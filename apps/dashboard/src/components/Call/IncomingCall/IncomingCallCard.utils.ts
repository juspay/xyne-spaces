import {
  CallOrigin,
  ChannelScopeType,
  InvitationResponse,
  type Channel,
  type CallParticipant,
  type User,
} from '@xyne/shared';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { isDMChannel } from '../../Chat/ChatDirectory/ChatDirectory.utils';
import type {
  IncomingCallContextVM,
  IncomingCallIdentityVM,
  IncomingCallRosterEntry,
  IncomingCallViewModel,
} from './IncomingCallCard.types';

/** Avatars shown before the rest collapse into a `+N` chip. */
export const MAX_VISIBLE_AVATARS = 4;

/** The shape the builder needs off a `calls` row. Widened for testability. */
export interface IncomingCallRow {
  externalId: string;
  title?: string | null;
  startsAt?: number | null;
  callOrigin?: CallOrigin | null;
  channelId?: string | null;
  callUpdatesChannel?: string | null;
  participantCount?: number | null;
  participants?: readonly CallParticipant[] | undefined;
}

type ChannelLike = Pick<Channel, 'id' | 'name' | 'scopeType'>;

// ---------------------------------------------------------------------------
// Ring policy
// ---------------------------------------------------------------------------

/**
 * Whether an active call should ring the current user.
 *
 * This is the *policy* half of the modal, kept apart from presentation on
 * purpose. The backend already writes an `INVITED` participant row for every
 * channel member, so nothing server-side stops these calls ringing — the rules
 * below are the only thing that does. Every one of them is a product decision,
 * so keep them here rather than scattering them through the render path.
 *
 * The view model is built for calls this rejects too, so relaxing a rule can
 * never produce an unhandled card.
 */
export function isRingableCall(input: {
  call: IncomingCallRow;
  channel: ChannelLike | undefined;
  myParticipant: CallParticipant | undefined;
  /** Call the room is already connected to — never ring for the current call. */
  currentCallId: string | null | undefined;
  /** Joined via a native VoIP notification before Zero synced. */
  nativeActiveCallId: string | null | undefined;
  now: number;
}): boolean {
  const { call, channel, myParticipant, currentCallId, nativeActiveCallId, now } = input;

  if (currentCallId && call.externalId === currentCallId) return false;
  if (nativeActiveCallId && call.externalId === nativeActiveCallId) return false;

  // Channel-wide calls would ring every member of the channel, so they are
  // suppressed. Note this also swallows calls you were *personally* invited to
  // on a channel call — `invitedBy` distinguishes the two and is carried on the
  // view model, but acting on it is a product change, not a rendering one.
  if (channel?.scopeType === ChannelScopeType.DEFAULT && call.callOrigin === CallOrigin.CHANNEL) {
    return false;
  }

  // A scheduled call rings when it starts, not when it is booked.
  if (call.startsAt && now < new Date(call.startsAt).getTime()) return false;

  return myParticipant?.response === InvitationResponse.INVITED;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/** `x == null` spelled out, since the lint config bans loose equality. */
function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

/** First name for the roster line: `"Ojas Sharma"` → `"Ojas"`. */
export function toFirstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return 'Someone';
  // An email has no first name to take — use the local part rather than
  // rendering "ojas@xyne.in" mid-sentence.
  const base = trimmed.includes('@') ? (trimmed.split('@')[0] ?? trimmed) : trimmed;
  return base.split(/\s+/)[0] || 'Someone';
}

function toInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0]?.[0] ?? '?').toUpperCase();
}

/**
 * Everyone on the call besides the current user, caller first.
 *
 * `userActiveCalls` attaches every `call_participants` row unfiltered, which
 * includes lobby knockers (`REQUESTED`), people who declined, and people who
 * already left. Showing those would mean a redial renders a stack of avatars
 * for a room nobody is in.
 */
