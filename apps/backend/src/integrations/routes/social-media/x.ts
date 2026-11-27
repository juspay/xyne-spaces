/**
 * X (Twitter) desk connection routes.
 *
 * Each tenant brings their own X developer app: they enter its four keys, add our callback URL to
 * the app, then authorize their brand account. Keys are validated before the redirect and
 * encrypted before they reach Redis or the database.
 */
import express, { type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { ChannelType } from '@xyne/shared';
import { z } from 'zod';
import { authMiddleware } from '@/middleware/auth';
import { db } from '@/database/client';
import { addMetaSourcesToChannelTx, createMetaDeskTx } from '@/bypassAcl/transactions/metaDesk';
import { decrypt, encrypt } from '@/services/encryptionService';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';
import { logger } from '@/utils/logger';
import { buildSupportPath, postOAuthRedirect } from '../urlHelpers';
import { ExternalSourcePlatform } from '../../core/types';
import { isXCreditsDepleted, isXNetworkError, xApiClient } from '../../adapters/social-media/x/client';
import {
  XConnectError,
  buildXAuthorizeUrl,
  xAppCredentialsSchema,
  xConnectionService,
} from '../../adapters/social-media/x/connection';
import { xOAuthStateService, type XOAuthState } from '../../adapters/social-media/x/oauthStateService';
import {
  parseXAppCredentials,
  parseXCredentials,
  replaceXCredentials,
  updateXCredentials,
  withoutUserSecrets,
  xTokenService,
} from '../../adapters/social-media/x/tokenService';
import { XChatUnlockError, xchatService } from '../../adapters/social-media/x/xchat';
import { acquireLeadership, releaseLock } from '@/utils/distributedLock';
import type { XAppCredentials, XCredentials } from '../../adapters/social-media/x/types';
import { authorizeSocialMediaManager } from './access';
import { oauthDeskStartSchema, parseOAuthPlatform, validateOAuthDeskSetup } from './deskSetup';

const TAG = '[XRoutes]';
const router = express.Router();

/** The tenant must add this exact URL (no trailing slash) to their X app's callback URLs. */
export const xCallbackUri = (req: Request) => `${getBackendUrl(req)}/api/integrations/social-media/x/oauth/callback`;

const xSourceName = (xUserId: string) => `x-${xUserId}`;

function redirectToDesk(
  req: Request,
  res: Response,
  params: { workspaceId?: string; channelId?: string; platform?: 'web' | 'electron'; error?: string },
): void {
  const query = new URLSearchParams(
    params.error
      ? { socialMediaError: params.error, socialMediaProvider: 'x' }
      : { socialMediaOAuth: 'success', socialMediaProvider: 'x' },
  );
  const path = buildSupportPath(params.workspaceId, params.channelId, query);
  res.redirect(postOAuthRedirect(getFrontendUrl(req), path, params.platform ?? 'web'));
}

/** Validates the keys and sends 400 with a code when X rejects them. Returns false if it responded. */
async function validateKeysOrRespond(app: XAppCredentials, res: Response): Promise<boolean> {
  try {
    await xConnectionService.validateAppKeys(app);
    return true;
  } catch (error) {
    if (error instanceof XConnectError) {
      res.status(400).json({ error: error.message, code: error.code });
      return false;
    }
    if (isXNetworkError(error)) {
      logger.error(`${TAG} X unreachable while validating app keys`, { host: error.host, reason: error.reason });
      res.status(502).json({ error: 'The server cannot reach X. Check its outbound access to api.x.com.', code: 'x_unreachable' });
      return false;
    }
    throw error;
  }
}

async function startAuthorization(
  req: Request,
  res: Response,
  app: XAppCredentials,
  state: Omit<XOAuthState, 'purpose' | 'codeVerifier' | 'createdAt' | 'encryptedApp' | 'redirectUri'>,
): Promise<void> {
  const redirectUri = xCallbackUri(req);
  const created = await xOAuthStateService.create({
    ...state,
    encryptedApp: encrypt(JSON.stringify(app)),
    redirectUri,
  });
  res.json({
    authorizationUrl: buildXAuthorizeUrl(app.clientId, redirectUri, created.state, created.codeChallenge),
    callbackUrl: redirectUri,
  });
}

/** Channel settings for add-account / reconnect, or null after sending 404. */
async function loadDeskSettings(channelId: string, workspaceId: string, res: Response) {
  const [channel, pref] = await Promise.all([
    db.channel.findFirst({
      where: { id: channelId, workspaceId, type: ChannelType.SOCIAL_MEDIA },
      select: { id: true, name: true, projectId: true, visibility: true },
    }),
    db.emailChannelPreference.findUnique({ where: { channelId }, select: { boardId: true, assigneeUserGroupId: true } }),
  ]);
  if (!channel?.projectId) {
    res.status(404).json({ error: 'X desk configuration not found' });
    return null;
  }
  return {
    channelName: channel.name,
    projectId: channel.projectId,
    boardId: pref?.boardId ?? undefined,
    assigneeUserGroupId: pref?.assigneeUserGroupId ?? undefined,
    visibility: channel.visibility === 'PRIVATE' ? ('PRIVATE' as const) : ('PUBLIC' as const),
  };
}

// GET /x/oauth/callback-url — shown in the connect form so the tenant can configure their app first.
router.get('/x/oauth/callback-url', authMiddleware.authenticate, (req: Request, res: Response) => {
  res.json({ callbackUrl: xCallbackUri(req) });
});

// POST /x/oauth/start — new X desk.
const startSchema = oauthDeskStartSchema.extend({ app: xAppCredentialsSchema });
router.post('/x/oauth/start', authMiddleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Desk name, project and all four X app keys are required' });
      return;
    }
    const input = parsed.data;
    const workspaceId = req.user!.workspaceId!;
    if (!(await validateOAuthDeskSetup(input, workspaceId, res))) return;
    if (!(await validateKeysOrRespond(input.app, res))) return;

    await startAuthorization(req, res, input.app, {
      userId: req.user!.id,
      workspaceId,
      channelName: input.name,
      projectId: input.projectId,
      boardId: input.boardId,
      assigneeUserGroupId: input.assigneeUserGroupId,
      visibility: input.visibility.toUpperCase() as 'PUBLIC' | 'PRIVATE',
      platform: input.platform,
    });
  } catch (error) {
    logger.error(`${TAG} Failed to start X authorization`, { error });
    res.status(500).json({ error: 'Failed to start X authorization' });
  }
});

