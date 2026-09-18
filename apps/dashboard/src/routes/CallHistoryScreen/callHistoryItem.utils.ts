import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { formatDuration } from '../../utils/dateUtils';
import {
  CallOrigin,
  CallStatus,
  CallType,
  CallVisibility,
  ChannelScopeType,
  InvitationResponse,
  MeetingStatus,
  type User,
} from '@xyne/shared';
import { hasJoinedExternalParticipant as hasJoinedExternalCallParticipant } from '../../components/Call/callParticipant.utils';
import type { DisplaySearchResult } from '../../types/search';

export type RecentCallFilter = 'all' | 'incoming' | 'outgoing' | 'active' | 'missed';

export const FILTER_LABELS: Record<RecentCallFilter, string> = {
  all: 'All Calls',
  incoming: 'Incoming Calls',
  outgoing: 'Outgoing Calls',
  active: 'Active Calls',
  missed: 'Missed Calls',
};

/** Calls V2's Recents segmented-tab filter — its own value set, own labels (rendered inline). */
export type RecentCallFilterV2 = 'all' | 'missed' | 'recurring';

export type CallParticipant = QueryResultType<typeof queries.callParticipantsByCallId>[number];
export type CallParticipants = readonly CallParticipant[] | undefined;
export type Call = Omit<
  QueryResultType<typeof queries.userCallHistoryV2>[number],
  'participants'
> & {
  participants?: CallParticipants;
};

export function hasExternalChatAccess(call: Call): boolean {
  return (
    call.participants?.some(p => p.isExternal && p.response !== InvitationResponse.INVITED) ?? false
  );
}

export function isDmScope(scopeType: ChannelScopeType | string | null | undefined): boolean {
  return scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
}

export function isVisibleInCallList(
  call: Call,
  currentUserId: string | undefined,
  showChannelCalls: boolean,
): boolean {
  if (isExternalCalendarEvent(call)) return true;
  if (showChannelCalls) return true;
  return call.participants?.some(p => p.userId === currentUserId) ?? false;
}

export function stripSearchHighlight(value: string | undefined): string {
  return (value || '').replace(/<\/?hi>/g, '');
}

export function timestampOrUndefined(value: number | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}

export function isJoinedInvitationResponse(response: string): boolean {
  return (
    response === String(InvitationResponse.ACCEPTED) || response === String(InvitationResponse.LEFT)
  );
}

export function mapVespaCallResultToCall(result: DisplaySearchResult, workspaceId: string): Call {
  const context = result.searchContext;
  const callId = context?.callId || result.id;
  const startedAt =
    timestampOrUndefined(context?.startedAt) ||
    timestampOrUndefined(context?.startsAt) ||
    Date.now();
  const now = Date.now();
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

  return {
    workspaceId,
    id: callId,
    externalId: context?.externalId || callId,
    title: stripSearchHighlight(context?.title || result.title) || null,
    createdByUserId: context?.createdByUserId || '',
    organizerId: null,
    channelId: context?.channelId || null,
    orgName: null,
    description: null,
    callType: CallType.VIDEO,
    callOrigin: (context?.callOrigin as CallOrigin | undefined) ?? CallOrigin.CHANNEL,
    status: (context?.status as CallStatus | undefined) ?? CallStatus.ENDED,
    roomLink: context?.roomLink || null,
    startsAt: timestampOrUndefined(context?.startsAt) ?? null,
    endsAt: timestampOrUndefined(context?.endsAt) ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isRecurring: Boolean(context?.recurringSeriesId),
    recurringSeriesId: context?.recurringSeriesId || null,
    recurrenceRule: null,
    instanceDate: null,
    recordingEnabled: false,
    recordingUrl: null,
    recordingParticipants: '[]',
    transcript: context?.hasTranscript ? 'available' : undefined,
    aiSummary: null,
    startedAt,
    endedAt: timestampOrUndefined(context?.endedAt) ?? null,
    lastActivityAt: timestampOrUndefined(context?.endedAt) || startedAt,
    createdAt: startedAt,
    updatedAt: now,
    callUpdatesChannel: null,
    participantCount,
    metadata: null,
    participantPreviewUserIds: JSON.stringify(
      participantUserIds
        .map((userId, index) =>
          userId
            ? {
                userId,
                hasJoined: isJoinedInvitationResponse(participantResponses[index] || ''),
              }
            : null,
        )
        .filter((entry): entry is { userId: string; hasJoined: boolean } => entry !== null),
    ),
    summaryTemplateId: null,
    labels: [],
    markedItems: [],
    xyneManaged: false,
    visibility: CallVisibility.PRIVATE,
    participants: Array.from({ length: participantCount }, (_, index) => {
      const userId = participantUserIds[index] || '';
      const displayName = stripSearchHighlight(participantNames[index]);
      const email = stripSearchHighlight(participantEmails[index]);
      const isExternal = !userId;

      return {
        workspaceId,
        id: `${callId}:${userId || `external-${index}`}`,
        callId,
        userId,
        invitedBy: context?.createdByUserId || '',
        invitedAt: startedAt,
        response: (participantResponses[index] as InvitationResponse | undefined) || null,
        meetingStatus: MeetingStatus.PENDING,
        respondedAt: null,
        joinedAt: null,
        leftAt: null,
        metadata: null,
        displayName: displayName || null,
        email: email || null,
        isExternal,
      };
    }),
  } as Call;
}
export type CallParticipantPreviewEntry = {
  readonly userId: string;
  readonly hasJoined: boolean;
};
type CallParticipantPreviewInput =
  | string
  | readonly CallParticipantPreviewEntry[]
  | null
  | undefined;

