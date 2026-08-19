/**
 * Desk integration management — disconnect & reconnect for the email channel
 * connected to a desk (channel). Both endpoints are gated to the desk owner:
 * either the channel creator (`Channel.createdBy`) or the configured email
 * preference owner (`EmailChannelPreference.ownerUserId`).
 *
 * Disconnect:
 *   - soft: ExternalSource.isActive = false, credentials cleared
 *   - best-effort revoke at provider (Google has a public revoke endpoint;
 *     Microsoft delegated tokens have no provider-side revoke API — the user
 *     must revoke from account.microsoft.com if they want to invalidate the
 *     refresh token outside our DB)
 *
 * Reconnect:
 *   - just kicks off the same OAuth flow used for /connect, but with state
 *     carrying { mode: 'reconnect', channelId, expectedEmail }. The shared
 *     OAuth callback handlers detect that flag and update the existing
 *     ExternalSource row instead of creating a new channel/source.
 *   - strict mailbox match enforced in the callback: if the user signs in
 *     with a different email than the desk is bound to, the callback rejects.
 */

import express, { Request, Response } from 'express';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { microsoftDeskService } from '@/services/microsoftDeskService';
import { ExternalSourcePlatform } from '../core/types';
import { stopGmailWatchBeforeDeactivation } from '@/services/gmailWatchStopService';
import { extractEmailAddress } from '@/utils/email';
// Reuse the OAuth primitives from the route files that own them — keeps
// connect and reconnect on the exact same scopes, OAuth client config, and
// state store.
import {
  GMAIL_SCOPES,
  createOAuth2Client as createGoogleOAuth2Client,
  getGoogleIntegrationRedirectUri,
  setOAuthState as setGoogleOAuthState,
} from './google-auth';
import { getBackendUrl } from '@/utils/publicUrls';
import { MICROSOFT_OAUTH_SCOPES } from '@/services/microsoftDeskService';
import { ChannelRole, DeskType } from '@xyne/shared';

const TAG = '[DeskIntegration]';
const router = express.Router();
router.use(express.json());

/**
 * Throws on auth failures. The channel creator, the email-channel owner,
 * or a channel admin can manage the integration.
 */
