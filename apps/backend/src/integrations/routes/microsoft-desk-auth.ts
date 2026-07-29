/**
 * Microsoft Desk Auth Routes
 * OAuth connect/callback for Microsoft email channels
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { authV2Middleware } from '../../middleware/authV2Middleware';
import {
  microsoftDeskService,
  isReconnectChannelData,
  isWorkspaceChannelData,
  isDlMemberSyncChannelData,
  isChannelEmailWorkspaceData,
  MICROSOFT_OAUTH_SCOPES,
} from '../../services/microsoftDeskService';
import { decrypt, encrypt } from '../../services/encryptionService';
import { db } from '../../database/client';
import { emailFetchQueue } from '../../queues/emailFetchQueue';
import { logger } from '../../utils/logger';
import { WorkspaceRole } from '@prisma/client';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';
import {
  appendQueryToReturnPath,
  buildReturnPathOrSupportPath,
  buildSupportPath,
  sanitizeReturnPath,
} from './urlHelpers';

const router = Router();

type ProviderPlatform = 'electron' | 'web';

type MicrosoftChannelConnectInitParams = {
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

class MicrosoftDeskRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MicrosoftDeskRouteError';
  }
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

async function createMicrosoftChannelConnectAuthUrl(
  params: MicrosoftChannelConnectInitParams,
  req: Request,
): Promise<string> {
  const oauthClient = microsoftDeskService.getOAuthClient();
  if (!oauthClient) {
    throw new MicrosoftDeskRouteError('microsoft_not_configured', 500);
  }

  const project = await db.project.findUnique({ where: { id: params.projectId } });
  if (!project) {
    throw new MicrosoftDeskRouteError('project_not_found', 404);
  }

  const state = microsoftDeskService.generateState();
  await microsoftDeskService.storePendingChannel(state, {
    mode: 'create',
    name: params.name,
    description: params.description,
    visibility: params.visibility || 'public',
    projectId: params.projectId,
    userId: params.userId,
    workspaceId: params.workspaceId,
    assigneeUserGroupId: params.assigneeUserGroupId,
    boardId: params.boardId,
    platform: params.platform,
  });

  const redirectUri = `${getBackendUrl(req)}/api/integrations/microsoft/callback`;
  return oauthClient.authorizeURL({
    redirect_uri: redirectUri,
    scope: MICROSOFT_OAUTH_SCOPES,
    state,
    prompt: 'consent',
  } as Record<string, string | string[]>);
}

async function createMicrosoftWorkspaceConnectAuthUrl(
  userId: string,
  workspaceId: string,
  role: WorkspaceRole,
  platform: ProviderPlatform,
  req: Request,
): Promise<string> {
  if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
    throw new MicrosoftDeskRouteError('Workspace admin/owner role required to set up the desk email', 403);
  }

  const oauthClient = microsoftDeskService.getOAuthClient();
  if (!oauthClient) {
    throw new MicrosoftDeskRouteError('microsoft_not_configured', 500);
  }

  const existing = await db.externalSource.findFirst({ where: { workspaceId, sourceType: 'microsoft' } });
  if (existing?.isActive) {
    throw new MicrosoftDeskRouteError('Workspace already has a shared desk email configured', 409);
  }

  const state = microsoftDeskService.generateState();
  await microsoftDeskService.storePendingChannel(state, {
    mode: 'workspace',
    userId,
    workspaceId,
    platform,
  });

  const redirectUri = `${getBackendUrl(req)}/api/integrations/microsoft/callback`;
  return oauthClient.authorizeURL({
    redirect_uri: redirectUri,
    scope: MICROSOFT_OAUTH_SCOPES,
    state,
    prompt: 'consent',
  } as Record<string, string | string[]>);
}

async function createMicrosoftChannelEmailWorkspaceAuthUrl(
  userId: string,
  workspaceId: string,
  role: WorkspaceRole,
  returnPath: string | undefined,
  platform: ProviderPlatform,
  req: Request,
): Promise<string> {
  if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
    throw new MicrosoftDeskRouteError('Workspace admin/owner role required to set up channel email', 403);
  }

  const oauthClient = microsoftDeskService.getOAuthClient();
  if (!oauthClient) {
    throw new MicrosoftDeskRouteError('microsoft_not_configured', 500);
  }

  const state = microsoftDeskService.generateState();
  await microsoftDeskService.storePendingChannel(state, {
    mode: 'channel-email-workspace',
    userId,
    workspaceId,
    returnPath,
    platform,
  });

  const redirectUri = `${getBackendUrl(req)}/api/integrations/microsoft/callback`;
  return oauthClient.authorizeURL({
    redirect_uri: redirectUri,
    scope: MICROSOFT_OAUTH_SCOPES,
    state,
    prompt: 'consent',
  } as Record<string, string | string[]>);
}

/**
 * POST /api/integrations/microsoft/connect/init
 * Returns the Microsoft OAuth URL without relying on the browser's Xyne session.
 */
