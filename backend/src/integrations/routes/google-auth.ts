/**
 * Google OAuth routes for Gmail integration setup.
 */

import express, { Request, Response } from 'express';
import { google } from 'googleapis';
import { logger } from '@/utils/logger';
import { GoogleService } from '@/services/googleService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ExternalSourcePlatform } from '../core/types';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { redisService } from '@/services/redisService';

const TAG = '[GoogleAuth]';
const router = express.Router();
router.use(express.json());

type PendingChannelData = {
  name: string;
  description?: string;
  visibility: string;
  projectId: string;
  userId: string;
  workspaceId: string;
};

// Redis-backed CSRF state store. Replaces the previous in-memory Map so OAuth
// state survives across server restarts and multi-instance deployments. TTL is
// enforced by Redis itself — no manual eviction needed.
type OAuthStateValue = { channelId?: string; channelData?: PendingChannelData; timestamp: number };
const OAUTH_STATE_KEY_PREFIX = 'google_oauth_state:';
const OAUTH_STATE_TTL_SECONDS = 60 * 60;

async function setOAuthState(state: string, value: OAuthStateValue): Promise<void> {
  await redisService.set(
    `${OAUTH_STATE_KEY_PREFIX}${state}`,
    JSON.stringify(value),
    OAUTH_STATE_TTL_SECONDS,
  );
}

async function getOAuthState(state: string): Promise<OAuthStateValue | null> {
  const raw = await redisService.get(`${OAUTH_STATE_KEY_PREFIX}${state}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthStateValue;
  } catch (err) {
    logger.error(`${TAG} failed to parse oauth state from redis`, err);
    return null;
  }
}

async function deleteOAuthState(state: string): Promise<void> {
  await redisService.del(`${OAUTH_STATE_KEY_PREFIX}${state}`);
}

function getFrontendUrl(req: Request): string {
  const originalHost = req.headers['x-original-host'];
  if (originalHost && typeof originalHost === 'string') {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    return `${protocol}://${originalHost}`;
  }
  const url = process.env.FRONTEND_URL;
  if (!url) throw new Error('FRONTEND_URL environment variable is required');
  return url.trim();
}


const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://mail.google.com/',
];

function createOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_REDIRECT_URI || `${process.env.BACKEND_URL}/api/integrations/google/auth/callback`
  );
}

