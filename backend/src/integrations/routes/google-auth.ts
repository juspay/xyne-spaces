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
import { authMiddleware } from '@/middleware/auth';
import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { EmailMergeMode, WorkspaceRole, DeskType } from '@prisma/client';
import { config as appConfig } from '@/config/env';
import {
  appendQueryToReturnPath,
  buildReturnPathOrSupportPath,
  buildSupportPath,
  getFrontendUrl,
  sanitizeReturnPath,
} from './urlHelpers';
import { encrypt } from '@/services/encryptionService';
import { emailFetchQueue } from '@/queues/emailFetchQueue';

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
  assigneeUserGroupId?: string;
  boardId?: string;
};

// Redis-backed CSRF state store. Replaces the previous in-memory Map so OAuth
// state survives across server restarts and multi-instance deployments. TTL is
// enforced by Redis itself — no manual eviction needed.
export type OAuthStateValue = {
  channelId?: string;
  channelData?: PendingChannelData;
  mode?: 'reconnect' | 'workspace' | 'dl-member-sync' | 'channel-email-workspace';
  expectedEmail?: string;
  workspaceId?: string;
  returnPath?: string;
  platform?: 'electron' | 'web';
  dlEmail?: string;
  startDate?: string;
  endDate?: string;
  userId?: string;
  timestamp: number;
};

const OAUTH_STATE_KEY_PREFIX = 'google_oauth_state:';
const OAUTH_STATE_TTL_SECONDS = 60 * 60;

export async function setOAuthState(state: string, value: OAuthStateValue): Promise<void> {
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

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://mail.google.com/',
  // Contacts — feeds the recipient suggestions in the desk composer.
  // `contacts.readonly`: the user's Google Contacts directory.
  // `contacts.other.readonly`: "Other contacts" (auto-saved frequent senders).
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
];

export function createOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_REDIRECT_URI || `${process.env.BACKEND_URL}/api/integrations/google/auth/callback`
  );
}

function buildPostOAuthRedirect(
  frontendUrl: string,
  path: string,
  platform?: 'electron' | 'web',
): string {
  if (platform === 'electron') {
    return `${frontendUrl}/launch?path=${encodeURIComponent(path)}`;
  }
  return `${frontendUrl}${path}`;
}

function redirectError(
  res: Response,
  frontendUrl: string,
  error: string,
  platform: 'electron' | 'web' | undefined,
  workspaceId?: string,
  channelId?: string,
): void {
  const params = new URLSearchParams({ emailError: error });
  res.redirect(
    buildPostOAuthRedirect(frontendUrl, buildSupportPath(workspaceId, channelId, params), platform),
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
  const platform: 'electron' | 'web' =
    req.query.platform === 'electron' ? 'electron' : 'web';
  try {
    const { name, description, visibility, projectId, assigneeUserGroupId, boardId } = req.query;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    if (!name || !projectId) {
      res.status(400).json({ error: 'name and projectId are required' });
      return;
    }

    const project = await db.project.findUnique({ where: { id: projectId as string } });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
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
        assigneeUserGroupId: assigneeUserGroupId as string | undefined,
        boardId: boardId as string | undefined,
      },
      platform,
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
    redirectError(
      res,
      getFrontendUrl(req),
      'google_connect_failed',
      platform,
      req.user!.workspaceId,
    );
  }
});

// GET /api/integrations/google/connect/workspace
// Workspace-level OAuth: connects xyne.desk@<orgDomain> as the shared mailbox that
// DL desks ride on. No channel/preference is created — only an ExternalSource scoped
// to the workspace (channelId: null, workspaceId set). Only one shared mailbox per
// workspace is permitted (enforced by ExternalSource.workspaceId @unique).
router.get('/connect/workspace', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const platform: 'electron' | 'web' =
    req.query.platform === 'electron' ? 'electron' : 'web';
  try {
    const workspaceId = req.user!.workspaceId;

    // Gate on workspace OWNER / ADMIN. req.user.role is the WorkspaceRole written
    // by authV2Middleware (fetched fresh from the User row).
    const role = req.user!.role as WorkspaceRole;
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      res.status(403).json({ error: 'Workspace admin/owner role required to set up the desk email' });
      return;
    }

    const existing = await db.externalSource.findFirst({ where: { workspaceId, sourceType: ExternalSourcePlatform.GOOGLE } });
    if (existing?.isActive) {
      res.status(409).json({
        error: 'Workspace already has a shared desk email configured',
        existingDisplayName: existing.displayName,
      });
      return;
    }

    const state = Math.random().toString(36).substring(7);
    await setOAuthState(state, {
      mode: 'workspace',
      workspaceId,
      platform,
      timestamp: Date.now(),
    });

    const authUrl = createOAuth2Client().generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent',
      state,
    });

    logger.info(`${TAG} Redirecting to Google OAuth for workspace shared mailbox`, { workspaceId });
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error(`${TAG} Error initiating workspace Google connect:`, error);
    redirectError(
      res,
      getFrontendUrl(req),
      'workspace_google_connect_failed',
      platform,
      req.user!.workspaceId,
    );
  }
});

