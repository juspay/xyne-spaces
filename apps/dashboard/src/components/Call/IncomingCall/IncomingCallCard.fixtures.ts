import type { IncomingCallRosterEntry, IncomingCallViewModel } from './IncomingCallCard.types';

/**
 * Hand-written view models, one per designed state, for `IncomingCallCard.dev.tsx`.
 *
 * These exist because most states cannot be produced on demand: scheduled calls
 * need a booking, thread titles need an LLM round trip, and three of them are
 * blocked by the ring filter outright. Since the card takes a fully-resolved
 * view model and nothing else, rendering from these needs no mocking at all.
 *
 * Roster entries carry `userId: null` so the harness draws initials tiles —
 * which is what most of an org without profile photos sees in production, and
 * what keeps these fixtures independent of who happens to exist in the dev
 * database.
 */

let seq = 0;
const person = (displayName: string): IncomingCallRosterEntry => ({
  key: `fixture-${++seq}`,
  userId: null,
  displayName,
  initials: displayName.trim()[0]?.toUpperCase() ?? '?',
  isExternal: false,
});

const stack = (
  names: string[],
  overflowCount = 0,
): Extract<IncomingCallViewModel['identity'], { mode: 'stack' }> => ({
  mode: 'stack',
  visible: names.map(person),
  overflowCount,
});

const base = {
  isInActiveCall: false,
  invitedBy: null,
} satisfies Pick<IncomingCallViewModel, 'isInActiveCall' | 'invitedBy'>;

export interface IncomingCallFixture {
  /** Matches the numbering in the design doc; blocked states continue past 10. */
  n: number;
  label: string;
  /** Why this state cannot currently occur in production, if it cannot. */
  blocked?: string;
  vm: IncomingCallViewModel;
}

