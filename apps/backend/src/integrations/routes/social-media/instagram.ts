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
import { META_MESSAGING_PLATFORMS } from '../../social-media/constants';
import { metaGraphClient } from '../../adapters/social-media/instagram/metaGraphClient';
import { instagramOAuthStateService } from '../../adapters/social-media/instagram/oauthStateService';
import type { InstagramCredentials } from '../../adapters/social-media/instagram/types';
import { authorizeSocialMediaManager, canAccessSocialMediaChannel } from './access';
import { oauthDeskStartSchema, validateOAuthDeskSetup } from './deskSetup';

const TAG = '[InstagramRoutes]';
const router = express.Router();

const IG_AUTH_BASE = 'https://www.instagram.com';

function callbackUri(req: Request): string {
  return config.META_IG_REDIRECT_URI || `${getBackendUrl(req)}/api/integrations/social-media/instagram/oauth/callback`;
}

function redirectToDesk(
  req: Request,
  res: Response,
  params: {
    workspaceId?: string;
    channelId?: string;
    platform?: 'web' | 'electron';
    error?: string;
  },
): void {
  const query = new URLSearchParams(
    params.error
      ? { socialMediaError: params.error, socialMediaProvider: 'instagram' }
      : { socialMediaOAuth: 'success', socialMediaProvider: 'instagram' },
  );
  const path = buildSupportPath(params.workspaceId, params.channelId, query);
  res.redirect(postOAuthRedirect(getFrontendUrl(req), path, params.platform ?? 'web'));
}

// POST /instagram/oauth/start
// Initiates Instagram Business Login with instagram_business_basic,instagram_business_manage_messages
router.post(
  '/instagram/oauth/start',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = oauthDeskStartSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn(`${TAG} Validation failed`, { issues: parsed.error.issues, body: req.body });
        res.status(400).json({ error: 'Valid channel name and project are required' });
        return;
      }

      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const input = parsed.data;

      if (!(await validateOAuthDeskSetup(input, workspaceId, res))) return;

      const { state, codeChallenge } = await instagramOAuthStateService.create({
        userId,
        workspaceId,
        channelName: input.name,
        projectId: input.projectId,
        boardId: input.boardId,
        assigneeUserGroupId: input.assigneeUserGroupId,
        visibility: input.visibility.toUpperCase() as 'PUBLIC' | 'PRIVATE',
        platform: input.platform,
      });

      const params = new URLSearchParams({
        client_id: config.META_IG_APP_ID || config.META_APP_ID,
        redirect_uri: callbackUri(req),
        scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
        response_type: 'code',
        state,
        enable_fb_login: '0',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      res.json({ authorizationUrl: `${IG_AUTH_BASE}/oauth/authorize?${params.toString()}` });
    } catch (error) {
      logger.error(`${TAG} Failed to start Instagram OAuth`, { error });
      res.status(500).json({ error: 'Failed to start Instagram authorization' });
    }
  },
);

