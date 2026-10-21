import { describe, expect, it, vi } from 'vitest';
import {
  CallOrigin,
  ChannelScopeType,
  ChannelType,
  InvitationResponse,
  type CallParticipant,
} from '@xyne/shared';
import { isRingableCall } from './IncomingCallCard.utils';

// The ring policy is pure; these pull in browser-only stores.
vi.mock('../../../stores/recordingStore', () => ({ isRecordingSessionActive: () => false }));
vi.mock('../../Chat/ChatDirectory/ChatDirectory.utils', () => ({ isDMChannel: () => false }));

const invited = { response: InvitationResponse.INVITED } as CallParticipant;

const ring = (channelType: string, callOrigin: CallOrigin) =>
  isRingableCall({
    call: { externalId: 'call-1', callOrigin, channelId: 'ch-1' },
    channel: {
      id: 'ch-1',
      name: 'hub',
      scopeType: ChannelScopeType.DEFAULT,
      type: channelType as ChannelType,
    },
    myParticipant: invited,
    currentCallId: null,
    nativeActiveCallId: null,
    now: Date.now(),
  });

describe('isRingableCall', () => {
  it('does not ring a whole-channel call in a normal channel', () => {
    expect(ring(ChannelType.DEFAULT, CallOrigin.CHANNEL)).toBe(false);
  });

  it('rings a whole-channel call in an SDLC hub', () => {
    expect(ring(ChannelType.SDLC, CallOrigin.CHANNEL)).toBe(true);
  });

  it('rings a thread call in a normal channel', () => {
    expect(ring(ChannelType.DEFAULT, CallOrigin.CONVERSATION)).toBe(true);
  });
});
