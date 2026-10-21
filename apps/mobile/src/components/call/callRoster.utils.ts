/**
 * Who is being rung. A direct port of the dashboard's `components/Call/ringStatus.utils.ts` so the
 * two clients agree on when a "Calling… / Ringing… / On another call" tile exists — do not add
 * client-side heuristics here (age cut-offs, declined / missed tiles…); the backend already moves a
 * row off INVITED when it is answered, declined or times out.
 *
 * Pure so it can be tested in node.
 */

import { CallOrigin, ChannelScopeType } from '@xyne/shared';

import { isAiAgentIdentity } from './callIdentity';

/** Mirrors `RingStatus` in @xyne/shared. Absent from older shared pins, hence strings. */
export type RingStatusValue = 'calling' | 'ringing' | 'busy';

export interface RosterParticipantLike {
  userId: string;
  response: string | null;
  joinedAt?: number | null;
  /** RingStatus written by the backend: CALLING → RINGING (device confirmed) or BUSY. */
  ringStatus?: string | null;
  displayName?: string | null;
  isExternal?: boolean | null;
}

export interface RingingInvitee {
  userId: string;
  name: string;
  ringStatus: RingStatusValue;
}

/**
 * A row written before ringStatus existed (or by a path that doesn't set it) reads as CALLING —
 * the invite went out, no device has confirmed it.
 */
export function toRingStatus(ringStatus: string | null | undefined): RingStatusValue {
  if (ringStatus === 'RINGING') return 'ringing';
  if (ringStatus === 'BUSY') return 'busy';
  return 'calling';
}

/** Caller-facing label for an invitee who hasn't answered yet. */
export function getRingStatusLabel(ringStatus: RingStatusValue): string {
  switch (ringStatus) {
    case 'ringing':
      return 'Ringing…';
    case 'busy':
      return 'On another call';
    default:
      return 'Calling…';
  }
}

/**
 * Invitees still being rung: INVITED, never joined, not already in the LiveKit room (the DB lags
 * the join by a webhook round-trip), and not the viewer. External email invitees are never rung,
 * so they don't get a tile.
 *
 * Callers must only use this for 1:1 DM calls — the dashboard shows ring status in the people list
 * everywhere else.
 */
export function getRingingInvitees(params: {
  participants: readonly RosterParticipantLike[] | null | undefined;
  connectedIdentities: ReadonlySet<string>;
  currentUserId: string | null | undefined;
  resolveName: (userId: string, fallback: string | null | undefined) => string;
}): RingingInvitee[] {
  const { participants, connectedIdentities, currentUserId, resolveName } = params;
  return (participants ?? [])
    .filter(
      p =>
        p.response === 'INVITED' &&
        (p.joinedAt === null || p.joinedAt === undefined) &&
        p.isExternal !== true &&
        p.userId !== currentUserId &&
        !isAiAgentIdentity(p.userId) &&
        !connectedIdentities.has(p.userId),
    )
    .map(p => ({
      userId: p.userId,
      name: resolveName(p.userId, p.displayName),
      ringStatus: toRingStatus(p.ringStatus),
    }));
}

/**
 * What the people list says for an INVITED row (dashboard `ParticipantsSidebar`): external guests
 * and channel-broadcast invitees are never rung, so they read "Invited".
 */
export function getInvitedRowLabel(params: {
  isExternal: boolean;
  isBroadcastChannelCall: boolean;
  ringStatus: string | null | undefined;
}): string {
  if (params.isExternal || params.isBroadcastChannelCall) return 'Invited';
  return getRingStatusLabel(toRingStatus(params.ringStatus));
}

/** "A", "A, B", "A, B + 3 others" — same phrasing as the Calls tab. */
function formatParticipantNames(names: readonly string[]): string {
  const clean = names.map(n => n.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]}, ${clean[1]}`;
  const remaining = clean.length - 2;
  return `${clean[0]}, ${clean[1]} + ${remaining} ${remaining === 1 ? 'other' : 'others'}`;
}

/**
 * Header title: an explicit call title wins, then the channel (DM partner / group / "# channel"),
 * then whoever else is on the call.
 */
export function resolveCallTitle(params: {
  callTitle?: string | null | undefined;
  channelTitle?: string | null | undefined;
  otherNames: readonly string[];
  fallback?: string;
}): string {
  const explicit = params.callTitle?.trim();
  if (explicit) return explicit;
  const channel = params.channelTitle?.trim();
  if (channel) return channel;
  const names = formatParticipantNames(params.otherNames);
  if (names) return names;
  return params.fallback ?? 'Call';
}

/**
 * A call started from a public channel: it rings nobody and never pops the incoming-call screen,
 * so its invitees read "Invited" rather than a ring status (dashboard rule).
 */
export function isBroadcastChannelCall(
  channelScope: string | null | undefined,
  callOrigin: string | null | undefined,
): boolean {
  return channelScope === ChannelScopeType.DEFAULT && callOrigin === CallOrigin.CHANNEL;
}
