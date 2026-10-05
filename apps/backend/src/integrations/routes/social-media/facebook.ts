import express, { type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { ChannelType } from '@xyne/shared';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { createMetaDeskTx, addMetaSourcesToChannelTx } from '@/bypassAcl/transactions/metaDesk';
import { decrypt, encrypt } from '@/services/encryptionService';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { buildSupportPath, postOAuthRedirect } from '../urlHelpers';
import { ExternalSourcePlatform } from '../../core/types';
import { metaGraphClient } from '../../adapters/social-media/instagram/metaGraphClient';
import {
  facebookGraphClient,
  FB_DIALOG_URL,
  type FacebookPage,
} from '../../adapters/social-media/facebook/facebookGraphClient';
import {
  facebookOAuthStateService,
  type FacebookOAuthState,
} from '../../adapters/social-media/facebook/oauthStateService';
import type { FacebookCredentials } from '../../adapters/social-media/facebook/types';
import { authorizeSocialMediaManager } from './access';
import { oauthDeskStartSchema, validateOAuthDeskSetup } from './deskSetup';

const TAG = '[FacebookRoutes]';
const router = express.Router();

const FB_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
].join(',');

function callbackUri(req: Request): string {
  return `${getBackendUrl(req)}/api/integrations/social-media/facebook/oauth/callback`;
}

function authorizationUrl(req: Request, state: string): string {
  const params = new URLSearchParams({
    client_id: config.META_APP_ID,
    redirect_uri: callbackUri(req),
    scope: FB_SCOPES,
    response_type: 'code',
    state,
  });
  return `${FB_DIALOG_URL}?${params.toString()}`;
}

function redirectToDesk(
  req: Request,
  res: Response,
  state: Pick<FacebookOAuthState, 'workspaceId' | 'channelId' | 'platform'> | undefined,
  outcome: { channelId?: string; error?: string } = {},
): void {
  const query = new URLSearchParams(
    outcome.error
      ? { socialMediaError: outcome.error, socialMediaProvider: 'facebook' }
      : { socialMediaOAuth: 'success', socialMediaProvider: 'facebook' },
  );
  const path = buildSupportPath(state?.workspaceId, outcome.channelId ?? state?.channelId, query);
  res.redirect(postOAuthRedirect(getFrontendUrl(req), path, state?.platform ?? 'web'));
}

/** Channel settings for an existing Facebook desk, reused as OAuth state for add-page / reconnect. */
async function existingDeskState(channelId: string, workspaceId: string) {
  const [channel, pref] = await Promise.all([
    db.channel.findFirst({
      where: { id: channelId, workspaceId, type: ChannelType.SOCIAL_MEDIA },
      select: { id: true, name: true, projectId: true, visibility: true },
    }),
    db.emailChannelPreference.findUnique({
      where: { channelId },
      select: { boardId: true, assigneeUserGroupId: true },
    }),
  ]);
  if (!channel?.projectId) return null;
  return {
    channelId,
    channelName: channel.name,
    projectId: channel.projectId,
    boardId: pref?.boardId ?? undefined,
    assigneeUserGroupId: pref?.assigneeUserGroupId ?? undefined,
    visibility: channel.visibility === 'PRIVATE' ? ('PRIVATE' as const) : ('PUBLIC' as const),
  };
}

function toMetaSource(page: FacebookPage, fbUserId: string) {
  const credentials: FacebookCredentials = {
    pageAccessToken: page.access_token,
    pageId: page.id,
    pageName: page.name,
    fbUserId,
  };
  return {
    name: `facebook-${page.id}`,
    displayName: page.name,
    externalIdentifier: page.id,
    encryptedCredentials: encrypt(JSON.stringify(credentials)),
  };
}

// Returns the Pages Meta accepted. A Page that cannot be subscribed would show as connected and
// never create a ticket, so the caller does not connect it.
async function subscribePages(pages: FacebookPage[]): Promise<FacebookPage[]> {
  const subscribed: FacebookPage[] = [];
  for (const page of pages) {
    try {
      await facebookGraphClient.subscribePage(page.access_token, page.id);
      subscribed.push(page);
    } catch {
      logger.error(`${TAG} Webhook subscription FAILED for page ${page.id} — not connecting it`);
    }
  }
  return subscribed;
}