// POST /:channelId/instagram/reconnect
// Re-initiates Instagram Login for an existing (disconnected) Instagram channel.
// Looks up the channel's existing settings so the user doesn't have to re-enter them.
router.post(
  '/:channelId/instagram/reconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const platform = (req.body?.platform ?? 'web') as 'web' | 'electron';

      if (!(await authorizeSocialMediaManager(channelId, userId, workspaceId, res))) return;

      const [channel, pref, existingSource] = await Promise.all([
        db.channel.findFirst({
          where: { id: channelId, workspaceId, type: ChannelType.SOCIAL_MEDIA },
          select: { id: true, name: true, projectId: true, visibility: true },
        }),
        db.emailChannelPreference.findUnique({
          where: { channelId },
          select: { boardId: true, assigneeUserGroupId: true },
        }),
        db.externalSource.findFirst({
          where: { channelId, workspaceId, sourceType: ExternalSourcePlatform.INSTAGRAM },
          select: { externalIdentifier: true },
        }),
      ]);

      if (!channel || !channel.projectId || !existingSource) {
        res.status(404).json({ error: 'Instagram desk configuration not found' });
        return;
      }

      const { state, codeChallenge } = await instagramOAuthStateService.create({
        mode: 'reconnect',
        userId,
        workspaceId,
        channelId,
        channelName: channel.name,
        projectId: channel.projectId,
        boardId: pref?.boardId ?? undefined,
        assigneeUserGroupId: pref?.assigneeUserGroupId ?? undefined,
        visibility: channel.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        platform,
        // Lock reconnect to the originally-connected IG account, same pattern as
        // Google's expectedEmail — prevents a different account silently overwriting credentials.
        expectedIgUserId: existingSource?.externalIdentifier ?? undefined,
      });

      const params = new URLSearchParams({
        client_id: config.META_IG_APP_ID || config.META_APP_ID,
        redirect_uri: callbackUri(req),
        scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
        response_type: 'code',
        state,
        enable_fb_login: '0',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      res.json({ authorizationUrl: `${IG_AUTH_BASE}/oauth/authorize?${params.toString()}` });
    } catch (error) {
      logger.error(`${TAG} Failed to start Instagram reconnect`, { error });
      res.status(500).json({ error: 'Failed to start Instagram reconnect' });
    }
  },
);

// POST /:channelId/instagram/add-account
// Adds another Instagram account to an existing channel (multi-account support).
// Re-uses the same OAuth flow; callback creates only ExternalSource (no new Channel row).
router.post(
  '/:channelId/instagram/add-account',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const platform = (req.body?.platform ?? 'web') as 'web' | 'electron';

      if (!(await authorizeSocialMediaManager(channelId, userId, workspaceId, res))) return;

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

      if (!channel || !channel.projectId) {
        res.status(404).json({ error: 'Instagram desk configuration not found' });
        return;
      }

      const { state, codeChallenge } = await instagramOAuthStateService.create({
        mode: 'add-account',
        userId,
        workspaceId,
        channelId,
        channelName: channel.name,
        projectId: channel.projectId,
        boardId: pref?.boardId ?? undefined,
        assigneeUserGroupId: pref?.assigneeUserGroupId ?? undefined,
        visibility: channel.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        platform,
      });

      const params = new URLSearchParams({
        client_id: config.META_IG_APP_ID || config.META_APP_ID,
        redirect_uri: callbackUri(req),
        scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
        response_type: 'code',
        state,
        enable_fb_login: '0',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      res.json({ authorizationUrl: `${IG_AUTH_BASE}/oauth/authorize?${params.toString()}` });
    } catch (error) {
      logger.error(`${TAG} Failed to start Instagram add-account OAuth`, { error });
      res.status(500).json({ error: 'Failed to start Instagram authorization' });
    }
  },
);