// POST /:channelId/x/add-account — another brand account on an existing X desk. Keys are optional:
// omitted ⇒ reuse the app of an account already on this desk.
const appBodySchema = z.object({ app: xAppCredentialsSchema.optional() });
router.post('/:channelId/x/add-account', authMiddleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId } = req.params;
    const workspaceId = req.user!.workspaceId!;
    const platform = parseOAuthPlatform(req, res);
    if (!platform) return;
    if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;
    const body = appBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid X app keys' });
      return;
    }

    let app = body.data.app;
    if (!app) {
      const existing = await db.externalSource.findMany({
        where: { channelId, workspaceId, sourceType: ExternalSourcePlatform.X },
        select: { credentials: true },
        orderBy: { createdAt: 'asc' },
      });
      app = existing.map((s) => parseXAppCredentials(s.credentials)?.app).find(Boolean);
      if (!app) {
        res.status(400).json({ error: 'Enter the X app keys for this account', code: 'x_keys_required' });
        return;
      }
    }
    if (!(await validateKeysOrRespond(app, res))) return;

    const settings = await loadDeskSettings(channelId, workspaceId, res);
    if (!settings) return;
    await startAuthorization(req, res, app, {
      mode: 'add-account',
      userId: req.user!.id,
      workspaceId,
      channelId,
      platform,
      ...settings,
    });
  } catch (error) {
    logger.error(`${TAG} Failed to start X add-account`, { error });
    res.status(500).json({ error: 'Failed to start X authorization' });
  }
});

