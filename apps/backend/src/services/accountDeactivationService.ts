import { UserSessionService } from '@/services/userSessionService';
import { fcmPushService } from '@/services/fcmService';
import { mtlsCertificateService } from '@/services/mtlsCertificateService';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { UserStatus } from '@xyne/shared';
import { userActivationService } from '@/services/userActivationService';

interface DeactivatedUser {
  userId: string;
  email: string;
}

export interface DeactivationStepResult {
  name: string;
  ok: boolean;
}

export interface UserDeactivationResult {
  userId: string;
  email: string;
  /** False when any step failed, i.e. some access may still be live. */
  ok: boolean;
  steps: DeactivationStepResult[];
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

  /**
   * Resolve every user row owning `email` and clean each one up.
   *
   * A user row is unique per (email, workspace), so one email can own a row in
   * several workspaces: a provider revoking the identity revokes all of them.
   * Returns one result per row, empty when no user has that email.
   */
  async handleDeactivatedEmail(email: string): Promise<UserDeactivationResult[]> {
    const users = await db.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, email: true, workspaceId: true },
    });

    // Mark every row INACTIVE through the same function the user-management
    // deactivation uses, so this endpoint leaves a user in exactly the state an
    // admin deactivation does: status + leftAt, user group / assignment /
    // expertise rows torn down, open tickets handed off. Revoking certificates
    // and sessions alone would leave the account looking live and still in the
    // auto-assignment candidate pool. bulkUpdateUserStatus is workspace-scoped,
    // hence one call per workspace.
    const usersByWorkspace = new Map<string, string[]>();
    for (const user of users) {
      const userIds = usersByWorkspace.get(user.workspaceId) ?? [];
      userIds.push(user.id);
      usersByWorkspace.set(user.workspaceId, userIds);
    }

    const markedInactive = new Set<string>();
    for (const [workspaceId, userIds] of usersByWorkspace) {
      const { successful, failed } = await userActivationService.bulkUpdateUserStatus(
        userIds,
        UserStatus.INACTIVE,
        workspaceId,
      );
      successful.forEach((userId) => markedInactive.add(userId));
      failed.forEach(({ userId, error }) =>
        logger.error('[Deactivation] Marking user INACTIVE failed', { userId, error }));
    }

    const results: UserDeactivationResult[] = [];
    for (const user of users) {
      const result = await this.handleDeactivatedUser({ userId: user.id, email: user.email });
      // Reported as a step like the others, so a failed row write shows up in the
      // response (and the 207) instead of being hidden behind revoked sessions.
      const markInactive: DeactivationStepResult = {
        name: 'markInactive',
        ok: markedInactive.has(user.id),
      };
      results.push({
        ...result,
        ok: result.ok && markInactive.ok,
        steps: [markInactive, ...result.steps],
      });
    }
    return results;
  }

  async handleDeactivatedUser({ userId, email }: DeactivatedUser): Promise<UserDeactivationResult> {
    logger.warn('[Deactivation] Cleaning up deactivated user', { userId });

    const steps: Array<{ name: string; run: () => Promise<unknown> }> = [
      // Revoke any mTLS certificates issued to the user (s2s call).
      { name: 'revokeCertificates', run: () => mtlsCertificateService.revokeUserCertificates(email) },
      // Revoke every session so the user cannot refresh into a new token.
      { name: 'revokeSessions', run: () => this.userSessionService.revokeAllUserSessions(userId, 'PROVIDER_REVOKED') },
      // Stop notifications: clear mobile push tokens and browser subscriptions.
      { name: 'unregisterPushTokens', run: () => fcmPushService.unregisterUserTokens(userId) },
    ];

    const results = await Promise.allSettled(steps.map((step) => step.run()));

    const stepResults: DeactivationStepResult[] = results.map((result, index) => {
      if (result.status === 'rejected') {
        logger.error(`[Deactivation] Step failed: ${steps[index].name}`, {
          userId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
      return { name: steps[index].name, ok: result.status === 'fulfilled' };
    });

    const ok = stepResults.every((step) => step.ok);
    logger.info('[Deactivation] Cleanup complete', { userId, ok });

    // Steps stay best-effort — this never throws — but the outcome is reported
    // so a caller that can retry (the internal endpoint) knows to.
    return { userId, email, ok, steps: stepResults };
  }
}

export const accountDeactivationService = new AccountDeactivationService();
