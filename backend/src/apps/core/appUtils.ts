import { repositories } from '@/database/repositories';
import { AuthProvider, UserType } from '@prisma/client';
import { logger } from '@/utils/logger';
import { encrypt } from '@/services/encryptionService';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Install an external app
 * 
 * @param appId - The ID of the external app to install
 * @returns The created installed app entry
 */
export async function installApp(appId: string) {
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

    // 4. Create a new user for the app
    const appUser = await repositories.users.create({
      name: app.name,
      email: email,
      providerUserId: `xyne-app-${appId}`, 
      authProvider: AuthProvider.API_KEY,
      userType: UserType.APP,
      status: 'ACTIVE',
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
