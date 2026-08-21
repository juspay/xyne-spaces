/**
 * Google OAuth routes for Gmail integration setup.
 */

import { randomUUID } from 'crypto';
import { EmailMergeMode, WorkspaceRole, DeskType, ChannelRole, ChannelScopeType, ChannelType, AccessType } from '@xyne/shared';
import express, { Request, Response } from 'express';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { google } from 'googleapis';
import { logger } from '@/utils/logger';
import { GoogleService } from '@/services/googleService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ExternalSourcePlatform } from '../core/types';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { BACKFILL_ADMIN_RESOURCE } from '@/middleware/backfillAdminAuth';
import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { config as appConfig } from '@/config/env';
import {
  appendQueryToReturnPath,
  buildReturnPathOrSupportPath,
  buildSupportPath,
  sanitizeReturnPath,
} from './urlHelpers';
import { encrypt } from '@/services/encryptionService';
import { emailFetchQueue, enqueueCursorCatchup } from '@/queues/emailFetchQueue';
import { getFrontendUrl, getBackendUrl } from '@/utils/publicUrls';
import { pubSubWatchService } from '@/pubsub';

const TAG = '[GoogleAuth]';

// Same ACL the migration/backfill endpoints use — a grantable resource permission
// rather than a users.role string check.
const seedCursorsAdminAuth = authorize(BACKFILL_ADMIN_RESOURCE, AccessType.ADMIN);
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

type ProviderPlatform = 'electron' | 'web';

type GoogleChannelConnectInitParams = {
  name: string;
  description?: string;
  visibility?: string;
  projectId: string;
  assigneeUserGroupId?: string;
  boardId?: string;
  userId: string;
  workspaceId: string;
  platform: ProviderPlatform;
};

class GoogleAuthRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GoogleAuthRouteError';
  }
}

// Redis-backed CSRF state store. Replaces the previous in-memory Map so OAuth
// state survives across server restarts and multi-instance deployments. TTL is
// enforced by Redis itself — no manual eviction needed.
export type OAuthStateValue = {
  channelId?: string;
  channelData?: PendingChannelData;
  mode?:
    | 'reconnect'
    | 'workspace'
    | 'dl-member-sync'
    | 'channel-email-workspace'
    | 'recording-email'
    | 'recording-doc';
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

const RECORDING_OAUTH_QUERY_PARAMS = {
  'recording-email': {
    connected: 'recordingEmailConnected',
    error: 'recordingEmailError',
  },
  'recording-doc': {
    connected: 'recordingGoogleDocConnected',
    error: 'recordingGoogleDocError',
  },
} as const;

type RecordingOAuthMode = keyof typeof RECORDING_OAUTH_QUERY_PARAMS;
type RecordingOAuthResult = keyof (typeof RECORDING_OAUTH_QUERY_PARAMS)[RecordingOAuthMode];

function recordingOAuthQueryParam(mode: RecordingOAuthMode, result: RecordingOAuthResult): string {
  return RECORDING_OAUTH_QUERY_PARAMS[mode][result];
}

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

const RECORDING_EMAIL_GMAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
];
const RECORDING_EMAIL_SOURCE_TYPE = 'google-recording-email';
const RECORDING_DOC_SOURCE_TYPE = 'google-recording-doc';
const RECORDING_DOC_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
];

export function getGoogleIntegrationRedirectUri(req: Request | null = null): string {
  return `${getBackendUrl(req)}/api/integrations/google/auth/callback`;
}