router.get('/connect/channel-email-workspace', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const platform: 'electron' | 'web' =
    req.query.platform === 'electron' ? 'electron' : 'web';
  const returnPath = sanitizeReturnPath(req.query.returnPath);
  try {
    const workspaceId = req.user!.workspaceId;
    const role = req.user!.role as WorkspaceRole;
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      res.status(403).json({ error: 'Workspace admin/owner role required to set up channel email' });
      return;
    }

    GoogleService.validatePushInfrastructure();

    const state = Math.random().toString(36).substring(7);
    await setOAuthState(state, {
      mode: 'channel-email-workspace',
      workspaceId,
      returnPath,
      platform,
      timestamp: Date.now(),
    });

    const authUrl = createOAuth2Client().generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent',
      state,
    });

    logger.info(`${TAG} Redirecting to Google OAuth for channel-email workspace mailbox`, {
      workspaceId,
    });
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error(`${TAG} Error initiating channel-email workspace Google connect:`, error);
    const params = new URLSearchParams({
      emailError: error?.message || 'channel_email_google_connect_failed',
    });
    res.redirect(
      buildPostOAuthRedirect(
        getFrontendUrl(req),
        buildReturnPathOrSupportPath(
          returnPath,
          req.user!.workspaceId,
          undefined,
          params,
        ),
        platform,
      ),
    );
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
  const frontendUrl = getFrontendUrl(req);
  const { code, state, error } = req.query;
  const stateData = state ? await getOAuthState(state as string) : null;
  const platform = stateData?.platform;
  const channelHint = stateData?.channelId;
  const stateWorkspaceId =
    stateData?.workspaceId ?? stateData?.channelData?.workspaceId;

  try {
    logger.info(`${TAG} OAuth callback received`, { hasCode: !!code, hasState: !!state, error });

    if (error) {
      logger.error(`${TAG} OAuth error:`, error);
      if (state) await deleteOAuthState(state as string);
      redirectError(res, frontendUrl, String(error), platform, stateWorkspaceId, channelHint);
      return;
    }

    if (!code || !state) {
      redirectError(res, frontendUrl, 'missing_code_or_state', platform, stateWorkspaceId, channelHint);
      return;
    }
    if (!stateData) {
      redirectError(res, frontendUrl, 'expired_state', platform);
      return;
    }

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
    if (existingSource && stateData.mode !== 'dl-member-sync') {
      const isConnectFlow = !!stateData.channelData;
      const isDifferentChannel =
        !!stateData.channelId && !!existingSource.channelId && existingSource.channelId !== stateData.channelId;
      if (isConnectFlow || isDifferentChannel) {
        const existingChannel = existingSource.channelId
          ? ((await db.channel.findUnique({ where: { id: existingSource.channelId } })) as
              | { name: string }
              | null)
          : null;
        const channelName = existingChannel?.name || 'unknown';
        const message = `Google account ${emailAddress} is already connected to channel "${channelName}"`;
        logger.warn(`${TAG} ${message}`, { sourceName, existingChannelId: existingSource.channelId });
        const params = new URLSearchParams({ emailError: message });
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            buildSupportPath(stateWorkspaceId, existingSource.channelId ?? undefined, params),
            stateData.platform,
          ),
        );
        return;
      }
    }

    if (stateData.mode === 'reconnect' && stateData.channelId && stateData.expectedEmail) {
      const expected = stateData.expectedEmail.toLowerCase();
      if (emailAddress.toLowerCase() !== expected) {
        logger.warn(`${TAG} Reconnect email mismatch: got ${emailAddress}, expected ${expected}`);
        const params = new URLSearchParams({
          emailError: `This desk is bound to ${expected}. Please sign in with that account.`,
        });
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            buildSupportPath(stateWorkspaceId, stateData.channelId, params),
            stateData.platform,
          ),
        );
        return;
      }

      const sourceRow = await db.externalSource.findFirst({
        where: { channelId: stateData.channelId },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!sourceRow) {
        const params = new URLSearchParams({ emailError: 'no_source_to_reconnect' });
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            buildSupportPath(stateWorkspaceId, stateData.channelId, params),
            stateData.platform,
          ),
        );
        return;
      }

      const reEncrypted = await GoogleService.prepareExternalSourceNetwork({
        emailAddress,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });
      await db.externalSource.update({
        where: { id: sourceRow.id },
        data: { credentials: reEncrypted.encryptedCredentials, isActive: true },
      });

      logger.info(`${TAG} Reconnected Gmail integration`, {
        channelId: stateData.channelId,
        sourceId: sourceRow.id,
      });
      const params = new URLSearchParams({
        emailReconnected: 'true',
        provider: 'google',
      });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(stateWorkspaceId, stateData.channelId, params),
          stateData.platform,
        ),
      );
      return;
    }

    // Workspace-level shared mailbox flow: no channel/preference, just one
    // ExternalSource row scoped to the workspace + Gmail watch + Pub/Sub.
    if (stateData.mode === 'workspace' && stateData.workspaceId) {
      const workspaceId = stateData.workspaceId;

      // Pre-checks before any network calls — avoids orphaning a Gmail watch /
      // Pub/Sub subscription if a write would fail anyway.
      const existingForWorkspace = await db.externalSource.findFirst({ where: { workspaceId, sourceType: ExternalSourcePlatform.GOOGLE } });
      if (existingForWorkspace?.isActive) {
        redirectError(res, frontendUrl, 'workspace_mailbox_already_exists', stateData.platform, workspaceId);
        return;
      }
      // `existingSource` (by sourceName) was loaded above as part of the cross-channel
      // dedup. Only reject if this Gmail is active on a *different* workspace.
      if (existingSource?.isActive && existingSource.workspaceId !== workspaceId) {
        redirectError(res, frontendUrl, 'gmail_already_connected', stateData.platform, workspaceId);
        return;
      }

      const network = await GoogleService.prepareExternalSourceNetwork({
        emailAddress,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });

      if (existingForWorkspace) {
        // Reactivate existing source (was soft-disconnected)
        await db.externalSource.update({
          where: { id: existingForWorkspace.id },
          data: {
            name: network.sourceName,
            sourceType: ExternalSourcePlatform.GOOGLE,
            displayName: emailAddress,
            credentials: network.encryptedCredentials,
            isActive: true,
          },
        });
      } else {
        try {
          await db.externalSource.create({
            data: {
              name: network.sourceName,
              sourceType: ExternalSourcePlatform.GOOGLE,
              displayName: emailAddress,
              channelId: null,
              workspaceId,
              credentials: network.encryptedCredentials,
              isActive: true,
            },
          });
        } catch (e: any) {
          // Race-condition safety net for the pre-checks above.
          if (e?.code === 'P2002') {
            redirectError(res, frontendUrl, 'workspace_mailbox_already_exists', stateData.platform, workspaceId);
            return;
          }
          throw e;
        }
      }

      logger.info(`${TAG} Workspace shared mailbox setup complete`, {
        workspaceId,
        sourceName: network.sourceName,
        emailAddress,
      });

      const params = new URLSearchParams({
        workspaceMailboxConnected: 'true',
        provider: 'google',
        email: emailAddress,
      });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          `/${workspaceId}/workspace-management?${params.toString()}`,
          stateData.platform,
        ),
      );
      return;
    }

    if (stateData.mode === 'dl-member-sync' && stateData.channelId && stateData.dlEmail) {
      // Guard: these fields are required for DL member sync jobs. They are always
      // set by desk-integration.ts before kicking off the OAuth flow, but validate
      // explicitly here to avoid silent `!` panics if state was somehow corrupted.
      if (!stateData.userId || !stateData.workspaceId || !stateData.startDate || !stateData.endDate) {
        logger.error(`${TAG} DL member sync: missing required state fields`, {
          hasUserId: !!stateData.userId,
          hasWorkspaceId: !!stateData.workspaceId,
          hasStartDate: !!stateData.startDate,
          hasEndDate: !!stateData.endDate,
        });
        redirectError(res, frontendUrl, 'dl_sync_invalid_state', stateData.platform, stateData.workspaceId, stateData.channelId);
        return;
      }

      const credentials = {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token ?? undefined,
        email: emailAddress,
      };
      const encryptedCredentials = encrypt(JSON.stringify(credentials));
      const sanitized = emailAddress.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_');
      const sourceName = `google-dl-sync--${sanitized}--${stateData.channelId.slice(0, 8)}`;

      const tempSource = await db.externalSource.upsert({
        where: { name: sourceName },
        update: {
          displayName: emailAddress,
          channelId: stateData.channelId,
          credentials: encryptedCredentials,
          isActive: true,
        },
        create: {
          name: sourceName,
          sourceType: ExternalSourcePlatform.GOOGLE,
          displayName: emailAddress,
          channelId: stateData.channelId,
          credentials: encryptedCredentials,
          isActive: true,
        },
      });

      if (!emailFetchQueue.isReady) await emailFetchQueue.initialize();
      await emailFetchQueue.getQueue().add('refetch', {
        sourceId: tempSource.id,
        channelId: stateData.channelId,
        requesterUserId: stateData.userId,
        workspaceId: stateData.workspaceId,
        startDate: stateData.startDate,
        endDate: stateData.endDate,
        targetChannelId: stateData.channelId,
        dlEmail: stateData.dlEmail,
        isDlMemberSync: true,
      });

      logger.info(`${TAG} DL member sync started`, {
        channelId: stateData.channelId,
        sourceId: tempSource.id,
        emailAddress,
      });

      const syncParams = new URLSearchParams({
        dlMemberSyncStarted: 'true',
        provider: 'google',
      });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(stateData.workspaceId, stateData.channelId, syncParams),
          stateData.platform,
        ),
      );
      return;
    }

    if (stateData.mode === 'channel-email-workspace' && stateData.workspaceId) {
      const workspaceId = stateData.workspaceId;
      const username = emailAddress.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
      const sourceName = `google-channel-email-${username}`;
      const existingByName = await db.externalSource.findUnique({ where: { name: sourceName } });
      if (existingByName?.isActive && existingByName.workspaceId !== workspaceId) {
        const params = new URLSearchParams({
          emailError: 'channel_email_mailbox_already_connected_elsewhere',
        });
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            buildReturnPathOrSupportPath(
              stateData.returnPath,
              workspaceId,
              undefined,
              params,
            ),
            stateData.platform,
          ),
        );
        return;
      }

      const network = await GoogleService.prepareExternalSourceNetwork({
        emailAddress,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        sourceName,
      });

      const existingSource = await db.externalSource.findFirst({
        where: {
          workspaceId,
          sourceType: { in: ['google-channel-email', 'microsoft-channel-email'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingSource?.isActive && existingSource.sourceType !== 'google-channel-email') {
        const params = new URLSearchParams({
          emailError: 'channel_email_mailbox_already_exists',
        });
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            buildReturnPathOrSupportPath(
              stateData.returnPath,
              workspaceId,
              undefined,
              params,
            ),
            stateData.platform,
          ),
        );
        return;
      }

      if (existingSource) {
        await db.externalSource.update({
          where: { id: existingSource.id },
          data: {
            name: network.sourceName,
            sourceType: 'google-channel-email',
            displayName: emailAddress,
            credentials: network.encryptedCredentials,
            isActive: true,
          },
        });
      } else {
        await db.externalSource.create({
          data: {
            name: network.sourceName,
            sourceType: 'google-channel-email',
            displayName: emailAddress,
            channelId: null,
            workspaceId,
            credentials: network.encryptedCredentials,
            isActive: true,
          },
        });
      }

      const params = new URLSearchParams({
        channelEmailMailboxConnected: 'true',
        provider: 'google',
      });
      if (stateData.returnPath) {
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            appendQueryToReturnPath(stateData.returnPath, params),
            stateData.platform,
          ),
        );
        return;
      }

      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(workspaceId, undefined, params),
          stateData.platform,
        ),
      );
      return;
    }

    // Resolve or create the channel. Reuses the `sourceName` computed above.
    logger.info(`${TAG} Creating channel / resolving board`);
    if (stateData.channelData) {
      // /connect flow: create channel + resolve default board from project
      const cd = stateData.channelData;
      const network = await GoogleService.prepareExternalSourceNetwork({
        emailAddress,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });

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
        const seenConversations = await tx.conversation.findMany({
          where: {
            channelId: ch.id,
            createdAt: { lte: now },
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: { createdAt: true },
        });
        const conversationSeenCutoffAt =
          seenConversations[seenConversations.length - 1]?.createdAt ?? now;

        await tx.channelParticipant.create({
          data: { channelId: ch.id, userId: cd.userId, role: 'ADMIN' },
        });

        await tx.channelUserStatus.create({
          data: {
            channelId: ch.id,
            userId: cd.userId,
            lastViewedAt: now,
            conversationSeenCutoffAt,
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

        // Create EmailChannelPreference for owner and assignee tracking
        // Note: We create it directly in the transaction, bypassing repository validation
        // since we already know this is an EMAIL channel
        await tx.emailChannelPreference.create({
          data: {
            channelId: ch.id,
            ownerUserId: cd.userId,
            ...(cd.assigneeUserGroupId && { assigneeUserGroupId: cd.assigneeUserGroupId }),
            ...(cd.boardId && { boardId: cd.boardId }),
            emailMergeMode: appConfig.emailMergeModeDefault as EmailMergeMode,
            deskType: DeskType.EMAIL,
          },
        });

        const board = await tx.board.findFirst({
          where: { projectId: cd.projectId },
          orderBy: { createdAt: 'asc' },
        });

        await tx.externalSource.create({
          data: {
            name: network.sourceName,
            sourceType: ExternalSourcePlatform.GOOGLE,
            displayName: emailAddress,
            channelId: ch.id,
            boardId: cd.boardId ?? board?.id,
            credentials: network.encryptedCredentials,
            ownerUserId: cd.userId,
            isActive: true,
          },
        });

        return { channelId: ch.id };
      });

      logger.info(`${TAG} Gmail integration setup complete`, { sourceName: network.sourceName });
      const params = new URLSearchParams({ emailConnected: 'true', provider: 'google' });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(cd.workspaceId, txResult.channelId, params),
          stateData.platform,
        ),
      );
    } else if (stateData.channelId) {
      // /auth/start flow: channel was pre-created, resolve board from channel's project
      const channelId = stateData.channelId;
      let boardId: string | undefined;
      const channel = await db.channel.findUnique({ where: { id: channelId } });
      if (channel?.projectId) {
        const board = await db.board.findFirst({
          where: { projectId: channel.projectId },
          orderBy: { createdAt: 'asc' },
        });
        boardId = board?.id;
      }
      const result = await GoogleService.setupExternalSource({
        channelId,
        emailAddress,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        boardId,
      });
      logger.info(`${TAG} Gmail integration setup complete`, { sourceName: result.sourceName });
      res.send(htmlPage('Gmail Integration Successful', `
        <h1>✓ Gmail Connected</h1>
        <p><strong>Email:</strong> ${emailAddress}</p>
        <p><strong>Source:</strong> <code>${result.sourceName}</code></p>
        <p><strong>Webhook:</strong> <code>${result.webhookUrl}</code></p>
        <p class="muted">You can close this window. New emails will sync automatically.</p>
      `,
        ),
      );
    } else {
      throw new Error('No channel info in OAuth state');
    }
  } catch (error: any) {
    const message = error?.message || 'Unknown error';
    const stack = error?.stack || '';
    logger.error(`${TAG} Error in OAuth callback: ${message}`, { stack });
    redirectError(res, frontendUrl, message, platform, stateWorkspaceId, channelHint);
  }
});

/**
 * POST /api/integrations/google/admin/migrate-to-shared-sub
 * One-shot migration: create shared subscription if missing, then delete every
 * legacy per-source `gmail-google-<src>-push`. Idempotent. Use `?dryRun=true`
 * (or `{ "dryRun": true }` in body) to preview before destroying anything.
 *
 * Auth: requires a logged-in user. Wrap with an admin role check if your
 * platform has one — this is a destructive operation.
 */
router.post('/admin/migrate-to-shared-sub', authMiddleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const dryRun = req.query.dryRun === 'true' || (req.body && req.body.dryRun === true);
    const report = await GoogleService.migrateToSharedSubscription({ dryRun });
    logger.info(`${TAG} migration finished`, {
      dryRun: report.dryRun,
      shared: report.sharedSubscriptionName,
      created: report.sharedSubscriptionCreated,
      deletedCount: report.oldSubscriptionsDeleted.length,
      skippedCount: report.oldSubscriptionsSkipped.length,
      requestedBy: req.user?.id,
    });
    res.json({ success: true, ...report });
  } catch (error: any) {
    logger.error(`${TAG} migration failed`, error);
    res.status(500).json({ success: false, error: error?.message ?? 'Unknown error' });
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