// GET /instagram/oauth/callback
// Instagram redirects here after user grants permissions
router.get(
  '/instagram/oauth/callback',
  async (req: Request, res: Response): Promise<void> => {
    const stateKey = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

    const state = await instagramOAuthStateService.consume(stateKey);
    if (!state) {
      // Redirect with error instead of a blank 400 page so the UI can show a proper message.
      redirectToDesk(req, res, { error: 'instagram_invalid_state' });
      return;
    }

    // CSRF guard: if this request carries a session user, verify it's the same person who
    // started the OAuth flow. Prevents an attacker from tricking a victim into completing
    // an OAuth flow that attaches their IG account to the attacker's workspace.
    if (req.user && req.user.id !== state.userId) {
      logger.warn(`${TAG} OAuth callback rejected — session user doesn't match state initiator`, {
        sessionUserId: req.user.id,
        stateUserId: state.userId,
      });
      redirectToDesk(req, res, {
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        platform: state.platform,
        error: 'instagram_auth_denied',
      });
      return;
    }

    if (!code && !errorParam) {
      redirectToDesk(req, res, {
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        platform: state.platform,
        error: 'instagram_connection_failed',
      });
      return;
    }

    if (errorParam) {
      logger.warn(`${TAG} User denied Instagram OAuth`, { error: errorParam });
      redirectToDesk(req, res, {
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        platform: state.platform,
        error: 'instagram_auth_denied',
      });
      return;
    }

    try {
      // Exchange code for short-lived IG User token (1 hour)
      const shortLived = await metaGraphClient.exchangeCodeForToken(
        code,
        callbackUri(req),
        state.codeVerifier,
      );

      // Exchange short-lived for long-lived IG User token (60 days)
      const longLived = await metaGraphClient.getLongLivedToken(shortLived.access_token);
      const expiresAt = Date.now() + longLived.expires_in * 1000;

      // Fetch IGSID + username.
      // igUserId = igsid = `id` from GET /me (app-scoped). This is what we store and what
      // webhook entry.id should match for the subscription created by subscribeToWebhook.
      const { igUserId, igsid, username: igUsername } = await metaGraphClient.getMe(longLived.access_token);
      logger.info(`${TAG} OAuth callback: connected Instagram account @${igUsername}`, { igUserId, igsid });

      const credentials: InstagramCredentials = {
        accessToken: longLived.access_token,
        igUserId,  // IGSID (= igsid) — source name, externalIdentifier, B2 filter, API calls
        igsid,
        username: igUsername,
        expiresAt,
      };
      const encryptedCredentials = encrypt(JSON.stringify(credentials));
      const sourceName = `instagram-${igUserId}`;
      const metaSource = {
        name: sourceName,
        displayName: igUsername,
        externalIdentifier: igUserId,
        encryptedCredentials,
      };

      // Revalidate that the user who initiated OAuth still belongs to the workspace.
      // The state was consumed from Redis (10-min TTL) — in that window the user
      // could have been removed. Without this check, stale state creates DB rows
      // (channel, channelParticipant, emailChannelPreference) owned by a ghost userId.
      const initiatingUser = await db.user.findFirst({
        where: { id: state.userId, workspaceId: state.workspaceId, leftAt: null },
        select: { id: true },
      });
      if (!initiatingUser) {
        logger.warn(`${TAG} OAuth callback rejected — initiating user no longer in workspace`, {
          userId: state.userId,
          workspaceId: state.workspaceId,
        });
        redirectToDesk(req, res, {
          workspaceId: state.workspaceId,
          platform: state.platform,
          error: 'instagram_user_removed',
        });
        return;
      }

      // ── Reconnect: validate account match BEFORE any side effects ───────────
      // Check mismatch here so subscribeToWebhook is never called for a wrong account.
      if (state.mode === 'reconnect' && state.channelId) {
        if (state.expectedIgUserId && state.expectedIgUserId !== igUserId) {
          logger.warn(`${TAG} Reconnect rejected: account mismatch. Expected=${state.expectedIgUserId}, got igUserId=${igUserId}`);
          const storedSource = await db.externalSource.findFirst({
            where: { channelId: state.channelId, workspaceId: state.workspaceId, sourceType: ExternalSourcePlatform.INSTAGRAM },
            select: { displayName: true },
          });
          const expectedHandle = storedSource?.displayName ? `@${storedSource.displayName}` : 'the original account';
          redirectToDesk(req, res, {
            workspaceId: state.workspaceId,
            channelId: state.channelId,
            platform: state.platform,
            error: `instagram_account_mismatch:${expectedHandle}`,
          });
          return;
        }
      }

      // Subscribe to webhooks so Meta delivers DMs to our endpoint.
      // subscribeToWebhook uses igsid (app-scoped) — the only ID accepted by POST /{id}/subscribed_apps.
      // Non-fatal — we still complete OAuth — but log at error so failures are visible.
      try {
        await metaGraphClient.subscribeToWebhook(longLived.access_token, igsid);
        logger.info(`${TAG} Webhook subscription verified`, { igsid, igUserId });
      } catch (webhookErr) {
        logger.error(
          `${TAG} Webhook subscription FAILED for igsid=${igsid} — DMs will not create tickets until re-connected`,
          { error: webhookErr },
        );
      }

      // ── Reconnect: update credentials on the existing source ──────────────
      if (state.mode === 'reconnect' && state.channelId) {
        if (state.sourceId) {
          // Per-source reconnect: update only the specific ExternalSource row.
          // updateMany would affect ALL Instagram sources on the channel and trigger a
          // P2002 unique constraint violation on `name` for multi-account channels.
          await db.externalSource.update({
            where: { id: state.sourceId },
            data: {
              credentials: encryptedCredentials,
              externalIdentifier: igUserId,
              name: sourceName,
              displayName: igUsername || undefined,
              isActive: true,
            },
          });
        } else {
          // Legacy channel-level reconnect (single-account channels only).
          await db.externalSource.updateMany({
            where: {
              channelId: state.channelId,
              workspaceId: state.workspaceId,
              sourceType: ExternalSourcePlatform.INSTAGRAM,
            },
            data: {
              credentials: encryptedCredentials,
              externalIdentifier: igUserId,
              name: sourceName,
              displayName: igUsername || undefined,
              isActive: true,
            },
          });
        }
        redirectToDesk(req, res, {
          workspaceId: state.workspaceId,
          channelId: state.channelId,
          platform: state.platform,
        });
        return;
      }

      // ── Add-account: connect a second IG account to the existing channel ──
      if (state.mode === 'add-account' && state.channelId) {
        const existingSource = await db.externalSource.findFirst({
          where: {
            workspaceId: state.workspaceId,
            sourceType: ExternalSourcePlatform.INSTAGRAM,
            externalIdentifier: igUserId,
          },
          select: { id: true },
        });
        if (existingSource) {
          redirectToDesk(req, res, {
            workspaceId: state.workspaceId,
            channelId: state.channelId,
            platform: state.platform,
            error: 'instagram_account_already_connected',
          });
          return;
        }
        await addMetaSourcesToChannelTx(
          state.channelId,
          state.workspaceId,
          state.userId,
          state.boardId,
          ExternalSourcePlatform.INSTAGRAM,
          [metaSource],
        );
        redirectToDesk(req, res, {
          workspaceId: state.workspaceId,
          channelId: state.channelId,
          platform: state.platform,
        });
        return;
      }

      // ── New connection: check for duplicates then create channel + source ──
      const existingSource = await db.externalSource.findFirst({
        where: {
          workspaceId: state.workspaceId,
          sourceType: ExternalSourcePlatform.INSTAGRAM,
          externalIdentifier: igUserId,
        },
        select: { id: true },
      });
      if (existingSource) {
        redirectToDesk(req, res, {
          workspaceId: state.workspaceId,
          channelId: state.channelId,
          platform: state.platform,
          error: 'instagram_account_already_connected',
        });
        return;
      }

      const result = await createMetaDeskTx(state, ExternalSourcePlatform.INSTAGRAM, [metaSource], new Date());

      redirectToDesk(req, res, {
        workspaceId: state.workspaceId,
        channelId: result.channelId,
        platform: state.platform,
      });
    } catch (error) {
      // P2002 on externalSource.name means another workspace already connected this IG account.
      // The name column is globally unique (`instagram-{igUserId}`), not workspace-scoped.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logger.warn(`${TAG} Instagram account already connected in another workspace`, {
          target: error.meta?.target,
        });
        redirectToDesk(req, res, {
          workspaceId: state.workspaceId,
          channelId: state.channelId,
          platform: state.platform,
          error: 'instagram_account_already_connected',
        });
        return;
      }
      logger.error(`${TAG} Instagram OAuth callback failed`, { error });
      redirectToDesk(req, res, {
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        platform: state.platform,
        error: 'instagram_connection_failed',
      });
    }
  },
);

