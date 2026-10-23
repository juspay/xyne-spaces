import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { encrypt, decrypt } from '@/services/encryptionService';
import { repositories } from '@/database/repositories';
import { AuthProvider, UserType, OrgRole, AppPermissionStatus, ChannelRole } from '@xyne/shared';
import { asSystem, asService } from './base';
import { claimAppSigningSecret } from '@/bypassAcl/appServices';
import { syncInstalledCommandsTx } from '@/bypassAcl/transactions/appUtils';
import { parseScope } from '@/database/repositories/appPermissionRepository';
import { ensureUserInGeneralChannel } from '@/utils/workspaceGeneralChannel';
import { withWorkspaceScope, currentWorkspaceId } from '@/database/tenant/context';
import { isSpacesAppClawAgent } from '@/services/clawAgentService';

interface AppInstallData {
  id: string;
  name: string;
  signingSecret: string | null;
  webhookUrl: string | null;
  version: number;
  /** Template permission IDs pre-fetched under asSystem — used instead of copyFromApp. */
  permissionIds: string[];
}

export interface EnsureInstalledParams {
  orgId: string;
  name: string;
  targetWorkspaceId: string;
  /** Spaces user ID to record as the app creator. Falls back to the workspace creator. */
  preferredCreatedByUserId?: string;
  description?: string;
  /**
   * Webhook URL template — `:appId` is substituted with the real app ID before storage.
   * e.g. `https://claw.example.com/claw/api/v1/webhook/app/:appId`
   */
  webhookUrlTemplate?: string;
  /** Permission scopes in `resource:action` format to grant on the app. */
  permissions?: string[];
  /** When true, adds the bot user to the workspace general channel after install. */
  addToGeneralChannel?: boolean;
}

/**
 * Write phase: installs or updates the app into targetWorkspaceId using pre-fetched app
 * data and permission IDs from the read phase. Runs entirely within bypassAcl/ so the
 * cross-workspace privilege escalation is explicit and isolated.
 *
 * Do NOT call installApp from appUtils here — that function is for normal tenant-scoped
 * installs and does not accept pre-fetched data. All bypass logic stays in this file.
 */