export function createOAuth2Client(
  redirectUri?: string
): InstanceType<typeof google.auth.OAuth2> {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_REDIRECT_URI || getGoogleIntegrationRedirectUri()
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

function redirectRecordingEmailOAuthResult(
  res: Response,
  frontendUrl: string,
  state: OAuthStateValue,
  params: URLSearchParams,
): void {
  res.redirect(
    buildPostOAuthRedirect(
      frontendUrl,
      buildReturnPathOrSupportPath(state.returnPath, state.workspaceId, undefined, params),
      state.platform,
    ),
  );
}

async function createGoogleChannelConnectAuthUrl(
  params: GoogleChannelConnectInitParams,
  req: Request,
): Promise<string> {
  const project = await db.project.findUnique({ where: { id: params.projectId } });
  if (!project) {
    throw new GoogleAuthRouteError('Project not found', 404);
  }

  const state = Math.random().toString(36).substring(7);
  await setOAuthState(state, {
    channelData: {
      name: params.name,
      description: params.description,
      visibility: params.visibility || 'public',
      projectId: params.projectId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      assigneeUserGroupId: params.assigneeUserGroupId,
      boardId: params.boardId,
    },
    platform: params.platform,
    timestamp: Date.now(),
  });

  return createOAuth2Client(getGoogleIntegrationRedirectUri(req)).generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
    state,
  });
}

async function createGoogleWorkspaceConnectAuthUrl(
  workspaceId: string,
  role: WorkspaceRole,
  platform: ProviderPlatform,
  req: Request,
): Promise<string> {
  if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
    throw new GoogleAuthRouteError('Workspace admin/owner role required to set up the desk email', 403);
  }

  const existing = await db.externalSource.findFirst({
    where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: ExternalSourcePlatform.GOOGLE },
  });
  if (existing?.isActive) {
    throw new GoogleAuthRouteError('Workspace already has a shared desk email configured', 409);
  }

  const state = Math.random().toString(36).substring(7);
  await setOAuthState(state, {
    mode: 'workspace',
    workspaceId,
    platform,
    userId: req.user!.id,
    timestamp: Date.now(),
  });

  return createOAuth2Client(getGoogleIntegrationRedirectUri(req)).generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
    state,
  });
}

async function createGoogleChannelEmailWorkspaceAuthUrl(
  workspaceId: string,
  role: WorkspaceRole,
  returnPath: string | undefined,
  platform: ProviderPlatform,
  req: Request,
): Promise<string> {
  if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
    throw new GoogleAuthRouteError('Workspace admin/owner role required to set up channel email', 403);
  }

  GoogleService.validatePushInfrastructure();

  const state = Math.random().toString(36).substring(7);
  await setOAuthState(state, {
    mode: 'channel-email-workspace',
    workspaceId,
    returnPath,
    platform,
    userId: req.user!.id,
    timestamp: Date.now(),
  });

  return createOAuth2Client(getGoogleIntegrationRedirectUri(req)).generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
    state,
  });
}

async function createGoogleRecordingEmailAuthUrl(
  userId: string,
  workspaceId: string,
  returnPath: string,
  platform: ProviderPlatform,
  req: Request,
): Promise<string> {
  const user = await db.user.findFirst({
    where: { id: userId, workspaceId },
    select: { email: true },
  });
  if (!user) {
    throw new GoogleAuthRouteError('User account not found', 401);
  }

  const state = randomUUID();
  await setOAuthState(state, {
    mode: 'recording-email',
    userId,
    workspaceId,
    expectedEmail: user.email.trim().toLowerCase(),
    returnPath,
    platform,
    timestamp: Date.now(),
  });

  return createOAuth2Client(getGoogleIntegrationRedirectUri(req)).generateAuthUrl({
    access_type: 'offline',
    scope: RECORDING_EMAIL_GMAIL_SCOPES,
    prompt: 'consent',
    state,
  });
}

async function createGoogleRecordingDocAuthUrl(
  userId: string,
  workspaceId: string,
  returnPath: string,
  platform: ProviderPlatform,
  req: Request,
): Promise<string> {
  const user = await db.user.findFirst({
    where: { id: userId, workspaceId },
    select: { email: true },
  });
  if (!user) throw new GoogleAuthRouteError('User account not found', 401);

  const state = randomUUID();
  await setOAuthState(state, {
    mode: 'recording-doc',
    userId,
    workspaceId,
    expectedEmail: user.email.trim().toLowerCase(),
    returnPath,
    platform,
    timestamp: Date.now(),
  });
  return createOAuth2Client(getGoogleIntegrationRedirectUri(req)).generateAuthUrl({
    access_type: 'offline',
    scope: RECORDING_DOC_SCOPES,
    prompt: 'consent',
    state,
  });
}