// GET /instagram/data-deletion-status?code=...
// Public page Meta's App Review will load after POSTing to /instagram/data-deletion.
// Returns a minimal HTML confirmation so the reviewer sees a real response.
router.get(
  '/instagram/data-deletion-status',
  (_req: Request, res: Response): void => {
    const code = typeof _req.query.code === 'string' ? _req.query.code : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      `<!DOCTYPE html><html><head><title>Data Deletion Status</title></head><body>` +
      `<h1>Data Deletion Request</h1>` +
      `<p>Your data deletion request has been received and processed.</p>` +
      (code ? `<p>Confirmation code: <strong>${code.replace(/[^a-zA-Z0-9-]/g, '')}</strong></p>` : '') +
      `</body></html>`,
    );
  },
);

// POST /:channelId/instagram/:sourceId/disconnect
// Disconnects a single Instagram account (by sourceId) from the channel.
// Mirrors the Google Play per-app disconnect pattern.
router.post(
  '/:channelId/instagram/:sourceId/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId, sourceId } = req.params;
      const workspaceId = req.user!.workspaceId!;

      if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;

      const source = await db.externalSource.findFirst({
        where: { id: sourceId, channelId, workspaceId, sourceType: ExternalSourcePlatform.INSTAGRAM },
        select: { credentials: true },
      });
      if (!source) {
        res.status(404).json({ error: 'Instagram source not found' });
        return;
      }

      await db.externalSource.update({
        where: { id: sourceId },
        data: { isActive: false, credentials: '' },
      });

      if (source.credentials) {
        try {
          const creds = JSON.parse(decrypt(source.credentials)) as InstagramCredentials;
          const igsidForUnsub = creds.igsid ?? creds.igUserId;
          await metaGraphClient.unsubscribeFromWebhook(creds.accessToken, igsidForUnsub);
          logger.info(`${TAG} Removed Meta webhook subscription for igsid=${igsidForUnsub}`);
        } catch (unsubErr) {
          logger.warn(`${TAG} Failed to remove Meta webhook subscription (non-fatal)`, { error: unsubErr });
        }
      }

      res.json({ message: 'Instagram account disconnected' });
    } catch (error) {
      logger.error(`${TAG} Failed to disconnect Instagram account`, {
        channelId: req.params.channelId,
        sourceId: req.params.sourceId,
        error,
      });
      res.status(500).json({ error: 'Failed to disconnect Instagram account' });
    }
  },
);

