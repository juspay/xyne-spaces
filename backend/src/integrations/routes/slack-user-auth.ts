/**
 * Slack User OAuth routes — per-agent "send as user" token management.
 *
 * Agents do a one-time Slack OAuth to get a user token (xoxp-) so replies
 * from Desk appear under their own Slack identity instead of the bot.
 *
 * 1. GET  /connect     — initiate OAuth redirect (auth required)
 * 2. GET  /callback    — handle Slack redirect (unauthenticated)
 * 3. GET  /status      — check if current user is connected (auth required)
 * 4. DELETE /disconnect — remove user token (auth required)
 */

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { encrypt, decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { getFrontendUrl, getBackendUrl } from './urlHelpers';

const TAG = '[SlackUserAuth]';
const router = express.Router();
router.use(express.json());

const OAUTH_STATE_KEY_PREFIX = 'slack_user_oauth_state:';
const OAUTH_STATE_TTL_SECONDS = 60 * 60; // 1 hour

type SlackUserOAuthState = {
  userId: string;
  workspaceId: string;
  platform?: 'electron' | 'web';
};

/**
 * GET /api/integrations/slack-user/connect
 * Initiates Slack OAuth flow to get a user token.
 */
router.get(
  '/connect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const platform = req.query.platform === 'electron' ? 'electron' : 'web';

      // Look up workspace-level Slack ExternalSource for clientId/clientSecret
      const slackSource = await db.externalSource.findFirst({
        where: { workspaceId, sourceType: 'slack', isActive: true },
      });
      if (!slackSource) {
        res.status(503).json({ error: 'Slack is not connected for this workspace' });
        return;
      }

      const creds = JSON.parse(decrypt(slackSource.credentials)) as {
        clientId?: string;
        clientSecret?: string;
      };
      if (!creds.clientId || !creds.clientSecret) {
        res.status(503).json({
          error: 'Slack app credentials (clientId/clientSecret) not configured. Update the workspace Slack source.',
        });
        return;
      }

      // Generate state for CSRF protection
      const state = crypto.randomBytes(24).toString('hex');
      await redisService.set(
        `${OAUTH_STATE_KEY_PREFIX}${state}`,
        JSON.stringify({ userId, workspaceId, platform } satisfies SlackUserOAuthState),
        OAUTH_STATE_TTL_SECONDS,
      );

      const redirectUri = `${getBackendUrl(req)}/api/integrations/slack-user/callback`;

      const params = new URLSearchParams({
        client_id: creds.clientId,
        user_scope: 'chat:write',
        redirect_uri: redirectUri,
        state,
      });

      logger.info(`${TAG} Redirecting to Slack OAuth for user token`, { userId });
      res.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
    } catch (error) {
      logger.error(`${TAG} Error initiating Slack user OAuth`, { error });
      res.status(500).json({ error: 'Failed to initiate Slack OAuth' });
    }
  },
);

/**
 * GET /api/integrations/slack-user/callback
 * Handles the Slack OAuth redirect. Exchanges code for user token.
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  let frontendUrl: string;
  try {
    frontendUrl = getFrontendUrl(req);
  } catch {
    frontendUrl = 'http://localhost:5173';
  }

  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      logger.warn(`${TAG} OAuth error from Slack`, { error: oauthError });
      res.redirect(`${frontendUrl}/support?slackUserError=${encodeURIComponent(String(oauthError))}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}/support?slackUserError=missing_code_or_state`);
      return;
    }

    // Retrieve and delete state from Redis
    const stateKey = `${OAUTH_STATE_KEY_PREFIX}${state}`;
    const raw = await redisService.get(stateKey);
    if (!raw) {
      res.redirect(`${frontendUrl}/support?slackUserError=expired_state`);
      return;
    }
    await redisService.del(stateKey);

    const stateData = JSON.parse(raw) as SlackUserOAuthState;

    // Look up workspace Slack source for clientId/clientSecret
    const slackSource = await db.externalSource.findFirst({
      where: { workspaceId: stateData.workspaceId, sourceType: 'slack', isActive: true },
    });
    if (!slackSource) {
      res.redirect(`${frontendUrl}/${stateData.workspaceId}/support?slackUserError=slack_not_connected`);
      return;
    }

    const creds = JSON.parse(decrypt(slackSource.credentials)) as {
      clientId?: string;
      clientSecret?: string;
    };
    if (!creds.clientId || !creds.clientSecret) {
      res.redirect(`${frontendUrl}/${stateData.workspaceId}/support?slackUserError=missing_client_credentials`);
      return;
    }

    const redirectUri = `${getBackendUrl(req)}/api/integrations/slack-user/callback`;

    // Exchange code for token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      ok: boolean;
      error?: string;
      authed_user?: {
        id: string;
        access_token: string;
      };
    };

    if (!tokenData.ok || !tokenData.authed_user?.access_token) {
      logger.error(`${TAG} Slack token exchange failed`, { error: tokenData.error });
      res.redirect(
        `${frontendUrl}/${stateData.workspaceId}/support?slackUserError=${encodeURIComponent(tokenData.error || 'token_exchange_failed')}`,
      );
      return;
    }

    const { id: slackUserId, access_token: userToken } = tokenData.authed_user;

    // Upsert UserExternalToken
    const encryptedToken = encrypt(userToken);
    await db.userExternalToken.upsert({
      where: {
        userId_provider: {
          userId: stateData.userId,
          provider: 'slack',
        },
      },
      create: {
        userId: stateData.userId,
        provider: 'slack',
        providerUserId: slackUserId,
        encryptedToken,
        connectedAt: new Date(),
      },
      update: {
        providerUserId: slackUserId,
        encryptedToken,
        connectedAt: new Date(),
      },
    });

    logger.info(`${TAG} Slack user token stored`, {
      userId: stateData.userId,
      slackUserId,
    });

    const redirectPath = `/${stateData.workspaceId}/support?slackUserConnected=true`;
    if (stateData.platform === 'electron') {
      res.redirect(`${frontendUrl}/launch?path=${encodeURIComponent(redirectPath)}`);
    } else {
      res.redirect(`${frontendUrl}${redirectPath}`);
    }
  } catch (error) {
    logger.error(`${TAG} Error in Slack user OAuth callback`, { error });
    res.redirect(`${frontendUrl}/support?slackUserError=callback_failed`);
  }
});

/**
 * GET /api/integrations/slack-user/status
 * Returns the current user's Slack connection status.
 */
router.get(
  '/status',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const token = await db.userExternalToken.findUnique({
        where: { userId_provider: { userId, provider: 'slack' } },
        select: { providerUserId: true, connectedAt: true },
      });

      if (!token) {
        res.json({ connected: false });
        return;
      }

      res.json({
        connected: true,
        providerUserId: token.providerUserId,
        connectedAt: token.connectedAt.toISOString(),
      });
    } catch (error) {
      logger.error(`${TAG} Error checking Slack user status`, { error });
      res.status(500).json({ error: 'Failed to check Slack user status' });
    }
  },
);

/**
 * DELETE /api/integrations/slack-user/disconnect
 * Removes the current user's Slack token.
 */
router.delete(
  '/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      await db.userExternalToken.deleteMany({
        where: { userId, provider: 'slack' },
      });

      logger.info(`${TAG} Slack user token removed`, { userId });
      res.json({ disconnected: true });
    } catch (error) {
      logger.error(`${TAG} Error disconnecting Slack user`, { error });
      res.status(500).json({ error: 'Failed to disconnect Slack user' });
    }
  },
);

export default router;