router.post('/connect/init', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const platform: ProviderPlatform = req.body.platform === 'electron' ? 'electron' : 'web';
  try {
    const { name, description, visibility, projectId, assigneeUserGroupId, boardId } = req.body;
    if (!name || !projectId) {
      res.status(400).json({ error: 'name and projectId are required' });
      return;
    }

    const authUrl = await createGoogleChannelConnectAuthUrl({
      name,
      description,
      visibility,
      projectId,
      assigneeUserGroupId,
      boardId,
      userId: req.user!.id,
      workspaceId: req.user!.workspaceId,
      platform,
    }, req);

    logger.info(`${TAG} Prepared Google OAuth URL for email channel creation`);
    res.json({ authUrl });
  } catch (error: any) {
    logger.error(`${TAG} Error initiating Google connect:`, error);
    if (error instanceof GoogleAuthRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error?.message || 'google_connect_failed' });
  }
});

// GET /api/integrations/google/connect
// Initiates Google OAuth flow for email channel creation (mirrors Microsoft /connect)
router.get('/connect', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const platform: ProviderPlatform =
    req.query.platform === 'electron' ? 'electron' : 'web';
  try {
    const { name, description, visibility, projectId, assigneeUserGroupId, boardId } = req.query;

    if (!name || !projectId) {
      res.status(400).json({ error: 'name and projectId are required' });
      return;
    }

    const authUrl = await createGoogleChannelConnectAuthUrl({
      name: name as string,
      description: description as string | undefined,
      visibility: visibility as string | undefined,
      projectId: projectId as string,
      assigneeUserGroupId: assigneeUserGroupId as string | undefined,
      boardId: boardId as string | undefined,
      userId: req.user!.id,
      workspaceId: req.user!.workspaceId,
      platform,
    }, req);

    logger.info(`${TAG} Redirecting to Google OAuth for email channel creation`);
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error(`${TAG} Error initiating Google connect:`, error);
    if (error instanceof GoogleAuthRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    redirectError(
      res,
      getFrontendUrl(req),
      'google_connect_failed',
      platform,
      req.user!.workspaceId,
    );
  }
});

router.post('/connect/workspace/init', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const platform: ProviderPlatform = req.body.platform === 'electron' ? 'electron' : 'web';
  try {
    const authUrl = await createGoogleWorkspaceConnectAuthUrl(
      req.user!.workspaceId,
      req.user!.role as WorkspaceRole,
      platform,
      req,
    );
    res.json({ authUrl });
  } catch (error: any) {
    logger.error(`${TAG} Error initiating workspace Google connect:`, error);
    if (error instanceof GoogleAuthRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error?.message || 'workspace_google_connect_failed' });
  }
});

// GET /api/integrations/google/connect/workspace
// Workspace-level OAuth: connects xyne.desk@<orgDomain> as the shared mailbox that
// DL desks ride on. No channel/preference is created — only an ExternalSource scoped
// to the workspace (channelId: null, workspaceId set). Only one shared mailbox per
// workspace is permitted (enforced by ExternalSource.workspaceId @unique).
router.get('/connect/workspace', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const platform: ProviderPlatform =
    req.query.platform === 'electron' ? 'electron' : 'web';
  try {
    const workspaceId = req.user!.workspaceId;
    const authUrl = await createGoogleWorkspaceConnectAuthUrl(
      workspaceId,
      req.user!.role as WorkspaceRole,
      platform,
      req,
    );

    logger.info(`${TAG} Redirecting to Google OAuth for workspace shared mailbox`, { workspaceId });
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error(`${TAG} Error initiating workspace Google connect:`, error);
    if (error instanceof GoogleAuthRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    redirectError(
      res,
      getFrontendUrl(req),
      'workspace_google_connect_failed',
      platform,
      req.user!.workspaceId,
    );
  }
});

