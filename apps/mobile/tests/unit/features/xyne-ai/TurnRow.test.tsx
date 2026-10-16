import type { ReactElement } from 'react';

import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

import { TurnRow } from '@/src/features/xyne-ai/components/TurnRow';
import type { ChatTurn } from '@/src/features/xyne-ai/model/assistantTurn';

const mockRendered: string[] = [];

jest.mock('uniwind', () => ({ useCSSVariable: (): string => '#000' }));
jest.mock('@/src/features/xyne-ai/components/ContextPickerSheet', () => ({}));
jest.mock('@/src/features/xyne-ai/components/TurnOutputs', () => ({}));

jest.mock('@/src/features/xyne-ai/components/AssistantReply', () => ({
  AssistantReply: ({ turn }: { turn: { messageId: string } }): null => {
    mockRendered.push(turn.messageId);
    return null;
  },
}));

const turn = (id: string): ChatTurn =>
  ({
    id,
    query: id,
    attachments: [],
    context: [],
    reply: { messageId: id, startedAt: 0 },
  }) as never;

const NOOP = (): void => undefined;
const props = {
  isLatest: false,
  isStreaming: false,
  canEdit: false,
  versionIndex: undefined,
  versionTotal: undefined,
  viewerId: 'viewer',
  conversationId: 'conversation',
  onLatestLayout: NOOP,
  onSwitchVersion: NOOP,
  onEdit: NOOP,
  onOpenUrl: NOOP,
  onFlowClose: NOOP,
  onFollowUp: NOOP,
  onRegenerate: NOOP,
  onPendingAction: (): Promise<void> => Promise.resolve(),
};

describe('TurnRow', () => {
  it('does not re-render earlier turns while the latest one streams', () => {
    const first = turn('first');
    const rows = (latest: ChatTurn): ReactElement => (
      <>
        <TurnRow {...props} turn={first} />
        <TurnRow {...props} turn={latest} isLatest isStreaming />
      </>
    );
    const { rerender } = render(rows(turn('second')));
    rerender(rows(turn('second')));

    expect(mockRendered.filter(id => id === 'first')).toHaveLength(1);
    expect(mockRendered.filter(id => id === 'second')).toHaveLength(2);
  });
});
