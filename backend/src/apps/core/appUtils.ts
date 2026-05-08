import { repositories } from '@/database/repositories';
import { AuthProvider, UserType } from '@prisma/client';
import { logger } from '@/utils/logger';
import { encrypt, decrypt } from '@/services/encryptionService';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { isValidUrl } from '@/utils/urlUtils';
import { db } from '@/database/client';

/**
 * Install an external app
 *
 * @param appId - The ID of the external app to install
 * @param workspaceId - The workspace ID to install the app in
 * @returns The created installed app entry
 */
export async function installApp(appId: string, workspaceId: string) {
  try {
    // 1. Check if app is already installed
    const existingInstallation = await repositories.installedApps.findMany({
      where: { appId: appId }
    });
    
    if (existingInstallation.length > 0) {
      return {
        message: 'App is already installed in workspace',
      };
    }

    // 2. Get the app to retrieve its name
    const app = await repositories.apps.findById(appId);
    if (!app) {
      throw new Error(`[INSTALL-APP] App with ID ${appId} not found`);
    }

    // 3. Sanitize bot name for email and create email address
    const botName = app.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-') 
      .replace(/^-|-$/g, '');
    const email = `${botName}@app.xyne.ai`;

    // 4. Get orgId from workspace and create orgMember for the app user
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { orgId: true }
    });
    if (!workspace) {
      throw new Error(`[INSTALL-APP] Workspace ${workspaceId} not found`);
    }

    // Create orgMember entry for the app (apps are dynamic, not pre-invited)
    const orgMember = await db.orgMember.create({
      data: {
        email: email,
        orgId: workspace.orgId,
        role: 'MEMBER',
      }
    });
    logger.info(`[INSTALL-APP] Created orgMember for app: ${orgMember.memberId}`);

    // 5. Create a new user for the app
    const appUser = await repositories.users.create({
      name: app.name,
      email: email,
      providerUserId: `xyne-app-${appId}`,
      authProvider: AuthProvider.API_KEY,
      userType: UserType.APP,
      status: 'ACTIVE',
      workspace: { connect: { id: workspaceId } },
      orgMember: { connect: { memberId: orgMember.memberId } },
    });
    logger.info(`[INSTALL-APP] Created new app user: ${appUser.id} for app ${appId}`);

    // 6. Generate signing secret
    const signingSecret = crypto.randomBytes(32).toString('hex');

    // 7. Create JWT token with appId and userId, signed by signingSecret 
    const jwtToken = jwt.sign(
      { appId, userId: appUser.id },
      signingSecret,
      { noTimestamp: true }
    );

    // 8. Create entry in installedApps
    const now = new Date();
    const installedApp = await repositories.installedApps.create({
      appId: appId,
      userId: appUser.id,
      signingSecret: await encrypt(signingSecret),
      createdAt: now,
      updatedAt: now,
    } );

    logger.info(`[INSTALL-APP] Created installed app entry: ${installedApp.id} for app ${appId}`);
    
    return {
      jwtToken: jwtToken,
    };
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
export async function configureWebhook(appId: string, webhookUrl: string) {
  try {
    if (!isValidUrl(webhookUrl)) {
      throw new Error('Invalid webhook URL format');
    }

    const installedApp = await repositories.installedApps.findFirst({
      where: { appId: appId }
    });

    if (!installedApp) {
      throw new Error(`[CONFIGURE-WEBHOOK] Installed app with appId ${appId} not found`);
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
export async function regenerateJwt(appId: string) {
  try {
    const installedApp = await repositories.installedApps.findFirst({
      where: { appId: appId }
    });

    if (!installedApp) {
      throw new Error(`[REGENERATE-JWT] Installed app with appId ${appId} not found`);
    }

    // Decrypt the signing secret
    const signingSecret = decrypt(installedApp.signingSecret);

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
