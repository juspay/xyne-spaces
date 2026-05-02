/**
 * Microsoft Desk Auth Routes
 * OAuth connect/callback for Microsoft email channels
 */

import { Router, Request, Response } from 'express';
import { authV2Middleware } from '../../middleware/authV2Middleware';
import {
  microsoftDeskService,
  isReconnectChannelData,
} from '../../services/microsoftDeskService';
import { encrypt } from '../../services/encryptionService';
import { db } from '../../database/client';
import { logger } from '../../utils/logger';

const router = Router();

function getFrontendUrl(): string {
  const url = process.env.FRONTEND_URL;
  if (!url) throw new Error('FRONTEND_URL environment variable is required');
  return url.trim();
}

export function getBackendUrl(req: Request): string {
  const originalHost = req.headers['x-original-host'];
  if (originalHost && typeof originalHost === 'string') {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    return `${protocol}://${originalHost}`;
  }
  const url = process.env.BACKEND_URL;
  if (!url) throw new Error('BACKEND_URL environment variable is required');
  return url.trim();
}

function getPublicUrl(req: Request): string {
  return getBackendUrl(req);
}

export const MICROSOFT_OAUTH_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'Mail.Read',
  'Mail.Send',
  'Mail.ReadWrite',
  'Contacts.Read',
  'People.Read',
  'Contacts.Read.Shared',
];

/** Space-joined scope string for Microsoft's token-exchange API. */
export const MICROSOFT_OAUTH_SCOPE_STRING = MICROSOFT_OAUTH_SCOPES.join(' ');

/**
 * GET /api/integrations/microsoft/connect
 * Initiates Microsoft OAuth flow for email channel creation
 */
