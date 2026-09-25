import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { AppError } from '@/middleware/errorHandler';
import { installApp } from '@/apps/core/appUtils';
import { runAsServiceActor, runAsSystem, SYSTEM_USER_ID } from '@/database/tenant/context';
import { decrypt, encrypt } from '@/services/encryptionService';
import crypto from 'crypto';
import { isValidUrl } from '@/utils/urlUtils';
import { vespaQueue } from '@/queues/vespaQueue';
import { appSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { ChannelRole } from '@xyne/shared';
import { ensureUserInGeneralChannel } from '@/utils/workspaceGeneralChannel';

/**
 * Internal S2S routes for org-scoped app provisioning (mounted at /api/internal/apps,
 * guarded by validateS2SKey in app.ts). Used by claw-auth's spaces-sync flow to create
 * the org's default-agent apps and install them into newly created workspaces — the
 * user-auth /api/apps/* routes are unreachable from that context.
 */
const router = Router();

function route(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

const createAppSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).trim(),
  description: z.string().trim().optional(),
  /** URL template; the literal ":appId" segment is substituted with the app id. */
  webhookUrlTemplate: z.string().min(1).optional(),
  /** Desired app TEMPLATE permissions (e.g. ["chat:write"]); intersected with the registry. */
  permissions: z.array(z.string()).optional(),
  /** Preferred owner — must be a user of `workspaceId`; falls back to that workspace's oldest active user. */
  preferredCreatedByUserId: z.string().optional(),
  /** Tenant scope the app is created under (creator snapshot + permission rows). */
  workspaceId: z.string().min(1),
});

const installAppSchema = z.object({
  workspaceId: z.string().min(1),
  /** Also join the install's bot user to the workspace's "general" channel. */
  addToGeneralChannel: z.boolean().optional(),
});

function substituteAppId(template: string, appId: string): string {
  const url = template.replace(/:appId/g, appId);
  if (!isValidUrl(url)) throw new AppError(`webhookUrlTemplate produced an invalid URL: ${url}`, 400);
  return url;
}

/** Grant only scopes the registry knows — the registry may be partially seeded per environment. */
async function grantRegistryIntersection(appId: string, permissions: string[]): Promise<string[]> {
  const registry = await repositories.appPermissions.findAll();
  const available = new Set(registry.map((p) => `${p.name}:${String(p.type).toLowerCase()}`));
  const grantable = permissions.filter((s) => available.has(s));
  if (grantable.length > 0) {
    await repositories.appPermissions.setAppPermissions(appId, grantable);
  }
  return grantable;
}

/**
 * POST /api/internal/apps
 * Idempotently ensure an ORG-scoped app exists (matched by orgId + name, case-insensitive,
 * same rule as AppsRepository.createApp). Returns the app id and the decrypted app-level
 * signing secret — plaintext is acceptable here because this route is S2S-only; the caller
 * (claw-auth) re-encrypts under its own key for webhook HMAC verification.
 */
