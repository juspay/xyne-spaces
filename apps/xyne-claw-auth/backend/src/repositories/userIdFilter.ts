/** Build a Prisma filter matching rows owned by one id or any of several
 *  aliases (canonical Claw id + workspace-scoped Spaces id). */
export const userIdFilter = (userIds: string | string[]) =>
  Array.isArray(userIds) ? { userId: { in: userIds } } : { userId: userIds };
