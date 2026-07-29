import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
import { encrypt } from '@/services/encryptionService';
import crypto from 'crypto';

const TAG = '[AppSigningSecretBackfill]';

// Create-time default scope (scope is a free-text column now, not an enum).
const DEFAULT_SCOPE = 'ORG';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  // apps — every column the additive migration added with an '' / NULL sentinel, filled in one pass
  appsProcessed: number;
  signingSecretCopied: number;
  signingSecretGenerated: number;
  webhookCopied: number;
  scopeSet: number;
  orgIdSet: number;
  orgIdUnresolved: number;
  errors: number;
};

/**
 * Single backfill for the apps columns the additive migration added with sentinel defaults.
 * The migration added orgId/scope/signingSecret as `NOT NULL DEFAULT ''` and webhookUrl as
 * nullable, so legacy rows carry '' (or NULL for webhookUrl) — NOT NULL — until this runs.
 * (version is `NOT NULL DEFAULT 1` in the migration, so it never needs backfilling.)
 *
 * Walks all apps once and fills, per row (only where still the sentinel):
 *  - signingSecret — copy the app's per-install (encrypted) secret up, else generate a fresh one
 *  - webhookUrl    — copy a configured per-install webhook up to the app template
 *  - scope         — ORG (the create-time default)
 *  - orgId         — the creator's workspace org (createdBy -> users.workspaceId -> workspaces.orgId);
 *                    left '' + counted if it can't be resolved (e.g. deleted creator)
 * Idempotent — only touches columns still holding their sentinel value.
 */
export class AppSigningSecretBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{ batchSize: number; delayMs: number; dryRun: boolean }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 100;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;
    return { batchSize, delayMs, dryRun };
  }

  private static async backfillApps(options: BackfillOptions, summary: BackfillSummary): Promise<void> {
    let cursor: string | null = null;
    do {
      const apps: Array<{
        id: string;
        createdBy: string;
        signingSecret: string;
        webhookUrl: string | null;
        scope: string;
        orgId: string;
      }> = await db.apps.findMany({
        // Sentinels written by the migration: '' for orgId/scope/signingSecret, NULL for webhookUrl.
        where: {
          OR: [
            { signingSecret: '' },
            { webhookUrl: null },
            { scope: '' },
            { orgId: '' },
          ],
        },
        select: {
          id: true,
          createdBy: true,
          signingSecret: true,
          webhookUrl: true,
          scope: true,
          orgId: true,
        },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (apps.length === 0) break;

      for (const app of apps) {
        summary.appsProcessed += 1;
        try {
          const data: Prisma.AppsUpdateInput = {};

          if (app.signingSecret === '') {
            const install = await db.installedApps.findFirst({
              where: { appId: app.id, signingSecret: { not: null } },
              select: { signingSecret: true },
              orderBy: { id: 'asc' },
            });
            // Already-encrypted value moves as-is; generate only if no install had a (non-empty) secret.
            const copied = install?.signingSecret && install.signingSecret.length > 0 ? install.signingSecret : null;
            data.signingSecret = copied ?? (await encrypt(crypto.randomBytes(32).toString('hex')));
            if (copied) summary.signingSecretCopied += 1;
            else summary.signingSecretGenerated += 1;
          }

          if (app.webhookUrl === null) {
            const install = await db.installedApps.findFirst({
              where: { appId: app.id, webhookUrl: { not: null } },
              select: { webhookUrl: true },
              orderBy: { id: 'asc' },
            });
            if (install?.webhookUrl) {
              data.webhookUrl = install.webhookUrl;
              summary.webhookCopied += 1;
            }
          }

          if (app.scope === '') {
            data.scope = DEFAULT_SCOPE;
            summary.scopeSet += 1;
          }

          if (app.orgId === '') {
            // Derive the owning org from the creator's workspace.
            const user = await db.user.findUnique({
              where: { id: app.createdBy },
              select: { workspaceId: true },
            });
            const workspace = user?.workspaceId
              ? await db.workspace.findUnique({
                  where: { id: user.workspaceId },
                  select: { orgId: true },
                })
              : null;
            if (workspace?.orgId) {
              data.orgId = workspace.orgId;
              summary.orgIdSet += 1;
            } else {
              summary.orgIdUnresolved += 1;
            }
          }

          if (!options.dryRun && Object.keys(data).length > 0) {
            await db.apps.update({ where: { id: app.id }, data });
          }
        } catch (error) {
          summary.errors += 1;
          logger.warn(`${TAG} Failed to backfill app`, {
            appId: app.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Cursor advances by id regardless of whether a row dropped out of the filter, so the loop
      // always terminates (orgId-unresolved rows stay '' but are skipped past).
      cursor = apps[apps.length - 1]?.id ?? null;
      logger.info(`${TAG} apps batch completed`, { batchSize: apps.length, ...summary });
      if (options.delayMs > 0) await AppSigningSecretBackfillController.sleep(options.delayMs);
    } while (cursor);
  }

  private static async runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      appsProcessed: 0,
      signingSecretCopied: 0,
      signingSecretGenerated: 0,
      webhookCopied: 0,
      scopeSet: 0,
      orgIdSet: 0,
      orgIdUnresolved: 0,
      errors: 0,
    };
    await AppSigningSecretBackfillController.backfillApps(options, summary);
    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const options = AppSigningSecretBackfillController.buildOptions(req.body);
      logger.info(`${TAG} Starting backfill`, options);

      const summary = await AppSigningSecretBackfillController.runBackfill(options);

      logger.info(`${TAG} Backfill completed`, summary);
      res.status(200).json({
        success: true,
        message: 'Backfill completed',
        data: { options, summary },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`${TAG} Error during backfill:`, error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