router.post(
  '/',
  route(async (req, res) => {
    const input = createAppSchema.parse(req.body);

    // Defence-in-depth (same rule install enforces): the workspace the app is
    // tenant-keyed to must belong to the org the app is scoped to. S2S-trusted
    // callers should never send a mismatched pair, but the write is cross-org.
    const workspace = await runAsServiceActor(SYSTEM_USER_ID, input.workspaceId, () =>
      db.workspace.findUnique({ where: { id: input.workspaceId }, select: { orgId: true } }),
    );
    if (!workspace) throw new AppError('Workspace not found', 404);
    if (workspace.orgId !== input.orgId) {
      throw new AppError('workspaceId does not belong to orgId', 400);
    }

    // Apps are org-level but carry the creator's workspace as their tenant key — the
    // idempotency lookup must span workspaces or a second workspace would recreate the app.
    const existing = await runAsSystem(() =>
      db.apps.findFirst({
        where: { orgId: input.orgId, name: { equals: input.name, mode: 'insensitive' } },
      }),
    );

    if (existing) {
      // Legacy/migrated apps may lack a signing secret — lazy-generate one with the
      // same atomic COALESCE installApp uses, so concurrent ensures can't race.
      let signingSecretEnc = existing.signingSecret;
      if (!signingSecretEnc) {
        const fresh = await encrypt(crypto.randomBytes(32).toString('hex'));
        const rows = await db.$queryRaw<{ signingSecret: string | null }[]>`
          UPDATE apps SET "signingSecret" = COALESCE("signingSecret", ${fresh})
          WHERE id = ${existing.id} RETURNING "signingSecret"`;
        signingSecretEnc = rows[0]?.signingSecret ?? fresh;
      }
      // Ensure-ups run under the APP'S OWN tenant key (its creator's workspace),
      // not the caller's: the ACL extension gates updates by the enforced
      // workspace, and this app may have been created under a different one.
      await runAsServiceActor(SYSTEM_USER_ID, existing.workspaceId, async () => {
        if (input.webhookUrlTemplate) {
          const webhookUrl = substituteAppId(input.webhookUrlTemplate, existing.id);
          if (existing.webhookUrl !== webhookUrl) {
            await db.apps.update({ where: { id: existing.id }, data: { webhookUrl } });
          }
        }
        if (input.permissions?.length) {
          await grantRegistryIntersection(existing.id, input.permissions);
        }
      });
      res.status(200).json({ id: existing.id, signingSecret: decrypt(signingSecretEnc), created: false });
      return;
    }

    const created = await runAsServiceActor(SYSTEM_USER_ID, input.workspaceId, async () => {
      const creator =
        (input.preferredCreatedByUserId
          ? await db.user.findFirst({
              where: { id: input.preferredCreatedByUserId, workspaceId: input.workspaceId, status: 'ACTIVE' },
              select: { id: true },
            })
          : null) ??
        (await db.user.findFirst({
          where: { workspaceId: input.workspaceId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        }));
      if (!creator) {
        throw new AppError('No active user available to own the app in this workspace', 409);
      }

      const app = await repositories.apps.createApp({
        name: input.name,
        description: input.description,
        createdBy: creator.id,
        orgId: input.orgId,
      });

      if (input.webhookUrlTemplate) {
        await db.apps.update({
          where: { id: app.id },
          data: { webhookUrl: substituteAppId(input.webhookUrlTemplate, app.id) },
        });
      }
      if (input.permissions?.length) {
        await grantRegistryIntersection(app.id, input.permissions);
      }

      // Mirror AppController.createApp: queue Vespa indexing for the new app.
      vespaQueue
        .addJob({ schema: appSchema, jobType: 'feed', docId: app.id })
        .catch((err) => logger.error(`Failed to queue Vespa feed for app ${app.id}:`, err));

      return app;
    });

    logger.info(`[apps-internal] Created org app ${created.id} (${input.name}) for org ${input.orgId}`);
    res.status(201).json({ id: created.id, signingSecret: decrypt(created.signingSecret), created: true });
  }),
);

/**
 * GET /api/internal/apps/:appId/installations/:workspaceId
 * Presence check — whether this app has an install row in the given workspace.
 * Lets claw-auth install exactly the apps a workspace is missing instead of
 * keying off the sync's `created` flag (which a transient failure can strand).
 */
router.get(
  '/:appId/installations/:workspaceId',
  route(async (req, res) => {
    const { appId, workspaceId } = z
      .object({ appId: z.string().min(1), workspaceId: z.string().min(1) })
      .parse(req.params);

    const installed = await runAsServiceActor(SYSTEM_USER_ID, workspaceId, () =>
      repositories.installedApps.findFirst({
        where: { appId, user: { workspaceId } },
      }),
    );
    res.status(200).json({ installed: Boolean(installed) });
  }),
);

/**
 * POST /api/internal/apps/:appId/install
 * Install an app into a workspace. Same ORG-scope eligibility rule as the user-auth
 * route; installApp itself is idempotent (an existing install is refreshed — new JWT,
 * permissions re-synced, version bumped).
 */
router.post(
  '/:appId/install',
  route(async (req, res) => {
    const { appId } = z.object({ appId: z.string().min(1) }).parse(req.params);
    const { workspaceId, addToGeneralChannel } = installAppSchema.parse(req.body);

    const app = await repositories.apps.findById(appId);
    if (!app) throw new AppError('App not found', 404);

    const result = await runAsServiceActor(SYSTEM_USER_ID, workspaceId, async () => {
      if (app.scope === 'ORG') {
        const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } });
        if (!workspace) throw new AppError('Workspace not found', 404);
        if (workspace.orgId !== app.orgId) {
          throw new AppError('This app is not available to your workspace', 403);
        }
      }
      return installApp(appId, workspaceId);
    });

    if (addToGeneralChannel) {
      // Best-effort: the install above already succeeded; a missing general
      // channel or join failure must not fail the install response.
      try {
        const channelId = await runAsServiceActor(SYSTEM_USER_ID, workspaceId, async () => {
          const installed = await repositories.installedApps.findFirst({
            where: { appId, user: { workspaceId } },
          });
          if (!installed) return undefined;
          return ensureUserInGeneralChannel(db, workspaceId, installed.userId, ChannelRole.MEMBER);
        });
        if (channelId) {
          logger.info(`[apps-internal] joined app ${appId} bot to general channel ${channelId} in workspace ${workspaceId}`);
        } else {
          logger.warn(`[apps-internal] no install row / general channel found — app ${appId} bot not joined in workspace=${workspaceId}`);
        }
      } catch (err) {
        logger.error(`[apps-internal] general-channel join failed app=${appId} workspace=${workspaceId}:`, err);
      }
    }

    logger.info(`[apps-internal] Installed app ${appId} into workspace ${workspaceId}`);
    res.status(200).json(result);
  }),
);

export default router;
