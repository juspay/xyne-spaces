/**
 * Microsoft Desk Auth Routes
 * OAuth connect/callback for Microsoft email channels
 */

import { Router, Request, Response } from 'express';
import { authV2Middleware } from '../../middleware/authV2Middleware';
import {
  microsoftDeskService,
  isReconnectChannelData,
  isWorkspaceChannelData,
  MICROSOFT_OAUTH_SCOPES,
} from '../../services/microsoftDeskService';
import { encrypt } from '../../services/encryptionService';
import { db } from '../../database/client';
import { logger } from '../../utils/logger';
import { WorkspaceRole } from '@prisma/client';
import { getFrontendUrl, getBackendUrl } from './urlHelpers';

const router = Router();

function getPublicUrl(req: Request): string {
  return getBackendUrl(req);
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

function buildSupportPath(
  workspaceId: string | undefined,
  channelId: string | undefined,
  query: URLSearchParams,
): string {
  const queryString = query.toString();
  const wsSegment = workspaceId ? `/${workspaceId}` : '';
  const channelSegment = channelId ? `/${channelId}` : '';
  const suffix = queryString ? `?${queryString}` : '';
  return `${wsSegment}/support${channelSegment}${suffix}`;
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

/**
 * GET /api/integrations/microsoft/connect
 * Initiates Microsoft OAuth flow for email channel creation
 */
router.get('/connect', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_DESK_CONNECT_${Date.now()}`;
  const platform: 'electron' | 'web' =
    req.query.platform === 'electron' ? 'electron' : 'web';
  const workspaceId = req.user!.workspaceId;

  try {
    const oauthClient = microsoftDeskService.getOAuthClient();
    if (!oauthClient) {
      redirectError(res, getFrontendUrl(), 'microsoft_not_configured', platform, workspaceId);
      return;
    }

    const { name, description, visibility, projectId, assigneeUserGroupId, boardId } = req.query;
    const userId = req.user!.id;

    if (!name || !projectId) {
      redirectError(res, getFrontendUrl(), 'name and projectId are required', platform, workspaceId);
      return;
    }

    const project = await db.project.findUnique({ where: { id: projectId as string } });
    if (!project) {
      redirectError(res, getFrontendUrl(), 'project_not_found', platform, workspaceId);
      return;
    }

    const state = microsoftDeskService.generateState();

    await microsoftDeskService.storePendingChannel(state, {
      mode: 'create',
      name: name as string,
      description: description as string | undefined,
      visibility: (visibility as string) || 'public',
      projectId: projectId as string,
      userId,
      workspaceId,
      assigneeUserGroupId: assigneeUserGroupId as string | undefined,
      boardId: boardId as string | undefined,
      platform,
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
    redirectError(res, getFrontendUrl(), 'microsoft_connect_failed', platform, workspaceId);
  }
});

/**
 * GET /api/integrations/microsoft/connect/workspace
 * Workspace-level OAuth: connects xyne.desk@<orgDomain> as the shared mailbox
 * that DL desks ride on. Admin/owner only. Creates no channel.
 */
router.get('/connect/workspace', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  const requestId = `MS_DESK_WS_CONNECT_${Date.now()}`;
  const platform: 'electron' | 'web' =
    req.query.platform === 'electron' ? 'electron' : 'web';
  const workspaceId = req.user!.workspaceId;

  try {
    const role = req.user!.role as WorkspaceRole;
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      res.status(403).json({ error: 'Workspace admin/owner role required to set up the desk email' });
      return;
    }

    const oauthClient = microsoftDeskService.getOAuthClient();
    if (!oauthClient) {
      redirectError(res, getFrontendUrl(), 'microsoft_not_configured', platform, workspaceId);
      return;
    }

    const existing = await db.externalSource.findFirst({ where: { workspaceId, sourceType: 'microsoft' } });
    if (existing?.isActive) {
      res.status(409).json({
        error: 'Workspace already has a shared desk email configured',
        existingDisplayName: existing.displayName,
      });
      return;
    }

    const state = microsoftDeskService.generateState();
    await microsoftDeskService.storePendingChannel(state, {
      mode: 'workspace',
      userId: req.user!.id,
      workspaceId,
      platform,
    });

    const redirectUri = `${getPublicUrl(req)}/api/integrations/microsoft/callback`;
    const authorizationUri = oauthClient.authorizeURL({
      redirect_uri: redirectUri,
      scope: MICROSOFT_OAUTH_SCOPES,
      state,
      prompt: 'consent',
    } as Record<string, string | string[]>);

    logger.info(`[${requestId}] Redirecting to Microsoft OAuth for workspace shared mailbox`, { workspaceId });
    res.redirect(authorizationUri);
  } catch (error) {
    logger.error(`[${requestId}] Error initiating Microsoft workspace connect:`, error);
    redirectError(res, getFrontendUrl(), 'microsoft_workspace_connect_failed', platform, workspaceId);
  }
});

/**
 * GET /api/integrations/microsoft/callback
 * Handles Microsoft OAuth callback — creates channel + source + webhook
 */
router.get('/callback', async (req: Request, res: Response) => {
  const requestId = `MS_DESK_CALLBACK_${Date.now()}`;
  const frontendUrl = getFrontendUrl();
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

    const redirectUri = `${getPublicUrl(req)}/api/integrations/microsoft/callback`;
    const tokenResult = await oauthClient.getToken({
      code: code as string,
      redirect_uri: redirectUri,
      scope: MICROSOFT_OAUTH_SCOPES.join(' '),
    });

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
        select: { id: true, name: true },
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
        const webhookUrl = `${getPublicUrl(req)}/api/external-source-sync/${source.name}/ingest`;
        await microsoftDeskService.registerGraphWebhook(accessToken, webhookUrl);
      } catch (err) {
        logger.warn(`[${requestId}] Failed to re-register webhook on reconnect`, err);
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
          getPublicUrl(req),
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
        provider: 'microsoft',
        email,
      });
      res.redirect(
        buildPostOAuthRedirect(
          frontendUrl,
          `/${channelData.workspaceId}/workspace-management?${workspaceParams.toString()}`,
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
    }, getPublicUrl(req));

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
