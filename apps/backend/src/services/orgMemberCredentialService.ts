import { Prisma } from '@prisma/client';
import { db } from '@/database/client';

/**
 * Returns the stored password hash for a member from OrgMemberCredential, or null when none is set.
 */
export async function getPasswordHash(memberId: string): Promise<string | null> {
  const row = await db.orgMemberCredential.findUnique({
    where: { memberId },
    select: { passwordHash: true },
  });
  return row?.passwordHash ?? null;
}

export interface SetPasswordHashInput {
  memberId: string;
  orgId: string;
  passwordHash: string;
}

/**
 * Writes passwordHash to OrgMemberCredential (non_zero schema), the only store for it. The old
 * OrgMember.passwordHash column is no longer written or read.
 *
 * Goes through the normal ACL-wrapped client: callers keep the authorization they already had
 * (pre-auth flows run unscoped, change-password writes the caller's own row, the invite flow
 * runs under withWorkspaceScope).
 *
 * Pass `tx` when the caller already has an open interactive transaction; the write then joins
 * it.
 */
export async function setPasswordHash(
  input: SetPasswordHashInput,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? db;
  await client.orgMemberCredential.upsert({
    where: { memberId: input.memberId },
    create: {
      memberId: input.memberId,
      orgId: input.orgId,
      passwordHash: input.passwordHash,
    },
    update: { orgId: input.orgId, passwordHash: input.passwordHash },
  });
}