async function writeInstall(
  app: AppInstallData,
  targetWorkspaceId: string,
  addToGeneralChannel: boolean,
): Promise<{ jwtToken: string; signingSecret: string }> {
  return asService(
    ['InstalledApps', 'InstalledAppPermission', 'User', 'OrgMember', 'InstalledAppCommand', 'ChannelParticipant'],
    'ensure-installed s2s: write phase runs as a service actor so currentWorkspaceId() is correct for all stamps',
    'ensure-installed-service',
    targetWorkspaceId,
    async () => {
      // Signing secret — lazy-generate if missing (same atomic COALESCE as installApp).
      let signingSecretEnc = app.signingSecret;
      if (!signingSecretEnc) {
        const fresh = await encrypt(crypto.randomBytes(32).toString('hex'));
        const rows = await claimAppSigningSecret(app.id, fresh);
        signingSecretEnc = rows[0]?.signingSecret ?? fresh;
      }
      const signingSecret = decrypt(signingSecretEnc);

      // Update path — already installed in this workspace.
      const existingInstall = await repositories.installedApps.findFirst({
        where: { appId: app.id, user: { workspaceId: targetWorkspaceId } },
      });
      if (existingInstall) {
        const jwtToken = jwt.sign({ appId: app.id, userId: existingInstall.userId }, signingSecret, { noTimestamp: true });
        const ws = currentWorkspaceId();
        if (ws && app.permissionIds.length > 0) {
          await db.installedAppPermission.createMany({
            data: app.permissionIds.map((permissionId) => ({
              installedAppId: existingInstall.id,
              permissionId,
              workspaceId: ws,
              status: AppPermissionStatus.APPROVED,
            })),
            skipDuplicates: true,
          });
        }
        await syncInstalledCommandsTx(app.id, existingInstall.id, targetWorkspaceId);
        await repositories.installedApps.update(existingInstall.id, {
          version: app.version,
          webhookUrl: existingInstall.webhookUrl ?? app.webhookUrl ?? null,
          updatedAt: new Date(),
        });
        if (addToGeneralChannel) {
          await ensureUserInGeneralChannel(db, targetWorkspaceId, existingInstall.userId, ChannelRole.MEMBER);
        }
        return { jwtToken, signingSecret };
      }

      // New install — dedicated per-workspace bot user.
      const botName = app.name.toLowerCase().trim()
        .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const email = `${botName}-${targetWorkspaceId}@app.xyne.ai`;

      const workspace = await db.workspace.findUnique({ where: { id: targetWorkspaceId }, select: { orgId: true } });
      if (!workspace) throw new Error(`[ENSURE-INSTALLED] workspace ${targetWorkspaceId} not found in write phase`);

      const orgMember = await withWorkspaceScope(async () => {
        const existing = await db.orgMember.findUnique({ where: { email }, select: { memberId: true } });
        if (existing) return existing;
        return db.orgMember.create({
          data: { email, orgId: workspace.orgId, role: OrgRole.MEMBER },
          select: { memberId: true },
        });
      });

      let appUser = await repositories.users.findByEmail(email, targetWorkspaceId);
      if (!appUser) {
        const userType = (await isSpacesAppClawAgent(app.id)) ? UserType.AGENT : UserType.APP;
        appUser = await repositories.users.create({
          name: app.name,
          email,
          providerUserId: `xyne-app-${app.id}`,
          authProvider: AuthProvider.API_KEY,
          userType,
          status: 'ACTIVE',
          workspace: { connect: { id: targetWorkspaceId } },
          orgMember: { connect: { memberId: orgMember.memberId } },
        });
      }

      const jwtToken = jwt.sign({ appId: app.id, userId: appUser.id }, signingSecret, { noTimestamp: true });

      const now = new Date();
      const installedApp = await repositories.installedApps.create({
        appId: app.id,
        userId: appUser.id,
        workspaceId: targetWorkspaceId,
        webhookUrl: app.webhookUrl ?? null,
        version: app.version,
        createdAt: now,
        updatedAt: now,
      });

      const ws = currentWorkspaceId();
      if (ws && app.permissionIds.length > 0) {
        await db.installedAppPermission.createMany({
          data: app.permissionIds.map((permissionId) => ({
            installedAppId: installedApp.id,
            permissionId,
            workspaceId: ws,
            status: AppPermissionStatus.APPROVED,
          })),
          skipDuplicates: true,
        });
      }

      await syncInstalledCommandsTx(app.id, installedApp.id, targetWorkspaceId);

      if (addToGeneralChannel) {
        await ensureUserInGeneralChannel(db, targetWorkspaceId, appUser.id, ChannelRole.MEMBER);
      }

      return { jwtToken, signingSecret };
    },
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Idempotently ensures a named org app exists and is installed in targetWorkspaceId.
 *
 * Read phase (asSystem): finds or creates the app by (orgId, name), validates same-org
 * ownership, resolves permissions, and reads its permission grants — all in one
 * cross-workspace pass.
 *
 * Write phase (asService): runs the install/update logic with currentWorkspaceId()
 * returning targetWorkspaceId so every stamp lands in the right place.
 */
export async function ensureInstalled(
  params: EnsureInstalledParams,
): Promise<{ appId: string; signingSecret: string; jwtToken: string; appCreated: boolean }> {
  const {
    orgId,
    name,
    targetWorkspaceId,
    preferredCreatedByUserId,
    description,
    webhookUrlTemplate,
    permissions,
    addToGeneralChannel = false,
  } = params;

  // ── Read phase ────────────────────────────────────────────────────────────
  const { appData, appCreated } = await asSystem(
    ['Apps', 'AppPermission', 'AvailableAppPermission', 'Workspace'],
    'ensure-installed s2s: app and permission grants may live in a sibling workspace — read both under asSystem before the write phase',
    async () => {
      const trimmedName = name.trim();
      const now = new Date();

      // Validate workspace and resolve fallback createdBy in one query.
      const workspace = await db.workspace.findUnique({
        where: { id: targetWorkspaceId },
        select: { orgId: true },
      });
      if (!workspace) throw new Error(`[ENSURE-INSTALLED] workspace ${targetWorkspaceId} not found`);
      if (workspace.orgId !== orgId) {
        throw new Error(`[ENSURE-INSTALLED] workspace ${targetWorkspaceId} does not belong to org ${orgId}`);
      }

      // Fall back to the first active human user in the workspace when no explicit
      // creator is supplied (e.g. background sync without a logged-in user).
      let resolvedCreatedBy = preferredCreatedByUserId;
      if (!resolvedCreatedBy) {
        const fallbackUser = await db.user.findFirst({
          where: { workspaceId: targetWorkspaceId, status: 'ACTIVE', NOT: { userType: 'APP' } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!fallbackUser) {
          throw new Error(`[ENSURE-INSTALLED] no active user found in workspace ${targetWorkspaceId} to use as app creator`);
        }
        resolvedCreatedBy = fallbackUser.id;
      }

      // Resolve permission IDs from scope strings once (shared by create + update paths).
      let resolvedPermissionIds: string[] = [];
      if (permissions && permissions.length > 0) {
        const parsed = permissions.map(parseScope);
        const available = await db.availableAppPermission.findMany({
          where: { OR: parsed.map(({ name: n, type }) => ({ name: n, type })) },
          select: { id: true },
        });
        resolvedPermissionIds = available.map((p) => p.id);
      }

      // Find or create the org app.
      let appCreated = false;
      let appRow = await db.apps.findFirst({
        where: { orgId, name: { equals: trimmedName, mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
      });

      if (!appRow) {
        try {
          appRow = await db.apps.create({
            data: {
              name: trimmedName,
              description: description ?? null,
              orgId,
              workspaceId: targetWorkspaceId,
              scope: 'ORG',
              version: 1,
              createdBy: resolvedCreatedBy,
              signingSecret: await encrypt(crypto.randomBytes(32).toString('hex')),
              createdAt: now,
              updatedAt: now,
            },
          });
          appCreated = true;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            // Lost the creation race — read the winning row.
            appRow = await db.apps.findFirst({
              where: { orgId, name: { equals: trimmedName, mode: 'insensitive' } },
              orderBy: { createdAt: 'asc' },
            });
            if (!appRow) throw new Error(`[ENSURE-INSTALLED] app '${trimmedName}' vanished after creation race`);
          } else {
            throw error;
          }
        }
      } else {
        // Existing app — validate its org matches the supplied orgId (cross-org guard).
        if (appRow.orgId !== orgId) {
          throw new Error(`[ENSURE-INSTALLED] app '${trimmedName}' belongs to org ${appRow.orgId}, not ${orgId}`);
        }
      }

      // Resolve final webhookUrl: substitute :appId in the template.
      const resolvedWebhookUrl = webhookUrlTemplate
        ? webhookUrlTemplate.replace(':appId', appRow.id)
        : null;

      // Persist webhookUrl on the app row if it has changed.
      if (resolvedWebhookUrl && resolvedWebhookUrl !== appRow.webhookUrl) {
        await db.apps.update({
          where: { id: appRow.id },
          data: { webhookUrl: resolvedWebhookUrl, updatedAt: new Date() },
        });
        appRow = { ...appRow, webhookUrl: resolvedWebhookUrl };
      }

      // For new apps: set app-level permissions directly (asSystem block — pass
      // targetWorkspaceId explicitly rather than relying on currentWorkspaceId()).
      if (appCreated && resolvedPermissionIds.length > 0) {
        await db.appPermission.createMany({
          data: resolvedPermissionIds.map((permissionId) => ({
            appId: appRow!.id,
            permissionId,
            workspaceId: targetWorkspaceId,
          })),
          skipDuplicates: true,
        });
      }

      // For existing apps: read current grants (install path uses them).
      let grantIds = resolvedPermissionIds;
      if (!appCreated) {
        const existingGrants = await db.appPermission.findMany({
          where: { appId: appRow.id },
          select: { permissionId: true },
        });
        grantIds = existingGrants.map((g) => g.permissionId);
      }

      const appData: AppInstallData = {
        id: appRow.id,
        name: appRow.name,
        signingSecret: appRow.signingSecret,
        webhookUrl: appRow.webhookUrl,
        version: appRow.version,
        permissionIds: grantIds,
      };

      return { appData, appCreated };
    },
  );

  // ── Write phase ───────────────────────────────────────────────────────────
  const { jwtToken, signingSecret } = await writeInstall(appData, targetWorkspaceId, addToGeneralChannel);

  return { appId: appData.id, signingSecret, jwtToken, appCreated };
}
