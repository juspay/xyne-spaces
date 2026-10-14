import type { CallStatus, CallType, ChannelScopeType, ChannelVisibility } from '@xyne/shared';

export interface CallDisplayData {
  id: string;
  externalId: string;
  status: CallStatus;
  callType: CallType;
  channelId: string | null;
  createdByUserId: string;
  startedAt: number | null;
  endedAt: number | null;
  startsAt: number | null;
  endsAt: number | null;
  title: string | null;
  transcript: string | null;
  roomLink: string | null;
  recurringSeriesId: string | null;
  participants: Array<{
    userId: string;
    response: string;
    joinedAt: number | null;
    leftAt: number | null;
  }> | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  channel: {
    id: string;
    name: string;
    visibility: ChannelVisibility;
    scopeType: ChannelScopeType;
  } | null;
  isOutgoing: boolean;
  hasJoined: boolean;
  userJoinedAndLeft: boolean;
  isMissed: boolean;
  didNotAnswer: boolean;
  isActive: boolean;
  isScheduled: boolean;
  displayTitle: string;
  statusText: string;
  participantCount: number;
  participantAvatars: Array<{ id: string; name: string; picture: string | null }>;
  duration: string | null;
  durationMs: number;
  timeAgo: string;
  isChannelCall: boolean;
  channelVisibility: ChannelVisibility | null;
}
