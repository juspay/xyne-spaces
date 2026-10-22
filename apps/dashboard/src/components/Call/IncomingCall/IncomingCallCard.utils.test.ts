import { describe, expect, it, vi } from 'vitest';
import {
  CallOrigin,
  CallRingNotification,
  ChannelScopeType,
  InvitationResponse,
  MeetingStatus,
  type CallParticipant,
} from '@xyne/shared';

// Browser-bound imports of the module; the ring policy under test touches neither.
vi.mock('../../../stores/recordingStore', () => ({ isRecordingSessionActive: (): boolean => false }));
vi.mock('../../Chat/ChatDirectory/ChatDirectory.utils', () => ({ isDMChannel: (): boolean => false }));

const { isRingableCall } = await import('./IncomingCallCard.utils');

const NOW = Date.UTC(2026, 9, 22, 10, 0);

function participant(overrides: Partial<CallParticipant> = {}): CallParticipant {
  return {
    workspaceId: 'ws',
    id: 'p1',
    callId: 'c1',
    userId: 'me',
    invitedBy: 'organizer',
    invitedAt: NOW - 60_000,
    response: InvitationResponse.INVITED,
    meetingStatus: MeetingStatus.PENDING,
    respondedAt: null,
    joinedAt: null,
    leftAt: null,
    metadata: null,
    displayName: null,
    email: null,
    isExternal: false,
    ringStatus: null,
    ringNotification: null,
    ...overrides,
  };
}

function ringable(myParticipant: CallParticipant, startsAt: number | null = NOW - 60_000): boolean {
  return isRingableCall({
    call: { externalId: 'room', startsAt, callOrigin: CallOrigin.CHANNEL, channelId: 'ch' },
    channel: { id: 'ch', name: 'group', scopeType: ChannelScopeType.GROUP_DM },
    myParticipant,
    currentCallId: null,
    nativeActiveCallId: null,
    now: NOW,
  });
}

describe('isRingableCall — scheduled-call ring option', () => {
  it('rings a started scheduled call when the option is ENABLED', () => {
    expect(ringable(participant({ ringNotification: CallRingNotification.ENABLED }))).toBe(true);
  });

  it('rings a started scheduled call when the option was never set (null)', () => {
    expect(ringable(participant({ ringNotification: null }))).toBe(true);
  });

  it('does not ring a started scheduled call when the option is DISABLED', () => {
    expect(ringable(participant({ ringNotification: CallRingNotification.DISABLED }))).toBe(false);
  });

  it('still waits for the start time regardless of the option', () => {
    expect(
      ringable(participant({ ringNotification: CallRingNotification.ENABLED }), NOW + 60_000),
    ).toBe(false);
  });
});
