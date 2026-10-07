import { mtlsCertificateService } from '@/services/mtlsCertificateService';
import { revokeAccountSessions } from '@/bypassAcl/authSessionServices';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { UserStatus } from '@xyne/shared';
import { userActivationService } from '@/services/userActivationService';

interface DeactivatedUser {
  userId: string;
  email: string;
  /** `org_members.memberId` — the session principal. Looked up by email when not supplied. */
  orgMemberId?: string | null;
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
      select: { id: true, email: true, workspaceId: true, orgMemberId: true },
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
      const result = await this.handleDeactivatedUser({
        userId: user.id,
        email: user.email,
        orgMemberId: user.orgMemberId,
      });
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

  async handleDeactivatedUser({ userId, email, orgMemberId }: DeactivatedUser): Promise<UserDeactivationResult> {
    logger.warn('[Deactivation] Cleaning up deactivated user', { userId });

    const steps: Array<{ name: string; run: () => Promise<unknown> }> = [
      // Revoke any mTLS certificates issued to the user (s2s call).
      { name: 'revokeCertificates', run: () => mtlsCertificateService.revokeUserCertificates(email) },
      // Revoke every device session of the account (auth_sessions + unconverted legacy rows), so
      // no cookie or `sid`-bound token survives. Push tokens live on those rows and REVOKED rows
      // are excluded from delivery, so there is no separate push unregister step.
      { name: 'revokeSessions', run: () => this.revokeSessions({ userId, email, orgMemberId }) },
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

  private async revokeSessions({ userId, email, orgMemberId }: DeactivatedUser): Promise<number> {
    let accountId = orgMemberId ?? null;
    if (!accountId) {
      const orgMember = await db.orgMember.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { memberId: true },
      });
      accountId = orgMember?.memberId ?? null;
    }
    if (!accountId) {
      throw new Error(`No organization membership found for deactivated user ${userId}`);
    }
    return revokeAccountSessions(accountId, 'PROVIDER_REVOKED');
  }
}

export const accountDeactivationService = new AccountDeactivationService();