// POST /:channelId/instagram/:sourceId/reconnect
// Re-enables a previously disconnected Instagram account.
router.post(
  '/:channelId/instagram/:sourceId/reconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId, sourceId } = req.params;
      const workspaceId = req.user!.workspaceId!;
      const platform = (req.body?.platform ?? 'web') as 'web' | 'electron';

      if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;

      const [channel, pref, source] = await Promise.all([
        db.channel.findFirst({
          where: { id: channelId, workspaceId, type: ChannelType.SOCIAL_MEDIA },
          select: { id: true, name: true, projectId: true, visibility: true },
        }),
        db.emailChannelPreference.findUnique({
          where: { channelId },
          select: { boardId: true, assigneeUserGroupId: true },
        }),
        db.externalSource.findFirst({
          where: { id: sourceId, channelId, workspaceId, sourceType: ExternalSourcePlatform.INSTAGRAM },
          select: { externalIdentifier: true, displayName: true },
        }),
      ]);

      if (!channel || !channel.projectId || !source?.externalIdentifier) {
        res.status(404).json({ error: 'Instagram desk configuration not found' });
        return;
      }

      const { state, codeChallenge } = await instagramOAuthStateService.create({
        mode: 'reconnect',
        userId: req.user!.id,
        workspaceId,
        channelId,
        sourceId,  // bind the exact source being reconnected so callback updates only it
        channelName: channel.name,
        projectId: channel.projectId,
        boardId: pref?.boardId ?? undefined,
        assigneeUserGroupId: pref?.assigneeUserGroupId ?? undefined,
        visibility: channel.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        platform,
        expectedIgUserId: source.externalIdentifier,
      });

      const params = new URLSearchParams({
        client_id: config.META_IG_APP_ID || config.META_APP_ID,
        redirect_uri: callbackUri(req),
        scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
        response_type: 'code',
        state,
        enable_fb_login: '0',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      res.json({ authorizationUrl: `${IG_AUTH_BASE}/oauth/authorize?${params.toString()}` });
    } catch (error) {
      logger.error(`${TAG} Failed to start Instagram per-source reconnect`, { error });
      res.status(500).json({ error: 'Failed to start Instagram reconnect' });
    }
  },
);

