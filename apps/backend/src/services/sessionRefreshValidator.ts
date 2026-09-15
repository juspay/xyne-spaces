import { OAuth2Client, gaxios } from 'google-auth-library';
import axios from 'axios';
import { AuthProvider } from '@xyne/shared';
import { logger as baseLogger } from '../utils/logger';
import { UserSessionService } from '../services/userSessionService';
import { accountDeactivationService } from '../services/accountDeactivationService';

const logger = baseLogger.child({ module: 'SessionRefreshValidator' });
const userSessionService = new UserSessionService();

// The session shape both middlewares load via userSessionService.getSessionById
// (UserSession joined with its user + orgMember).
type LoadedSession = NonNullable<Awaited<ReturnType<UserSessionService['getSessionById']>>>;

export type RefreshVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; deactivate: boolean };

// Errors that mean the token/account is permanently invalid — matches the
// PERMANENT_AUTH_ERROR convention used across the Gmail/Calendar workers.
const PERMANENT_GOOGLE_ERRORS = ['invalid_grant', 'unauthorized_client', 'invalid_token'];

/**
 * Verify a Google refresh token against Google.
 *
 * A fresh OAuth2Client is used per attempt; a shared client whose credentials
 * are mutated per request can surface a spurious `unauthorized_client` under
 * concurrency, so on that error we recreate the client and retry once — a real
 * revocation then surfaces as `invalid_grant`. Returns true only when Google
 * definitively rejects the token (account revoked/deactivated). Transient/system
 * errors return false so the local session is allowed to continue.
 */
async function isGoogleRefreshTokenRevoked(
  refreshToken: string,
  user: { id: string; email: string },
): Promise<boolean> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const attempt = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const client = new OAuth2Client(clientId, clientSecret);
      client.setCredentials({ refresh_token: refreshToken });
      // If the user has been deleted or suspended in Google, this throws.
      await client.getAccessToken();
      return { ok: true };
    } catch (err) {
      const googleError = err as gaxios.GaxiosError;
      return { ok: false, error: googleError.response?.data?.error ?? googleError.message };
    }
  };

  let result = await attempt();
  if (result.ok) {
    logger.info(`[Refresh-Validate] Google verification successful for ${user.email}`, { userId: user.id });
    return false;
  }

  if (result.error === 'unauthorized_client') {
    logger.info(`[Refresh-Validate] Google returned unauthorized_client for ${user.email}; recreating client and retrying`, { userId: user.id });
    result = await attempt();
    if (result.ok) {
      logger.info(`[Refresh-Validate] Google verification successful on retry for ${user.email}`, { userId: user.id });
      return false;
    }
  }

  if (result.error && PERMANENT_GOOGLE_ERRORS.includes(result.error)) {
    logger.warn(`[Refresh-Validate] Google rejected token (${result.error}) for ${user.email} — account revoked/deactivated`, {
      userId: user.id,
      googleError: result.error,
    });
    return true;
  }

  logger.warn(`[Refresh-Validate] Google verification transient error for ${user.email}; allowing session. Error: ${result.error}`, { userId: user.id });
  return false;
}

/**
 * Verify a Microsoft user is still valid in Azure AD via Microsoft Graph, with a
 * token refresh on 401. Returns true only when Azure AD definitively rejects the
 * user (disabled/deleted). Transient/network errors return false.
 */
async function isMicrosoftUserRevoked(session: LoadedSession): Promise<boolean> {
  const user = session.user;

  if (!session.accessToken) {
    logger.info(`[Refresh-Validate] No access token for Microsoft user ${user.email}; skipping Graph check`);
    return false;
  }

  try {
    const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      validateStatus: () => true, // Don't throw on non-2xx
    });

    if (graphResponse.status === 200) {
      logger.info(`[Refresh-Validate] Microsoft Graph verification successful for ${user.email}`);
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
        },
      );

      if (tokenResponse.status === 200) {
        const tokenData = tokenResponse.data as { access_token: string };
        await userSessionService.updateSession(session.id, { accessToken: tokenData.access_token });
        logger.info(`[Refresh-Validate] Microsoft token refreshed for ${user.email}`);
        return false;
      }

      logger.warn(`[Refresh-Validate] Microsoft token refresh failed for ${user.email}; user may be disabled in Azure AD`);
      return true;
    }

    // 403 or other — user likely disabled/deleted in Azure AD.
    logger.warn(`[Refresh-Validate] Microsoft Graph returned ${graphResponse.status} for ${user.email}; user may be disabled in Azure AD`);
    return true;
  } catch (err) {
    logger.warn(`[Refresh-Validate] Microsoft Graph verification transient error for ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
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
    return isGoogleRefreshTokenRevoked(session.refreshToken, {
      id: session.user.id,
      email: session.user.email,
    });
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
    email: session?.user?.email,
  });

  if (verdict.deactivate && session?.user) {
    await accountDeactivationService.handleDeactivatedUser({
      userId: session.user.id,
      email: session.user.email,
    });
  }
  return false;
}
