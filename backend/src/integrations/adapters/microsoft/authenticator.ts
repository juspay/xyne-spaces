/**
 * Microsoft Graph webhook authenticator
 * Validates the clientState token sent by Graph in webhook notifications
 */

import { BaseAuthenticator } from '../../core/baseAuthenticator';
import { AuthResult } from '../../core/types';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export class MicrosoftAuthenticator extends BaseAuthenticator {
  /**
   * Authenticate Microsoft Graph webhook notification.
   * Validates clientState if stored in credentials.
   * When the temporary backfill flag is enabled and credentials do not yet
   * have a clientState, the request is accepted and the observed Graph
   * clientState is returned in metadata so the caller can persist it.
   */
  async authenticate(
    rawBody: string,
    _headers: Record<string, string | string[]>,
    credentialsJson: string,
    _sourceName: string
  ): Promise<AuthResult> {
    try {
      // Parse the notification body to extract clientState.
      let body: { value?: Array<{ clientState?: string }> };
      try {
        body = JSON.parse(rawBody);
      } catch {
        logger.warn('Microsoft webhook body is not valid JSON');
        return { authenticated: false };
      }

      const notifications = Array.isArray(body.value) ? body.value : null;
      if (!notifications) {
        logger.warn('Microsoft webhook notification batch missing value array');
        return { authenticated: false };
      }

      const incomingClientStates = notifications
        .map(notification => notification?.clientState)
        .filter((clientState): clientState is string => typeof clientState === 'string' && clientState.length > 0);
      const uniqueIncomingClientStates = Array.from(new Set(incomingClientStates));
      if (uniqueIncomingClientStates.length > 1) {
        logger.warn('Microsoft webhook notification batch contained multiple clientState values');
        return { authenticated: false };
      }

      const incomingClientState = uniqueIncomingClientStates[0];

      if (credentialsJson) {
        try {
          const credentials = JSON.parse(credentialsJson);

          // Stored clientState exists: validate against the incoming batch.
          if (credentials.clientState) {
            const allClientStatesMatch = notifications.every(
              notification => notification?.clientState === credentials.clientState
            );
            if (!allClientStatesMatch) {
              logger.warn('Microsoft webhook clientState mismatch in notification batch');
              return { authenticated: false };
            }

            return { authenticated: true };
          }

          // Temporary compatibility path for legacy rows created before we
          // persisted Microsoft Graph clientState in credentials.
          if (incomingClientState && config.microsoftGraph.clientStateBackfillEnabled) {
            return {
              authenticated: true,
              metadata: { clientState: incomingClientState },
            };
          }

          logger.warn('Microsoft webhook clientState missing from credentials');
          return { authenticated: false };
        } catch {
          // If credentials can't be parsed, fail closed.
          return { authenticated: false };
        }
      }

      return { authenticated: true };
    } catch (error) {
      logger.error('Microsoft authentication error:', error);
      return { authenticated: false };
    }
  }
}
