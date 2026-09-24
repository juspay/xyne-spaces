import { OAuth2Client, gaxios } from 'google-auth-library';
import axios from 'axios';
import { AuthProvider } from '@xyne/shared';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { UserSessionService } from '../services/userSessionService';
import { accountDeactivationService } from '../services/accountDeactivationService';
import {
  GOOGLE_CLIENTS,
  googleClientKeyFromDeviceInfo,
  orderedGoogleClientKeys,
} from '../services/googleOAuthClients';

const userSessionService = new UserSessionService();

// Timeout for Microsoft Graph / token calls so a hanging endpoint cannot stall
// the refresh hot path indefinitely.
const MS_REQUEST_TIMEOUT_MS = 10_000;

// The session shape both middlewares load via userSessionService.getSessionById
// (UserSession joined with its user + orgMember).
type LoadedSession = NonNullable<Awaited<ReturnType<UserSessionService['getSessionById']>>>;

export type RefreshVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; deactivate: boolean };

// A refresh token is bound to its minting client. Only the OWNING client can
// tell us the account is revoked (permanent errors, GOOGLE_AUTH_PERMANENT_ERRORS,
// default invalid_grant / invalid_token). Any other client just reports it
// doesn't own the token (unauthorized_client / invalid_client) — that is NOT a
// revocation, so we try the next client.
const OWNING_CLIENT_REVOKED = config.googleAuthPermanentErrors;
const WRONG_CLIENT = config.googleAuthClientErrors;

/**
 * Verify a Google refresh token against the client that minted it.
 *
 * Returns true only when the OWNING client reports the token is bad
 * (invalid_grant / invalid_token) — a genuine revocation/deactivation. A
 * `unauthorized_client` means we tried the wrong client, so we move on. If no
 * client claims the token or everything is transient, we allow the session (we
 * never deactivate on an inconclusive result).
 */
async function isGoogleRefreshTokenRevoked(
  session: LoadedSession,
  user: { id: string },
): Promise<boolean> {
  const refreshToken = session.refreshToken!;
  const preferred = googleClientKeyFromDeviceInfo(session.deviceInfo);
  let sawTransient = false;

  for (const key of orderedGoogleClientKeys(preferred)) {
    const creds = GOOGLE_CLIENTS[key]();
    if (!creds.id) continue; // client not configured — skip

    try {
      const client = new OAuth2Client(creds.id, creds.secret);
      client.setCredentials({ refresh_token: refreshToken });
      await client.getAccessToken();
      logger.info(`[Refresh-Validate] Google verification successful via ${creds.label} client`, { userId: user.id });
      return false;
    } catch (err) {
      const code = (err as gaxios.GaxiosError).response?.data?.error ?? (err as Error).message;

      if (OWNING_CLIENT_REVOKED.includes(code)) {
        logger.warn(`[Refresh-Validate] Google rejected token (${code}) via ${creds.label} client — account revoked/deactivated`, {
          userId: user.id,
          googleError: code,
        });
        return true;
      }
      if (WRONG_CLIENT.includes(code)){
        logger.info(`[Refresh-Validate] Wrong client: ${creds.label}, ${code}`);
        continue; // not this client's token — try next
      } 
      logger.error(`[Refresh-Validate] Unexpected Google error (${code}) via ${creds.label} client`, {
        userId: user.id,
        googleError: code,
        client: creds.id,
      });
      sawTransient = true; // network / 5xx — inconclusive
    }
  }

  logger.warn(`[Refresh-Validate] Google verification inconclusive (transient=${sawTransient}); allowing session`, { userId: user.id });
  return false;
}

/**
 * Verify a Microsoft user is still valid in Azure AD via Microsoft Graph, with a
 * token refresh on 401. Returns true ONLY on a definitive rejection (disabled /
 * deleted). Transient failures — Graph 429/5xx, a failed token refresh that is
 * itself 429/5xx, network errors, timeouts — return false (inconclusive), so a
 * Microsoft outage never mass-deactivates healthy users.
 */