router.post('/connect/channel-email-workspace/init', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const platform: ProviderPlatform = req.body.platform === 'electron' ? 'electron' : 'web';
  const returnPath = sanitizeReturnPath(req.body.returnPath);
  try {
    const authUrl = await createGoogleChannelEmailWorkspaceAuthUrl(
      req.user!.workspaceId,
      req.user!.role as WorkspaceRole,
      returnPath,
      platform,
      req,
    );
    res.json({ authUrl });
  } catch (error: any) {
    logger.error(`${TAG} Error initiating channel-email workspace Google connect:`, error);
    if (error instanceof GoogleAuthRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error?.message || 'channel_email_google_connect_failed' });
  }
});

router.get('/connect/channel-email-workspace', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const platform: ProviderPlatform =
    req.query.platform === 'electron' ? 'electron' : 'web';
  const returnPath = sanitizeReturnPath(req.query.returnPath);
  try {
    const workspaceId = req.user!.workspaceId;
    const authUrl = await createGoogleChannelEmailWorkspaceAuthUrl(
      workspaceId,
      req.user!.role as WorkspaceRole,
      returnPath,
      platform,
      req,
    );

    logger.info(`${TAG} Redirecting to Google OAuth for channel-email workspace mailbox`, {
      workspaceId,
    });
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error(`${TAG} Error initiating channel-email workspace Google connect:`, error);
    if (error instanceof GoogleAuthRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
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

router.post(
  '/connect/recording-email/init',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const returnPath = sanitizeReturnPath(req.body.returnPath);
    const platform: ProviderPlatform = req.body.platform === 'electron' ? 'electron' : 'web';
    if (!returnPath) {
      res.status(400).json({ error: 'A valid return path is required' });
      return;
    }

    try {
      const authUrl = await createGoogleRecordingEmailAuthUrl(
        req.user!.id,
        req.user!.workspaceId,
        returnPath,
        platform,
        req,
      );
      res.json({ authUrl });
    } catch (error: unknown) {
      logger.error(`${TAG} Error initiating recording email Google connect`, error);
      if (error instanceof GoogleAuthRouteError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: 'Unable to start Google email connection' });
    }
  },
);

router.post(
  '/connect/recording-doc/init',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const returnPath = sanitizeReturnPath(req.body.returnPath);
    const platform: ProviderPlatform = req.body.platform === 'electron' ? 'electron' : 'web';
    if (!returnPath) {
      res.status(400).json({ error: 'A valid return path is required' });
      return;
    }
    try {
      const authUrl = await createGoogleRecordingDocAuthUrl(
        req.user!.id,
        req.user!.workspaceId,
        returnPath,
        platform,
        req,
      );
      res.json({ authUrl });
    } catch (error: unknown) {
      logger.error(`${TAG} Error initiating recording Google Docs connect`, error);
      res.status(error instanceof GoogleAuthRouteError ? error.status : 400).json({
        error: error instanceof GoogleAuthRouteError ? error.message : 'Unable to start Google Docs connection',
      });
    }
  },
);

// Legacy /auth/start flow removed.
// The frontend now uses the authenticated /connect/* entry points, which
// validate workspace ownership before generating OAuth URLs.

