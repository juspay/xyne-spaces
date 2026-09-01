import { repositories } from '@/database/repositories';
import { AuthProvider, UserType, OrgRole } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { encrypt, decrypt } from '@/services/encryptionService';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { isValidUrl } from '@/utils/urlUtils';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { getAppEditorRole } from './appCollaboratorUtils';

/**
 * Install an external app
 *
 * @param appId - The ID of the external app to install
 * @param workspaceId - The workspace ID to install the app in
 * @returns The created installed app entry
 */
/**
 * Sync a workspace's installed command snapshot with the app's current commands.
 * Upserts each template command (matched by sourceCommandId) and removes installed commands
 * whose template source no longer exists. Used on both install and Update.
 */
async function syncInstalledCommands(installedAppId: string, appId: string, workspaceId: string): Promise<void> {
  // One transaction so the install never ends up with a half-synced command snapshot if the
  // process dies mid-loop (partial create/update/delete).
  await db.$transaction(async (tx) => {
    const now = new Date();
    const [templateCommands, existing] = await Promise.all([
      tx.appCommand.findMany({ where: { appId } }),
      tx.installedAppCommand.findMany({ where: { installedAppId } }),
    ]);
    const existingBySource = new Map(existing.map(e => [e.sourceCommandId, e]));
    const templateIds = new Set(templateCommands.map(c => c.id));

    for (const c of templateCommands) {
      const prev = existingBySource.get(c.id);
      if (prev) {
        await tx.installedAppCommand.update({
          where: { id: prev.id },
          data: {
            commandName: c.commandName,
            description: c.description,
            commandType: c.commandType,
            commandAccessibility: c.commandAccessibility,
            updatedAt: now,
          },
        });
      } else {
        await tx.installedAppCommand.create({
          data: {
            installedAppId,
            workspaceId,
            sourceCommandId: c.id,
            commandName: c.commandName,
            description: c.description,
            commandType: c.commandType,
            commandAccessibility: c.commandAccessibility,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }

    for (const e of existing) {
      if (!templateIds.has(e.sourceCommandId)) {
        await tx.installedAppCommand.delete({ where: { id: e.id } });
      }
    }
  });
}

/**
 * Install (or Update) an app into a workspace. Each install is a version-frozen snapshot of the
 * app's commands + permissions; calling again for the same workspace performs an Update.
 */
export async function installApp(appId: string, workspaceId: string) {
  try {
    const app = await repositories.apps.findById(appId);
    if (!app) {
      throw new Error(`[INSTALL-APP] App with ID ${appId} not found`);
    }

    // App-level signing secret (lazy-generate for legacy/migrated apps that lack one). One secret
    // per app — the per-install JWT and outbound webhook HMAC are all signed with it. The write is
    // atomic (COALESCE) so concurrent first-installs can't generate competing secrets: only the
    // first writer sets it and every caller reads back the persisted (winning) value.
    let signingSecretEnc = app.signingSecret;
    if (!signingSecretEnc) {
      const fresh = await encrypt(crypto.randomBytes(32).toString('hex'));
      const rows = await db.$queryRaw<{ signingSecret: string | null }[]>`
        UPDATE apps SET "signingSecret" = COALESCE("signingSecret", ${fresh})
        WHERE id = ${appId} RETURNING "signingSecret"`;
      signingSecretEnc = rows[0]?.signingSecret ?? fresh;
    }
    const signingSecret = decrypt(signingSecretEnc);

    // 1. Update path — already installed IN THIS WORKSPACE (scoped via the app user's workspace,
    // since installs have no workspaceId column). Re-mint token, re-sync commands + permissions, bump version.
    const existingInstallation = await repositories.installedApps.findFirst({
      where: { appId, user: { workspaceId } },
    });
    if (existingInstallation) {
      const jwtToken = jwt.sign({ appId, userId: existingInstallation.userId }, signingSecret, { noTimestamp: true });
      await repositories.appPermissions.syncFromAppApproved(appId, existingInstallation.id);
      await syncInstalledCommands(existingInstallation.id, appId, workspaceId);
      await repositories.installedApps.update(existingInstallation.id, {
        version: app.version,
        webhookUrl: existingInstallation.webhookUrl ?? app.webhookUrl ?? null,
        updatedAt: new Date(),
      });
      logger.info(`[INSTALL-APP] App ${appId} updated in workspace ${workspaceId}`);
      return { jwtToken };
    }

    // 2. New install — dedicated per-workspace app user. Email is suffixed with the workspace id
    // because OrgMember.email is globally unique, so the same app installs across workspaces/orgs.
    const botName = app.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const email = `${botName}-${workspaceId}@app.xyne.ai`;

    const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } });
    if (!workspace) {
      throw new Error(`[INSTALL-APP] Workspace ${workspaceId} not found`);
    }

    // Reuse an existing orgMember/app-user if present (idempotent — survives prior manual cleanup).
    // Resolves the app's own bot membership, not the installer's.
    const orgMember = await withWorkspaceScope(async () => {
      const existing = await db.orgMember.findUnique({ where: { email }, select: { memberId: true } });
      if (existing) return existing;
      return db.orgMember.create({
        data: { email, orgId: workspace.orgId, role: OrgRole.MEMBER },
        select: { memberId: true },
      });
    });
    let appUser = await repositories.users.findByEmail(email, workspaceId);
    if (!appUser) {
      appUser = await repositories.users.create({
        name: app.name,
        email,
        providerUserId: `xyne-app-${appId}`,
        authProvider: AuthProvider.API_KEY,
        userType: UserType.APP,
        status: 'ACTIVE',
        workspace: { connect: { id: workspaceId } },
        orgMember: { connect: { memberId: orgMember.memberId } },
      });
    }

    // Per-install JWT, signed with the app-level secret.
    const jwtToken = jwt.sign({ appId, userId: appUser.id }, signingSecret, { noTimestamp: true });

    const now = new Date();
    const installedApp = await repositories.installedApps.create({
      appId,
      userId: appUser.id,
      workspaceId,
      webhookUrl: app.webhookUrl ?? null,
      version: app.version,
      createdAt: now,
      updatedAt: now,
    });

    await repositories.appPermissions.copyFromApp(appId, installedApp.id);
    await syncInstalledCommands(installedApp.id, appId, workspaceId);
    logger.info(`[INSTALL-APP] Installed app ${appId} (entry ${installedApp.id}) in workspace ${workspaceId}`);

    return { jwtToken };
  } catch (error) {
    logger.error(`[INSTALL-APP] Error installing app ${appId}:`, error);
    throw error;
  }
}

/**
 * Configure webhook URL for an installed app
 * 
 * @param appId - The ID of the app
 * @param webhookUrl - The webhook URL to configure
 * @returns The updated installed app entry
 */
export async function configureWebhook(appId: string, webhookUrl: string, workspaceId: string) {
  try {
    if (!isValidUrl(webhookUrl)) {
      throw new Error('Invalid webhook URL format');
    }

    const installedApp = await repositories.installedApps.findFirst({
      where: { appId, user: { workspaceId } }
    });

    if (!installedApp) {
      throw new Error(`[CONFIGURE-WEBHOOK] Installed app with appId ${appId} not found in workspace ${workspaceId}`);
    }

    const updatedInstalledApp = await repositories.installedApps.update(
      installedApp.id,
      { webhookUrl: webhookUrl }
    );

    return {
      message: 'Webhook URL configured successfully',
      webhookUrl: updatedInstalledApp.webhookUrl,
    };
  } catch (error) {
    logger.error(`[CONFIGURE-WEBHOOK] Error configuring webhook for app ${appId}:`, error);
    throw error;
  }
}

/**
 * Regenerate JWT token for an installed app
 *
 * @param appId - The ID of the app
 * @returns The new JWT token
 */
export async function regenerateJwt(appId: string, workspaceId: string) {
  try {
    const app = await repositories.apps.findById(appId);
    if (!app?.signingSecret) {
      throw new Error(`[REGENERATE-JWT] App ${appId} not found or has no signing secret`);
    }

    const installedApp = await repositories.installedApps.findFirst({
      where: { appId, user: { workspaceId } }
    });

    if (!installedApp) {
      throw new Error(`[REGENERATE-JWT] Installed app with appId ${appId} not found in workspace ${workspaceId}`);
    }

    // Decrypt the app-level signing secret
    const signingSecret = decrypt(app.signingSecret);

    // Generate new JWT token
    const jwtToken = jwt.sign(
      { appId, userId: installedApp.userId },
      signingSecret,
      { noTimestamp: true }
    );

    logger.info(`[REGENERATE-JWT] Regenerated JWT for app ${appId}`);

    return {
      jwtToken: jwtToken,
    };
  } catch (error) {
    logger.error(`[REGENERATE-JWT] Error regenerating JWT for app ${appId}:`, error);
    throw error;
  }
}

/**
 * Get decrypted signing secret for an installed app
 * Only app creator, a collaborator, or ADMIN can access this.
 *
 * @param appId - The ID of the app
 * @param userId - The ID of the user requesting the secret
 * @param isAdmin - Whether the user is an admin
 * @returns The decrypted signing secret
 */
export async function getSigningSecret(appId: string, userId: string, isAdmin: boolean) {
  try {
    // Get the app to check ownership
    const app = await repositories.apps.findById(appId);
    if (!app) {
      throw new Error(`[GET-SIGNING-SECRET] App with ID ${appId} not found`);
    }

    // Check if user is admin, app creator, or a collaborator (they need the secret to develop)
    if (!isAdmin && app.createdBy !== userId && !(await getAppEditorRole(appId, userId))) {
      throw new Error(`[GET-SIGNING-SECRET] Unauthorized: Only admin, app creator or a collaborator can access signing secret`);
    }

    if (!app.signingSecret) {
      throw new Error(`[GET-SIGNING-SECRET] App ${appId} has no signing secret`);
    }

    // Decrypt the app-level signing secret
    const signingSecret = decrypt(app.signingSecret);

    logger.info(`[GET-SIGNING-SECRET] Retrieved signing secret for app ${appId} by user ${userId}`);

    return {
      signingSecret: signingSecret,
    };
  } catch (error) {
    logger.error(`[GET-SIGNING-SECRET] Error retrieving signing secret for app ${appId}:`, error);
    throw error;
  }
}
