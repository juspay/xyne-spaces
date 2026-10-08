import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { superpositionClient } from '@/services/superpositionClient';

/** Superposition flag: true reads the stored password hash from OrgMemberCredential, false from the old OrgMember column. */
const READ_FROM_CREDENTIAL_TABLE_FLAG = 'read_password_hash_from_credential_table';

async function shouldReadFromCredentialTable(): Promise<boolean> {
  try {
    return await superpositionClient.getBooleanValue(READ_FROM_CREDENTIAL_TABLE_FLAG, false, {});
  } catch (error) {
    logger.error(`[OrgMemberCredential] Failed to read ${READ_FROM_CREDENTIAL_TABLE_FLAG}, defaulting to OrgMember column:`, error);
    return false;
  }
}

/**
 * Returns the stored password hash for a member, or null when none is set.
 * Source is chosen by the superposition flag: new table when true, the old OrgMember column when false.
 */
export async function getPasswordHash(memberId: string): Promise<string | null> {
  if (await shouldReadFromCredentialTable()) {
    const row = await db.orgMemberCredential.findUnique({
      where: { memberId },
      select: { passwordHash: true },
    });
    return row?.passwordHash ?? null;
  }
  const member = await db.orgMember.findUnique({
    where: { memberId },
    select: { passwordHash: true },
  });
  return member?.passwordHash ?? null;
}

export interface SetPasswordHashInput {
  memberId: string;
  orgId: string;
  passwordHash: string;
}

/**
 * Writes passwordHash to BOTH OrgMember (old column, kept until reads are switched over and it
 * is dropped — see [ticket/doc]) and OrgMemberCredential (new table, non_zero schema) so the
 * two commit together or not at all.
 *
 * Goes through the normal ACL-wrapped client: callers keep the authorization they already had
 * (pre-auth flows run unscoped, change-password writes the caller's own row, the invite flow
 * runs under withWorkspaceScope).
 *
 * Pass `tx` when the caller already has an open interactive transaction; the writes then join
 * it instead of starting another.
 */
export async function setPasswordHash(
  input: SetPasswordHashInput,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? db;
  const updateOrgMember = client.orgMember.update({
    where: { memberId: input.memberId },
    data: { passwordHash: input.passwordHash },
  });
  const upsertCredential = client.orgMemberCredential.upsert({
    where: { memberId: input.memberId },
    create: {
      memberId: input.memberId,
      orgId: input.orgId,
      passwordHash: input.passwordHash,
    },
    update: { passwordHash: input.passwordHash },
  });

  if (tx) {
    await updateOrgMember;
    await upsertCredential;
    return;
  }
  await db.$transaction([updateOrgMember, upsertCredential]);
}
