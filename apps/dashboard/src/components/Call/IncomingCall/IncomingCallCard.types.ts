/**
 * View model for the incoming-call modal.
 *
 * The card is driven entirely by this shape — no Zero rows, no XState, no
 * router. That is deliberate: the derivation in `IncomingCallCard.utils.ts` is
 * a pure function, and the presenter can be rendered from fixtures without any
 * mocking (see `IncomingCallCard.dev.tsx`).
 */

/**
 * Which of the ten designed states the card is showing.
 *
 * These are derived from live call data, so more combinations exist than the
 * ring filter currently lets through — `channel` in particular is unreachable
 * today (see `isRingableCall`). Every kind still has a defined render so that
 * loosening the filter can never produce an empty card.
 */
export type IncomingCallContextKind =
  | 'direct' // 1:1 DM
  | 'group' // group DM, or a DM that gained a third person
  | 'thread' // call started inside a conversation
  | 'scheduled' // has startsAt
  | 'scheduled-thread' // both of the above
  | 'calendar' // Google / Microsoft calendar event
  | 'channel' // channel-scoped call (blocked by the ring filter today)
  | 'unknown'; // channel unresolved, or nothing identifying at all

/** Icon slot in the context line. Mapped to lucide components by the presenter. */
export type IncomingCallContextIcon = 'user' | 'users' | 'thread' | 'calendar' | 'hash';

export interface IncomingCallContextVM {
  kind: IncomingCallContextKind;
  icon: IncomingCallContextIcon;
  /**
   * Full context line, already assembled — e.g. `Thread call in #engineering`.
   * Place names are static text by product decision, so there is nothing to
   * click and nothing for the presenter to reassemble.
   */
  text: string;
}

export interface IncomingCallRosterEntry {
  /** `call_participants.id` — stable React key. */
  key: string;
  /**
   * Null when no user account backs this entry — external guests, and fixture
   * data. The presenter falls back to an initials tile rather than letting
   * Avatar render an empty "Unknown".
   */
  userId: string | null;
  displayName: string;
  initials: string;
  isExternal: boolean;
}

export type IncomingCallIdentityVM =
  | { mode: 'solo'; userId: string | null; displayName: string }
  | {
      mode: 'stack';
      /** At most `MAX_VISIBLE_AVATARS`, caller first. */
      visible: IncomingCallRosterEntry[];
      /** Everyone on the call beyond `visible`; 0 hides the chip. */
      overflowCount: number;
    };

export interface IncomingCallViewModel {
  callId: string;
  context: IncomingCallContextVM;
  identity: IncomingCallIdentityVM;
  /** Caller display name. Always present. */
  name: string;
  /** Priority: meeting title → roster line → caller email → omitted. */
  subtitle: string | null;
  /** Drives the notice block and swaps Accept for the Switch-call pill. */
  isInActiveCall: boolean;
  /**
   * Who invited the current user — `invitedBy`, falling back to the call
   * creator. Unused by the card today; it is the signal that separates "invited
   * because I am in the channel" from "someone picked me", which is what a
   * future fix to the ring filter would key on.
   */
  invitedBy: string | null;
}
