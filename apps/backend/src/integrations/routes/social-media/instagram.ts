import express, { type Request, type Response } from 'express';
import {
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  DeskType,
  EmailMergeMode,
} from '@xyne/shared';
import { z } from 'zod';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { decrypt, encrypt } from '@/services/encryptionService';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { buildSupportPath, postOAuthRedirect } from '../urlHelpers';
import { ExternalSourcePlatform } from '../../core/types';
import { metaGraphClient } from '../../adapters/social-media/instagram/metaGraphClient';
import { instagramOAuthStateService } from '../../adapters/social-media/instagram/oauthStateService';
import type { InstagramCredentials } from '../../adapters/social-media/instagram/types';
import { authorizeSocialMediaManager, canAccessSocialMediaChannel } from './access';

const TAG = '[InstagramRoutes]';
const router = express.Router();

const IG_AUTH_BASE = 'https://www.instagram.com';

const startSchema = z.object({
  name: z.string().trim().min(1).max(120),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  assigneeUserGroupId: z.preprocess(v => (typeof v === 'string' ? v.trim() || undefined : undefined), z.string().min(1).optional()),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'public', 'private']).default('PUBLIC'),
  platform: z.enum(['web', 'electron']).default('web'),
});

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
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn(`${TAG} Validation failed`, { issues: parsed.error.issues, body: req.body });
        res.status(400).json({ error: 'Valid channel name and project are required' });
        return;
      }

      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const input = parsed.data;

      const [project, board, group, duplicateChannel] = await Promise.all([
        db.project.findFirst({
          where: { id: input.projectId, workspaceId },
          select: { id: true },
        }),
        db.board.findFirst({
          where: { id: input.boardId, projectId: input.projectId, workspaceId },
          select: { id: true },
        }),
        input.assigneeUserGroupId
          ? db.userGroup.findFirst({
              where: { id: input.assigneeUserGroupId, workspaceId, isActive: true },
              select: { id: true },
            })
          : null,
        db.channel.findFirst({
          where: { workspaceId, name: input.name },
          select: { id: true },
        }),
      ]);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      if (!board) {
        res.status(404).json({ error: 'Board not found' });
        return;
      }
      if (input.assigneeUserGroupId && !group) {
        res.status(404).json({ error: 'Assignee group not found' });
        return;
      }
      if (duplicateChannel) {
        res.status(409).json({ error: 'A channel with this display name already exists' });
        return;
      }

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
        scope: 'instagram_business_basic,instagram_business_manage_messages',
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

      if (!channel || !channel.projectId || !pref?.boardId || !existingSource) {
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
        boardId: pref.boardId,
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
        scope: 'instagram_business_basic,instagram_business_manage_messages',
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

      // Fetch the real IG user ID + IGSID + username so we know exactly which account connected.
      const { igUserId, igsid, username: igUsername } = await metaGraphClient.getMe(longLived.access_token);
      logger.debug(`${TAG} OAuth callback: connected Instagram account @${igUsername} (igUserId=${igUserId}, igsid=${igsid})`);

      const credentials: InstagramCredentials = {
        accessToken: longLived.access_token,
        igUserId,  // real user ID — matches webhook entry.id; used for source name & B2 filter
        igsid,     // app-scoped IGSID — used for all Meta Graph API calls (sendDM, subscribed_apps)
        username: igUsername,
        expiresAt,
      };
      const encryptedCredentials = encrypt(JSON.stringify(credentials));
      const sourceName = `instagram-${igUserId}`;

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
        res.status(400).json({ error: 'User no longer in workspace' });
        return;
      }

      // ── Reconnect: validate account match BEFORE any side effects ───────────
      // Check mismatch here so subscribeToWebhook is never called for a wrong account.
      if (state.mode === 'reconnect' && state.channelId) {
        if (state.expectedIgUserId && state.expectedIgUserId !== igUserId) {
          logger.warn(`${TAG} Reconnect rejected: account mismatch. Expected igUserId=${state.expectedIgUserId}, got ${igUserId}`);
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

      // Subscribe to webhooks. Without this, DMs will not create tickets.
      // Non-fatal — we still complete OAuth — but log at error so failures are visible.
      // Must use igsid (app-scoped) — the real igUserId is rejected by subscribed_apps endpoint.
      try {
        await metaGraphClient.subscribeToWebhook(longLived.access_token, igsid);
        const subscribedApps = await metaGraphClient.getSubscribedApps(longLived.access_token, igsid);
        logger.info(`${TAG} Webhook subscription verified`, { igsid, igUserId, subscribedApps });
      } catch (webhookErr) {
        logger.error(
          `${TAG} Webhook subscription FAILED for igsid=${igsid} — DMs will not create tickets until re-connected`,
          { error: webhookErr },
        );
      }

      // ── Reconnect: update credentials on the existing source ──────────────
      if (state.mode === 'reconnect' && state.channelId) {
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
            displayName: igUsername || undefined, // update to real @handle on reconnect
            isActive: true,
          },
        });
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

      const now = new Date();
      const result = await db.$transaction(async (tx) => {
        const channel = await tx.channel.create({
          data: {
            name: state.channelName,
            type: ChannelType.SOCIAL_MEDIA,
            scopeType: ChannelScopeType.DEFAULT,
            visibility: state.visibility === 'PUBLIC' ? ChannelVisibility.PUBLIC : ChannelVisibility.PRIVATE,
            createdBy: state.userId,
            projectId: state.projectId,
            workspaceId: state.workspaceId,
          },
        });
        await tx.channelParticipant.create({
          data: {
            workspaceId: state.workspaceId,
            channelId: channel.id,
            userId: state.userId,
            role: ChannelRole.ADMIN,
          },
        });
        await tx.channelUserStatus.create({
          data: {
            workspaceId: state.workspaceId,
            channelId: channel.id,
            userId: state.userId,
            updatedAt: now,
          },
        });
        await tx.channelStats.create({
          data: {
            workspaceId: state.workspaceId,
            channelId: channel.id,
            participantCount: 1,
            lastActivityAt: now,
          },
        });
        await tx.emailChannelPreference.create({
          data: {
            channelId: channel.id,
            workspaceId: state.workspaceId,
            ownerUserId: state.userId,
            assigneeUserGroupId: state.assigneeUserGroupId,
            boardId: state.boardId,
            deskType: DeskType.SOCIAL_MEDIA,
            emailMergeMode: EmailMergeMode.DISABLED,
          },
        });
        const source = await tx.externalSource.create({
          data: {
            name: sourceName,
            sourceType: ExternalSourcePlatform.INSTAGRAM,
            displayName: igUsername || state.channelName,
            channelId: channel.id,
            externalIdentifier: igUserId,
            workspaceId: state.workspaceId,
            boardId: state.boardId,
            ownerUserId: state.userId,
            credentials: encryptedCredentials,
            isActive: true,
          },
          select: { id: true },
        });
        return { channelId: channel.id, sourceId: source.id };
      });

      redirectToDesk(req, res, {
        workspaceId: state.workspaceId,
        channelId: result.channelId,
        platform: state.platform,
      });
    } catch (error) {
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

      // For Instagram Login apps, user_id in the signed_request is the IG user ID.
      const igUserId = payload.user_id;
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
// Returns previous tickets from the same Instagram customer (identified by IGSID) in this channel.
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

      const source = await db.externalSource.findFirst({
        where: { channelId, workspaceId, sourceType: ExternalSourcePlatform.INSTAGRAM, isActive: true },
        select: { id: true },
      });
      if (!source) {
        res.json({ igsid: null, tickets: [] });
        return;
      }

      const emails = await db.email.findMany({ where: { conversationId }, select: { id: true } });
      const emailIds = emails.map(e => e.id);

      const extMsg = emailIds.length > 0
        ? await db.externalMessage.findFirst({
            where: {
              externalSourceId: source.id,
              entityType: 'EMAIL',
              direction: 'INCOMING',
              entityId: { in: emailIds },
            },
            select: { externalThreadId: true },
          })
        : null;

      if (!extMsg) { res.json({ igsid: null, tickets: [] }); return; }

      const igsid = extMsg.externalThreadId.split(':')[0];
      if (!igsid) { res.json({ igsid: null, tickets: [] }); return; }

      const relatedExtMsgs = await db.externalMessage.findMany({
        where: {
          externalSourceId: source.id,
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