function isCallParticipantPreviewEntries(
  value: unknown,
): value is readonly CallParticipantPreviewEntry[] {
  return Array.isArray(value);
}

function parseParticipantPreviewEntries(
  participantPreviewUserIds: CallParticipantPreviewInput,
): readonly CallParticipantPreviewEntry[] | null {
  if (typeof participantPreviewUserIds === 'string') {
    try {
      const parsed = JSON.parse(participantPreviewUserIds) as unknown;
      if (!isCallParticipantPreviewEntries(parsed)) return null;

      return parsed
        .map(normalizeParticipantPreviewEntry)
        .filter((entry): entry is CallParticipantPreviewEntry => entry !== null);
    } catch {
      return null;
    }
  }

  if (!isCallParticipantPreviewEntries(participantPreviewUserIds)) return null;

  return participantPreviewUserIds
    .map(normalizeParticipantPreviewEntry)
    .filter((entry): entry is CallParticipantPreviewEntry => entry !== null);
}

function normalizeParticipantPreviewEntry(value: unknown): CallParticipantPreviewEntry | null {
  if (value && typeof value === 'object' && 'userId' in value && typeof value.userId === 'string') {
    return {
      userId: value.userId,
      hasJoined: 'hasJoined' in value && value.hasJoined === true,
    };
  }

  return null;
}

export function isGoogleCalendarCall(
  call: { callOrigin?: string } | Record<string, unknown>,
): boolean {
  return (call as { callOrigin?: string }).callOrigin === CallOrigin.GOOGLE_CALENDAR;
}

export function isMicrosoftCalendarCall(
  call: { callOrigin?: string } | Record<string, unknown>,
): boolean {
  return (call as { callOrigin?: string }).callOrigin === CallOrigin.MICROSOFT_CALENDAR;
}

export function isExternalCalendarEvent(
  call: { callOrigin?: string } | Record<string, unknown>,
): boolean {
  return isGoogleCalendarCall(call) || isMicrosoftCalendarCall(call);
}

export function isExternalCalendarEventForUser(
  call:
    | { callOrigin?: string; createdByUserId?: string; externalId?: string }
    | Record<string, unknown>,
  userId: string | undefined,
): boolean {
  if (!isExternalCalendarEvent(call)) return false;
  if (!userId) return false;
  if ((call as { createdByUserId?: string }).createdByUserId === userId) return true;

  const externalId = (call as { externalId?: unknown }).externalId;
  if (typeof externalId !== 'string') return false;

  const providerPrefix = isGoogleCalendarCall(call) ? 'gcal' : 'mscal';
  return externalId.startsWith(`${providerPrefix}__${userId}__`);
}

/**
 * Determines if a call should be visible in the main call history lists
 * (All, Active, Missed tabs). External calendar events are excluded —
 * they should only appear in the Calendar view.
 */
export function shouldShowInCallLists(
  call: { callOrigin?: string } | Record<string, unknown>,
): boolean {
  return !isExternalCalendarEvent(call);
}

/**
 * Determines if a scheduled call should appear in the "Upcoming" list view.
 * Calendar events are only shown in the calendar grid, not in lists.
 */
export function shouldShowInScheduledList(
  call: { callOrigin?: string } | Record<string, unknown>,
): boolean {
  return !isExternalCalendarEvent(call);
}

export interface CallStatusInfo {
  isMissedCall: boolean;
  didNotAnswer: boolean;
}

// Get all participant user objects (excluding nulls)
export function getParticipantUsers(participants: CallParticipants, allUsers: User[]): User[] {
  const participantUserIds = (participants || []).map(p => p.userId);
  return allUsers.filter(u => participantUserIds.includes(u.id));
}