export function selectRosterParticipants(
  participants: readonly CallParticipant[] | undefined,
  callerUserId: string,
  currentUserId: string | undefined,
  usersById: ReadonlyMap<string, User>,
): IncomingCallRosterEntry[] {
  const eligible = (participants ?? [])
    .filter(
      p =>
        (p.response === InvitationResponse.ACCEPTED || p.response === InvitationResponse.INVITED) &&
        isNullish(p.leftAt) &&
        p.userId !== currentUserId,
    )
    .sort((a, b) => {
      // Caller leads, so the stack and the subtitle read as one sentence.
      if (a.userId === callerUserId) return -1;
      if (b.userId === callerUserId) return 1;
      return (a.invitedAt ?? 0) - (b.invitedAt ?? 0);
    });

  const seen = new Set<string>();
  const roster: IncomingCallRosterEntry[] = [];

  for (const p of eligible) {
    const dedupeKey = p.userId || p.id;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // External guests have no user account, so `usersById` cannot resolve them
    // and Avatar would fall back to an empty "Unknown" tile.
    const displayName = p.isExternal
      ? p.displayName || p.email || 'Guest'
      : getUserDisplayName(usersById.get(p.userId));

    roster.push({
      key: p.id,
      userId: p.isExternal ? null : p.userId,
      displayName,
      initials: toInitials(displayName),
      isExternal: p.isExternal,
    });
  }

  return roster;
}

/**
 * The roster line under the caller's name.
 *
 * Up to three others are named in full; beyond that the tail collapses so the
 * line stays on one row at typical name lengths.
 */
export function formatRosterSubtitle(firstNames: readonly string[]): string | null {
  const [a, b, c] = firstNames;
  switch (firstNames.length) {
    case 0:
      return null;
    case 1:
      return `with ${a}`;
    case 2:
      return `with ${a} and ${b}`;
    case 3:
      return `with ${a}, ${b} and ${c}`;
    default:
      return `with ${a}, ${b} +${firstNames.length - 2}`;
  }
}

// ---------------------------------------------------------------------------
// Place resolution
// ---------------------------------------------------------------------------

/**
 * The channel whose name the context line may show, or null when there is
 * nothing nameable.
 *
 * `callUpdatesChannel` wins because a scheduled group call stores a synthesized
 * GROUP_DM in `channelId` and the real broadcast channel here. DM and GROUP_DM
 * names are comma-joined user IDs rather than anything human, so they are never
 * nameable — rendering one gives `#u_a1b2,u_c3d4`.
 */
export function resolveDisplayChannel(
  call: Pick<IncomingCallRow, 'channelId' | 'callUpdatesChannel'>,
  channelMap: ReadonlyMap<string, ChannelLike>,
): { channel: ChannelLike | undefined; nameable: ChannelLike | null } {
  const broadcast = call.callUpdatesChannel ? channelMap.get(call.callUpdatesChannel) : undefined;
  const own = call.channelId ? channelMap.get(call.channelId) : undefined;

  for (const candidate of [broadcast, own]) {
    if (candidate && !isDMChannel(candidate.scopeType) && candidate.name.trim()) {
      return { channel: own ?? candidate, nameable: candidate };
    }
  }

  return { channel: own ?? broadcast, nameable: null };
}

// ---------------------------------------------------------------------------
// Context line
// ---------------------------------------------------------------------------