// GET /api/integrations/google/auth/callback
router.get('/auth/callback', async (req: Request, res: Response): Promise<void> => {
  const frontendUrl = getFrontendUrl(req);
  const { code, state, error } = req.query;
  const stateData = state ? await getOAuthState(state as string) : null;
  const platform = stateData?.platform;
  const channelHint = stateData?.channelId;
  const stateWorkspaceId =
    stateData?.workspaceId ?? stateData?.channelData?.workspaceId;
  const redirectCallbackError = (message: string): void => {
    if (stateData?.mode === 'recording-email' || stateData?.mode === 'recording-doc') {
      redirectRecordingEmailOAuthResult(
        res,
        frontendUrl,
        stateData,
        new URLSearchParams({
          [recordingOAuthQueryParam(stateData.mode, 'error')]: message,
        }),
      );
      return;
    }
    redirectError(res, frontendUrl, message, platform, stateWorkspaceId, channelHint);
  };

  try {
    logger.info(`${TAG} OAuth callback received`, { hasCode: !!code, hasState: !!state, error });

    if (error) {
      logger.error(`${TAG} OAuth error:`, error);
      if (state) await deleteOAuthState(state as string);
      redirectCallbackError(String(error));
      return;
    }

    if (!code || !state) {
      redirectCallbackError('missing_code_or_state');
      return;
    }
    if (!stateData) {
      redirectError(res, frontendUrl, 'expired_state', platform);
      return;
    }

    await deleteOAuthState(state as string);

    // Exchange code for tokens
    logger.info(`${TAG} Exchanging code for tokens`);
    const oauth2Client = createOAuth2Client(getGoogleIntegrationRedirectUri(req));
    const { tokens } = await oauth2Client.getToken(code as string);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error(`Failed to obtain tokens — access_token: ${!!tokens.access_token}, refresh_token: ${!!tokens.refresh_token}`);
    }
    logger.info(`${TAG} Tokens obtained successfully`);

    if (stateData.mode === 'recording-email' || stateData.mode === 'recording-doc') {
      const isRecordingDoc = stateData.mode === 'recording-doc';
      if (!stateData.userId || !stateData.workspaceId || !stateData.expectedEmail || !tokens.id_token) {
        throw new Error(`Invalid recording ${isRecordingDoc ? 'Google Docs' : 'email'} OAuth state`);
      }

      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      const emailAddress = payload?.email?.trim().toLowerCase();
      if (!emailAddress || payload?.email_verified !== true) {
        redirectRecordingEmailOAuthResult(
          res,
          frontendUrl,
          stateData,
          new URLSearchParams({
            [recordingOAuthQueryParam(stateData.mode, 'error')]: 'Google did not verify this email address',
          }),
        );
        return;
      }
      if (emailAddress !== stateData.expectedEmail) {
        redirectRecordingEmailOAuthResult(
          res,
          frontendUrl,
          stateData,
          new URLSearchParams({
            [recordingOAuthQueryParam(stateData.mode, 'error')]:
              `Connect ${stateData.expectedEmail} to ${isRecordingDoc ? 'export recordings' : 'send recording recaps'}`,
          }),
        );
        return;
      }

      const currentUser = await db.user.findFirst({
        where: { id: stateData.userId, workspaceId: stateData.workspaceId },
        select: { email: true },
      });
      if (currentUser?.email.trim().toLowerCase() !== stateData.expectedEmail) {
        throw new Error(`Your Xyne account changed while connecting Google ${isRecordingDoc ? 'Docs' : 'email'}`);
      }

      const sourceName = `${isRecordingDoc ? 'google-recording-doc' : 'google-recording-email'}-${stateData.userId}`;
      const existingSource = await db.externalSource.findUnique({
        where: { name: sourceName },
        select: { id: true, workspaceId: true, ownerUserId: true },
      });
      if (
        existingSource &&
        (existingSource.workspaceId !== stateData.workspaceId ||
          existingSource.ownerUserId !== stateData.userId)
      ) {
        throw new Error(`Recording ${isRecordingDoc ? 'Google Docs' : 'email'} connection is owned by another user`);
      }

      const credentials = encrypt(
        JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          email: emailAddress,
        }),
      );
      await db.externalSource.upsert({
        where: { name: sourceName },
        update: {
          sourceType: isRecordingDoc ? RECORDING_DOC_SOURCE_TYPE : RECORDING_EMAIL_SOURCE_TYPE,
          displayName: emailAddress,
          channelId: null,
          workspaceId: stateData.workspaceId,
          ownerUserId: stateData.userId,
          credentials,
          isActive: true,
        },
        create: {
          name: sourceName,
          sourceType: isRecordingDoc ? RECORDING_DOC_SOURCE_TYPE : RECORDING_EMAIL_SOURCE_TYPE,
          displayName: emailAddress,
          channelId: null,
          workspaceId: stateData.workspaceId,
          ownerUserId: stateData.userId,
          credentials,
          isActive: true,
        },
      });

      logger.info(`${TAG} Recording ${isRecordingDoc ? 'Google Docs' : 'email'} connection established`, {
        workspaceId: stateData.workspaceId,
        userId: stateData.userId,
        sourceName,
      });
      redirectRecordingEmailOAuthResult(
        res,
        frontendUrl,
        stateData,
        new URLSearchParams({
          [recordingOAuthQueryParam(stateData.mode, 'connected')]: 'true',
        }),
      );
      return;
    }

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
    const username = emailAddress.replace('@', '--').replace(/[^a-zA-Z0-9_-]/g, '-');
    const sourceName = `google-${username}`;
    const legacyUsername = emailAddress.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
    const legacySourceName = `google-${legacyUsername}`;
    const legacyMatch = await db.externalSource.findUnique({ where: { name: legacySourceName } });
    const existingSource =
      (await db.externalSource.findUnique({ where: { name: sourceName } })) ??
      (legacyMatch?.displayName?.toLowerCase() === emailAddress.toLowerCase() ? legacyMatch : null);
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

      const sourceRow =
        existingSource ??
        (await db.externalSource.findFirst({
          where: {
            channelId: stateData.channelId,
            sourceType: ExternalSourcePlatform.GOOGLE,
            NOT: { name: { startsWith: 'google-dl-sync' } },
          },
          select: { id: true },
          orderBy: { createdAt: 'desc' },
        }));
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
        data: { name: sourceName, credentials: reEncrypted.encryptedCredentials, isActive: true },
      });

      logger.info(`${TAG} Reconnected Gmail integration`, {
        channelId: stateData.channelId,
        sourceId: sourceRow.id,
      });

      await enqueueCursorCatchup({
        sourceId: sourceRow.id,
        watchHistoryId: reEncrypted.watchResult.historyId,
        requesterUserId: stateData.userId,
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
      const existingForWorkspace = await db.externalSource.findFirst({ where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: ExternalSourcePlatform.GOOGLE } });
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
            ...(existingForWorkspace.lastSyncCursor == null && {
              lastSyncCursor: network.watchResult.historyId,
            }),
          },
        });

        await enqueueCursorCatchup({
          sourceId: existingForWorkspace.id,
          watchHistoryId: network.watchResult.historyId,
          requesterUserId: stateData.userId,
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
              lastSyncCursor: network.watchResult.historyId,
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
        deskIntegrations: 'open',
        provider: 'google',
        email: emailAddress,
      });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(workspaceId, undefined, params),
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
          workspaceId: stateData.workspaceId,
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
      const username = emailAddress.replace('@', '--').replace(/[^a-zA-Z0-9_-]/g, '-');
      const sourceName = `google-channel-email-${username}`;
      const legacyUsername = emailAddress.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
      const legacySourceName = `google-channel-email-${legacyUsername}`;
      const legacyByName = await db.externalSource.findUnique({ where: { name: legacySourceName } });
      const existingByName =
        (await db.externalSource.findUnique({ where: { name: sourceName } })) ??
        (legacyByName?.displayName?.toLowerCase() === emailAddress.toLowerCase() ? legacyByName : null);
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
            ...(existingSource.lastSyncCursor == null && {
              lastSyncCursor: network.watchResult.historyId,
            }),
          },
        });

        await enqueueCursorCatchup({
          sourceId: existingSource.id,
          watchHistoryId: network.watchResult.historyId,
          requesterUserId: stateData.userId,
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
            lastSyncCursor: network.watchResult.historyId,
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
            scopeType: ChannelScopeType.DEFAULT,
            name: cd.name,
            description: cd.description,
            visibility: cd.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
            createdBy: cd.userId,
            workspaceId: cd.workspaceId,
            projectId: cd.projectId,
            type: ChannelType.EMAIL,
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
          data: { channelId: ch.id, userId: cd.userId, role: ChannelRole.ADMIN, workspaceId: cd.workspaceId },
        });

        await tx.channelUserStatus.create({
          data: {
            channelId: ch.id,
            userId: cd.userId,
            lastViewedAt: now,
            conversationSeenCutoffAt,
            updatedAt: now,
            workspaceId: cd.workspaceId,
          },
        });

        await tx.channelStats.create({
          data: {
            channelId: ch.id,
            lastActivityAt: now,
            participantCount: 1,
            workspaceId: cd.workspaceId,
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
            workspaceId: cd.workspaceId,
          },
        });

        const boards = await tx.board.findMany({
          where: { projectId: cd.projectId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        const board = boards[0] ?? null;

        // Dual-write: mirror the channel→project board set into ChannelBoardMapping
        // so downstream consumers never need to read channel.projectId.
        if (boards.length > 0) {
          await tx.channelBoardMapping.createMany({
            data: boards.map((b, index) => ({
              channelId: ch.id,
              boardId: b.id,
              workspaceId: cd.workspaceId,
              isDefault: cd.boardId ? b.id === cd.boardId : index === 0,
              createdBy: cd.userId,
              createdAt: now,
              updatedAt: now,
            })),
            skipDuplicates: true,
          });
        }

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
            workspaceId: cd.workspaceId,
            lastSyncCursor: network.watchResult.historyId,
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
    } else {
      throw new Error('No channel info in OAuth state');
    }
  } catch (error: any) {
    const message = error?.message || 'Unknown error';
    const stack = error?.stack || '';
    logger.error(`${TAG} Error in OAuth callback: ${message}`, { stack });
    redirectCallbackError(message);
  }
});