// POST /:channelId/x/:sourceId/reconnect — re-authorize one account. Keys are optional: omitted ⇒
// reuse the stored ones; pass new ones after regenerating them in the X Developer Console.
router.post('/:channelId/x/:sourceId/reconnect', authMiddleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId, sourceId } = req.params;
    const workspaceId = req.user!.workspaceId!;
    const platform = parseOAuthPlatform(req, res);
    if (!platform) return;
    if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;
    const body = appBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid X app keys' });
      return;
    }

    const source = await db.externalSource.findFirst({
      where: { id: sourceId, channelId, workspaceId, sourceType: ExternalSourcePlatform.X },
      select: { credentials: true, externalIdentifier: true },
    });
    if (!source?.externalIdentifier) {
      res.status(404).json({ error: 'X account not found' });
      return;
    }
    const app = body.data.app ?? parseXAppCredentials(source.credentials)?.app;
    if (!app) {
      res.status(400).json({ error: 'Enter the X app keys for this account', code: 'x_keys_required' });
      return;
    }
    if (!(await validateKeysOrRespond(app, res))) return;

    const settings = await loadDeskSettings(channelId, workspaceId, res);
    if (!settings) return;
    await startAuthorization(req, res, app, {
      mode: 'reconnect',
      userId: req.user!.id,
      workspaceId,
      channelId,
      platform,
      sourceId,
      expectedXUserId: source.externalIdentifier,
      ...settings,
    });
  } catch (error) {
    logger.error(`${TAG} Failed to start X reconnect`, { error });
    res.status(500).json({ error: 'Failed to start X authorization' });
  }
});