router.post('/connect/init', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_DESK_CONNECT_INIT_${Date.now()}`;
  const platform: ProviderPlatform = req.body.platform === 'electron' ? 'electron' : 'web';
  try {
    const { name, description, visibility, projectId, assigneeUserGroupId, boardId } = req.body;
    if (!name || !projectId) {
      res.status(400).json({ error: 'name and projectId are required' });
      return;
    }

    const authUrl = await createMicrosoftChannelConnectAuthUrl({
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

    logger.info(`[${requestId}] Prepared Microsoft OAuth URL for email channel`);
    res.json({ authUrl });
  } catch (error: any) {
    logger.error(`[${requestId}] Error initiating Microsoft email connect:`, error);
    if (error instanceof MicrosoftDeskRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error?.message || 'microsoft_connect_failed' });
  }
});

/**
 * GET /api/integrations/microsoft/connect
 * Initiates Microsoft OAuth flow for email channel creation
 */
router.get('/connect', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_DESK_CONNECT_${Date.now()}`;
  const platform: ProviderPlatform =
    req.query.platform === 'electron' ? 'electron' : 'web';
  const workspaceId = req.user!.workspaceId;

  try {
    const { name, description, visibility, projectId, assigneeUserGroupId, boardId } = req.query;

    if (!name || !projectId) {
      redirectError(res, getFrontendUrl(req), 'name and projectId are required', platform, workspaceId);
      return;
    }

    const authorizationUri = await createMicrosoftChannelConnectAuthUrl({
      name: name as string,
      description: description as string | undefined,
      visibility: visibility as string | undefined,
      projectId: projectId as string,
      assigneeUserGroupId: assigneeUserGroupId as string | undefined,
      boardId: boardId as string | undefined,
      userId: req.user!.id,
      workspaceId,
      platform,
    }, req);

    logger.info(`[${requestId}] Redirecting to Microsoft OAuth for email channel`);
    res.redirect(authorizationUri);
  } catch (error) {
    logger.error(`[${requestId}] Error initiating Microsoft email connect:`, error);
    if (error instanceof MicrosoftDeskRouteError) {
      if (error.message === 'microsoft_not_configured') {
        redirectError(res, getFrontendUrl(req), error.message, platform, workspaceId);
        return;
      }
      res.status(error.status).json({ error: error.message });
      return;
    }
    redirectError(res, getFrontendUrl(req), 'microsoft_connect_failed', platform, workspaceId);
  }
});

/**
 * POST /api/integrations/microsoft/connect/workspace/init
 * Returns the Microsoft OAuth URL for the workspace shared mailbox.
 */
