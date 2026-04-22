/**
 * Microsoft Graph webhook authenticator
 * Validates the clientState token sent by Graph in webhook notifications
 */

import { BaseAuthenticator } from '../../core/baseAuthenticator';
import { AuthResult } from '../../core/types';
import { logger } from '@/utils/logger';

export class MicrosoftAuthenticator extends BaseAuthenticator {
  /**
   * Authenticate Microsoft Graph webhook notification.
   * Validates clientState if stored in credentials, otherwise trusts the request
   * since the webhook URL itself acts as a shared secret.
   */
  async authenticate(
    rawBody: string,
    _headers: Record<string, string | string[]>,
    credentialsJson: string,
    _sourceName: string
  ): Promise<AuthResult> {
    try {
      // Parse the notification body to extract clientState
      let body: { value?: Array<{ clientState?: string }> };
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { authenticated: true }; // Non-JSON body, let flow handle it
      }

      // If credentials contain a clientState, validate it
      if (credentialsJson) {
        try {
          const credentials = JSON.parse(credentialsJson);
          if (credentials.clientState && body.value?.[0]?.clientState) {
            if (credentials.clientState !== body.value[0].clientState) {
              logger.warn('Microsoft webhook clientState mismatch');
              return { authenticated: false };
            }
          }
        } catch {
          // If credentials can't be parsed, proceed without clientState validation
        }
      }

      return { authenticated: true };
    } catch (error) {
      logger.error('Microsoft authentication error:', error);
      return { authenticated: false };
    }
  }
}