// GET /x/oauth/callback — X redirects here after the brand account authorizes the tenant's app.
router.get('/x/oauth/callback', async (req: Request, res: Response): Promise<void> => {
  const stateKey = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

  const state = await xOAuthStateService.consume(stateKey);
  if (!state) {
    redirectToDesk(req, res, { error: 'x_invalid_state' });
    return;
  }
  const back = { workspaceId: state.workspaceId, channelId: state.channelId, platform: state.platform };

  // CSRF guard: a session user, when present, must be the one who started the flow.
  if (req.user && req.user.id !== state.userId) {
    logger.warn(`${TAG} Callback rejected — session user does not match state initiator`);
    redirectToDesk(req, res, { ...back, error: 'x_auth_denied' });
    return;
  }
  if (errorParam || !code) {
    logger.warn(`${TAG} X authorization not completed`, { error: errorParam || 'missing_code' });
    redirectToDesk(req, res, { ...back, error: errorParam === 'access_denied' ? 'x_auth_denied' : 'x_connection_failed' });
    return;
  }

  try {
    const initiatingUser = await db.user.findFirst({
      where: { id: state.userId, workspaceId: state.workspaceId, leftAt: null },
      select: { id: true },
    });
    if (!initiatingUser) {
      redirectToDesk(req, res, { ...back, error: 'x_user_removed' });
      return;
    }

    const app = JSON.parse(decrypt(state.encryptedApp)) as XAppCredentials;
    const creds = await xConnectionService.completeAuthorization(app, code, state.redirectUri, state.codeVerifier);

    if (state.mode === 'reconnect' && state.expectedXUserId !== creds.xUserId) {
      logger.warn(`${TAG} Reconnect rejected — different X account`, { expected: state.expectedXUserId, got: creds.xUserId });
      redirectToDesk(req, res, { ...back, error: 'x_account_mismatch' });
      return;
    }
    if (state.mode !== 'reconnect') {
      // Same workspace, or (the source name is globally unique) another workspace. Checked before
      // subscribing, so an account owned elsewhere never gets subscriptions on this app.
      const existing = await db.externalSource.findFirst({
        where: {
          OR: [
            { workspaceId: state.workspaceId, sourceType: ExternalSourcePlatform.X, externalIdentifier: creds.xUserId },
            { name: xSourceName(creds.xUserId) },
          ],
        },
        select: { id: true },
      });
      if (existing) {
        redirectToDesk(req, res, { ...back, error: 'x_account_already_connected' });
        return;
      }
    }

    await xConnectionService.ensureSubscriptions(creds);

    const encryptedCredentials = encrypt(JSON.stringify(creds satisfies XCredentials));
    const xSource = {
      name: xSourceName(creds.xUserId),
      displayName: creds.username,
      externalIdentifier: creds.xUserId,
      encryptedCredentials,
    };

    if (state.mode === 'reconnect' && state.sourceId) {
      const target = await db.externalSource.findFirst({
        where: { id: state.sourceId, workspaceId: state.workspaceId, sourceType: ExternalSourcePlatform.X },
        select: { id: true },
      });
      if (!target) {
        redirectToDesk(req, res, { ...back, error: 'x_connection_failed' });
        return;
      }
      let previousApp: XAppCredentials | undefined;
      // Under the credentials lock, on a fresh read: keep the XChat keys (they belong to the account,
      // not the app; a disconnect already deleted them), and never race a token refresh.
      await replaceXCredentials(target.id, (previous) => {
        previousApp = previous?.app;
        return { ...creds, ...(previous?.xchat?.keys && { xchat: previous.xchat }) };
      });
      await db.externalSource.update({
        where: { id: target.id },
        data: { displayName: creds.username, isActive: true },
      });
      xchatService.forget(target.id);
      // Reconnected with a different app: the old app would keep delivering (and billing) events.
      if (previousApp && previousApp.consumerKey !== creds.app.consumerKey) {
        await xApiClient
          .removeXyneSubscriptions(previousApp, creds.xUserId)
          .catch((error: unknown) =>
            logger.warn(`${TAG} Could not remove old app's subscriptions after reconnect`, { sourceId: target.id, error: String(error) }),
          );
      }
      redirectToDesk(req, res, back);
      return;
    }
    if (state.mode === 'add-account' && state.channelId) {
      await addMetaSourcesToChannelTx(
        state.channelId,
        state.workspaceId,
        state.userId,
        state.boardId,
        ExternalSourcePlatform.X,
        [xSource],
      );
      redirectToDesk(req, res, back);
      return;
    }

    const result = await createMetaDeskTx(state, ExternalSourcePlatform.X, [xSource], new Date());
    redirectToDesk(req, res, { ...back, channelId: result.channelId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // ExternalSource.name (`x-<userId>`) is globally unique: connected in another workspace.
      redirectToDesk(req, res, { ...back, error: 'x_account_already_connected' });
      return;
    }
    if (error instanceof XConnectError) {
      redirectToDesk(req, res, { ...back, error: error.code });
      return;
    }
    if (isXCreditsDepleted(error)) {
      redirectToDesk(req, res, { ...back, error: 'x_no_credits' });
      return;
    }
    if (isXNetworkError(error)) {
      logger.error(`${TAG} X unreachable during callback`, { host: error.host, reason: error.reason });
      redirectToDesk(req, res, { ...back, error: 'x_unreachable' });
      return;
    }
    logger.error(`${TAG} X callback failed`, { error: String(error) });
    redirectToDesk(req, res, { ...back, error: 'x_connection_failed' });
  }
});

/**
 * Stops X delivery for a source, revokes and blanks its tokens and deletes its XChat keys (app keys
 * kept for reconnect). Under the credentials lock it only reads and blanks, which is quick; the X
 * calls run after the lock with what was read. Blanking first means no refresh can rotate the token
 * in between, so the revoked token is the current one. No-op if already torn down.
 */
export async function teardownXSource(sourceId: string): Promise<void> {
  const read: { creds?: XCredentials } = {};
  await updateXCredentials(sourceId, (current) => {
    read.creds = current;
    return withoutUserSecrets(current);
  });
  xchatService.forget(sourceId);
  if (read.creds) await xConnectionService.releaseAtX(read.creds);
}

// POST /:channelId/x/:sourceId/disconnect
router.post('/:channelId/x/:sourceId/disconnect', authMiddleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId, sourceId } = req.params;
    const workspaceId = req.user!.workspaceId!;
    if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;

    const source = await db.externalSource.findFirst({
      where: { id: sourceId, channelId, workspaceId, sourceType: ExternalSourcePlatform.X },
      select: { id: true, credentials: true },
    });
    if (!source) {
      res.status(404).json({ error: 'X account not found' });
      return;
    }
    // Deactivate first so the stream worker stops ingesting even if X cleanup is slow or fails.
    await db.externalSource.update({ where: { id: sourceId }, data: { isActive: false } });
    await teardownXSource(sourceId);
    res.json({ message: 'X account disconnected' });
  } catch (error) {
    logger.error(`${TAG} Failed to disconnect X account`, { error: String(error) });
    res.status(500).json({ error: 'Failed to disconnect X account' });
  }
});

/** An active X source of this desk, or null after sending 404. */
async function loadActiveXSource(channelId: string, sourceId: string, workspaceId: string, res: Response) {
  const source = await db.externalSource.findFirst({
    where: { id: sourceId, channelId, workspaceId, sourceType: ExternalSourcePlatform.X, isActive: true },
    select: { id: true, credentials: true },
  });
  if (!source?.credentials) {
    res.status(404).json({ error: 'Connected X account not found' });
    return null;
  }
  return source;
}

