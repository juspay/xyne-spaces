/**
 * Pure unread-count predicates shared by the dashboard hooks. The backend
 * endpoint (activityService.getWorkspaceActivityCounts) mirrors these rules as
 * Prisma where-clauses — see the parity tests in
 * packages/shared/test/unreadCountParity.test.mjs, which run the same golden
 * fixtures through this predicate and pin the server-side translations.
 */
import {
  BELL_EXCLUDED_ACTOR_ACTIONS,
  BELL_EXCLUDED_CLASSIFICATIONS,
  BELL_EXCLUDED_LEGACY_DIRECT_MESSAGE_ACTIONS,
  DM_SHELF_CHANNEL_SCOPES,
  DM_SHELF_MENTION_ACTOR_ACTIONS,
} from './bellCountRules.js';

/** Classification treated as present when an activity row has none. */
export const DEFAULT_CLASSIFICATION = 'PENDING';

/** Minimal activity-row shape the predicates need (Zero or Prisma rows). */
export interface CountableActivityRow {
  actorAction: string;
  actionSource: string;
  classification?: string | null;
  isRead?: boolean;
  channelId?: string | null;
  isThreadActivity?: boolean | null;
}

/**
 * Bell-shelf membership: an unread activity counts in the bell unless the
 * shared BELL_COUNT_RULES exclude it (added_v2/removed, missed_call, SKIP,
 * legacy direct_message) or its channel is closed for this user.
 *
 * `closedChannelIds` is the set of channels closed for the user doing the
 * counting (isClosed/isDeleted are per-user flags).
 */
export const isBellCountedActivity = (
  activity: CountableActivityRow,
  closedChannelIds: ReadonlySet<string>,
): boolean => {
  if ((BELL_EXCLUDED_ACTOR_ACTIONS as readonly string[]).includes(activity.actorAction)) {
    return false;
  }
  if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') {
    return false;
  }
  const classification = activity.classification ?? DEFAULT_CLASSIFICATION;
  if ((BELL_EXCLUDED_CLASSIFICATIONS as readonly string[]).includes(classification)) {
    return false;
  }
  if ((BELL_EXCLUDED_LEGACY_DIRECT_MESSAGE_ACTIONS as readonly string[]).includes(activity.actorAction)) {
    return false;
  }
  if (activity.channelId != null && closedChannelIds.has(activity.channelId)) {
    return false;
  }
  return true;
};

/**
 * The dm shelf's per-channel subtraction: unread top-level mention rows in
 * GROUP_DM channels (actorAction mentioned_user/group_mention,
 * actionSource 'message', isThreadActivity !== true) — the bell counts them
 * ("mention wins the bucket"), so the dm shelf must not.
 *
 * `dmChannelScopeTypes` is the set of DM/GROUP_DM scopeType values the caller
 * sees (visible DM channels; closed ones are already excluded upstream).
 * `isGroupDmChannel` reports whether a channelId belongs to a GROUP_DM (vs
 * plain DM) — subtraction applies to GROUP_DM only.
 */
export const countDmShelfMentionRows = <T extends CountableActivityRow>(
  activities: readonly T[],
  dmChannelIds: ReadonlySet<string>,
  isGroupDmChannel: (channelId: string) => boolean,
): Map<string, number> => {
  const mentionRowsByChannel = new Map<string, number>();
  for (const activity of activities) {
    const channelId = activity.channelId;
    if (channelId == null || !dmChannelIds.has(channelId)) continue;
    if (!isGroupDmChannel(channelId)) continue;
    if (activity.isThreadActivity === true) continue;
    if (!(DM_SHELF_MENTION_ACTOR_ACTIONS as readonly string[]).includes(activity.actorAction)) {
      continue;
    }
    if (activity.actionSource !== 'message') continue;
    mentionRowsByChannel.set(channelId, (mentionRowsByChannel.get(channelId) ?? 0) + 1);
  }
  return mentionRowsByChannel;
};

/** ScopeType values (DM / GROUP_DM) whose unreads belong to the dm shelf. */
export const isDmShelfScopeType = (scopeType: string): boolean =>
  (DM_SHELF_CHANNEL_SCOPES as readonly string[]).includes(scopeType);