function htmlPage(title: string, body: string, status: 'success' | 'error' = 'success'): string {
  const color = status === 'success' ? '#4CAF50' : '#F44336';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: sans-serif; max-width: 520px; margin: 60px auto; padding: 20px; }
  .card { background: #fff; padding: 28px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
  h1 { color: ${color}; margin-top: 0; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
  .muted { color: #888; margin-top: 24px; }
</style></head>
<body><div class="card">${body}</div></body></html>`;
}

// GET /api/integrations/google/connect
// Initiates Google OAuth flow for email channel creation (mirrors Microsoft /connect)
router.get('/connect', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, visibility, projectId } = req.query;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    if (!name || !projectId) {
      res.status(400).json({ error: 'name and projectId are required' });
      return;
    }

    const state = Math.random().toString(36).substring(7);
    await setOAuthState(state, {
      channelData: {
        name: name as string,
        description: description as string | undefined,
        visibility: (visibility as string) || 'public',
        projectId: projectId as string,
        userId,
        workspaceId,
      },
      timestamp: Date.now(),
    });

    const authUrl = createOAuth2Client().generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent',
      state,
    });

    logger.info(`${TAG} Redirecting to Google OAuth for email channel creation`);
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error(`${TAG} Error initiating Google connect:`, error);
    res.redirect(`${getFrontendUrl(req)}?error=google_connect_failed`);
  }
});

// POST /api/integrations/google/auth/start
router.post('/auth/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId } = req.body;
    if (!channelId) { res.status(400).json({ error: 'channelId is required' }); return; }

    const channel = await new ChannelRepository().findById(channelId);
    if (!channel) { res.status(404).json({ error: 'Channel not found' }); return; }
    if (channel.type !== 'EMAIL') {
      res.status(400).json({ error: 'Channel must be of type EMAIL' }); return;
    }

    const state = Math.random().toString(36).substring(7);
    await setOAuthState(state, { channelId, timestamp: Date.now() });

    const authUrl = createOAuth2Client().generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent',
      state,
    });

    logger.info(`${TAG} OAuth flow initiated`, { channelId });
    res.json({ authUrl, state });
  } catch (error: any) {
    logger.error(`${TAG} Error starting OAuth flow:`, error);
    res.status(500).json({ error: 'Failed to start OAuth flow', details: error.message });
  }
});

// GET /api/integrations/google/auth/callback
router.get('/auth/callback', async (req: Request, res: Response): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL?.trim() || '';
  try {
    const { code, state, error } = req.query;

    logger.info(`${TAG} OAuth callback received`, { hasCode: !!code, hasState: !!state, error });

    if (error) {
      logger.error(`${TAG} OAuth error:`, error);
      res.status(400).send(htmlPage('Authentication Failed',
        `<h1>Authentication Failed</h1><p>${error}</p><p class="muted">Close this window and try again.</p>`,
        'error'));
      return;
    }

    if (!code || !state) { res.status(400).json({ error: 'Missing code or state' }); return; }

    const stateData = await getOAuthState(state as string);
    if (!stateData) { res.status(400).json({ error: 'Invalid or expired state' }); return; }

    await deleteOAuthState(state as string);

    // Exchange code for tokens
    logger.info(`${TAG} Exchanging code for tokens`);
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error(`Failed to obtain tokens — access_token: ${!!tokens.access_token}, refresh_token: ${!!tokens.refresh_token}`);
    }
    logger.info(`${TAG} Tokens obtained successfully`);

    // Fetch Gmail profile
    logger.info(`${TAG} Fetching Gmail profile`);
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const emailAddress = profile.data.emailAddress;
    if (!emailAddress) throw new Error('Failed to get email address from Gmail profile');
    logger.info(`${TAG} Gmail profile fetched`, { emailAddress });

    // If this Google account is already connected to another channel, block before
    // creating anything new (mirrors microsoftDeskService.createChannelAndSource)
    const username = emailAddress.split('@')[0].replace(/[^a-zA-Z0-9-_]/g, '-');
    const sourceName = `google-${username}`;
    const existingSource = await db.externalSource.findUnique({ where: { name: sourceName } });
    if (existingSource) {
      const isConnectFlow = !!stateData.channelData;
      const isDifferentChannel =
        !!stateData.channelId && !!existingSource.channelId && existingSource.channelId !== stateData.channelId;
      if (isConnectFlow || isDifferentChannel) {
        const existingChannel = existingSource.channelId
          ? await db.channel.findUnique({ where: { id: existingSource.channelId }, select: { name: true } })
          : null;
        const channelName = existingChannel?.name || 'unknown';
        const message = `Google account ${emailAddress} is already connected to channel "${channelName}"`;
        logger.warn(`${TAG} ${message}`, { sourceName, existingChannelId: existingSource.channelId });
        res.redirect(`${frontendUrl}/support?emailError=${encodeURIComponent(message)}`);
        return;
      }
    }

    // Resolve or create the channel
    logger.info(`${TAG} Creating channel / resolving board`);
    let channelId: string;
    let boardId: string | undefined;
    if (stateData.channelData) {
      // /connect flow: create channel + resolve default board from project
      const cd = stateData.channelData;
      const txResult = await db.$transaction(async (tx) => {
        const ch = await tx.channel.create({
          data: {
            scopeType: 'DEFAULT',
            name: cd.name,
            description: cd.description,
            visibility: cd.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
            createdBy: cd.userId,
            workspaceId: cd.workspaceId,
            projectId: cd.projectId,
            type: 'EMAIL',
          },
        });
        const now = new Date();
        await tx.channelParticipant.create({
          data: { channelId: ch.id, userId: cd.userId, role: 'ADMIN' },
        });

        await tx.channelUserStatus.create({
          data: {
            channelId: ch.id,
            userId: cd.userId,
            lastViewedAt: now,
            updatedAt: now,
          },
        });
        
        await tx.channelStats.create({
          data: {
            channelId: ch.id,
            lastActivityAt: now,
            participantCount: 1,
          },
        });

        const board = await tx.board.findFirst({
          where: { projectId: cd.projectId },
          orderBy: { createdAt: 'asc' },
        });
        return { channelId: ch.id, boardId: board?.id };
      });
      channelId = txResult.channelId;
      boardId = txResult.boardId;
    } else if (stateData.channelId) {
      // /auth/start flow: channel was pre-created, resolve board from channel's project
      channelId = stateData.channelId;
      const channel = await db.channel.findUnique({ where: { id: channelId } });
      if (channel?.projectId) {
        const board = await db.board.findFirst({
          where: { projectId: channel.projectId },
          orderBy: { createdAt: 'asc' },
        });
        boardId = board?.id;
      }
    } else {
      throw new Error('No channel info in OAuth state');
    }

    // Setup ExternalSource + watch + Pub/Sub
    logger.info(`${TAG} Setting up ExternalSource, Gmail watch, Pub/Sub`, { channelId, boardId });
    const result = await GoogleService.setupExternalSource({
      channelId,
      emailAddress,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      boardId,
    });

    logger.info(`${TAG} Gmail integration setup complete`, { sourceName: result.sourceName });

    if (stateData.channelData) {
      // /connect flow: redirect to frontend like Microsoft
      res.redirect(`${frontendUrl}/support?emailConnected=true&channel=${channelId}&provider=google`);
    } else {
      res.send(htmlPage('Gmail Integration Successful', `
        <h1>✓ Gmail Connected</h1>
        <p><strong>Email:</strong> ${emailAddress}</p>
        <p><strong>Source:</strong> <code>${result.sourceName}</code></p>
        <p><strong>Webhook:</strong> <code>${result.webhookUrl}</code></p>
        <p class="muted">You can close this window. New emails will sync automatically.</p>
      `));
    }
  } catch (error: any) {
    const message = error?.message || 'Unknown error';
    const stack = error?.stack || '';
    logger.error(`${TAG} Error in OAuth callback: ${message}`, { stack });
    res.status(500).send(htmlPage('Setup Failed',
      `<h1>Setup Failed</h1><p><strong>${message}</strong></p><pre style="font-size:11px;overflow:auto">${stack}</pre><p class="muted">Check backend logs for details.</p>`,
      'error'));
  }
});

// POST /api/integrations/google/watch/renew/:sourceName
router.post('/watch/renew/:sourceName', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceName } = req.params;
    const repo = new ExternalSourceRepository();
    const source = await repo.findByName(sourceName);

    if (!source) { res.status(404).json({ error: 'External source not found' }); return; }
    if (source.sourceType !== ExternalSourcePlatform.GOOGLE) {
      res.status(400).json({ error: 'Source is not a Google integration' }); return;
    }

    const googleService = GoogleService.fromEncryptedCredentials(source.credentials, source.id);
    const result = await googleService.renewGmailWatch();

    logger.info(`${TAG} Gmail watch renewed`, { sourceName });
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error(`${TAG} Error renewing Gmail watch:`, error);
    res.status(500).json({ error: 'Failed to renew Gmail watch', details: error.message });
  }
});

export default router;
