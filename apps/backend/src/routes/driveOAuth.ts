import express, { type Request, type Response } from 'express';
import { UserStatus } from '@xyne/shared';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { authMiddleware } from '@/middleware/auth';
import { repositories } from '@/database/repositories';
import { persistDriveOAuthCredentials } from '@/services/driveTokenService';
import {
  driveOAuthStateService,
  type DriveOAuthPlatform,
  type DriveOAuthState,
} from '@/services/driveOAuthStateService';
import { logger } from '@/utils/logger';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';

const router = express.Router();

// ONLY the Drive scope — no openid/email/profile, and no include_granted_scopes (see
// generateAuthUrl below). Requesting identity scopes (or re-affirming them via
// include_granted_scopes) makes Google render a "You're signing back in to Xyne"
// screen; with just drive.readonly in isolation the user sees only the "Xyne wants
// access to your Drive files" permission card. The active login session is untouched.
const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function getGoogleRedirectUri(req: Request): string {
  return `${getBackendUrl(req)}/api/drive/oauth/google/callback`;
}

function createGoogleClient(req: Request): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured');
  }
  return new OAuth2Client(clientId, clientSecret, getGoogleRedirectUri(req));
}

function getPlatform(req: Request): DriveOAuthPlatform {
  return req.body?.platform === 'electron' ? 'electron' : 'web';
}

/**
 * Resolve the caller-supplied return path against the frontend origin, dropping
 * anything that would leave our origin (open-redirect guard). Returns a same-origin
 * path (with query string) or '/' when invalid.
 */
function sanitizeReturnPath(frontendUrl: string, returnPath: unknown): string {
  if (typeof returnPath !== 'string' || !returnPath.startsWith('/')) return '/';
  try {
    const url = new URL(returnPath, frontendUrl);
    if (url.origin !== new URL(frontendUrl).origin) return '/';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

/** Build a same-origin redirect back to the stored return path with extra params. */
function buildReturnUrl(frontendUrl: string, returnPath: string, extra: Record<string, string>): string {
  const url = new URL(returnPath || '/', frontendUrl);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}

function redirectToFrontend(
  req: Request,
  res: Response,
  params: Record<string, string>,
  returnPath = '/',
): void {
  res.redirect(buildReturnUrl(getFrontendUrl(req), returnPath, params));
}

router.post('/google/init', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      res.status(401).json({ success: false, error: 'authentication_required' });
      return;
    }

    const user = await repositories.users.findById(authenticatedUserId);
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.leftAt !== null ||
      user.workspaceId !== req.user?.workspaceId
    ) {
      res.status(403).json({ success: false, error: 'inactive_workspace_user' });
      return;
    }

    const platform = getPlatform(req);
    const returnPath = sanitizeReturnPath(getFrontendUrl(req), req.body?.returnPath);
    const { state, codeChallenge } = await driveOAuthStateService.create({
      ownerUserId: user.id,
      workspaceId: user.workspaceId,
      expectedEmail: user.email,
      platform,
      returnPath,
    });

    const authUrl = createGoogleClient(req).generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_DRIVE_SCOPES,
      prompt: 'consent',
      // NOTE: intentionally NOT setting include_granted_scopes. With the same OAuth
      // client used for login, that flag makes Google re-affirm the existing
      // openid/profile grant and inserts a "You're signing back in to Xyne" identity
      // screen before the Drive consent. Requesting drive.readonly in isolation shows
      // only the "Xyne wants access to your Drive files" card. We don't need the
      // token to carry identity scopes, so there's no downside.
      login_hint: user.email,
      redirect_uri: getGoogleRedirectUri(req),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });

    logger.info('[DRIVE_IMPORT][OAUTH] Authorization initialized', {
      ownerUserId: user.id,
      workspaceId: user.workspaceId,
      platform,
    });
    res.json({ success: true, authUrl });
  } catch (error) {
    logger.error('[DRIVE_IMPORT][OAUTH] Failed to initialize authorization', error);
    res.status(500).json({ success: false, error: 'drive_oauth_init_failed' });
  }
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  // Where to send the user back to in the SPA; filled in once we read the state.
  let returnPath = '/';

  try {
    // Resolve the callback against SERVER-issued, single-use state FIRST, so every
    // subsequent decision keys off this server-controlled result rather than the raw
    // query params. A forged / absent / expired `state` consumes to null and is
    // rejected before anything sensitive runs — the authorization gate cannot be
    // bypassed by user-supplied input (CodeQL js/user-controlled-bypass,
    // CWE-807 / CWE-290). `consume` is atomic (GET+DEL), so it also self-cleans.
    const state: DriveOAuthState | null = stateParam
      ? await driveOAuthStateService.consume(stateParam)
      : null;
    if (!state) {
      redirectToFrontend(req, res, { driveOAuthError: 'missing_or_expired_state' }, returnPath);
      return;
    }
    returnPath = state.returnPath;

    // The request is now bound to valid server state; branch on Google's response.
    if (req.query.error) {
      redirectToFrontend(req, res, { driveOAuthError: 'authorization_denied' }, returnPath);
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
      redirectToFrontend(req, res, { driveOAuthError: 'missing_or_expired_state' }, returnPath);
      return;
    }

    const user = await repositories.users.findById(state.ownerUserId);
    if (!user || user.workspaceId !== state.workspaceId) {
      throw new Error('The Drive authorization no longer matches the active workspace user');
    }

    const client = createGoogleClient(req);
    const { tokens } = await client.getToken({
      code,
      redirect_uri: getGoogleRedirectUri(req),
      codeVerifier: state.codeVerifier,
    });
    // We request only drive.readonly (no openid), so there's no id_token to verify.
    // The flow is bound to the signed-in user via single-use, server-issued state,
    // and login_hint pre-selects their account. Whichever Google account the user
    // authorizes is the Drive we read on their behalf — their choice, no identity
    // scope needed. displayName uses the app-side email for reference only.
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Google did not return the required Drive credentials');
    }

    await persistDriveOAuthCredentials({
      ownerUserId: user.id,
      workspaceId: state.workspaceId,
      email: state.expectedEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });

    logger.info('[DRIVE_IMPORT][OAUTH] Authorization completed', {
      ownerUserId: user.id,
      workspaceId: state.workspaceId,
    });
    redirectToFrontend(req, res, { driveOAuth: 'success' }, returnPath);
  } catch (error) {
    logger.error('[DRIVE_IMPORT][OAUTH] Callback failed', error);
    redirectToFrontend(req, res, { driveOAuthError: 'google_drive_oauth_failed' }, returnPath);
  }
});

export default router;
