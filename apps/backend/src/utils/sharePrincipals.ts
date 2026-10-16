import { db } from '@/database/client';

type SharePrincipal = {
  userId?: string | null;
  userGroupId?: string | null;
  channelId?: string | null;
};

/** The user ids a set of shares reaches: direct users plus every member of a shared group or channel. */
export async function expandSharePrincipals(shares: SharePrincipal[]): Promise<string[]> {
  const directUserIds = shares.map(s => s.userId).filter((id): id is string => Boolean(id));
  const channelIds = shares.map(s => s.channelId).filter((id): id is string => Boolean(id));
  const groupIds = shares.map(s => s.userGroupId).filter((id): id is string => Boolean(id));

  const [channelMembers, groupMembers] = await Promise.all([
    channelIds.length
      ? db.channelParticipant.findMany({ where: { channelId: { in: channelIds } }, select: { userId: true } })
      : Promise.resolve([] as { userId: string }[]),
    groupIds.length
      ? db.userGroupMapping.findMany({ where: { userGroupId: { in: groupIds } }, select: { userId: true } })
      : Promise.resolve([] as { userId: string }[]),
  ]);

  return Array.from(new Set([
    ...directUserIds,
    ...channelMembers.map(m => m.userId),
    ...groupMembers.map(m => m.userId),
  ].filter((id): id is string => Boolean(id))));
}