async function assertChannelOwner(channelId: string, userId: string): Promise<void> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, createdBy: true },
  });
  if (!channel) {
    const err = new Error('Channel not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (channel.createdBy === userId) return;

  const pref = await db.emailChannelPreference.findUnique({
    where: { channelId },
    select: { ownerUserId: true },
  });
  if (pref?.ownerUserId === userId) return;

  const participant = await db.channelParticipant.findFirst({
    where: { channelId, userId, role: ChannelRole.ADMIN },
    select: { id: true },
  });
  if (participant) return;

  const err = new Error('Forbidden: only the desk owner or admin can manage this integration') as Error & {
    status?: number;
  };
  err.status = 403;
  throw err;
}

async function findActiveSourceForChannel(
  channelId: string,
): Promise<{ id: string; sourceType: string; displayName: string; credentials: string } | null> {
  return db.externalSource.findFirst({
    where: { channelId, isActive: true, NOT: { name: { startsWith: 'google-dl-sync' } } },
    select: { id: true, sourceType: true, displayName: true, credentials: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * GET /api/integrations/desk/:channelId/dl-member-sync-status
 * Returns the active one-time DL older-email sync, if any.
 */
router.get(
  '/:channelId/dl-member-sync-status',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = req.user!.id;

    try {
      await assertChannelOwner(channelId, userId);

      const activeSync = await db.externalSource.findFirst({
        where: {
          channelId,
          name: { contains: 'dl-sync' },
          isActive: true,
        },
        select: {
          displayName: true,
          sourceType: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (!activeSync) {
        res.json({ active: false });
        return;
      }

      res.json({
        active: true,
        memberEmail: activeSync.displayName,
        provider: activeSync.sourceType,
        startedAt: activeSync.updatedAt.toISOString(),
      });
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status ?? 500;
      const message =
        error instanceof Error ? error.message : 'Failed to fetch DL member sync status';
      logger.error(`${TAG} DL member sync status failed`, { channelId, status, error });
      res.status(status).json({ error: message });
    }
  },
);

/**
 * POST /api/integrations/desk/:channelId/disconnect
 * Body: none
 * Soft-disconnects: clears the credentials and flips `isActive = false`.
 */
router.post(
  '/:channelId/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = req.user!.id;

    try {
      await assertChannelOwner(channelId, userId);

      const source = await findActiveSourceForChannel(channelId);
      if (!source) {
        res.status(404).json({ error: 'No active integration found for this channel' });
        return;
      }

      // Must run BEFORE the OAuth revoke below, since stop() needs a valid token.
      await stopGmailWatchBeforeDeactivation(source, TAG);

      // Best-effort token revocation at the provider. Don't let a revoke
      // failure block the local disconnect — the source is being marked
      // inactive regardless, and the user can retry if needed.
      try {
        if (source.sourceType === ExternalSourcePlatform.GOOGLE) {
          const creds = JSON.parse(decrypt(source.credentials)) as {
            refreshToken?: string;
            accessToken?: string;
          };
          const tokenToRevoke = creds.refreshToken || creds.accessToken;
          if (tokenToRevoke) {
            const revokeRes = await fetch(
              `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`,
              { method: 'POST' },
            );
            if (!revokeRes.ok) {
              logger.warn(`${TAG} Google revoke returned ${revokeRes.status}`, { sourceId: source.id });
            }
          }
        }
        // Microsoft delegated tokens: no provider revoke endpoint. Document
        // and skip — the user must revoke from account.microsoft.com to
        // invalidate the refresh token outside our DB.
      } catch (err) {
        logger.warn(`${TAG} Best-effort token revoke failed`, err);
      }

      await db.externalSource.update({
        where: { id: source.id },
        data: { isActive: false, credentials: '' },
      });

      logger.info(`${TAG} Disconnected integration`, {
        channelId,
        sourceId: source.id,
        sourceType: source.sourceType,
      });
      res.json({ success: true });
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Failed to disconnect integration';
      logger.error(`${TAG} Disconnect failed`, { channelId, status, message });
      res.status(status).json({ error: message });
    }
  },
);

/**
 * POST /api/integrations/desk/:channelId/reconnect-init
 * Body: none
 * Returns: { authUrl: string }
 * Caller opens authUrl in a new window. The OAuth callback (in
 * google-auth.ts / microsoft-desk-auth.ts) detects the reconnect state and
 * updates the existing ExternalSource row.
 */
router.post(
  '/:channelId/reconnect-init',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;
    const platform: 'electron' | 'web' =
      (req.body as { platform?: string } | undefined)?.platform === 'electron' ? 'electron' : 'web';

    try {
      await assertChannelOwner(channelId, userId);

      // Use findFirst (not findActiveSourceForChannel) — reconnect should
      // also work when the source is currently inactive (post-disconnect).
      const source = await db.externalSource.findFirst({
        where: { channelId },
        select: { id: true, sourceType: true, displayName: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!source) {
        res.status(404).json({ error: 'No integration to reconnect for this channel' });
        return;
      }

      const expectedEmail = extractEmailAddress(source.displayName);
      if (!expectedEmail) {
        res.status(409).json({ error: 'Existing integration has no recorded email' });
        return;
      }

      if (source.sourceType === ExternalSourcePlatform.GOOGLE) {
        const state = Math.random().toString(36).substring(7);
        await setGoogleOAuthState(state, {
          mode: 'reconnect',
          channelId,
          expectedEmail,
          workspaceId,
          platform,
          userId,
          timestamp: Date.now(),
        });

        const authUrl = createGoogleOAuth2Client(getGoogleIntegrationRedirectUri(req)).generateAuthUrl({
          access_type: 'offline',
          scope: GMAIL_SCOPES,
          prompt: 'consent',
          // login_hint pre-fills the account picker with the bound email so
          // the user can't accidentally pick the wrong account. The strict
          // email check in the callback is the real enforcement.
          login_hint: expectedEmail,
          state,
        });
        res.json({ authUrl });
        return;
      }

      if (source.sourceType === 'microsoft') {
        const oauthClient = microsoftDeskService.getOAuthClient();
        if (!oauthClient) {
          res.status(503).json({ error: 'Microsoft OAuth not configured' });
          return;
        }
        const state = microsoftDeskService.generateState();
        await microsoftDeskService.storePendingChannel(state, {
          mode: 'reconnect',
          userId,
          channelId,
          expectedEmail,
          workspaceId,
          platform,
        });

        const redirectUri = `${getBackendUrl(req)}/api/integrations/microsoft/callback`;
        const authUrl = oauthClient.authorizeURL({
          redirect_uri: redirectUri,
          scope: MICROSOFT_OAUTH_SCOPES,
          state,
          prompt: 'consent',
          login_hint: expectedEmail,
        } as Record<string, string | string[]>);
        res.json({ authUrl });
        return;
      }

      res.status(400).json({ error: `Unsupported sourceType for reconnect: ${source.sourceType}` });
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status ?? 500;
      const message =
        error instanceof Error ? error.message : 'Failed to initiate reconnect';
      logger.error(`${TAG} Reconnect init failed`, { channelId, status, message });
      res.status(status).json({ error: message });
    }
  },
);

/**
 * POST /api/integrations/desk/:channelId/dl-member-sync-init
 * Body: { startDate: string, endDate: string, provider: 'google' | 'microsoft', platform?: 'electron' | 'web' }
 * Returns: { authUrl: string }
 * Initiates OAuth to connect a DL member's mailbox for one-time backfill
 * of older distribution list emails.
 */
router.post(
  '/:channelId/dl-member-sync-init',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;
    const { startDate, endDate, provider, platform: rawPlatform } = req.body as {
      startDate?: string;
      endDate?: string;
      provider?: string;
      platform?: string;
    };
    const platform: 'electron' | 'web' = rawPlatform === 'electron' ? 'electron' : 'web';

    try {
      await assertChannelOwner(channelId, userId);

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }
      if (provider !== 'google' && provider !== 'microsoft') {
        res.status(400).json({ error: 'provider must be "google" or "microsoft"' });
        return;
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        res.status(400).json({ error: 'Invalid date range' });
        return;
      }
      const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 365) {
        res.status(400).json({ error: 'Date range cannot exceed 365 days' });
        return;
      }

      const pref = await db.emailChannelPreference.findUnique({
        where: { channelId },
        select: { deskType: true, dlEmail: true },
      });
      if (!pref || pref.deskType !== DeskType.DL || !pref.dlEmail) {
        res.status(400).json({ error: 'Channel is not a DL desk or has no DL email configured' });
        return;
      }

      const existingSync = await db.externalSource.findFirst({
        where: {
          channelId,
          name: { contains: 'dl-sync' },
          isActive: true,
        },
      });
      if (existingSync) {
        res.status(409).json({ error: 'A member sync is already in progress for this desk' });
        return;
      }

      if (provider === 'google') {
        const state = Math.random().toString(36).substring(7);
        await setGoogleOAuthState(state, {
          mode: 'dl-member-sync',
          channelId,
          workspaceId,
          dlEmail: pref.dlEmail,
          startDate,
          endDate,
          userId,
          platform,
          timestamp: Date.now(),
        });

        const authUrl = createGoogleOAuth2Client(getGoogleIntegrationRedirectUri(req)).generateAuthUrl({
          access_type: 'offline',
          scope: GMAIL_SCOPES,
          prompt: 'consent',
          state,
        });
        res.json({ authUrl });
        return;
      }

      const oauthClient = microsoftDeskService.getOAuthClient();
      if (!oauthClient) {
        res.status(503).json({ error: 'Microsoft OAuth not configured' });
        return;
      }
      const state = microsoftDeskService.generateState();
      await microsoftDeskService.storePendingChannel(state, {
        mode: 'dl-member-sync',
        userId,
        workspaceId,
        channelId,
        dlEmail: pref.dlEmail,
        startDate,
        endDate,
        platform,
      });

      const redirectUri = `${getBackendUrl(req)}/api/integrations/microsoft/callback`;
      const authUrl = oauthClient.authorizeURL({
        redirect_uri: redirectUri,
        scope: MICROSOFT_OAUTH_SCOPES,
        state,
        prompt: 'consent',
      } as Record<string, string | string[]>);
      res.json({ authUrl });
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status ?? 500;
      const message =
        error instanceof Error ? error.message : 'Failed to initiate DL member sync';
      logger.error(`${TAG} DL member sync init failed`, { channelId, status, message });
      res.status(status).json({ error: message });
    }
  },
);

export default router;