router.post('/connect/workspace/init', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_DESK_WS_CONNECT_INIT_${Date.now()}`;
  const platform: ProviderPlatform = req.body.platform === 'electron' ? 'electron' : 'web';
  try {
    const authUrl = await createMicrosoftWorkspaceConnectAuthUrl(
      req.user!.id,
      req.user!.workspaceId,
      req.user!.role as WorkspaceRole,
      platform,
      req,
    );
    logger.info(`[${requestId}] Prepared Microsoft OAuth URL for workspace shared mailbox`);
    res.json({ authUrl });
  } catch (error: any) {
    logger.error(`[${requestId}] Error initiating Microsoft workspace connect:`, error);
    if (error instanceof MicrosoftDeskRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error?.message || 'microsoft_workspace_connect_failed' });
  }
});

/**
 * GET /api/integrations/microsoft/connect/workspace
 * Workspace-level OAuth: connects xyne.desk@<orgDomain> as the shared mailbox
 * that DL desks ride on. Admin/owner only. Creates no channel.
 */
router.get('/connect/workspace', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_DESK_WS_CONNECT_${Date.now()}`;
  const platform: ProviderPlatform =
    req.query.platform === 'electron' ? 'electron' : 'web';
  const workspaceId = req.user!.workspaceId;

  try {
    const authorizationUri = await createMicrosoftWorkspaceConnectAuthUrl(
      req.user!.id,
      workspaceId,
      req.user!.role as WorkspaceRole,
      platform,
      req,
    );

    logger.info(`[${requestId}] Redirecting to Microsoft OAuth for workspace shared mailbox`, { workspaceId });
    res.redirect(authorizationUri);
  } catch (error) {
    logger.error(`[${requestId}] Error initiating Microsoft workspace connect:`, error);
    if (error instanceof MicrosoftDeskRouteError) {
      if (error.message === 'microsoft_not_configured') {
        redirectError(res, getFrontendUrl(req), error.message, platform, workspaceId);
        return;
      }
      res.status(error.status).json({ error: error.message });
      return;
    }
    redirectError(res, getFrontendUrl(req), 'microsoft_workspace_connect_failed', platform, workspaceId);
  }
});

router.post('/connect/channel-email-workspace/init', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_CHANNEL_EMAIL_WS_CONNECT_INIT_${Date.now()}`;
  const platform: ProviderPlatform = req.body.platform === 'electron' ? 'electron' : 'web';
  const returnPath = sanitizeReturnPath(req.body.returnPath);
  try {
    const authUrl = await createMicrosoftChannelEmailWorkspaceAuthUrl(
      req.user!.id,
      req.user!.workspaceId,
      req.user!.role as WorkspaceRole,
      returnPath,
      platform,
      req,
    );
    logger.info(`[${requestId}] Prepared Microsoft OAuth URL for channel-email workspace mailbox`);
    res.json({ authUrl });
  } catch (error: any) {
    logger.error(`[${requestId}] Error initiating Microsoft channel-email workspace connect:`, error);
    if (error instanceof MicrosoftDeskRouteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error?.message || 'microsoft_channel_email_connect_failed' });
  }
});

router.get('/connect/channel-email-workspace', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_CHANNEL_EMAIL_WS_CONNECT_${Date.now()}`;
  const platform: ProviderPlatform =
    req.query.platform === 'electron' ? 'electron' : 'web';
  const workspaceId = req.user!.workspaceId;
  const returnPath = sanitizeReturnPath(req.query.returnPath);

  try {
    const authorizationUri = await createMicrosoftChannelEmailWorkspaceAuthUrl(
      req.user!.id,
      workspaceId,
      req.user!.role as WorkspaceRole,
      returnPath,
      platform,
      req,
    );

    logger.info(`[${requestId}] Redirecting to Microsoft OAuth for channel-email workspace mailbox`, { workspaceId });
    res.redirect(authorizationUri);
  } catch (error) {
    logger.error(`[${requestId}] Error initiating Microsoft channel-email workspace connect:`, error);
    if (error instanceof MicrosoftDeskRouteError) {
      if (error.message === 'microsoft_not_configured') {
        redirectError(res, getFrontendUrl(req), error.message, platform, workspaceId);
        return;
      }
      res.status(error.status).json({ error: error.message });
      return;
    }
    const params = new URLSearchParams({
      emailError: 'microsoft_channel_email_connect_failed',
    });
    res.redirect(
      buildPostOAuthRedirect(
        getFrontendUrl(req),
        buildReturnPathOrSupportPath(returnPath, workspaceId, undefined, params),
        platform,
      ),
    );
  }
});

