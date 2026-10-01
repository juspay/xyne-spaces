import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '@/middleware/errorHandler';
import {
  claimAppSigningSecret,
  ensureOrgAppConfig,
  findOrgAppsByName,
  findWorkspaceOrgId,
  joinAppBotToGeneralChannel,
  provisionOrgApp,
} from '@/bypassAcl/appServices';
import { installOrgAppForWorkspace } from '@/bypassAcl/installAppWrapper';
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

const ensureInstalledSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).trim(),
  description: z.string().trim().optional(),
  /** URL template; the literal ":appId" segment is substituted with the app id. */
  webhookUrlTemplate: z.string().min(1).optional(),
  /** Desired app TEMPLATE permissions (e.g. ["chat:write"]); intersected with the registry. */
  permissions: z.array(z.string()).optional(),
  /** Preferred owner — must be a user of `workspaceId`; falls back to that workspace's oldest active user. */
  preferredCreatedByUserId: z.string().optional(),
  /** Tenant scope the app is created/installed under. */
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
  const fresh = encrypt(crypto.randomBytes(32).toString('hex'));
  const rows = await claimAppSigningSecret(appId, fresh);
  return rows[0]?.signingSecret ?? fresh;
}

interface EnsuredApp {
  appId: string;
  signingSecretEnc: string;
  appCreated: boolean;
}

/** Create-or-adopt the org app, converge its config, return credentials. Handles concurrent-create races. */
async function ensureOrgApp(input: z.infer<typeof ensureInstalledSchema>): Promise<EnsuredApp> {
  const existing = (await findOrgAppsByName(input.orgId, input.name))[0]; // oldest first
  if (existing) {
    await ensureOrgAppConfig(existing.id, existing.workspaceId, {
      webhookUrl: input.webhookUrlTemplate ? substituteAppId(input.webhookUrlTemplate, existing.id) : undefined,
      permissions: input.permissions,
    });
    return {
      appId: existing.id,
      signingSecretEnc: await ensureSigningSecretEnc(existing.id, existing.signingSecret),
      appCreated: false,
    };
  }

  try {
    const created = await provisionOrgApp(input);
    await ensureOrgAppConfig(created.id, created.workspaceId, {
      webhookUrl: input.webhookUrlTemplate ? substituteAppId(input.webhookUrlTemplate, created.id) : undefined,
      permissions: input.permissions,
    });
    return { appId: created.id, signingSecretEnc: created.signingSecret, appCreated: true };
  } catch (err) {
    // Lost a concurrent create race — adopt whatever the winner created.
    if (err instanceof Error && err.message.includes('already exists')) {
      const winner = (await findOrgAppsByName(input.orgId, input.name))[0];
      if (winner) {
        await ensureOrgAppConfig(winner.id, winner.workspaceId, {
          webhookUrl: input.webhookUrlTemplate ? substituteAppId(input.webhookUrlTemplate, winner.id) : undefined,
          permissions: input.permissions,
        });
        return {
          appId: winner.id,
          signingSecretEnc: await ensureSigningSecretEnc(winner.id, winner.signingSecret),
          appCreated: false,
        };
      }
    }
    throw err;
  }
}

/**
 * Idempotently ensure an org app exists and is installed in the given workspace in one shot.
 * Creates or adopts the org app (oldest same-name app wins), installs into the workspace,
 * and returns both credentials. Fully idempotent — safe to call on every workspace sync.
 */
router.post(
  '/ensure-installed',
  route(async (req, res) => {
    const input = ensureInstalledSchema.parse(req.body);

    const workspaceOrgId = await findWorkspaceOrgId(input.workspaceId);
    if (!workspaceOrgId) throw new AppError('Workspace not found', 404);
    if (workspaceOrgId !== input.orgId) {
      throw new AppError('workspaceId does not belong to orgId', 400);
    }

    const { appId, signingSecretEnc, appCreated } = await ensureOrgApp(input);

    // installOrgAppForWorkspace is idempotent: re-running updates the existing install row.
    const { jwtToken } = await installOrgAppForWorkspace(appId, input.workspaceId);

    if (input.addToGeneralChannel) {
      // Best-effort: credentials already returned; a join failure must not fail the response.
      try {
        const channelId = await joinAppBotToGeneralChannel(appId, input.workspaceId);
        if (channelId) {
          logger.info(`[apps-internal] joined app ${appId} bot to general channel ${channelId} in workspace ${input.workspaceId}`);
        } else {
          logger.warn(`[apps-internal] no install row / general channel found — app ${appId} bot not joined in workspace=${input.workspaceId}`);
        }
      } catch (err) {
        logger.error(`[apps-internal] general-channel join failed app=${appId} workspace=${input.workspaceId}:`, err);
      }
    }

    logger.info(`[apps-internal] app=${appId} (${input.name}) installed in workspace=${input.workspaceId} appCreated=${appCreated}`);
    res.status(200).json({ appId, signingSecret: decrypt(signingSecretEnc), jwtToken, appCreated });
  }),
);

export default router;
