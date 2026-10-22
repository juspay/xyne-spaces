import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CallOrigin, CallStatus, InvitationResponse } from '@xyne/shared';

import type { Call, UserLike } from '@/src/components/call-log/callHistoryItem.utils';
import {
  formatDuration,
  getCallStatus,
  getCallTitleFromParticipants,
  getOtherParticipants,
  getParticipantUsers,
  getStatusText,
  hasAnyoneJoined,
  isExternalCalendarEvent,
  isGoogleCalendarCall,
  isMicrosoftCalendarCall,
  isScheduledCallJoinable,
} from '@/src/components/call-log/callHistoryItem.utils';

// The functions read only a few structural fields; cast minimal fixtures to the
// Zero-generated participant/call types used by the signatures.
const participants = (rows: Array<{ userId: string; response?: string }>): Call['participants'] =>
  rows as unknown as Call['participants'];

const users: UserLike[] = [
  { id: 'u1', name: 'Ada Lovelace' },
  { id: 'u2', name: 'Alan Turing' },
  { id: 'u3', name: 'Grace Hopper' },
];

describe('calendar origin helpers', () => {
  it('detects google, microsoft, and combined external origins', () => {
    assert.equal(isGoogleCalendarCall({ callOrigin: CallOrigin.GOOGLE_CALENDAR }), true);
    assert.equal(isMicrosoftCalendarCall({ callOrigin: CallOrigin.MICROSOFT_CALENDAR }), true);
    assert.equal(isExternalCalendarEvent({ callOrigin: CallOrigin.GOOGLE_CALENDAR }), true);
    assert.equal(isExternalCalendarEvent({ callOrigin: CallOrigin.MICROSOFT_CALENDAR }), true);
    assert.equal(isExternalCalendarEvent({ callOrigin: CallOrigin.CHANNEL }), false);
    assert.equal(isGoogleCalendarCall({}), false);
  });
});

describe('participant helpers', () => {
  it('resolves participant user objects by id', () => {
    const resolved = getParticipantUsers(participants([{ userId: 'u1' }, { userId: 'u3' }]), users);
    assert.deepEqual(
      resolved.map(u => u.id),
      ['u1', 'u3'],
    );
  });

  it('detects whether anyone accepted or left the call', () => {
    assert.equal(
      hasAnyoneJoined(participants([{ userId: 'u1', response: InvitationResponse.ACCEPTED }])),
      true,
    );
    assert.equal(
      hasAnyoneJoined(participants([{ userId: 'u1', response: InvitationResponse.LEFT }])),
      true,
    );
    assert.equal(
      hasAnyoneJoined(participants([{ userId: 'u1', response: InvitationResponse.INVITED }])),
      false,
    );
    assert.equal(hasAnyoneJoined(participants([])), false);
  });

  it('excludes the current user from other participants', () => {
    const others = getOtherParticipants(participants([{ userId: 'u1' }, { userId: 'u2' }]), 'u1');
    assert.deepEqual(
      others.map(p => p.userId),
      ['u2'],
    );
    assert.deepEqual(getOtherParticipants(null as unknown as Call['participants'], 'u1'), []);
  });
});

describe('getCallStatus', () => {
  const endedCall = { status: CallStatus.ENDED } as unknown as Call;

  it('marks an unanswered outgoing call as "did not answer"', () => {
    assert.deepEqual(getCallStatus(endedCall, true, false, false, false), {
      isMissedCall: false,
      didNotAnswer: true,
    });
  });

  it('marks an unattended incoming call as missed', () => {
    assert.deepEqual(getCallStatus(endedCall, false, false, false, false), {
      isMissedCall: true,
      didNotAnswer: false,
    });
  });

  it('does not flag a call the current user participated in', () => {
    assert.deepEqual(getCallStatus(endedCall, false, true, false, true), {
      isMissedCall: false,
      didNotAnswer: false,
    });
  });
});

describe('formatDuration', () => {
  it('formats sub-minute and minute-plus durations', () => {
    assert.equal(formatDuration(0), '0s');
    assert.equal(formatDuration(-100), '0s');
    assert.equal(formatDuration(500), '0s');
    assert.equal(formatDuration(5000), '5s');
    assert.equal(formatDuration(60_000), '1m 0s');
    assert.equal(formatDuration(65_000), '1m 5s');
  });
});

describe('getStatusText', () => {
  it('prioritises missed → no-answer → active → scheduled → duration', () => {
    assert.equal(getStatusText(true, false, false, 0), 'Missed call invite');
    assert.equal(getStatusText(false, true, false, 0), 'No answer');
    assert.equal(getStatusText(false, false, true, 0), 'Active');
    assert.equal(getStatusText(false, false, false, 0, true), 'Scheduled');
    assert.equal(getStatusText(false, false, false, 65_000), '1m 5s');
  });
});

describe('getCallTitleFromParticipants', () => {
  it('joins the first names of other participants', () => {
    const title = getCallTitleFromParticipants(
      participants([{ userId: 'u1' }, { userId: 'u2' }]),
      users,
      'u3',
    );
    assert.equal(title, 'Ada, Alan');
  });

  it('falls back to Unknown when there are no other participants or names', () => {
    assert.equal(
      getCallTitleFromParticipants(participants([{ userId: 'u1' }]), users, 'u1'),
      'Unknown',
    );
    assert.equal(
      getCallTitleFromParticipants(participants([{ userId: 'missing' }]), users, 'u1'),
      'Unknown',
    );
  });
});

describe('isScheduledCallJoinable', () => {
  let now = 0;
  beforeEach(() => {
    now = Date.now();
  });
  afterEach(() => {
    now = 0;
  });

  it('is not joinable without a start time or once ended', () => {
    assert.equal(isScheduledCallJoinable({ status: CallStatus.SCHEDULED }), false);
    assert.equal(isScheduledCallJoinable({ startsAt: now, status: CallStatus.ENDED }), false);
  });

  it('is always joinable while active', () => {
    assert.equal(
      isScheduledCallJoinable({ startsAt: now + 10_000, status: CallStatus.ACTIVE }),
      true,
    );
  });

  it('becomes joinable once the start time has passed', () => {
    assert.equal(
      isScheduledCallJoinable({ startsAt: now - 1000, status: CallStatus.SCHEDULED }),
      true,
    );
    assert.equal(
      isScheduledCallJoinable({ startsAt: now + 60_000, status: CallStatus.SCHEDULED }),
      false,
    );
  });
});