// POST /facebook/oauth/start
router.post(
  '/facebook/oauth/start',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = oauthDeskStartSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid channel name and project are required' });
        return;
      }

      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const input = parsed.data;

      if (!(await validateOAuthDeskSetup(input, workspaceId, res))) return;

      const { state } = await facebookOAuthStateService.create({
        userId,
        workspaceId,
        channelName: input.name,
        projectId: input.projectId,
        boardId: input.boardId,
        assigneeUserGroupId: input.assigneeUserGroupId,
        visibility: input.visibility.toUpperCase() as 'PUBLIC' | 'PRIVATE',
        platform: input.platform,
      });

      res.json({ authorizationUrl: authorizationUrl(req, state) });
    } catch (error) {
      logger.error(`${TAG} Failed to start Facebook OAuth`, { error });
      res.status(500).json({ error: 'Failed to start Facebook authorization' });
    }
  },
);

// POST /:channelId/facebook/add-page
// Connects further Pages to an existing Facebook desk; the callback creates only ExternalSource rows.
router.post(
  '/:channelId/facebook/add-page',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const platform = (req.body?.platform ?? 'web') as 'web' | 'electron';

      if (!(await authorizeSocialMediaManager(channelId, userId, workspaceId, res))) return;

      const desk = await existingDeskState(channelId, workspaceId);
      if (!desk) {
        res.status(404).json({ error: 'Facebook desk configuration not found' });
        return;
      }

      const { state } = await facebookOAuthStateService.create({
        mode: 'add-page',
        userId,
        workspaceId,
        platform,
        ...desk,
      });
      res.json({ authorizationUrl: authorizationUrl(req, state) });
    } catch (error) {
      logger.error(`${TAG} Failed to start Facebook add-page OAuth`, { error });
      res.status(500).json({ error: 'Failed to start Facebook authorization' });
    }
  },
);

// POST /:channelId/facebook/:sourceId/reconnect
router.post(
  '/:channelId/facebook/:sourceId/reconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId, sourceId } = req.params;
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const platform = (req.body?.platform ?? 'web') as 'web' | 'electron';

      if (!(await authorizeSocialMediaManager(channelId, userId, workspaceId, res))) return;

      const [desk, source] = await Promise.all([
        existingDeskState(channelId, workspaceId),
        db.externalSource.findFirst({
          where: { id: sourceId, channelId, workspaceId, sourceType: ExternalSourcePlatform.FACEBOOK },
          select: { externalIdentifier: true },
        }),
      ]);
      if (!desk || !source?.externalIdentifier) {
        res.status(404).json({ error: 'Facebook desk configuration not found' });
        return;
      }

      const { state } = await facebookOAuthStateService.create({
        mode: 'reconnect',
        userId,
        workspaceId,
        platform,
        sourceId,
        // Lock reconnect to the originally-connected Page so another Page cannot overwrite it.
        expectedPageId: source.externalIdentifier,
        ...desk,
      });
      res.json({ authorizationUrl: authorizationUrl(req, state) });
    } catch (error) {
      logger.error(`${TAG} Failed to start Facebook reconnect`, { error });
      res.status(500).json({ error: 'Failed to start Facebook reconnect' });
    }
  },
);

