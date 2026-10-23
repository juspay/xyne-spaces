/** Build a Prisma filter matching rows owned by one id or any of several
 *  aliases (canonical Claw id + workspace-scoped Spaces id). */
export const userIdFilter = (userIds: string | string[]) =>
  Array.isArray(userIds) ? { userId: { in: userIds } } : { userId: userIds };

/** Same alias rule for tables whose owning column is `ownerUserId` rather than
 *  `userId` (ChatProject). Kept here so both spellings stay in one place. */
export const ownerUserIdFilter = (userIds: string | string[]) =>
  Array.isArray(userIds) ? { ownerUserId: { in: userIds } } : { ownerUserId: userIds };