export function getParticipantDisplayData(
  participants: CallParticipants,
  allUsers: User[],
  currentUserId: string | undefined,
): { userIds: string[]; displayNames: string[] } {
  const otherParticipants = getOtherParticipants(participants, currentUserId);
  const usersById = new Map(allUsers.map(user => [user.id, user]));

  const userIds: string[] = [];
  const displayNames = otherParticipants.map(participant => {
    if (participant.isExternal) {
      return participant.displayName || participant.email || 'Guest';
    }

    userIds.push(participant.userId);
    const user = usersById.get(participant.userId);
    return user?.name || user?.email || 'Unknown';
  });

  return { userIds, displayNames };
}

// "Prerna, Samit & 2 others" — untitled-call title fallback, shared by CallCard.tsx
// (Recents) and UpcomingCallRowV2.tsx (Upcoming) so both format it identically.
export function buildParticipantSummary(
  displayNames: string[],
  otherParticipantCount: number,
): string {
  const [firstParticipantName, secondParticipantName] = displayNames;
  if (!firstParticipantName || otherParticipantCount <= 1) {
    return firstParticipantName || 'Unknown';
  }
  if (otherParticipantCount === 2) {
    return `${firstParticipantName}, ${secondParticipantName}`;
  }
  return `${firstParticipantName}, ${secondParticipantName} & ${otherParticipantCount - 2} other${
    otherParticipantCount - 2 > 1 ? 's' : ''
  }`;
}

export function formatParticipantNames(displayNames: string[]): string {
  return displayNames.length === 0
    ? 'Just you'
    : buildParticipantSummary(displayNames, displayNames.length);
}

export function getCallParticipantCount(call: {
  status?: CallStatus | string | null | undefined;
  participantCount?: number | null | undefined;
  participants?: readonly unknown[] | null | undefined;
}): number {
  if (call.status === CallStatus.ACTIVE) {
    return call.participants?.length ?? call.participantCount ?? 0;
  }

  return call.participantCount ?? call.participants?.length ?? 0;
}

export function getPreviewParticipantUserIds(
  participantPreviewUserIds: CallParticipantPreviewInput,
  currentUserId: string | undefined,
): string[] {
  const previewEntries = parseParticipantPreviewEntries(participantPreviewUserIds);
  const previewUserIds = previewEntries ? previewEntries.map(entry => entry.userId) : [];
  const displayUserIds = previewUserIds.filter(userId => userId !== currentUserId);

  return displayUserIds;
}

/**
 * Preview entries with their `hasJoined` flag intact — the id-only variant above
 * drops it, but the roster needs per-user join state for participants that only
 * exist in the preview payload.
 */
export function getPreviewParticipantEntries(
  participantPreviewUserIds: CallParticipantPreviewInput,
  currentUserId: string | undefined,
): CallParticipantPreviewEntry[] {
  const previewEntries = parseParticipantPreviewEntries(participantPreviewUserIds) ?? [];
  return previewEntries.filter(entry => entry.userId !== currentUserId);
}

export function getPreviewParticipantUsers(
  participantPreviewUserIds: CallParticipantPreviewInput,
  allUsers: User[],
  currentUserId: string | undefined,
): User[] {
  const previewUserIds = getPreviewParticipantUserIds(participantPreviewUserIds, currentUserId);
  const usersById = new Map(allUsers.map(user => [user.id, user]));
  return previewUserIds
    .map(userId => usersById.get(userId))
    .filter((user): user is User => Boolean(user));
}

export function hasPreviewParticipantJoined(
  participantPreviewUserIds: CallParticipantPreviewInput,
  currentUserId: string | undefined,
): boolean {
  const previewEntries = parseParticipantPreviewEntries(participantPreviewUserIds);
  if (previewEntries) {
    return previewEntries.some(entry => entry.userId !== currentUserId && entry.hasJoined);
  }

  return false;
}

// Check if any participant joined the call
export function hasAnyoneJoined(participants: CallParticipants): boolean {
  return (participants || []).some(
    p => p.response === InvitationResponse.ACCEPTED || p.response === InvitationResponse.LEFT,
  );
}

export function hasJoinedExternalParticipant(participants: CallParticipants): boolean {
  return hasJoinedExternalCallParticipant(participants);
}

// Get other participants (excluding current user)
export function getOtherParticipants(
  participants: CallParticipants,
  currentUserId: string | undefined,
): CallParticipant[] {
  return participants?.filter(p => p.userId !== currentUserId) || [];
}

// Determine call status based on call type and participants
export function getCallStatus(
  call: Call,
  isOutgoingCall: boolean,
  hasCurrentUserJoined: boolean,
  userJoinedandLeft: boolean,
  anyoneJoined: boolean,
): CallStatusInfo {
  const isCallEnded = call.status === CallStatus.ENDED;
  const hasCurrentUserParticipated = hasCurrentUserJoined || userJoinedandLeft;

  if (isOutgoingCall) {
    // Outgoing call: "No answer" if ended and no one joined
    return {
      isMissedCall: false,
      didNotAnswer: isCallEnded && !anyoneJoined,
    };
  }

  // Incoming call: "Missed" if ended and current user didn't participate
  return {
    isMissedCall: isCallEnded && !hasCurrentUserParticipated,
    didNotAnswer: false,
  };
}

