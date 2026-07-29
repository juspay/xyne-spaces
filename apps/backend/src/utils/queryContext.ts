import { db } from '@/database/client';
import type { QueryContext } from '@/zero/acl/core/types';

/**
 * Builds a full QueryContext from a user id by reading the user row and the
 * matching orgMember (joined on email, which is globally unique).
 *
 * For S2S / system callers (bots, scheduled jobs, app-internal ingest) that
 * don't have an authenticated `req.user` on hand but still need to invoke ACL
 * checks or side-effect handlers that expect a full context.
 */
export async function buildUserQueryContext(userId: string): Promise<QueryContext> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, workspaceId: true, role: true },
  });
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }
  if (!user.workspaceId) {
    throw new Error(`User ${userId} has no workspace assigned`);
  }
  const orgMember = await db.orgMember.findUnique({
    where: { email: user.email },
  });
  if (!orgMember) {
    throw new Error(`User ${userId} is not a member of any organization`);
  }
  return {
    userID: user.id,
    workspaceId: user.workspaceId,
    role: user.role,
    orgRole: orgMember.role,
    memberId: orgMember.memberId,
  };
}