// GET /facebook/oauth/callback
router.get(
  '/facebook/oauth/callback',
  async (req: Request, res: Response): Promise<void> => {
    const stateKey = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

    const state = await facebookOAuthStateService.consume(stateKey);
    if (!state) {
      redirectToDesk(req, res, undefined, { error: 'facebook_invalid_state' });
      return;
    }

    // CSRF guard: a session user completing the flow must be the one who started it.
    if (req.user && req.user.id !== state.userId) {
      logger.warn(`${TAG} OAuth callback rejected — session user doesn't match state initiator`);
      redirectToDesk(req, res, state, { error: 'facebook_auth_denied' });
      return;
    }

    if (errorParam || !code) {
      if (errorParam) logger.warn(`${TAG} User denied Facebook OAuth`, { error: errorParam });
      redirectToDesk(req, res, state, {
        error: errorParam ? 'facebook_auth_denied' : 'facebook_connection_failed',
      });
      return;
    }

    try {
      const shortLived = await facebookGraphClient.exchangeCodeForToken(code, callbackUri(req));
      const userToken = await facebookGraphClient.getLongLivedUserToken(shortLived);
      const [fbUserId, pages] = await Promise.all([
        facebookGraphClient.getUserId(userToken),
        facebookGraphClient.getPages(userToken),
      ]);

      if (pages.length === 0) {
        redirectToDesk(req, res, state, { error: 'facebook_no_pages' });
        return;
      }

      // The state lives 10 minutes in Redis; the initiating user may have left the workspace since.
      const initiatingUser = await db.user.findFirst({
        where: { id: state.userId, workspaceId: state.workspaceId, leftAt: null },
        select: { id: true },
      });
      if (!initiatingUser) {
        redirectToDesk(req, res, { ...state, channelId: undefined }, { error: 'facebook_user_removed' });
        return;
      }

      if (state.mode === 'reconnect') {
        const page = pages.find(p => p.id === state.expectedPageId);
        if (!page) {
          const stored = await db.externalSource.findFirst({
            where: { id: state.sourceId, workspaceId: state.workspaceId },
            select: { displayName: true },
          });
          redirectToDesk(req, res, state, {
            error: `facebook_page_mismatch:${stored?.displayName ?? 'the original Page'}`,
          });
          return;
        }
        if ((await subscribePages([page])).length === 0) {
          redirectToDesk(req, res, state, { error: 'facebook_subscription_failed' });
          return;
        }
        const metaSource = toMetaSource(page, fbUserId);
        await db.externalSource.updateMany({
          where: {
            id: state.sourceId,
            channelId: state.channelId,
            workspaceId: state.workspaceId,
            sourceType: ExternalSourcePlatform.FACEBOOK,
          },
          data: {
            credentials: metaSource.encryptedCredentials,
            displayName: metaSource.displayName,
            isActive: true,
          },
        });
        redirectToDesk(req, res, state);
        return;
      }

      // ExternalSource.name (`facebook-{pageId}`) is globally unique, so a Page connected
      // anywhere — this desk, another desk, another workspace — is skipped.
      const alreadyConnected = await db.externalSource.findMany({
        where: {
          sourceType: ExternalSourcePlatform.FACEBOOK,
          externalIdentifier: { in: pages.map(p => p.id) },
        },
        select: { externalIdentifier: true },
      });
      const connectedIds = new Set(alreadyConnected.map(s => s.externalIdentifier));
      const newPages = pages.filter(p => !connectedIds.has(p.id));
      if (newPages.length === 0) {
        redirectToDesk(req, res, state, { error: 'facebook_page_already_connected' });
        return;
      }

      const subscribedPages = await subscribePages(newPages);
      if (subscribedPages.length === 0) {
        redirectToDesk(req, res, state, { error: 'facebook_subscription_failed' });
        return;
      }
      const metaSources = subscribedPages.map(page => toMetaSource(page, fbUserId));

      if (state.mode === 'add-page' && state.channelId) {
        await addMetaSourcesToChannelTx(
          state.channelId,
          state.workspaceId,
          state.userId,
          state.boardId,
          ExternalSourcePlatform.FACEBOOK,
          metaSources,
        );
        redirectToDesk(req, res, state);
        return;
      }

      const result = await createMetaDeskTx(
        state,
        ExternalSourcePlatform.FACEBOOK,
        metaSources,
        new Date(),
      );
      redirectToDesk(req, res, state, { channelId: result.channelId });
    } catch (error) {
      // Lost a race with another connect for the same Page. A P2002 on any other model
      // (e.g. the channel name was taken meanwhile) is a plain failure.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        error.meta?.modelName === 'ExternalSource'
      ) {
        redirectToDesk(req, res, state, { error: 'facebook_page_already_connected' });
        return;
      }
      logger.error(`${TAG} Facebook OAuth callback failed`, { error });
      redirectToDesk(req, res, state, { error: 'facebook_connection_failed' });
    }
  },
);