export const INCOMING_CALL_FIXTURES: IncomingCallFixture[] = [
  {
    n: 1,
    label: 'DM — solo',
    vm: {
      ...base,
      callId: 'fx-1',
      context: { kind: 'direct', icon: 'user', place: null, text: 'Incoming call' },
      identity: { mode: 'solo', userId: null, displayName: 'Ankit Sharma' },
      name: 'Ankit Sharma',
      subtitle: 'ankit.sharma@juspay.in',
    },
  },
  {
    n: 2,
    label: 'DM that gained a third person',
    vm: {
      ...base,
      callId: 'fx-2',
      context: { kind: 'group', icon: 'users', place: null, text: 'Group call' },
      identity: stack(['Ankit Sharma', 'Ojas Deshmukh', 'Shubham Agarwal']),
      name: 'Ankit Sharma',
      subtitle: 'with Ojas and Shubham',
    },
  },
  {
    n: 3,
    label: 'Group DM, 7 people',
    vm: {
      ...base,
      callId: 'fx-3',
      context: { kind: 'group', icon: 'users', place: null, text: 'Group call' },
      identity: stack(['Priya Nair', 'Ojas Deshmukh', 'Shubham Agarwal', 'Harsh Iyer'], 2),
      name: 'Priya Nair',
      subtitle: 'with Ojas, Shubham +3',
    },
  },
  {
    n: 4,
    label: 'Thread call in a channel',
    vm: {
      ...base,
      callId: 'fx-4',
      context: {
        kind: 'thread',
        icon: 'thread',
        place: { kind: 'channel', name: 'engineering' },
        text: 'Thread call in #engineering',
      },
      identity: stack(['Rohan Mehta', 'Ojas Deshmukh', 'Shubham Agarwal', 'Meera Pillai'], 1),
      name: 'Rohan Mehta',
      subtitle: 'with Ojas, Shubham +2',
    },
  },
  {
    n: 5,
    label: 'Scheduled call, in progress',
    blocked:
      'Scheduled channel calls get callOrigin=CHANNEL and are dropped by the ring filter; ' +
      'a place name only resolves when callUpdatesChannel points at a real channel.',
    vm: {
      ...base,
      callId: 'fx-5',
      context: {
        kind: 'scheduled',
        icon: 'calendar',
        place: { kind: 'channel', name: 'product-sync' },
        text: 'Scheduled call in #product-sync',
      },
      identity: stack(['Kunal Bose', 'Divya Krishnan', 'Rohan Mehta', 'Sana Khan'], 3),
      name: 'Kunal Bose',
      subtitle: 'Weekly product sync',
    },
  },
  {
    n: 6,
    label: 'Scheduled thread call, long name and title',
    vm: {
      ...base,
      callId: 'fx-6',
      context: {
        kind: 'scheduled-thread',
        icon: 'calendar',
        place: { kind: 'channel', name: 'platform-infra-oncall-escalations' },
        text: 'Scheduled thread call in #platform-infra-oncall-escalations',
      },
      identity: stack(['Meera Pillai', 'Sana Khan', 'Harsh Iyer', 'Ankit Sharma'], 1),
      name: 'Meera Pillai',
      subtitle: 'Oncall escalation review — Q3 platform rollout readiness',
    },
  },
  {
    n: 7,
    label: 'Channel name unresolved',
    vm: {
      ...base,
      callId: 'fx-7',
      context: { kind: 'unknown', icon: 'hash', place: null, text: 'Incoming call' },
      identity: stack(['Rohan Mehta', 'Ojas Deshmukh', 'Priya Nair']),
      name: 'Rohan Mehta',
      subtitle: 'with Ojas and Priya',
    },
  },
  {
    n: 8,
    label: 'Already in a call — notice + Switch call',
    vm: {
      ...base,
      callId: 'fx-8',
      isInActiveCall: true,
      context: { kind: 'direct', icon: 'user', place: null, text: 'Incoming call' },
      identity: { mode: 'solo', userId: null, displayName: 'Ankit Sharma' },
      name: 'Ankit Sharma',
      subtitle: 'ankit.sharma@juspay.in',
    },
  },
  {
    n: 9,
    label: 'Thread call inside a group DM',
    vm: {
      ...base,
      callId: 'fx-9',
      context: {
        kind: 'thread',
        icon: 'thread',
        place: { kind: 'group-dm' },
        text: 'Thread call in group DM',
      },
      identity: stack(['Shubham Agarwal', 'Priya Nair', 'Harsh Iyer']),
      name: 'Shubham Agarwal',
      subtitle: 'with Priya and Harsh',
    },
  },
  {
    n: 10,
    label: 'Thread call, thread has a title',
    vm: {
      ...base,
      callId: 'fx-10',
      context: {
        kind: 'thread',
        icon: 'thread',
        place: { kind: 'channel', name: 'engineering' },
        text: 'Thread call in #engineering',
      },
      identity: stack(['Rohan Mehta', 'Ojas Deshmukh', 'Shubham Agarwal', 'Meera Pillai'], 1),
      name: 'Rohan Mehta',
      // Written by the LLM a beat after the phone starts ringing, so this
      // replaces the roster line mid-ring.
      subtitle: 'UPI activation escalations',
    },
  },

  // --- States the ring filter blocks today. -------------------------------
  // They render here so that relaxing `isRingableCall` cannot produce a card
  // nobody has ever looked at.
  {
    n: 11,
    label: 'Channel call',
    blocked: 'Suppressed by isRingableCall — would ring every member of the channel.',
    vm: {
      ...base,
      callId: 'fx-11',
      context: {
        kind: 'channel',
        icon: 'hash',
        place: { kind: 'channel', name: 'general' },
        text: 'Call in #general',
      },
      identity: stack(['Divya Krishnan', 'Kunal Bose', 'Meera Pillai', 'Sana Khan'], 196),
      name: 'Divya Krishnan',
      subtitle: 'with Kunal, Meera +197',
    },
  },
  {
    n: 12,
    label: 'Large group call (9+), auto-generated channel name',
    blocked: 'Groups past 9 become a private DEFAULT-scope channel, so the same filter drops them.',
    vm: {
      ...base,
      callId: 'fx-12',
      context: {
        kind: 'channel',
        icon: 'hash',
        place: { kind: 'channel', name: 'Call-Standup-12 Aug 3:04pm' },
        text: 'Call in #Call-Standup-12 Aug 3:04pm',
      },
      identity: stack(['Kunal Bose', 'Divya Krishnan', 'Rohan Mehta', 'Sana Khan'], 8),
      name: 'Kunal Bose',
      subtitle: 'with Divya, Rohan +9',
    },
  },
  {
    n: 13,
    label: 'Explicitly invited to a channel call',
    blocked: 'The filter keys on the call, not on invitedBy, so a personal invite is dropped too.',
    vm: {
      ...base,
      callId: 'fx-13',
      invitedBy: 'user-rohan',
      context: {
        kind: 'channel',
        icon: 'hash',
        place: { kind: 'channel', name: 'payments-oncall' },
        text: 'Call in #payments-oncall',
      },
      identity: stack(['Rohan Mehta', 'Priya Nair', 'Harsh Iyer'], 4),
      name: 'Rohan Mehta',
      subtitle: 'with Priya, Harsh +5',
    },
  },
];