function buildContext(input: {
  call: IncomingCallRow;
  channel: ChannelLike | undefined;
  nameable: ChannelLike | null;
  isSolo: boolean;
  isCalendar: boolean;
}): IncomingCallContextVM {
  const { call, channel, nameable, isSolo, isCalendar } = input;

  const isScheduled = !isNullish(call.startsAt) || isCalendar;
  const isThread = call.callOrigin === CallOrigin.CONVERSATION;
  const isGroupDm = channel?.scopeType === ChannelScopeType.GROUP_DM;
  const place = nameable ? `#${nameable.name}` : isGroupDm ? 'group DM' : null;

  // Precedence matters — these overlap, and a scheduled thread call has to read
  // as one sentence rather than pick a side.
  if (isScheduled) {
    const prefix = isThread ? 'Scheduled thread call' : 'Scheduled call';
    return {
      kind: isThread ? 'scheduled-thread' : isCalendar ? 'calendar' : 'scheduled',
      icon: 'calendar',
      text: place ? `${prefix} in ${place}` : prefix,
    };
  }

  if (isThread) {
    return {
      kind: 'thread',
      icon: 'thread',
      text: place ? `Thread call in ${place}` : 'Thread call',
    };
  }

  if (nameable) {
    return { kind: 'channel', icon: 'hash', text: `Call in ${place}` };
  }

  if (isSolo) {
    return { kind: 'direct', icon: 'user', text: 'Incoming call' };
  }

  if (isGroupDm || channel) {
    return { kind: 'group', icon: 'users', text: 'Group call' };
  }

  // Channel not synced yet, or nothing identifying at all. A generic line plus
  // a stack and a name is still a complete sentence.
  return {
    kind: call.channelId ? 'unknown' : 'group',
    icon: call.channelId ? 'hash' : 'users',
    text: call.channelId ? 'Incoming call' : 'Group call',
  };
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export function buildIncomingCallViewModel(input: {
  callId: string;
  call: IncomingCallRow | undefined;
  /** The inviter, from the call machine — not necessarily the call creator. */
  caller: { id: string; name: string; email: string };
  channelMap: ReadonlyMap<string, ChannelLike>;
  usersById: ReadonlyMap<string, User>;
  currentUserId: string | undefined;
  isInActiveCall: boolean;
  /** Overridable so fixtures can exercise the overflow chip cheaply. */
  maxVisibleAvatars?: number;
}): IncomingCallViewModel {
  const {
    callId,
    call,
    caller,
    channelMap,
    usersById,
    currentUserId,
    isInActiveCall,
    maxVisibleAvatars = MAX_VISIBLE_AVATARS,
  } = input;

  const isCalendar =
    call?.callOrigin === CallOrigin.GOOGLE_CALENDAR ||
    call?.callOrigin === CallOrigin.MICROSOFT_CALENDAR;

  const { channel, nameable } = call
    ? resolveDisplayChannel(call, channelMap)
    : { channel: undefined, nameable: null };

  const roster = selectRosterParticipants(call?.participants, caller.id, currentUserId, usersById);

  // Roster size is the reliable signal: `useAllChannels` is a sync cache, so a
  // first-ever DM may have no channel row yet and keying on scopeType would
  // intermittently drop the radar on the most common call there is. scopeType
  // only ever demotes a would-be solo to a stack.
  const isSolo =
    roster.length <= 1 &&
    call?.callOrigin !== CallOrigin.CONVERSATION &&
    isNullish(call?.startsAt) &&
    !isCalendar &&
    channel?.scopeType !== ChannelScopeType.DEFAULT;

  const identity: IncomingCallIdentityVM = isSolo
    ? { mode: 'solo', userId: roster[0]?.userId ?? caller.id, displayName: caller.name }
    : {
        mode: 'stack',
        // Slice before mapping — a channel call carries one row per member.
        visible: roster.slice(0, maxVisibleAvatars),
        overflowCount: Math.max(0, roster.length - maxVisibleAvatars),
      };

  const title = call?.title?.trim();
  // The stack leads with the caller, but the line beneath names the people they
  // are calling *with* — so the caller is dropped here and nowhere else.
  const rosterLine = formatRosterSubtitle(
    roster.filter(r => r.userId !== caller.id).map(r => toFirstName(r.displayName)),
  );

  const myParticipant = call?.participants?.find(p => p.userId === currentUserId);

  return {
    callId,
    context: buildContext({
      call: call ?? { externalId: callId },
      channel,
      nameable,
      isSolo,
      isCalendar,
    }),
    identity,
    name: caller.name,
    // Title wins when there is one — a thread call's generated title and a
    // meeting's name both say what the call is about, which a roster cannot.
    subtitle: title || rosterLine || caller.email || null,
    isInActiveCall,
    invitedBy: myParticipant?.invitedBy ?? null,
  };
}
