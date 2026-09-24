import { CallOrigin, ChannelScopeType, InvitationResponse, RingStatus } from '@xyne/shared';
import { useChannel } from '../../hooks/useChannels';

export interface RingableParticipantRow {
  readonly userId: string;
  readonly response: string | null;
  readonly ringStatus?: string | null | undefined;
  readonly joinedAt: number | null;
  readonly isExternal?: boolean | null | undefined;
}

export interface RingingInvitee {
  userId: string;
  ringStatus: RingStatus;
}

/**
 * Caller-facing label for an invitee who hasn't answered yet. A row written before
 * ringStatus existed (or by a path that doesn't set it) reads as CALLING — the
 * invite went out, no device has confirmed it.
 */
export function getRingStatusLabel(ringStatus: string | null | undefined): string {
  switch (ringStatus) {
    case RingStatus.RINGING:
      return 'Ringing…';
    case RingStatus.BUSY:
      return 'On another call';
    default:
      return 'Calling…';
  }
}

export function toRingStatus(ringStatus: string | null | undefined): RingStatus {
  return ringStatus === RingStatus.RINGING || ringStatus === RingStatus.BUSY
    ? ringStatus
    : RingStatus.CALLING;
}

/**
 * Invitees still being rung: INVITED, never joined, not already in the LiveKit room
 * (the DB lags the join by a webhook round-trip), and not the viewer themselves.
 * External email invitees are never rung, so they don't get a tile.
 */
export function getRingingInvitees(
  participants: readonly RingableParticipantRow[] | null | undefined,
  connectedIdentities: ReadonlySet<string>,
  currentUserId: string | null | undefined,
): RingingInvitee[] {
  return (participants ?? [])
    .filter(
      p =>
        p.response === InvitationResponse.INVITED &&
        p.joinedAt === null &&
        p.isExternal !== true &&
        p.userId !== currentUserId &&
        !connectedIdentities.has(p.userId),
    )
    .map(p => ({ userId: p.userId, ringStatus: toRingStatus(p.ringStatus) }));
}

// Mirrors the backend's ring-suppression check: nobody rings in a channel broadcast call.
export function useIsBroadcastChannelCall(
  channelId: string | null | undefined,
  callOrigin: string | null | undefined,
): boolean {
  const channel = useChannel(channelId ?? '');
  return channel?.scopeType === ChannelScopeType.DEFAULT && callOrigin === CallOrigin.CHANNEL;
}

// True only for a one-on-one DM call, not a group DM or a channel call.
export function useIsDmCall(channelId: string | null): boolean {
  const channel = useChannel(channelId ?? '');
  return channel?.scopeType === ChannelScopeType.DM;
}
