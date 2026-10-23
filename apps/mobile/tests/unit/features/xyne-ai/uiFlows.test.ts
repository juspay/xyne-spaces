import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FlowDefinition } from '@xyne/shared';

import type { PendingAction } from '@/src/features/xyne-ai/api/xyneAIEvents';
import {
  reduceAssistantTurn,
  startAssistantTurn,
  turnsFromMessages,
} from '@/src/features/xyne-ai/model/assistantTurn';
import {
  flowMessageId,
  mergeUiFlows,
  unpresentedPendingActions,
} from '@/src/features/xyne-ai/model/uiFlows';

const flow = (screenId: string, data?: Record<string, unknown>): FlowDefinition =>
  ({ version: '2.0', screenId, components: [], state: {}, ...(data && { data }) }) as never;

describe('mergeUiFlows', () => {
  it('appends new cards and replaces a card with the same screen id', () => {
    const first = flow('a');
    const updated = flow('a', { step: 2 });
    assert.deepEqual(mergeUiFlows([first], flow('b')), [first, flow('b')]);
    assert.deepEqual(mergeUiFlows([first, flow('b')], updated), [updated, flow('b')]);
  });

  it('never replaces a tokenized card with an untokenized copy', () => {
    const tokenized = flow('a', { __xyneFlowToken: 'tok' });
    const existing = [tokenized];
    assert.equal(mergeUiFlows(existing, flow('a')), existing);
    assert.equal(mergeUiFlows(existing, flow('a', { __xyneFlowToken: '' })), existing);
    const refreshed = flow('a', { __xyneFlowToken: 'tok2' });
    assert.deepEqual(mergeUiFlows(existing, refreshed), [refreshed]);
  });
});

describe('flowMessageId', () => {
  it('prefers the id the card was minted against', () => {
    assert.equal(flowMessageId(flow('a', { chatMessageId: 'm9' }), 'm1'), 'm9');
    assert.equal(flowMessageId(flow('a'), 'm1'), 'm1');
    assert.equal(flowMessageId(flow('a', { chatMessageId: '' }), undefined), '');
  });
});

describe('unpresentedPendingActions', () => {
  const action = (signature: string): PendingAction => ({
    id: signature,
    serverType: 's',
    tool: 't',
    params: {},
    signature,
    resolution: undefined,
  });

  it('hides only the actions a card presents', () => {
    const actions = [action('x'), action('y')];
    assert.deepEqual(unpresentedPendingActions(actions, [flow('a', { pendingSignature: 'x' })]), [
      actions[1],
    ]);
    assert.deepEqual(unpresentedPendingActions(actions, [flow('a')]), actions);
    assert.deepEqual(unpresentedPendingActions(actions, []), actions);
  });
});

describe('cards on a turn', () => {
  it('collects streamed cards by screen id', () => {
    const turn = [flow('a'), flow('b'), flow('a', { step: 2 })].reduce(
      (current, card) => reduceAssistantTurn(current, { type: 'uiFlow', flow: card }, 0),
      startAssistantTurn(0),
    );
    assert.deepEqual(turn.uiFlows, [flow('a', { step: 2 }), flow('b')]);
  });

  it('restores the cards stored with an answer', () => {
    const [turn] = turnsFromMessages({
      data: [
        { id: 'u1', role: 'user', content: 'Plan it', createdAt: '2026-01-01T10:00:00Z' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Here',
          createdAt: '2026-01-01T10:00:05Z',
          uiFlows: [flow('a'), { bad: true }],
        },
      ],
    });
    assert.deepEqual(turn?.reply.uiFlows, [flow('a')]);
  });
});