router.get('/connect', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_DESK_CONNECT_${Date.now()}`;

  try {
    const oauthClient = microsoftDeskService.getOAuthClient();
    if (!oauthClient) {
      res.status(503).json({ error: 'Microsoft OAuth not configured' });
      return;
    }

    const { name, description, visibility, projectId, assigneeUserGroupId } = req.query;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    if (!name || !projectId) {
      res.status(400).json({ error: 'name and projectId are required' });
      return;
    }

    const state = microsoftDeskService.generateState();

    await microsoftDeskService.storePendingChannel(state, {
      name: name as string,
      description: description as string | undefined,
      visibility: (visibility as string) || 'public',
      projectId: projectId as string,
      userId,
      workspaceId,
      assigneeUserGroupId: assigneeUserGroupId as string | undefined,
    });

    const redirectUri = `${getPublicUrl(req)}/api/integrations/microsoft/callback`;

    const authorizationUri = oauthClient.authorizeURL({
      redirect_uri: redirectUri,
      scope: MICROSOFT_OAUTH_SCOPES,
      state,
      prompt: 'consent',
    } as Record<string, string | string[]>);

    logger.info(`[${requestId}] Redirecting to Microsoft OAuth for email channel`);
    res.redirect(authorizationUri);
  } catch (error) {
    logger.error(`[${requestId}] Error initiating Microsoft email connect:`, error);
    res.redirect(`${getFrontendUrl()}?error=microsoft_connect_failed`);
  }
});

/**
 * GET /api/integrations/microsoft/callback
 * Handles Microsoft OAuth callback — creates channel + source + webhook
 */
router.get('/callback', async (req: Request, res: Response) => {
  const requestId = `MS_DESK_CALLBACK_${Date.now()}`;
  const frontendUrl = getFrontendUrl();

  try {
    const oauthClient = microsoftDeskService.getOAuthClient();
    if (!oauthClient) {
      res.redirect(`${frontendUrl}?error=microsoft_not_configured`);
      return;
    }

    const { code, state, error } = req.query;

    if (error) {
      logger.error(`[${requestId}] Microsoft OAuth error: ${error}`);
      res.redirect(`${frontendUrl}?error=microsoft_oauth_error&message=${encodeURIComponent(error as string)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?error=missing_params`);
      return;
    }

    const channelData = await microsoftDeskService.getPendingChannel(state as string);
    if (!channelData) {
      logger.error(`[${requestId}] Pending channel data not found or expired`);
      res.redirect(`${frontendUrl}?error=expired_state`);
      return;
    }

    const redirectUri = `${getPublicUrl(req)}/api/integrations/microsoft/callback`;
    const tokenResult = await oauthClient.getToken({
      code: code as string,
      redirect_uri: redirectUri,
      scope: MICROSOFT_OAUTH_SCOPE_STRING,
    });

    const { token } = tokenResult;
    const accessToken = token.access_token as string;

    if (!accessToken) {
      logger.error(`[${requestId}] No access token received from Microsoft`);
      res.redirect(`${frontendUrl}?error=no_access_token`);
      return;
    }

    const email = await microsoftDeskService.resolveEmail(accessToken, token.id_token as string | undefined);
    if (!email) {
      logger.error(`[${requestId}] Could not determine email from Microsoft profile`);
      res.redirect(`${frontendUrl}?error=no_email`);
      return;
    }


    if (isReconnectChannelData(channelData)) {
      const expected = channelData.expectedEmail.toLowerCase();
      if (email.toLowerCase() !== expected) {
        logger.warn(`[${requestId}] Reconnect email mismatch: got ${email}, expected ${expected}`);
        res.redirect(
          `${frontendUrl}/support?channel=${channelData.channelId}&emailError=${encodeURIComponent(
            `This desk is bound to ${expected}. Please sign in with that account.`,
          )}`,
        );
        return;
      }

      const source = await db.externalSource.findFirst({
        where: { channelId: channelData.channelId },
        select: { id: true, name: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!source) {
        logger.error(`[${requestId}] No ExternalSource found for reconnect`);
        res.redirect(`${frontendUrl}/support?channel=${channelData.channelId}&emailError=no_source`);
        return;
      }

      const expiresAt = token.expires_at
        ? new Date(token.expires_at as string).toISOString()
        : undefined;
      const reconnectCreds = {
        accessToken,
        refreshToken: (token.refresh_token as string) ?? undefined,
        email,
        expiresAt,
      };
      await db.externalSource.update({
        where: { id: source.id },
        data: {
          credentials: encrypt(JSON.stringify(reconnectCreds)),
          isActive: true,
        },
      });

      try {
        const webhookUrl = `${getPublicUrl(req)}/api/integrations/microsoft/webhook/${source.name}`;
        await microsoftDeskService.registerGraphWebhook(accessToken, webhookUrl);
      } catch (err) {
        logger.warn(`[${requestId}] Failed to re-register webhook on reconnect`, err);
      }

      logger.info(`[${requestId}] Microsoft integration reconnected: ${channelData.channelId}`);
      res.redirect(
        `${frontendUrl}/support?emailReconnected=true&channel=${channelData.channelId}&provider=microsoft`,
      );
      return;
    }

    const { channelId } = await microsoftDeskService.createChannelAndSource(channelData, {
      accessToken,
      refreshToken: (token.refresh_token as string) ?? undefined,
      email,
      expiresAt: token.expires_at ? new Date(token.expires_at as string).toISOString() : undefined,
    }, getPublicUrl(req));

    logger.info(`[${requestId}] Microsoft email channel created: ${channelId}`);

    res.redirect(
      `${frontendUrl}/support?emailConnected=true&channel=${channelId}&provider=microsoft`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[${requestId}] Microsoft email callback error: ${errorMessage}`, error);

    const params = new URLSearchParams({ emailError: errorMessage });
    const existingChannelId = (error as Error & { existingChannelId?: string })?.existingChannelId;
    if (existingChannelId) params.set('channel', existingChannelId);

    res.redirect(`${frontendUrl}/support?${params.toString()}`);
  }
});

export default router;
