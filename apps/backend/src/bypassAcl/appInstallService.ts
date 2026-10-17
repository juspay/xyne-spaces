import { AuthProvider, UserType, OrgRole, AppPermissionStatus, ChannelRole } from '@xyne/shared';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { encrypt, decrypt } from '@/services/encryptionService';
import { isSpacesAppClawAgent } from '@/services/clawAgentService';
import { ensureUserInGeneralChannel } from '@/utils/workspaceGeneralChannel';
import { syncInstalledCommandsTx } from '@/bypassAcl/transactions/appUtils';
import { vespaQueue } from '@/queues/vespaQueue';
import { appSchema } from '@/vespa/src/types';
import { isValidUrl } from '@/utils/urlUtils';
import { logger } from '@/utils/logger';
import { asSystem, asService } from '@/bypassAcl/base';
import { claimAppSigningSecret } from '@/bypassAcl/appServices';
import { SYSTEM_USER_ID } from '@/database/tenant/context';

// ---------------------------------------------------------------------------
// Input type (mirrors the Zod schema in appsInternal.ts)
// ---------------------------------------------------------------------------

export interface EnsureInstalledInput {
  orgId: string;
  name: string;
  description?: string;
  webhookUrlTemplate?: string;
  permissions?: string[];
  preferredCreatedByUserId?: string;
  workspaceId: string;
  addToGeneralChannel?: boolean;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function substituteAppId(template: string, appId: string): string {
  const url = template.replace(/:appId/g, appId);
  if (!isValidUrl(url)) throw new Error(`webhookUrlTemplate produced an invalid URL: ${url}`);
  return url;
}

async function ensureSigningSecretEnc(appId: string, signingSecretEnc: string | null): Promise<string> {
  if (signingSecretEnc) return signingSecretEnc;
  const fresh = encrypt(crypto.randomBytes(32).toString('hex'));
  const rows = await claimAppSigningSecret(appId, fresh);
  return rows[0]?.signingSecret ?? fresh;
}

function findWorkspaceOrgId(workspaceId: string): Promise<string | null> {
  return asSystem(
    ['Workspace'],
    'S2S ensure-installed: validate caller workspace',
    async () =>
      (await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } }))?.orgId ?? null,
  );
}