async function isMicrosoftUserRevoked(session: LoadedSession): Promise<boolean> {
  if (!session.accessToken) {
    logger.info('[Refresh-Validate] No access token for Microsoft user; skipping Graph check');
    return false;
  }

  try {
    const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      validateStatus: () => true, // Don't throw on non-2xx
      timeout: MS_REQUEST_TIMEOUT_MS,
    });

    if (graphResponse.status === 200) {
      logger.info('[Refresh-Validate] Microsoft Graph verification successful');
      return false;
    }

    if (graphResponse.status === 401) {
      // Access token expired — try refreshing via the Microsoft token endpoint.
      const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
      const tokenResponse = await axios.post(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: session.refreshToken,
          scope: 'openid email profile User.Read',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: MS_REQUEST_TIMEOUT_MS,
        },
      );

      if (tokenResponse.status === 200) {
        const tokenData = tokenResponse.data as { access_token: string };
        await userSessionService.updateSession(session.id, { accessToken: tokenData.access_token });
        logger.info('[Refresh-Validate] Microsoft token refreshed');
        return false;
      }

      // 400/401 from the token endpoint = the refresh token itself is rejected
      // (revoked/expired/user disabled) — definitive. 429/5xx = transient.
      if (tokenResponse.status === 400 || tokenResponse.status === 401) {
        logger.warn(`[Refresh-Validate] Microsoft token refresh rejected (${tokenResponse.status}); user disabled/revoked in Azure AD`);
        return true;
      }

      logger.warn(`[Refresh-Validate] Microsoft token refresh transient failure (${tokenResponse.status}); allowing session`);
      return false;
    }

    // 403/404 = user disabled/deleted in Azure AD (definitive). 429/5xx and any
    // other status = transient/inconclusive — allow the session.
    if (graphResponse.status === 403 || graphResponse.status === 404) {
      logger.warn(`[Refresh-Validate] Microsoft Graph returned ${graphResponse.status}; user disabled/deleted in Azure AD`);
      return true;
    }

    logger.warn(`[Refresh-Validate] Microsoft Graph transient status ${graphResponse.status}; allowing session`);
    return false;
  } catch (err) {
    logger.warn(`[Refresh-Validate] Microsoft Graph verification transient error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Verify the session's user against their identity provider.
 * Returns true only on a definitive revocation. Email users (we issued the token
 * ourselves) and sessions without a refresh token have nothing external to check.
 */
async function isProviderRevoked(session: LoadedSession): Promise<boolean> {
  const provider = session.user.authProvider;

  if (provider === AuthProvider.GOOGLE && session.refreshToken) {
    return isGoogleRefreshTokenRevoked(session, { id: session.user.id });
  }

  if (provider === AuthProvider.MICROSOFT) {
    return isMicrosoftUserRevoked(session);
  }

  return false;
}

/**
 * The single, shared "is this session still allowed to be refreshed?" decision,
 * used by both authMiddleware (v1) and authV2Middleware. Pure decision — no
 * cookie/JWT side effects, so each middleware keeps its own token-minting.
 */
export async function validateSessionForRefresh(session: LoadedSession | null): Promise<RefreshVerdict> {
  if (!session || !session.user) {
    return { allowed: false, reason: 'session_or_user_not_found', deactivate: false };
  }
  if (session.status !== 'ACTIVE') {
    return { allowed: false, reason: `status_${session.status}`, deactivate: false };
  }
  if (new Date() >= session.refreshTokenExpiry) {
    return { allowed: false, reason: 'refresh_token_expired', deactivate: false };
  }
  if (session.user.orgMember?.leftAt) {
    return { allowed: false, reason: 'org_member_left', deactivate: false };
  }
  if (session.user.leftAt) {
    return { allowed: false, reason: 'workspace_user_left', deactivate: false };
  }
  if (await isProviderRevoked(session)) {
    return { allowed: false, reason: 'provider_revoked', deactivate: true };
  }
  return { allowed: true };
}

/**
 * Entry point both middlewares call after loading the session. Returns whether
 * the session may be refreshed, and triggers deactivation cleanup (cert +
 * session + notification revocation) when the identity provider revoked the user.
 */
export async function isRefreshAllowed(session: LoadedSession | null): Promise<boolean> {
  const verdict = await validateSessionForRefresh(session);
  if (verdict.allowed) return true;

  logger.warn(`[Refresh-Validate] Refresh denied: ${verdict.reason}`, {
    userId: session?.user?.id,
  });

  // A still-ACTIVE session denied here is the moment the user gets logged out,
  // and the server is the only side that sees it — the client just receives a
  // 401. This only writes to the activity log, never to the session row (no
  // cookie/JWT/session-state side effects, same as validateSessionForRefresh
  // above) — so a client that keeps retrying with the same stale refresh
  // token logs a LOGOUT on every such request, not just the first. Accepted
  // trade-off: logging without changing what this function already decides.
  // provider_revoked is recorded by the deactivation cleanup below instead.
  if (session && verdict.reason === 'refresh_token_expired') {
    userSessionService.trackLogout(session, 'TOKEN_EXPIRED');
  }

  if (verdict.deactivate && session?.user) {
    const { id: userId, email } = session.user;
    void accountDeactivationService
      .handleDeactivatedUser({ userId, email })
      .catch((err) => logger.error('[Refresh-Validate] Deactivation cleanup failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      }));
  }
  return false;
}
