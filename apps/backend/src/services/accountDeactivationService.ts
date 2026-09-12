import { UserSessionService } from '@/services/userSessionService';
import { fcmPushService } from '@/services/fcmService';
import { mtlsCertificateService } from '@/services/mtlsCertificateService';
import { repositories } from '@/database/repositories';
import { logger as baseLogger } from '@/utils/logger';

const logger = baseLogger.child({ module: 'AccountDeactivationService' });

interface DeactivatedUser {
  userId: string;
  email: string;
}

/**
 * Orchestrates cleanup when a user's account is found to be deactivated
 * (e.g. their identity provider revoked access).
 *
 * Every step is independent and best-effort: they run concurrently and a
 * failure in one is logged but never prevents the others, so we always tear
 * down as much access as possible.
 */
class AccountDeactivationService {
  private userSessionService = new UserSessionService();

  async handleDeactivatedUser({ userId, email }: DeactivatedUser): Promise<void> {
    logger.warn('[Deactivation] Cleaning up deactivated user', { userId, email });

    const steps: Array<{ name: string; run: () => Promise<unknown> }> = [
      // Revoke any mTLS certificates issued to the user (s2s call).
      { name: 'revokeCertificates', run: () => mtlsCertificateService.revokeUserCertificates(email) },
      // Revoke every session so the user cannot refresh into a new token.
      { name: 'revokeSessions', run: () => this.userSessionService.revokeAllUserSessions(userId) },
      // Stop notifications: clear mobile push tokens and browser subscriptions.
      { name: 'unregisterPushTokens', run: () => fcmPushService.unregisterUserTokens(userId) },
      { name: 'deactivateBrowserSubscriptions', run: () => repositories.browserNotificationSubscriptions.deactivateByUserId(userId) },
    ];

    const results = await Promise.allSettled(steps.map((step) => step.run()));

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(`[Deactivation] Step failed: ${steps[index].name}`, {
          userId,
          email,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    logger.info('[Deactivation] Cleanup complete', { userId, email });
  }
}

export const accountDeactivationService = new AccountDeactivationService();