// POST /:channelId/facebook/:sourceId/disconnect
router.post(
  '/:channelId/facebook/:sourceId/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId, sourceId } = req.params;
      const workspaceId = req.user!.workspaceId!;

      if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;

      const source = await db.externalSource.findFirst({
        where: { id: sourceId, channelId, workspaceId, sourceType: ExternalSourcePlatform.FACEBOOK },
        select: { credentials: true },
      });
      if (!source) {
        res.status(404).json({ error: 'Facebook Page not found' });
        return;
      }

      await db.externalSource.update({
        where: { id: sourceId },
        data: { isActive: false, credentials: '' },
      });

      // Best-effort: stop Meta delivering events for this Page. The local disconnect is already done.
      if (source.credentials) {
        try {
          const creds = JSON.parse(decrypt(source.credentials)) as FacebookCredentials;
          await facebookGraphClient.unsubscribePage(creds.pageAccessToken, creds.pageId);
        } catch (unsubErr) {
          logger.warn(`${TAG} Failed to remove Page webhook subscription (non-fatal)`, { error: unsubErr });
        }
      }

      res.json({ message: 'Facebook Page disconnected' });
    } catch (error) {
      logger.error(`${TAG} Failed to disconnect Facebook Page`, {
        channelId: req.params.channelId,
        sourceId: req.params.sourceId,
        error,
      });
      res.status(500).json({ error: 'Failed to disconnect Facebook Page' });
    }
  },
);

// POST /facebook/data-deletion
// Meta's data-deletion callback for Facebook Login: signed_request carries the app-scoped user id.
router.post(
  '/facebook/data-deletion',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const signedRequest = typeof req.body?.signed_request === 'string' ? req.body.signed_request : '';
      if (!signedRequest) {
        res.status(400).json({ error: 'signed_request is required' });
        return;
      }
      if (!config.META_APP_SECRET) {
        res.status(500).json({ error: 'Server misconfiguration: app secret not set' });
        return;
      }
      const payload = metaGraphClient.verifySignedRequest(signedRequest, config.META_APP_SECRET);
      if (!payload) {
        res.status(401).json({ error: 'Invalid signed_request signature' });
        return;
      }
      if (!payload.user_id) {
        res.status(400).json({ error: 'signed_request payload missing user_id' });
        return;
      }

      // fbUserId lives inside the encrypted credentials, so match by decrypting every source
      // that still holds a token, including ones already deactivated.
      const sources = await db.externalSource.findMany({
        where: { sourceType: ExternalSourcePlatform.FACEBOOK, NOT: { credentials: '' } },
        select: { id: true, credentials: true },
      });
      const matchingIds = sources
        .filter(source => {
          try {
            return (JSON.parse(decrypt(source.credentials)) as FacebookCredentials).fbUserId === payload.user_id;
          } catch {
            return false;
          }
        })
        .map(source => source.id);
      if (matchingIds.length > 0) {
        await db.externalSource.updateMany({
          where: { id: { in: matchingIds } },
          data: { isActive: false, credentials: '' },
        });
      }
      logger.info(`${TAG} Data deletion: deactivated ${matchingIds.length} source(s)`);

      const confirmationCode = `xyne-del-${Date.now()}`;
      res.json({
        url: `${getBackendUrl(req)}/api/integrations/social-media/instagram/data-deletion-status?code=${confirmationCode}`,
        confirmation_code: confirmationCode,
      });
    } catch (error) {
      logger.error(`${TAG} Data deletion callback failed`, { error });
      res.status(500).json({ error: 'Data deletion request failed' });
    }
  },
);

export default router;
