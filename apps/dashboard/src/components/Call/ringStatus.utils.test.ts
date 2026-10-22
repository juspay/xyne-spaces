import { describe, expect, it, vi } from 'vitest';
import { CallRingNotification, InvitationResponse, RingStatus } from '@xyne/shared';
import type { RingableParticipantRow } from './ringStatus.utils';

// The hooks in this module read Zero; only the pure helper is under test here.
vi.mock('../../hooks/useChannels', () => ({ useChannel: (): undefined => undefined }));

const { getRingingInvitees } = await import('./ringStatus.utils');

const invitee = (
  userId: string,
  ringNotification: string | null,
): RingableParticipantRow => ({
  userId,
  response: InvitationResponse.INVITED,
  ringStatus: null,
  ringNotification,
  joinedAt: null,
  isExternal: false,
});

describe('getRingingInvitees', () => {
  it('omits invitees of a call scheduled not to ring', () => {
    const rows = [
      invitee('rung', CallRingNotification.ENABLED),
      invitee('legacy', null),
      invitee('silent', CallRingNotification.DISABLED),
    ];

    expect(getRingingInvitees(rows, new Set(), 'me')).toEqual([
      { userId: 'rung', ringStatus: RingStatus.CALLING },
      { userId: 'legacy', ringStatus: RingStatus.CALLING },
    ]);
  });
});
