/**
 * The DM list keeps its previous rows when the new ones are equivalent. A preview decrypted
 * after the transit key arrives has the same ids and timestamps, so it must still re-render.
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@rocicorp/zero', () => ({}));
jest.mock('@xstate/react', () => ({}));
jest.mock('@xyne/shared', () => ({ ChannelScopeType: {} }));
jest.mock('@xyne/shared/machines', () => ({}));
jest.mock('@xyne/shared/hooks', () => ({}));
jest.mock('@/src/hooks/useZero', () => ({}));
jest.mock('@/src/hooks/useCachedQuery', () => ({}));
jest.mock('@/src/zero/queries', () => ({}));
jest.mock('@/src/utils/logger', () => ({ logger: {}, Event: {} }));
jest.mock('@/src/utils/listSyncTelemetry', () => ({}));
jest.mock('@/src/hooks/useForegroundListSyncProbe', () => ({}));
jest.mock('@/src/hooks/useListLiveUpdateProbe', () => ({}));

const { areDmRowsEquivalent } =
  require('@/src/hooks/useDmsPaginatedMessagesV2') as typeof import('@/src/hooks/useDmsPaginatedMessagesV2');

type Rows = Parameters<typeof areDmRowsEquivalent>[0];

const rows = (initialMessageMd: string): Rows =>
  [
    {
      channelId: 'c1',
      lastActivityAt: 100,
      participantCount: 2,
      channel: {
        id: 'c1',
        name: 'dm',
        conversations: [
          {
            conversationId: 'conv1',
            initialMessageId: 'm1',
            lastActivityAt: 100,
            initial_message_md: initialMessageMd,
          },
        ],
      },
    },
  ] as unknown as Rows;

describe('areDmRowsEquivalent', () => {
  it('treats identical rows as equivalent', () => {
    expect(areDmRowsEquivalent(rows('content: hi'), rows('content: hi'))).toBe(true);
  });

  it('is not equivalent when only initial_message_md changed (ciphertext to decrypted preview)', () => {
    expect(areDmRowsEquivalent(rows('content: ENC:v1|tk-1|abc'), rows('content: hi'))).toBe(false);
  });
});
