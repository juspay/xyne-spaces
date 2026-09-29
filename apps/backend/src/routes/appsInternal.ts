import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '@/middleware/errorHandler';
import {
  claimAppSigningSecret,
  ensureOrgAppConfig,
  findOrgAppByName,
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

/**
 * Internal S2S routes for org-scoped app provisioning (mounted at /api/internal/apps,
 * guarded by validateS2SKey in app.ts). Used by claw-auth's spaces-sync flow to create
 * the org's default-agent apps and install them into newly created workspaces — the
 * user-auth /api/apps/* routes are unreachable from that context. All DB access is
 * delegated to named operations in bypassAcl/appServices.ts (bypass audit boundary).
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

/** Lazily claim the at-rest signing secret for legacy apps that lack it, sharing installApp's atomic COALESCE claim. */
async function ensureSigningSecretEnc(appId: string, signingSecretEnc: string | null): Promise<string> {
  if (signingSecretEnc) return signingSecretEnc;
  const fresh = await encrypt(crypto.randomBytes(32).toString('hex'));
  const rows = await claimAppSigningSecret(appId, fresh);
  return rows[0]?.signingSecret ?? fresh;
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

    // Defence-in-depth: the tenant-key workspace must belong to the app's org.
    const workspaceOrgId = await findWorkspaceOrgId(input.workspaceId);
    if (!workspaceOrgId) throw new AppError('Workspace not found', 404);
    if (workspaceOrgId !== input.orgId) {
      throw new AppError('workspaceId does not belong to orgId', 400);
    }

    const existing = await findOrgAppByName(input.orgId, input.name);
    if (existing) {
      await ensureOrgAppConfig(existing.id, existing.workspaceId, {
        webhookUrl: input.webhookUrlTemplate
          ? substituteAppId(input.webhookUrlTemplate, existing.id)
          : undefined,
        permissions: input.permissions,
      });
      const signingSecretEnc = await ensureSigningSecretEnc(existing.id, existing.signingSecret);
      res.status(200).json({ id: existing.id, signingSecret: decrypt(signingSecretEnc), created: false });
      return;
    }

    let created;
    try {
      created = await provisionOrgApp(input);
    } catch (err) {
      // Lost a concurrent create race — the winner answers the same lookup now.
      if (err instanceof Error && err.message.includes('already exists')) {
        const winner = await findOrgAppByName(input.orgId, input.name);
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

    res.status(200).json({ installed: await isAppInstalledInWorkspace(appId, workspaceId) });
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