/**
 * GET /api/integrations/microsoft/callback
 * Handles Microsoft OAuth callback — creates channel + source + webhook
 */
router.get('/callback', async (req: Request, res: Response) => {
  const requestId = `MS_DESK_CALLBACK_${Date.now()}`;
  const frontendUrl = getFrontendUrl(req);
  const { code, state, error } = req.query;
  const channelData = state
    ? await microsoftDeskService.getPendingChannel(state as string)
    : null;
  const platform: 'electron' | 'web' =
    channelData?.platform === 'electron' ? 'electron' : 'web';
  const channelHint = channelData && isReconnectChannelData(channelData)
    ? channelData.channelId
    : undefined;

  const stateWorkspaceId = channelData
    ? isReconnectChannelData(channelData)
      ? channelData.workspaceId
      : channelData.workspaceId
    : undefined;

  try {
    const oauthClient = microsoftDeskService.getOAuthClient();
    if (!oauthClient) {
      redirectError(res, frontendUrl, 'microsoft_not_configured', platform, stateWorkspaceId, channelHint);
      return;
    }

    if (error) {
      logger.error(`[${requestId}] Microsoft OAuth error: ${error}`);
      redirectError(res, frontendUrl, String(error), platform, stateWorkspaceId, channelHint);
      return;
    }

    if (!code || !state) {
      redirectError(res, frontendUrl, 'missing_params', platform, stateWorkspaceId, channelHint);
      return;
    }

    if (!channelData) {
      logger.error(`[${requestId}] Pending channel data not found or expired`);
      redirectError(res, frontendUrl, 'expired_state', platform);
      return;
    }

    const redirectUri = `${getBackendUrl(req)}/api/integrations/microsoft/callback`;
    let tokenResult;
    try {
      tokenResult = await oauthClient.getToken({
        code: code as string,
        redirect_uri: redirectUri,
        scope: MICROSOFT_OAUTH_SCOPES.join(' '),
      });
    } catch (err) {
      const oauthError = err as {
        message?: string;
        data?: {
          res?: { statusCode?: number };
          payload?: unknown;
        };
      };

      logger.error(`[${requestId}] Microsoft token exchange failed`, {
        errorMessage: oauthError.message ?? 'Unknown token exchange error',
        statusCode: oauthError.data?.res?.statusCode,
        payload: oauthError.data?.payload,
        redirectUri,
      });
      throw err;
    }

    const { token } = tokenResult;
    const accessToken = token.access_token as string;

    if (!accessToken) {
      logger.error(`[${requestId}] No access token received from Microsoft`);
      redirectError(res, frontendUrl, 'no_access_token', platform, stateWorkspaceId, channelHint);
      return;
    }

    const email = await microsoftDeskService.resolveEmail(accessToken, token.id_token as string | undefined);
    if (!email) {
      logger.error(`[${requestId}] Could not determine email from Microsoft profile`);
      redirectError(res, frontendUrl, 'no_email', platform, stateWorkspaceId, channelHint);
      return;
    }


    if (isReconnectChannelData(channelData)) {
      const expected = channelData.expectedEmail.toLowerCase();
      if (email.toLowerCase() !== expected) {
        logger.warn(`[${requestId}] Reconnect email mismatch: got ${email}, expected ${expected}`);
        const params = new URLSearchParams({
          emailError: `This desk is bound to ${expected}. Please sign in with that account.`,
        });
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            buildSupportPath(channelData.workspaceId, channelData.channelId, params),
            platform,
          ),
        );
        return;
      }

      const source = await db.externalSource.findFirst({
        where: { channelId: channelData.channelId },
        select: { id: true, name: true, credentials: true, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!source) {
        logger.error(`[${requestId}] No ExternalSource found for reconnect`);
        const params = new URLSearchParams({ emailError: 'no_source' });
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            buildSupportPath(channelData.workspaceId, channelData.channelId, params),
            platform,
          ),
        );
        return;
      }

      const expiresAt = token.expires_at
        ? new Date(token.expires_at as string).toISOString()
        : undefined;
      const existingCredentials = (() => {
        try {
          return source.credentials ? JSON.parse(decrypt(source.credentials)) as { clientState?: string } : {};
        } catch {
          return {};
        }
      })();
      const clientState = existingCredentials.clientState || crypto.randomBytes(16).toString('hex');
      const reconnectCreds = {
        accessToken,
        refreshToken: (token.refresh_token as string) ?? undefined,
        email,
        expiresAt,
        clientState,
      };
      await db.externalSource.update({
        where: { id: source.id },
        data: {
          credentials: encrypt(JSON.stringify(reconnectCreds)),
          isActive: true,
        },
      });

      try {
        const webhookUrl = `${getBackendUrl(req)}/api/external-source-sync/${source.name}/ingest`;
        await microsoftDeskService.registerGraphWebhook(
          accessToken,
          webhookUrl,
          clientState,
        );
      } catch (err) {
        logger.warn(`[${requestId}] Failed to re-register webhook on reconnect`, err);
        try {
          await db.externalSource.update({
            where: { id: source.id },
            data: {
              credentials: source.credentials,
              isActive: source.isActive,
            },
          });
        } catch (rollbackErr) {
          logger.error(`[${requestId}] Failed to roll back reconnect after webhook error`, rollbackErr);
        }
        throw new MicrosoftDeskRouteError('Reconnect failed, try again once', 502);
      }

      logger.info(`[${requestId}] Microsoft integration reconnected: ${channelData.channelId}`);
      const params = new URLSearchParams({
        emailReconnected: 'true',
        provider: 'microsoft',
      });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(channelData.workspaceId, channelData.channelId, params),
          platform,
        ),
      );
      return;
    }

    if (isWorkspaceChannelData(channelData)) {
      try {
        await microsoftDeskService.createWorkspaceSource(
          channelData,
          {
            accessToken,
            refreshToken: (token.refresh_token as string) ?? undefined,
            email,
            expiresAt: token.expires_at ? new Date(token.expires_at as string).toISOString() : undefined,
          },
          getBackendUrl(req),
        );
      } catch (err) {
        const errCode = (err as Error & { code?: string })?.code;
        if (errCode === 'WORKSPACE_MAILBOX_EXISTS') {
          redirectError(res, frontendUrl, 'workspace_mailbox_already_exists', platform, channelData.workspaceId);
          return;
        }
        if (errCode === 'GMAIL_ALREADY_CONNECTED') {
          redirectError(res, frontendUrl, 'microsoft_account_already_connected', platform, channelData.workspaceId);
          return;
        }
        throw err;
      }

      logger.info(`[${requestId}] Microsoft workspace shared mailbox connected`, {
        workspaceId: channelData.workspaceId,
        email,
      });

      const workspaceParams = new URLSearchParams({
        workspaceMailboxConnected: 'true',
        deskIntegrations: 'open',
        provider: 'microsoft',
        email,
      });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(channelData.workspaceId, undefined, workspaceParams),
          platform,
        ),
      );
      return;
    }

    if (isDlMemberSyncChannelData(channelData)) {
      const expiresAt = token.expires_at
        ? new Date(token.expires_at as string).toISOString()
        : undefined;

      const sanitizedEmail = email.replace(/[^a-zA-Z0-9._-]/g, '_');
      const sourceName = `microsoft-dl-sync--${sanitizedEmail}--${channelData.channelId.slice(0, 8)}`;
      const encryptedCredentials = encrypt(JSON.stringify({
        accessToken,
        refreshToken: (token.refresh_token as string) ?? undefined,
        email,
        expiresAt,
      }));

      const tempSource = await db.externalSource.upsert({
        where: { name: sourceName },
        update: {
          displayName: email,
          channelId: channelData.channelId,
          credentials: encryptedCredentials,
          isActive: true,
        },
        create: {
          name: sourceName,
          sourceType: 'microsoft',
          displayName: email,
          channelId: channelData.channelId,
          workspaceId: channelData.workspaceId,
          credentials: encryptedCredentials,
          isActive: true,
        },
      });

      if (!emailFetchQueue.isReady) await emailFetchQueue.initialize();
      await emailFetchQueue.getQueue().add('refetch', {
        sourceId: tempSource.id,
        channelId: channelData.channelId,
        requesterUserId: channelData.userId,
        workspaceId: channelData.workspaceId,
        startDate: channelData.startDate,
        endDate: channelData.endDate,
        targetChannelId: channelData.channelId,
        dlEmail: channelData.dlEmail,
        isDlMemberSync: true,
      });

      logger.info(`[${requestId}] DL member sync started`, {
        channelId: channelData.channelId,
        sourceId: tempSource.id,
        email,
      });

      const syncParams = new URLSearchParams({
        dlMemberSyncStarted: 'true',
        provider: 'microsoft',
      });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(channelData.workspaceId, channelData.channelId, syncParams),
          platform,
        ),
      );
      return;
    }

    if (isChannelEmailWorkspaceData(channelData)) {
      try {
        await microsoftDeskService.createChannelEmailWorkspaceSource(
          channelData,
          {
            accessToken,
            refreshToken: (token.refresh_token as string) ?? undefined,
            email,
            expiresAt: token.expires_at ? new Date(token.expires_at as string).toISOString() : undefined,
          },
          getBackendUrl(req),
        );
      } catch (err) {
        const errCode = (err as Error & { code?: string })?.code;
        if (errCode === 'CHANNEL_EMAIL_MAILBOX_EXISTS') {
          const params = new URLSearchParams({
            emailError: 'channel_email_mailbox_already_exists',
          });
          res.redirect(
            buildPostOAuthRedirect(
              frontendUrl,
              buildReturnPathOrSupportPath(
                channelData.returnPath,
                channelData.workspaceId,
                undefined,
                params,
              ),
              platform,
            ),
          );
          return;
        }
        if (errCode === 'CHANNEL_EMAIL_MAILBOX_CONNECTED_ELSEWHERE') {
          const params = new URLSearchParams({
            emailError: 'channel_email_mailbox_already_connected_elsewhere',
          });
          res.redirect(
            buildPostOAuthRedirect(
              frontendUrl,
              buildReturnPathOrSupportPath(
                channelData.returnPath,
                channelData.workspaceId,
                undefined,
                params,
              ),
              platform,
            ),
          );
          return;
        }
        throw err;
      }

      const params = new URLSearchParams({
        channelEmailMailboxConnected: 'true',
        provider: 'microsoft',
      });
      if (channelData.returnPath) {
        res.redirect(
          buildPostOAuthRedirect(
            frontendUrl,
            appendQueryToReturnPath(channelData.returnPath, params),
            platform,
          ),
        );
        return;
      }

      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          buildSupportPath(channelData.workspaceId, undefined, params),
          platform,
        ),
      );
      return;
    }

    const { channelId } = await microsoftDeskService.createChannelAndSource(channelData, {
      accessToken,
      refreshToken: (token.refresh_token as string) ?? undefined,
      email,
      expiresAt: token.expires_at ? new Date(token.expires_at as string).toISOString() : undefined,
    }, getBackendUrl(req));

    logger.info(`[${requestId}] Microsoft email channel created: ${channelId}`);

    const successParams = new URLSearchParams({
      emailConnected: 'true',
      provider: 'microsoft',
    });
    res.redirect(
      buildPostOAuthRedirect(
        frontendUrl,
        buildSupportPath(channelData.workspaceId, channelId, successParams),
        platform,
      ),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[${requestId}] Microsoft email callback error: ${errorMessage}`, error);

    const existingChannelId = (error as Error & { existingChannelId?: string })?.existingChannelId;
    redirectError(res, frontendUrl, errorMessage, platform, stateWorkspaceId, existingChannelId ?? channelHint);
  }
});

export default router;
