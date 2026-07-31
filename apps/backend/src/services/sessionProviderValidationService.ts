import axios from 'axios';
import { OAuth2Client, gaxios } from 'google-auth-library';
import type { AuthProvider } from '@prisma/client';
import { UserSessionService } from '@/services/userSessionService';

export interface ProviderSession {
  id: string;
  refreshToken: string | null;
  accessToken: string | null;
  user: { authProvider: AuthProvider };
}

export interface SessionProviderValidator {
  isValid(session: ProviderSession): Promise<boolean>;
}

/**
 * Revalidates sessions against their external identity provider. A provider
 * outage keeps an otherwise valid local session usable; explicit rejection
 * from the provider invalidates it. This matches authV2's existing policy.
 */
export class SessionProviderValidationService implements SessionProviderValidator {
  constructor(
    private readonly userSessions: Pick<
      UserSessionService,
      'updateSession'
    > = new UserSessionService()
  ) {}

  async isValid(session: ProviderSession): Promise<boolean> {
    const { user } = session;

    if (user.authProvider === 'GOOGLE' && session.refreshToken) {
      return this.validateGoogleSession(session.refreshToken);
    }

    if (user.authProvider === 'MICROSOFT' && session.accessToken) {
      return this.validateMicrosoftSession(session);
    }

    return true;
  }

  private async validateGoogleSession(refreshToken: string): Promise<boolean> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return false;

    try {
      const googleClient = new OAuth2Client(clientId, clientSecret);
      googleClient.setCredentials({ refresh_token: refreshToken });
      await googleClient.getAccessToken();
      return true;
    } catch (error) {
      const googleError = error as gaxios.GaxiosError;
      return googleError.response?.data?.error !== 'invalid_grant';
    }
  }

  private async validateMicrosoftSession(session: ProviderSession): Promise<boolean> {
    try {
      const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        validateStatus: () => true,
      });

      if (graphResponse.status === 200) return true;
      if (graphResponse.status !== 401) return false;

      return this.refreshMicrosoftAccessToken(session);
    } catch {
      return true;
    }
  }

  private async refreshMicrosoftAccessToken(session: ProviderSession): Promise<boolean> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret || !session.refreshToken) return false;

    const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
    const tokenResponse = await axios.post(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        scope: 'openid email profile User.Read',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
      }
    );

    if (tokenResponse.status !== 200 || typeof tokenResponse.data?.access_token !== 'string') {
      return false;
    }

    await this.userSessions.updateSession(session.id, {
      accessToken: tokenResponse.data.access_token,
    });
    return true;
  }
}