export function isMissedCallForUser(call: Call, userId: string | undefined): boolean {
  if (!userId) return false;
  if (call.status === CallStatus.SCHEDULED || call.status === CallStatus.ACTIVE) {
    return false;
  }

  const isOutgoingCall = call.createdByUserId === userId;
  const currentUserParticipant = call.participants?.find(p => p.userId === userId);
  if (!currentUserParticipant) {
    return false;
  }

  const hasCurrentUserJoined = currentUserParticipant.response === InvitationResponse.ACCEPTED;
  const userJoinedandLeft = currentUserParticipant.response === InvitationResponse.LEFT;
  const otherParticipants = call.participants?.filter(p => p.userId !== userId);
  const anyoneJoined =
    hasPreviewParticipantJoined(call.participantPreviewUserIds, userId) ||
    hasAnyoneJoined(otherParticipants);

  return getCallStatus(call, isOutgoingCall, hasCurrentUserJoined, userJoinedandLeft, anyoneJoined)
    .isMissedCall;
}

// Get status text based on call state
export function getStatusText(
  isMissedCall: boolean,
  didNotAnswer: boolean,
  isActive: boolean,
  duration: number,
): string {
  if (isMissedCall) return 'Missed call invite';
  if (didNotAnswer) return 'No answer';
  if (isActive) return 'Active';
  return formatDuration(duration);
}

// Get call title from participant names
export function getCallTitleFromParticipants(
  participants: CallParticipants,
  allUsers: User[],
  currentUserId: string | undefined,
): string {
  const otherParticipants = getOtherParticipants(participants, currentUserId);
  if (otherParticipants.length === 0) return 'Unknown';

  const userMap = new Map(allUsers.map(u => [u.id, u]));
  const firstNames = otherParticipants.map(p => {
    if (p.isExternal) return `${p.displayName?.split(' ')[0] || 'Guest'} (External)`;
    const fullName = userMap.get(p.userId)?.name || 'Unknown';
    return fullName.split(' ')[0];
  });

  return firstNames.join(', ');
}

export function groupByDay(calls: Call[]): { date: Date; calls: Call[] }[] {
  const map = new Map<string, { date: Date; calls: Call[] }>();
  for (const call of calls) {
    if (!call.startsAt) continue;
    const d = new Date(call.startsAt);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    if (!map.has(key)) map.set(key, { date: d, calls: [] });
    map.get(key)!.calls.push(call);
  }
  return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function isScheduledCallJoinable(call: Call, now = Date.now()): boolean {
  if (call.status === CallStatus.ACTIVE || call.status === CallStatus.IN_PROGRESS) return true;
  if (call.status !== CallStatus.SCHEDULED || !call.startsAt) return false;

  return now >= new Date(call.startsAt).getTime();
}

export function hasCallEnded(call: Call): call is Call & { endedAt: NonNullable<Call['endedAt']> } {
  if (call.status === CallStatus.ACTIVE || call.status === CallStatus.IN_PROGRESS) return false;
  return Boolean(call.endedAt);
}

export function canJoinCall(call: Call): boolean {
  return (
    call.status === CallStatus.SCHEDULED ||
    call.status === CallStatus.ACTIVE ||
    call.status === CallStatus.IN_PROGRESS
  );
}

export function isScheduledCallManageable(call: Call, currentUserId: string | undefined): boolean {
  if (!currentUserId || call.status !== CallStatus.SCHEDULED) return false;

  const organizerUserId = call.organizerId ?? call.createdByUserId;
  return organizerUserId === currentUserId;
}

/**
 * A non-organizer participant may add people to a direct call — one whose channel is a
 * DM/GROUP_DM, or isn't visible to them at all (a large group call sits in the organizer's
 * self-DM, which no other participant belongs to). A channel-scoped call is visible only to
 * its members, so a channel you CAN see that isn't a DM means the invite list is the
 * channel's — organizer only. The API is what enforces this; this only shows the entry point.
 */
export function canEditScheduledCallParticipants(
  call: Call,
  currentUserId: string | undefined,
  visibleChannels: readonly { id: string; scopeType: ChannelScopeType }[],
): boolean {
  if (!currentUserId || call.status !== CallStatus.SCHEDULED || !call.channelId) return false;
  if (isScheduledCallManageable(call, currentUserId)) return false;
  if (visibleChannels.length === 0) return false;

  const channel = visibleChannels.find(c => c.id === call.channelId);
  return (
    !channel ||
    channel.scopeType === ChannelScopeType.DM ||
    channel.scopeType === ChannelScopeType.GROUP_DM
  );
}
