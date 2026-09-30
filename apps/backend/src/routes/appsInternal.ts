import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '@/middleware/errorHandler';
import {
  claimAppSigningSecret,
  ensureOrgAppConfig,
  findOrgAppsByName,
  findOrgAppTemplate,
  findWorkspaceOrgId,
  installOrgAppForWorkspace,
  isAppInstalledInWorkspace,
  joinAppBotToGeneralChannel,
  provisionOrgApp,
} from '@/bypassAcl/appServices';
import { decrypt, encrypt } from '@/services/encryptionService';
import crypto from 'crypto';
import { isValidUrl } from '@/utils/urlUtils';
import { logger } from '@/utils/logger';

/** S2S org-app provisioning for claw-auth's spaces-sync; all DB access via bypassAcl/appServices. */
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

/** Lazily claim the at-rest signing secret for legacy apps that lack it, sharing installApp's atomic COALESCE claim. */
async function ensureSigningSecretEnc(appId: string, signingSecretEnc: string | null): Promise<string> {
  if (signingSecretEnc) return signingSecretEnc;
  const fresh = await encrypt(crypto.randomBytes(32).toString('hex'));
  const rows = await claimAppSigningSecret(appId, fresh);
  return rows[0]?.signingSecret ?? fresh;
}

/** Adoptable only if the stored webhook already equals this template resolved for the app's own id. */
function findTemplateOwnedApp<T extends { id: string; webhookUrl: string | null }>(
  apps: T[],
  webhookUrlTemplate: string | undefined,
): T | undefined {
  if (!webhookUrlTemplate) return undefined;
  return apps.find((app) => app.webhookUrl === substituteAppId(webhookUrlTemplate, app.id));
}

/**
 * Idempotently ensure an org app exists (orgId + name, case-insensitive). Names aren't unique,
 * so only a template-owned app is adopted — a foreign same-name app gets 409, never an adoption.
 * Returns the decrypted signing secret; S2S-only, the caller re-encrypts for webhook verification.
 */
router.post(
  '/',
  route(async (req, res) => {
    const input = createAppSchema.parse(req.body);

    const workspaceOrgId = await findWorkspaceOrgId(input.workspaceId);
    if (!workspaceOrgId) throw new AppError('Workspace not found', 404);
    if (workspaceOrgId !== input.orgId) {
      throw new AppError('workspaceId does not belong to orgId', 400);
    }

    const sameNameApps = await findOrgAppsByName(input.orgId, input.name);
    const existing = findTemplateOwnedApp(sameNameApps, input.webhookUrlTemplate);
    if (existing) {
      await ensureOrgAppConfig(existing.id, existing.workspaceId, {
        webhookUrl: substituteAppId(input.webhookUrlTemplate!, existing.id),
        permissions: input.permissions,
      });
      const signingSecretEnc = await ensureSigningSecretEnc(existing.id, existing.signingSecret);
      res.status(200).json({ id: existing.id, signingSecret: decrypt(signingSecretEnc), created: false });
      return;
    }
    if (sameNameApps.length > 0) {
      throw new AppError(
        `An app named "${input.name}" already exists in this org and was not provisioned for this webhook template — refusing to adopt it`,
        409,
      );
    }

    let created;
    try {
      created = await provisionOrgApp(input);
    } catch (err) {
      // Lost a concurrent create race — the winner answers the same lookup now.
      if (err instanceof Error && err.message.includes('already exists')) {
        const winner = findTemplateOwnedApp(
          await findOrgAppsByName(input.orgId, input.name),
          input.webhookUrlTemplate,
        );
        if (winner) {
          const signingSecretEnc = await ensureSigningSecretEnc(winner.id, winner.signingSecret);
          res.status(200).json({ id: winner.id, signingSecret: decrypt(signingSecretEnc), created: false });
          return;
        }
      }
      throw err;
    }

    await ensureOrgAppConfig(created.id, created.workspaceId, {
      webhookUrl: input.webhookUrlTemplate
        ? substituteAppId(input.webhookUrlTemplate, created.id)
        : undefined,
      permissions: input.permissions,
    });

    logger.info(`[apps-internal] Created org app ${created.id} (${input.name}) for org ${input.orgId}`);
    res.status(201).json({ id: created.id, signingSecret: decrypt(created.signingSecret), created: true });
  }),
);

/** Presence check: is this app installed in the given workspace. */
router.get(
  '/:appId/installations/:workspaceId',
  route(async (req, res) => {
    const { appId, workspaceId } = z
      .object({ appId: z.string().min(1), workspaceId: z.string().min(1) })
      .parse(req.params);

    res.status(200).json({ installed: await isAppInstalledInWorkspace(appId, workspaceId) });
  }),
);

/** Install an app into a workspace (same ORG-eligibility rule as the user-auth route; idempotent). */
router.post(
  '/:appId/install',
  route(async (req, res) => {
    const { appId } = z.object({ appId: z.string().min(1) }).parse(req.params);
    const { workspaceId, addToGeneralChannel } = installAppSchema.parse(req.body);

    const app = await findOrgAppTemplate(appId);
    if (!app) throw new AppError('App not found', 404);

    if (app.scope === 'ORG') {
      const workspaceOrgId = await findWorkspaceOrgId(workspaceId);
      if (!workspaceOrgId) throw new AppError('Workspace not found', 404);
      if (workspaceOrgId !== app.orgId) {
        throw new AppError('This app is not available to your workspace', 403);
      }
    }

    const result = await installOrgAppForWorkspace(appId, workspaceId);

    if (addToGeneralChannel) {
      // Best-effort: the install already succeeded; a join failure must not fail the response.
      try {
        const channelId = await joinAppBotToGeneralChannel(appId, workspaceId);
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
