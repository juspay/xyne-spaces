import type { ScheduleCallParticipants, ScheduleCallUser } from '../hooks/useScheduleCallForm';

export type Recipients =
  { channelId: string; targetUserIds?: string[] } | { targetUserIds: string[] };

/**
 * A channel call goes to the channel, minus any members left out (then the remaining ids ride along
 * as a subset). Individual calls go as user ids only.
 */
export const toRecipients = (
  { users, channel }: ScheduleCallParticipants,
  members: ScheduleCallUser[] | null,
  hadExclusions = false,
): Recipients => {
  if (!channel) return { targetUserIds: users.map(u => u.id) };
  const excluded = new Set(channel.excludedUserIds);
  // The form blocks submit while exclusions exist but members are not loaded, so `!members` here
  // only means "nothing was left out".
  if ((excluded.size === 0 && !hadExclusions) || !members) return { channelId: channel.id };
  return {
    channelId: channel.id,
    targetUserIds: members.filter(m => !excluded.has(m.id)).map(m => m.id),
  };
};