// POST /:channelId/instagram/disconnect
router.post(
  '/:channelId/instagram/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (!(await authorizeSocialMediaManager(req.params.channelId, req.user!.id, workspaceId, res))) {
        return;
      }

      // Read credentials BEFORE clearing them so we can tell Meta to stop delivering events.
      const existingForDisconnect = await db.externalSource.findFirst({
        where: { channelId: req.params.channelId, workspaceId, sourceType: ExternalSourcePlatform.INSTAGRAM },
        select: { credentials: true },
      });

      const result = await db.externalSource.updateMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: ExternalSourcePlatform.INSTAGRAM,
        },
        data: { isActive: false, credentials: '' },
      });
      if (result.count === 0) {
        res.status(404).json({ error: 'Instagram source not found' });
        return;
      }

      // Best-effort: remove the app's Meta-side webhook subscription so Meta stops
      // delivering events for this account. Non-fatal — local disconnect already complete.
      if (existingForDisconnect?.credentials) {
        try {
          const creds = JSON.parse(decrypt(existingForDisconnect.credentials)) as InstagramCredentials;
          const igsidForUnsub = creds.igsid ?? creds.igUserId;
          await metaGraphClient.unsubscribeFromWebhook(creds.accessToken, igsidForUnsub);
          logger.info(`${TAG} Removed Meta webhook subscription for igsid=${igsidForUnsub}`);
        } catch (unsubErr) {
          logger.warn(`${TAG} Failed to remove Meta webhook subscription (non-fatal)`, { error: unsubErr });
        }
      }

      res.json({ message: 'Instagram account disconnected' });
    } catch (error) {
      logger.error(`${TAG} Failed to disconnect Instagram`, {
        channelId: req.params.channelId,
        error,
      });
      res.status(500).json({ error: 'Failed to disconnect Instagram account' });
    }
  },
);

