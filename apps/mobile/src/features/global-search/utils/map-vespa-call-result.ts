/**
 * Call search returns a flat hit, but the Calls tab renders the `CallLogItem` the call
 * history uses, which wants a whole call: participants, channel, duration, status
 * text, and titles without the `<hi>` tags Vespa wraps matches in.
 */

import { CallStatus, CallType, ChannelScopeType, InvitationResponse } from '@xyne/shared';

import { formatDuration, getStatusText } from '@/src/components/call-log/callHistoryItem.utils';
import type { CallDisplayData } from '@/src/types/calls';
import type { DisplaySearchResult, SearchContext } from '@/src/types/search';
import type { CallChannelLike, CallUserLike } from '@/src/utils/callDisplayData';
import { PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';
import { canonicalizePublicDeepLink } from '@/src/utils/publicDeepLink';

export type CallSearchResultItem = {
  call: CallDisplayData;
  /** Raw Vespa title — may include `<hi>` highlight tags. */
  highlightTitle?: string;
};

function stripSearchHighlight(value: string | undefined): string {
  return (value || '').replace(/<\/?hi>/gi, '');
}

function timestampOrUndefined(value: number | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}

function isJoinedInvitationResponse(response: string): boolean {
  return (
    response === String(InvitationResponse.ACCEPTED) || response === String(InvitationResponse.LEFT)
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatScheduledTimeDisplay(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((dateStart - todayStart) / 86400000);
  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 0) return `Today · ${timeStr}`;
  if (diffDays === 1) return `Tomorrow · ${timeStr}`;
  if (diffDays < 7)
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} · ${timeStr}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${timeStr}`;
}

/** Preserve transcript navigation fields used by CallLogItem. */
function buildCallMetadata(context: SearchContext | undefined): Record<string, unknown> | null {
  const conversationId = context?.conversationId;
  const systemMessageId = context?.systemMessageId ?? context?.messageId;
  if (!conversationId && !systemMessageId) return null;
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(systemMessageId ? { systemMessageId } : {}),
  };
}

function resolveCallId(result: DisplaySearchResult): string {
  return result.searchContext?.callId || result.id || '';
}

/**
 * Maps a Vespa call hit to {@link CallDisplayData} for the global-search Calls tab.
 * Ported from dashboard `mapVespaCallResultToCall`.
 */
export function mapVespaCallResultToCallDisplayData(
  result: DisplaySearchResult,
  currentUserId: string,
  allUsers: ReadonlyArray<CallUserLike>,
  channelsById: Map<string, CallChannelLike>,
): CallSearchResultItem {
  const context = result.searchContext;
  const callId = resolveCallId(result);
  const startedAt =
    timestampOrUndefined(context?.startedAt) ||
    timestampOrUndefined(context?.startsAt) ||
    Date.now();
  const participantResponses = context?.participantResponses || [];
  const participantUserIds = context?.userIds || [];
  const participantNames = context?.participantNames || [];
  const participantEmails = context?.participantEmails || [];
  const participantCount = Math.max(
    participantUserIds.length,
    participantResponses.length,
    participantNames.length,
    participantEmails.length,
  );

  const usersById = new Map(allUsers.map(user => [user.id, user]));
  const participants = Array.from({ length: participantCount }, (_, index) => {
    const userId = participantUserIds[index] || '';
    const response = (participantResponses[index] as InvitationResponse | undefined) || null;
    const responseStr = response ? String(response) : '';
    return {
      userId,
      response: responseStr,
      joinedAt: isJoinedInvitationResponse(responseStr) ? startedAt : null,
      leftAt: response === InvitationResponse.LEFT ? startedAt : null,
      sourceIndex: index,
    };
  });

  const channelId = context?.channelId || null;
  const channel = channelId ? (channelsById.get(channelId) ?? null) : null;
  const isChannelCall = channel?.scopeType === ChannelScopeType.DEFAULT;
  const channelVisibility = channel?.visibility ?? null;

  // Keep original parallel-array indexes while filtering out the current user.
  const otherParticipants = participants.filter(p => p.userId && p.userId !== currentUserId);
  const participantAvatars = otherParticipants
    .slice(0, 3)
    .map(participant => {
      const sourceIndex = participant.sourceIndex;
      const user = usersById.get(participant.userId);
      const rawName =
        stripSearchHighlight(participantNames[sourceIndex]) ||
        user?.name ||
        user?.email ||
        stripSearchHighlight(participantEmails[sourceIndex]) ||
        '?';
      return {
        id: participant.userId,
        name: rawName,
        picture: user?.picture || null,
      };
    })
    .filter(avatar => avatar.id);

  const status = (context?.status as CallStatus | undefined) ?? CallStatus.ENDED;
  const isActive = status === CallStatus.ACTIVE;
  const isScheduled = status === CallStatus.SCHEDULED;
  const isOutgoing = (context?.createdByUserId || '') === currentUserId;
  const currentUserParticipant = participants.find(p => p.userId === currentUserId);
  const hasJoined = currentUserParticipant?.response === String(InvitationResponse.ACCEPTED);
  const userJoinedAndLeft = currentUserParticipant?.response === String(InvitationResponse.LEFT);
  const isCallEnded = status === CallStatus.ENDED;
  const hasCurrentUserParticipated = hasJoined || userJoinedAndLeft;
  const anyoneJoined = otherParticipants.some(p => isJoinedInvitationResponse(p.response));

  let isMissed = false;
  let didNotAnswer = false;
  if (isOutgoing) {
    didNotAnswer = isCallEnded && !anyoneJoined;
  } else if (currentUserParticipant) {
    isMissed = isCallEnded && !hasCurrentUserParticipated;
  }

  const endedAt = timestampOrUndefined(context?.endedAt) ?? null;
  const startsAt = timestampOrUndefined(context?.startsAt) ?? null;
  const durationMs = startedAt && endedAt ? endedAt - startedAt : 0;
  const duration = durationMs > 0 ? formatDuration(durationMs) : null;
  const statusText = getStatusText(isMissed, didNotAnswer, isActive, durationMs, isScheduled);

  const timeStamp = startedAt ?? startsAt ?? Date.now();
  const timeAgo =
    isScheduled && startsAt && startsAt > Date.now()
      ? formatScheduledTimeDisplay(startsAt)
      : formatTimeAgo(timeStamp);

  const rawHighlightTitle = context?.title || result.title;
  const strippedTitle = stripSearchHighlight(rawHighlightTitle) || null;

  let displayTitle = strippedTitle || '';
  if (!displayTitle) {
    if (isChannelCall && channel?.name) {
      displayTitle = `# ${channel.name}`;
    } else if (participantAvatars.length === 0) {
      displayTitle = stripSearchHighlight(result.subtitle) || 'Call';
    } else if (participantAvatars.length === 1) {
      displayTitle = participantAvatars[0]!.name;
    } else {
      displayTitle = `${participantAvatars[0]!.name}, ${participantAvatars[1]?.name ?? 'Unknown'}`;
    }
  }

  const call: CallDisplayData = {
    id: callId,
    externalId: context?.externalId || callId,
    status,
    callType: (context?.callType as CallType | undefined) ?? CallType.VIDEO,
    channelId,
    createdByUserId: context?.createdByUserId || '',
    startedAt,
    endedAt,
    startsAt,
    endsAt: timestampOrUndefined(context?.endsAt) ?? null,
    title: strippedTitle,
    transcript: context?.hasTranscript ? 'available' : null,
    roomLink: context?.roomLink
      ? canonicalizePublicDeepLink(context.roomLink, PUBLIC_DEEP_LINK_ORIGIN)
      : null,
    recurringSeriesId: context?.recurringSeriesId || null,
    participants: participants.map(({ sourceIndex: _sourceIndex, ...participant }) => participant),
    metadata: buildCallMetadata(context),
    createdAt: startedAt,
    channel,
    isOutgoing,
    hasJoined,
    userJoinedAndLeft,
    isMissed,
    didNotAnswer,
    isActive,
    isScheduled,
    displayTitle,
    statusText,
    participantCount: Math.max(otherParticipants.length, participantAvatars.length),
    participantAvatars,
    duration,
    durationMs,
    timeAgo,
    isChannelCall: Boolean(isChannelCall),
    channelVisibility,
  };

  return {
    call,
    highlightTitle: rawHighlightTitle !== strippedTitle ? rawHighlightTitle : result.title,
  };
}

export function mapVespaCallResultsToDisplay(
  results: DisplaySearchResult[],
  currentUserId: string,
  allUsers: ReadonlyArray<CallUserLike>,
  channelsById: Map<string, CallChannelLike>,
): CallSearchResultItem[] {
  // Resolve canonical call id before filtering so hits that only carry `result.id`
  // (mapper fallback) are not dropped.
  return results
    .filter(result => Boolean(resolveCallId(result)))
    .map(result =>
      mapVespaCallResultToCallDisplayData(result, currentUserId, allUsers, channelsById),
    );
}