// GET /:channelId/x/accounts — per-account status for desk settings. Flags only: never key material.
router.get('/:channelId/x/accounts', authMiddleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId } = req.params;
    const workspaceId = req.user!.workspaceId!;
    if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;
    const sources = await db.externalSource.findMany({
      where: { channelId, workspaceId, sourceType: ExternalSourcePlatform.X },
      select: { id: true, isActive: true, credentials: true, lastSyncCursor: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      callbackUrl: xCallbackUri(req),
      accounts: sources.map((s) => {
        let xchatEnabled = false;
        let hasAppKeys = false;
        try {
          const creds = s.credentials ? parseXAppCredentials(s.credentials) : null;
          hasAppKeys = !!creds;
          xchatEnabled = s.isActive && !!(s.credentials && parseXCredentials(s.credentials).xchat?.keys);
        } catch {
          /* tokens blanked (disconnected) — XChat is necessarily off */
        }
        return { id: s.id, isActive: s.isActive, xchatEnabled, hasAppKeys, lastSyncedAt: s.lastSyncCursor };
      }),
    });
  } catch (error) {
    logger.error(`${TAG} Failed to load X accounts`, { error: String(error) });
    res.status(500).json({ error: 'Failed to load X accounts' });
  }
});

const xchatEnableSchema = z.object({ passcode: z.string().min(1).max(128) });

/**
 * POST /:channelId/x/:sourceId/xchat — enable reading encrypted XChat messages.
 *
 * The passcode is used once to unlock the account's keys from X's key backup and is then dropped;
 * only the exported keys are stored (encrypted). X allows a small number of wrong passcodes for
 * the account as a whole, so we never retry, never run two attempts at once, and report how many
 * attempts X says remain.
 */
router.post('/:channelId/x/:sourceId/xchat', authMiddleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  const { channelId, sourceId } = req.params;
  const workspaceId = req.user!.workspaceId!;
  const parsed = xchatEnableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'XChat passcode is required' });
    return;
  }
  if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;
  const source = await loadActiveXSource(channelId, sourceId, workspaceId, res);
  if (!source) return;

  // Fails closed: if Redis is unavailable no attempt is made, so two can never race.
  const lock = await acquireLeadership(`lock:x-xchat-unlock:${sourceId}`, 60);
  if (!lock) {
    res.status(409).json({ error: 'An XChat setup for this account is already in progress' });
    return;
  }
  try {
    const creds = parseXCredentials(source.credentials);
    const keys = await xTokenService.withUserToken(source, (token) =>
      xchatService.unlockKeys(token, creds.xUserId, parsed.data.passcode),
    );
    // Merge only the keys into a fresh read under the credentials lock: a token refresh during the
    // unlock (seconds) rotated the stored tokens, and those must not be overwritten.
    const saved = await updateXCredentials(sourceId, (current) => ({ ...current, xchat: keys }));
    if (!saved) {
      res.status(409).json({ error: 'This X account was disconnected while XChat was being enabled' });
      return;
    }
    xchatService.forget(sourceId);
    logger.info(`${TAG} XChat enabled`, { sourceId });
    res.json({ message: 'XChat enabled', xchatEnabled: true });
  } catch (error) {
    if (error instanceof XChatUnlockError) {
      const status = error.code === 'xchat_unlock_failed' ? 502 : 400;
      res.status(status).json({ error: error.message, code: error.code, guessesRemaining: error.guessesRemaining });
      return;
    }
    logger.error(`${TAG} Failed to enable XChat`, { sourceId, error: String(error) });
    res.status(500).json({ error: 'Failed to enable XChat' });
  } finally {
    await releaseLock(lock);
  }
});

// DELETE /:channelId/x/:sourceId/xchat — forget the stored XChat keys.
router.delete('/:channelId/x/:sourceId/xchat', authMiddleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId, sourceId } = req.params;
    const workspaceId = req.user!.workspaceId!;
    if (!(await authorizeSocialMediaManager(channelId, req.user!.id, workspaceId, res))) return;
    const source = await loadActiveXSource(channelId, sourceId, workspaceId, res);
    if (!source) return;
    // undefined is dropped by JSON; fresh read under the lock keeps any just-rotated tokens.
    await updateXCredentials(sourceId, (current) => ({ ...current, xchat: undefined }));
    xchatService.forget(sourceId);
    res.json({ message: 'XChat disabled', xchatEnabled: false });
  } catch (error) {
    logger.error(`${TAG} Failed to disable XChat`, { error: String(error) });
    res.status(500).json({ error: 'Failed to disable XChat' });
  }
});

export default router;