// POST /instagram/data-deletion
// Required by Meta App Review — called when a user requests data deletion.
// Meta signs the body with HMAC-SHA256 using the app secret.
router.post(
  '/instagram/data-deletion',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const signedRequest = typeof req.body?.signed_request === 'string'
        ? req.body.signed_request
        : '';
      if (!signedRequest) {
        res.status(400).json({ error: 'signed_request is required' });
        return;
      }

      // Verify the HMAC-SHA256 signature before trusting the payload.
      // Fail closed: reject immediately if no app secret is configured — an empty
      // secret would let any attacker compute a passing HMAC.
      const appSecret = config.META_IG_APP_SECRET || config.META_APP_SECRET;
      if (!appSecret) {
        res.status(500).json({ error: 'Server misconfiguration: app secret not set' });
        return;
      }
      const payload = metaGraphClient.verifySignedRequest(signedRequest, appSecret);
      if (!payload) {
        res.status(401).json({ error: 'Invalid signed_request signature' });
        return;
      }

      // For Instagram Business Login, user_id in the signed_request is the real IG user ID.
      // Require it — without it we cannot identify whose data to delete.
      const igUserId = payload.user_id;
      if (!igUserId) {
        logger.warn(`${TAG} Data deletion request missing user_id — rejecting`, { payload });
        res.status(400).json({ error: 'signed_request payload missing user_id' });
        return;
      }

      logger.info(`${TAG} Data deletion request received`, { igUserId });

      if (igUserId) {
        // externalIdentifier stores igUserId directly (set at channel creation) — no decryption needed.
        const result = await db.externalSource.updateMany({
          where: {
            sourceType: ExternalSourcePlatform.INSTAGRAM,
            externalIdentifier: igUserId,
            isActive: true,
          },
          data: { isActive: false, credentials: '' },
        });
        logger.info(`${TAG} Deactivated ${result.count} source(s) for igUserId=${igUserId}`);
      }

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

// GET /:channelId/customer-history?conversationId=xxx
// Returns previous tickets from the same Instagram/Facebook customer (identified by IGSID/PSID) in this channel.
router.get(
  '/:channelId/customer-history',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      const { channelId } = req.params;
      const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : '';

      if (!conversationId) {
        res.status(400).json({ error: 'conversationId is required' });
        return;
      }

      if (!(await canAccessSocialMediaChannel(channelId, req.user!.id, workspaceId))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // A desk can hold several accounts; the conversation's own message picks the right one.
      const sources = await db.externalSource.findMany({
        where: { channelId, workspaceId, sourceType: { in: [...META_MESSAGING_PLATFORMS] }, isActive: true },
        select: { id: true },
      });
      if (sources.length === 0) {
        res.json({ igsid: null, tickets: [] });
        return;
      }

      const emails = await db.email.findMany({ where: { conversationId }, select: { id: true } });
      const emailIds = emails.map(e => e.id);

      const extMsg = emailIds.length > 0
        ? await db.externalMessage.findFirst({
            where: {
              externalSourceId: { in: sources.map(s => s.id) },
              entityType: 'EMAIL',
              direction: 'INCOMING',
              entityId: { in: emailIds },
            },
            select: { externalThreadId: true, externalSourceId: true },
          })
        : null;

      if (!extMsg) { res.json({ igsid: null, tickets: [] }); return; }

      // Only DM threads are keyed by the customer ("{igsid}:{windowStart}"). Comment and mention
      // threads are keyed by the comment/post, so their prefix would match every such thread.
      if (/^(comment|post|media|mention):/.test(extMsg.externalThreadId)) {
        res.json({ igsid: null, tickets: [] });
        return;
      }
      const igsid = extMsg.externalThreadId.split(':')[0];
      if (!igsid) { res.json({ igsid: null, tickets: [] }); return; }

      const relatedExtMsgs = await db.externalMessage.findMany({
        where: {
          externalSourceId: extMsg.externalSourceId,
          externalThreadId: { startsWith: `${igsid}:` },
          direction: 'INCOMING',
          entityType: 'EMAIL',
        },
        distinct: ['externalThreadId'],
        select: { entityId: true },
      });

      const relatedEmailIds = relatedExtMsgs
        .map(m => m.entityId)
        .filter((id): id is string => !!id && !emailIds.includes(id));

      const relatedConversationIds = [
        ...new Set(
          (relatedEmailIds.length > 0
            ? await db.email.findMany({ where: { id: { in: relatedEmailIds } }, select: { conversationId: true } })
            : []
          ).map(e => e.conversationId).filter((id): id is string => !!id && id !== conversationId),
        ),
      ];

      if (relatedConversationIds.length === 0) { res.json({ igsid, tickets: [] }); return; }

      const tickets = await db.ticket.findMany({
        where: { conversationId: { in: relatedConversationIds }, channelId },
        select: { id: true, xyneId: true, title: true, stageName: true, createdAt: true, conversationId: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      res.json({ igsid, tickets });
    } catch (error) {
      logger.error(`${TAG} Failed to fetch customer history`, { error });
      res.status(500).json({ error: 'Failed to fetch customer history' });
    }
  },
);

export default router;
