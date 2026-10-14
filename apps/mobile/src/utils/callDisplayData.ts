import type { QueryResultType } from '@rocicorp/zero';
import {
  CallStatus,
  CallType,
  ChannelScopeType,
  ChannelVisibility,
  InvitationResponse,
  MeetingStatus,
} from '@xyne/shared';
import { canonicalizePublicDeepLink } from './publicDeepLink';
import { PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';

import {
  formatDuration,
  getCallParticipantCount,
  getCallStatus,
  getOtherParticipants,
  getPreviewParticipantUserIds,
  getStatusText,
  hasAnyoneJoined,
  hasPreviewParticipantJoined,
  isExternalCalendarEvent,
} from '@/src/components/call-log/callHistoryItem.utils';
import type { CallDisplayData } from '@/src/types/calls';
import { queries } from '@/src/zero/queries';

export type RawCall = QueryResultType<typeof queries.userCallHistory>[number];
export type ScheduledRawCall = QueryResultType<typeof queries.userScheduledCalls>[number];
export type CallUserLike = {
  id: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
};
export type CallChannelLike = {
  id: string;
  name: string;
  visibility: ChannelVisibility;
  scopeType: ChannelScopeType;
};

const MAX_AVATARS = 3;

export const EMPTY_CALL_USERS: CallUserLike[] = [];
export const EMPTY_CALL_CHANNELS: CallChannelLike[] = [];

// WeakMap cache: same allUsers array reference → reuse the Map, no rebuild per call.
const _callUsersMapCache = new WeakMap<ReadonlyArray<CallUserLike>, Map<string, CallUserLike>>();
const _getCallUsersMap = (users: ReadonlyArray<CallUserLike>): Map<string, CallUserLike> => {
  let map = _callUsersMapCache.get(users);
  if (!map) {
    map = new Map(users.map(u => [u.id, u]));
    _callUsersMapCache.set(users, map);
  }
  return map;
};

export const hasCallDisplayRows = (cache: {
  recentCalls: ReadonlyArray<CallDisplayData>;
  scheduledCalls: ReadonlyArray<CallDisplayData>;
  activeCalls: ReadonlyArray<CallDisplayData>;
}): boolean =>
  cache.recentCalls.length > 0 || cache.scheduledCalls.length > 0 || cache.activeCalls.length > 0;

export function buildCallChannelsById(
  allChannels: ReadonlyArray<CallChannelLike>,
): Map<string, CallChannelLike> {
  const map = new Map<string, CallChannelLike>();
  for (const channel of allChannels) {
    map.set(channel.id, {
      id: channel.id,
      name: channel.name,
      visibility: channel.visibility as ChannelVisibility,
      scopeType: channel.scopeType as ChannelScopeType,
    });
  }
  return map;
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

export function toCallDisplayData(
  call: RawCall | ScheduledRawCall,
  currentUserId: string,
  allUsers: ReadonlyArray<CallUserLike>,
  channelsById: Map<string, CallChannelLike>,
): CallDisplayData {
  const channel = call.channelId ? (channelsById.get(call.channelId) ?? null) : null;
  const isChannelCall = channel?.scopeType === ChannelScopeType.DEFAULT;
  const channelVisibility = channel?.visibility ?? null;

  const otherParticipants = getOtherParticipants(call.participants, currentUserId);
  const usersById = _getCallUsersMap(allUsers);
  // History rows carry only the current user's participant row (participant-only query);
  // the others come from the denormalized preview, falling back to live rows (active,
  // scheduled and search results load every participant).
  const previewUserIds = getPreviewParticipantUserIds(
    (call as { participantPreviewUserIds?: unknown }).participantPreviewUserIds,
    currentUserId,
  );
  const otherUserIds =
    previewUserIds.length > 0 ? previewUserIds : otherParticipants.map(p => p.userId);
  const participantUsers = otherUserIds
    .map(userId => usersById.get(userId))
    .filter(Boolean)
    .slice(0, MAX_AVATARS);

  const participantAvatars = participantUsers.map(u => ({
    id: u!.id,
    name: u!.name || u!.email || '?',
    picture: u!.picture || null,
  }));

  const isOutgoing = call.createdByUserId === currentUserId;
  const currentUserParticipant = call.participants?.find(p => p.userId === currentUserId);
  const hasJoined = currentUserParticipant?.response === InvitationResponse.ACCEPTED;
  const userJoinedAndLeft = currentUserParticipant?.response === InvitationResponse.LEFT;
  const anyoneJoined =
    hasPreviewParticipantJoined(
      (call as { participantPreviewUserIds?: unknown }).participantPreviewUserIds,
      currentUserId,
    ) || hasAnyoneJoined(otherParticipants);
  const otherParticipantCount = Math.max(
    getCallParticipantCount(call) - (currentUserParticipant ? 1 : 0),
    otherUserIds.length,
  );
  const callStatusInfo = getCallStatus(
    call as RawCall,
    isOutgoing,
    hasJoined,
    userJoinedAndLeft,
    anyoneJoined,
  );

  const isActive = call.status === CallStatus.ACTIVE;
  const isScheduled = call.status === CallStatus.SCHEDULED;
  const isUserInvited = !!currentUserParticipant;
  const isMissed = isUserInvited ? callStatusInfo.isMissedCall : false;
  const didNotAnswer = callStatusInfo.didNotAnswer;

  const durationMs = call.startedAt && call.endedAt ? call.endedAt - call.startedAt : 0;
  const duration = durationMs > 0 ? formatDuration(durationMs) : null;
  const statusText = getStatusText(isMissed, didNotAnswer, isActive, durationMs, isScheduled);

  const timeStamp = call.startedAt ?? call.startsAt ?? call.createdAt;
  const timeAgo =
    isScheduled && call.startsAt && call.startsAt > Date.now()
      ? formatScheduledTimeDisplay(call.startsAt)
      : formatTimeAgo(timeStamp);

  let displayTitle = call.title || '';
  if (!displayTitle) {
    if (isChannelCall && channel?.name) {
      displayTitle = '# ' + channel.name;
    } else if (participantAvatars.length === 0) {
      displayTitle = 'Unknown';
    } else {
      const primary = participantAvatars[0]!.name;
      if (participantAvatars.length === 1) {
        displayTitle = primary;
      } else {
        const secondUserId = otherUserIds[1];
        const secondUser = secondUserId ? usersById.get(secondUserId) : undefined;
        const second = secondUser?.name || secondUser?.email || 'Unknown';
        const remaining = otherParticipantCount - 2;
        displayTitle =
          remaining > 0
            ? `${primary}, ${second} + ${remaining} ${remaining === 1 ? 'other' : 'others'}`
            : `${primary}, ${second}`;
      }
    }
  }

  const recurringSeriesId =
    ('recurringSeriesId' in call
      ? (call as unknown as { recurringSeriesId?: string }).recurringSeriesId
      : null) ?? null;

  return {
    id: call.id,
    externalId: call.externalId,
    status: call.status as CallStatus,
    callType: call.callType as CallType,
    channelId: call.channelId ?? null,
    createdByUserId: call.createdByUserId,
    startedAt: call.startedAt ?? null,
    endedAt: call.endedAt ?? null,
    startsAt: call.startsAt ?? null,
    endsAt: call.endsAt ?? null,
    title: call.title ?? null,
    transcript: call.transcript ?? null,
    roomLink: call.roomLink
      ? canonicalizePublicDeepLink(call.roomLink, PUBLIC_DEEP_LINK_ORIGIN)
      : null,
    recurringSeriesId,
    participants: call.participants as unknown as CallDisplayData['participants'],
    metadata: call.metadata as Record<string, unknown> | null,
    createdAt: call.createdAt,
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
    participantCount: otherParticipantCount,
    participantAvatars,
    duration,
    durationMs,
    timeAgo,
    isChannelCall,
    channelVisibility,
  };
}

export function getScheduledCallsForDisplay(
  allScheduledCalls: ReadonlyArray<ScheduledRawCall>,
  activeCalls: ReadonlyArray<RawCall>,
  currentUserId: string,
): ScheduledRawCall[] {
  const now = Date.now();
  const activeExternalIds = new Set(activeCalls.map(c => c.externalId));
  const activeSeriesIds = new Set(
    activeCalls
      .map(c => (c as unknown as { recurringSeriesId?: string }).recurringSeriesId)
      .filter((id): id is string => !!id),
  );

  const filtered = allScheduledCalls.filter(call => {
    if (isExternalCalendarEvent(call as Record<string, unknown>)) return false;
    if (call.status === CallStatus.ACTIVE) return false;
    if (activeExternalIds.has(call.externalId)) return false;
    const seriesId = (call as unknown as { recurringSeriesId?: string }).recurringSeriesId;
    if (seriesId && activeSeriesIds.has(seriesId)) return false;
    if (call.startsAt && new Date(call.startsAt).getTime() <= now) return false;
    if (!call.endsAt || new Date(call.endsAt).getTime() <= now) return false;

    const participant = call.participants?.find(p => p.userId === currentUserId);
    if (!participant || participant.meetingStatus === MeetingStatus.HIDDEN) {
      return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aTime = a.startsAt ? new Date(a.startsAt).getTime() : Infinity;
    const bTime = b.startsAt ? new Date(b.startsAt).getTime() : Infinity;
    return aTime - bTime;
  });

  const seenSeries = new Set<string>();
  return sorted.filter(call => {
    const seriesId = (call as unknown as { recurringSeriesId?: string }).recurringSeriesId;
    if (seriesId) {
      if (seenSeries.has(seriesId)) return false;
      seenSeries.add(seriesId);
    }
    return true;
  });
}

export function getRecentCallsForDisplay(
  rows: ReadonlyArray<RawCall>,
  allScheduledCalls: ReadonlyArray<ScheduledRawCall>,
  activeCalls: ReadonlyArray<RawCall>,
  currentUserId: string,
): RawCall[] {
  const now = Date.now();
  const activeCallExternalIds = new Set(activeCalls.map(c => c.externalId));
  const scheduledCallIds = new Set(allScheduledCalls.map(c => c.id));
  const activeScheduledCalls = allScheduledCalls.filter(
    call =>
      call.status === CallStatus.ACTIVE ||
      (call.startsAt && new Date(call.startsAt).getTime() <= now),
  );

  // Live active calls first: history rows exclude ACTIVE (participant-only query), and the
  // live row must win over any stale copy of the same call.
  const combined = [...activeCalls, ...rows, ...(activeScheduledCalls as unknown as RawCall[])];
  const seen = new Set<string>();
  const merged: RawCall[] = [];
  for (const call of combined) {
    if (seen.has(call.id)) continue;
    seen.add(call.id);
    if (call.status === CallStatus.ACTIVE) {
      if (scheduledCallIds.has(call.id)) continue;
      if (!activeCallExternalIds.has(call.externalId)) continue;
    }
    merged.push(call);
  }

  return merged
    .filter(call => call.participants?.some(p => p.userId === currentUserId))
    .filter(call => !isExternalCalendarEvent(call as unknown as Record<string, unknown>))
    .sort((a, b) => {
      const aTime = a.startedAt || a.startsAt || a.createdAt;
      const bTime = b.startedAt || b.startsAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
}

export function getCallDisplayCache(params: {
  recentRows: ReadonlyArray<RawCall>;
  scheduledRows: ReadonlyArray<ScheduledRawCall>;
  activeRows: ReadonlyArray<RawCall>;
  currentUserId: string;
  users: ReadonlyArray<CallUserLike>;
  channels: ReadonlyArray<CallChannelLike>;
}): {
  recentCalls: CallDisplayData[];
  scheduledCalls: CallDisplayData[];
  activeCalls: CallDisplayData[];
} {
  const channelsById = buildCallChannelsById(params.channels);
  const recentRows = getRecentCallsForDisplay(
    params.recentRows,
    params.scheduledRows,
    params.activeRows,
    params.currentUserId,
  );
  const scheduledRows = getScheduledCallsForDisplay(
    params.scheduledRows,
    params.activeRows,
    params.currentUserId,
  );

  return {
    recentCalls: recentRows.map(call =>
      toCallDisplayData(call, params.currentUserId, params.users, channelsById),
    ),
    scheduledCalls: scheduledRows.map(call =>
      toCallDisplayData(call, params.currentUserId, params.users, channelsById),
    ),
    activeCalls: params.activeRows.map(call =>
      toCallDisplayData(call, params.currentUserId, params.users, channelsById),
    ),
  };
}