function findOrgAppsByName(orgId: string, name: string) {
  return asSystem(
    ['Apps'],
    'S2S ensure-installed: org-wide idempotency lookup (app tenant key = creator workspace)',
    async () =>
      await db.apps.findMany({
        where: { orgId, name: { equals: name.trim(), mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
      }),
  );
}

function provisionOrgApp(input: EnsureInstalledInput) {
  return asService(
    ['Apps', 'User'],
    'S2S ensure-installed: create org app under caller workspace',
    SYSTEM_USER_ID,
    input.workspaceId,
    async () => {
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
      if (!creator) throw new Error('No active user available to own the app in this workspace');
      const app = await repositories.apps.createApp({
        name: input.name,
        description: input.description,
        createdBy: creator.id,
        orgId: input.orgId,
      });
      vespaQueue
        .addJob({ schema: appSchema, jobType: 'feed', docId: app.id })
        .catch((err) => logger.error(`Failed to queue Vespa feed for app ${app.id}:`, err));
      return app;
    },
  );
}

function ensureOrgAppConfig(
  appId: string,
  appWorkspaceId: string,
  config: { webhookUrl?: string; permissions?: string[] },
) {
  return asService(
    ['Apps', 'AppPermission', 'AvailableAppPermission'],
    'S2S ensure-installed: converge org app config under its own workspace',
    SYSTEM_USER_ID,
    appWorkspaceId,
    async () => {
      if (config.webhookUrl) {
        const current = await db.apps.findUnique({ where: { id: appId }, select: { webhookUrl: true } });
        if (current && current.webhookUrl !== config.webhookUrl)
          await db.apps.update({ where: { id: appId }, data: { webhookUrl: config.webhookUrl } });
      }
      if (config.permissions?.length) {
        const registry = await repositories.appPermissions.findAll();
        const available = new Set(registry.map((p) => `${p.name}:${String(p.type).toLowerCase()}`));
        const grantable = config.permissions.filter((s) => available.has(s));
        if (grantable.length > 0) {
          const current = await repositories.appPermissions.getAppPermissions(appId);
          const currentSet = new Set(current);
          const changed =
            grantable.some((s) => !currentSet.has(s)) || current.some((s) => !new Set(grantable).has(s));
          if (changed) {
            await repositories.appPermissions.setAppPermissions(appId, grantable);
            await repositories.apps.bumpVersion(appId);
          }
        }
      }
    },
  );
}

interface EnsuredApp {
  appId: string;
  signingSecretEnc: string;
  appCreated: boolean;
}

async function ensureOrgApp(input: EnsureInstalledInput): Promise<EnsuredApp> {
  const webhookUrl = (id: string) =>
    input.webhookUrlTemplate ? substituteAppId(input.webhookUrlTemplate, id) : undefined;

  const existing = (await findOrgAppsByName(input.orgId, input.name))[0];
  if (existing) {
    await ensureOrgAppConfig(existing.id, existing.workspaceId, {
      webhookUrl: webhookUrl(existing.id),
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
      webhookUrl: webhookUrl(created.id),
      permissions: input.permissions,
    });
    return { appId: created.id, signingSecretEnc: created.signingSecret, appCreated: true };
  } catch (err) {
    if (err instanceof Error && err.message.includes(`App with name '${input.name}' already exists`)) {
      const winner = (await findOrgAppsByName(input.orgId, input.name))[0];
      if (winner) {
        await ensureOrgAppConfig(winner.id, winner.workspaceId, {
          webhookUrl: webhookUrl(winner.id),
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

// ---------------------------------------------------------------------------
// Cross-workspace install — the ACL-bypassing core
// Two cross-workspace reads exist in the normal installApp path:
//   1. repositories.apps.findById          → ACL scopes to workspaceId; misses apps in other workspaces
//   2. db.appPermission.findMany({appId})   → same; returns no grants
// Both are handled here with asSystem bounded by the validated orgId.
// syncInstalledCommandsTx already uses the raw transaction client (bypassAcl/transactions/appUtils)
// and is unaffected.
// ---------------------------------------------------------------------------

async function installAppCrossWorkspace(
  appId: string,
  orgId: string,
  workspaceId: string,
): Promise<{ jwtToken: string }> {
  // Phase 1: cross-workspace reads under system scope, bounded by orgId check
  const { app, appPermissionIds } = await asSystem(
    ['Apps', 'AppPermission'],
    'S2S ensure-installed: cross-workspace app + permission read bounded by orgId',
    async () => {
      const app = await db.apps.findUnique({
        where: { id: appId },
        select: {
          id: true,
          name: true,
          signingSecret: true,
          version: true,
          webhookUrl: true,
          orgId: true,
        },
      });
      if (!app || app.orgId !== orgId) throw new Error(`App ${appId} not found in org ${orgId}`);
      const appPermissionIds = await db.appPermission.findMany({
        where: { appId },
        select: { permissionId: true },
      });
      return { app, appPermissionIds };
    },
  );

  // Phase 2: all writes are workspace-scoped under service context
  return await asService(
    ['InstalledApps', 'User', 'OrgMember', 'InstalledAppPermission', 'AppCommand', 'InstalledAppCommand'],
    'S2S ensure-installed: workspace-scoped install writes',
    SYSTEM_USER_ID,
    workspaceId,
    async () => {
      let signingSecretEnc = app.signingSecret;
      if (!signingSecretEnc) {
        const fresh = encrypt(crypto.randomBytes(32).toString('hex'));
        const rows = await claimAppSigningSecret(appId, fresh);
        signingSecretEnc = rows[0]?.signingSecret ?? fresh;
      }
      const signingSecret = decrypt(signingSecretEnc);

      // Update path — already installed in this workspace
      const existing = await db.installedApps.findFirst({ where: { appId, user: { workspaceId } } });
      if (existing) {
        const jwtToken = jwt.sign({ appId, userId: existing.userId }, signingSecret, { noTimestamp: true });
        await repositories.appPermissions.syncFromAppApproved(appId, existing.id);
        await syncInstalledCommandsTx(appId, existing.id, workspaceId);
        await db.installedApps.update({
          where: { id: existing.id },
          data: { version: app.version, webhookUrl: existing.webhookUrl ?? app.webhookUrl ?? null, updatedAt: new Date() },
        });
        return { jwtToken };
      }

      // New install — dedicated per-workspace bot user
      const botName = app.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      const email = `${botName}-${workspaceId}@app.xyne.ai`;

      const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } });
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const existingMember = await db.orgMember.findUnique({ where: { email }, select: { memberId: true } });
      const orgMember =
        existingMember ??
        (await db.orgMember.create({
          data: { email, orgId: workspace.orgId, role: OrgRole.MEMBER },
          select: { memberId: true },
        }));

      let appUser = await db.user.findFirst({ where: { email, workspaceId }, select: { id: true } });
      if (!appUser) {
        const userType = (await isSpacesAppClawAgent(appId)) ? UserType.AGENT : UserType.APP;
        appUser = await db.user.create({
          data: {
            name: app.name,
            email,
            providerUserId: `xyne-app-${appId}`,
            authProvider: AuthProvider.API_KEY,
            userType,
            status: 'ACTIVE',
            workspace: { connect: { id: workspaceId } },
            orgMember: { connect: { memberId: orgMember.memberId } },
          },
          select: { id: true },
        });
      }

      const jwtToken = jwt.sign({ appId, userId: appUser.id }, signingSecret, { noTimestamp: true });
      const now = new Date();
      const installedApp = await db.installedApps.create({
        data: {
          appId,
          userId: appUser.id,
          workspaceId,
          webhookUrl: app.webhookUrl ?? null,
          version: app.version,
          createdAt: now,
          updatedAt: now,
        },
      });

      // Copy app permissions — use pre-fetched grants from Phase 1 (avoids cross-workspace ACL block)
      if (appPermissionIds.length > 0) {
        await db.installedAppPermission.createMany({
          data: appPermissionIds.map((g) => ({
            installedAppId: installedApp.id,
            permissionId: g.permissionId,
            workspaceId,
            status: AppPermissionStatus.APPROVED,
          })),
          skipDuplicates: true,
        });
      }

      await syncInstalledCommandsTx(appId, installedApp.id, workspaceId);
      logger.info(`[S2S ensure-installed] app=${appId} installed in workspace=${workspaceId}`);
      return { jwtToken };
    },
  );
}

function joinAppBotToGeneralChannel(appId: string, workspaceId: string) {
  return asService(
    ['InstalledApps', 'Channel', 'ChannelParticipant'],
    'S2S ensure-installed: join app bot to general channel',
    SYSTEM_USER_ID,
    workspaceId,
    async () => {
      const installed = await repositories.installedApps.findFirst({ where: { appId, user: { workspaceId } } });
      if (!installed) return null;
      return await ensureUserInGeneralChannel(db, workspaceId, installed.userId, ChannelRole.MEMBER);
    },
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function ensureInstalled(input: EnsureInstalledInput): Promise<{
  appId: string;
  signingSecret: string;
  jwtToken: string;
  appCreated: boolean;
}> {
  const workspaceOrgId = await findWorkspaceOrgId(input.workspaceId);
  if (!workspaceOrgId) throw Object.assign(new Error('Workspace not found'), { statusCode: 404 });
  if (workspaceOrgId !== input.orgId)
    throw Object.assign(new Error('workspaceId does not belong to orgId'), { statusCode: 400 });

  const { appId, signingSecretEnc, appCreated } = await ensureOrgApp(input);
  const { jwtToken } = await installAppCrossWorkspace(appId, input.orgId, input.workspaceId);

  if (input.addToGeneralChannel) {
    try {
      const channelId = await joinAppBotToGeneralChannel(appId, input.workspaceId);
      if (channelId)
        logger.info(`[S2S ensure-installed] joined app ${appId} bot to general channel ${channelId} in workspace=${input.workspaceId}`);
      else
        logger.warn(`[S2S ensure-installed] no install row / general channel found — app ${appId} bot not joined workspace=${input.workspaceId}`);
    } catch (err) {
      logger.error(`[S2S ensure-installed] general-channel join failed app=${appId} workspace=${input.workspaceId}:`, err);
    }
  }

  logger.info(`[S2S ensure-installed] app=${appId} (${input.name}) workspace=${input.workspaceId} appCreated=${appCreated}`);
  return { appId, signingSecret: decrypt(signingSecretEnc), jwtToken, appCreated };
}