/**
 * POST /api/integrations/google/admin/seed-sync-cursors
 * Give every active Gmail source a starting `lastSyncCursor` from `users.getProfile`.
 * Run before the cursor-resuming ingestion path ships.
 *
 * `?dryRun=true` previews. `?overwrite=true` replaces existing cursors — safe only
 * while nothing reads the column.
 */
router.post('/admin/seed-sync-cursors', authMiddleware.authenticate, seedCursorsAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
    const overwrite = req.query.overwrite === 'true' || req.body?.overwrite === true;

    const report = await GoogleService.seedSyncCursors({ dryRun, overwrite });

    logger.info(`${TAG} seed-sync-cursors finished`, {
      dryRun: report.dryRun,
      overwrite: report.overwrite,
      seededCount: report.seeded.length,
      skippedCount: report.skipped.length,
      requestedBy: req.user?.id,
    });
    res.json({ success: true, ...report });
  } catch (error: any) {
    logger.error(`${TAG} seed-sync-cursors failed`, error);
    res.status(500).json({ success: false, error: error?.message ?? 'Unknown error' });
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

    // Renew the exact source row; Gmail source names are not reversible from email.
    const result = await pubSubWatchService.renewSubscription('gmail', {
      id: source.id,
      email: source.displayName,
    });

    logger.info(`${TAG} Gmail watch renewed`, { sourceName });
    res.json({ success: true, historyId: result.historyId, expiration: result.expiration });
  } catch (error: any) {
    logger.error(`${TAG} Error renewing Gmail watch:`, error);
    res.status(500).json({ error: 'Failed to renew Gmail watch', details: error.message });
  }
});

export default router;
