import { describe, expect, it } from 'vitest';
import type { FlowDefinition } from '../../../../flowUI/types';
import type { PendingAction } from '../XyneAITypes';
import { pendingActionIndex, unpresentedPendingActions } from '../XyneAITypes';

const action = (signature: string, tool = 'spaces-create-ticket'): PendingAction => ({
  id: `id-${signature}`,
  serverType: 'xyne-spaces',
  tool,
  params: { title: 'T' },
  signature,
});

const card = (pendingSignature?: string): FlowDefinition =>
  ({
    version: '2.0',
    screenId: `screen-${pendingSignature ?? 'none'}`,
    components: [],
    ...(pendingSignature ? { data: { pendingSignature } } : {}),
  }) as unknown as FlowDefinition;

describe('unpresentedPendingActions', () => {
  it('hides the action a card already presents', () => {
    const actions = [action('sig-a')];
    expect(unpresentedPendingActions(actions, [card('sig-a')])).toEqual([]);
  });

  it('keeps actions no card presents, so nothing becomes unapprovable', () => {
    const actions = [action('sig-a'), action('sig-b', 'create-agent')];
    expect(unpresentedPendingActions(actions, [card('sig-a')])).toEqual([actions[1]]);
  });

  it('keeps everything when the card failed to post', () => {
    const actions = [action('sig-a')];
    expect(unpresentedPendingActions(actions, [])).toEqual(actions);
    expect(unpresentedPendingActions(actions, undefined)).toEqual(actions);
  });

  it('ignores cards that carry no pending signature', () => {
    const actions = [action('sig-a')];
    // A question/code/chart card, or the ticket card's own re-minted signature.
    expect(unpresentedPendingActions(actions, [card()])).toEqual(actions);
  });

  it('returns an empty list when there are no actions', () => {
    expect(unpresentedPendingActions(undefined, [card('sig-a')])).toEqual([]);
    expect(unpresentedPendingActions([], [card('sig-a')])).toEqual([]);
  });
});

describe('pendingActionIndex', () => {
  it('reports the position in the FULL list, not the visible one', () => {
    const first = action('sig-a');
    const second = action('sig-b', 'create-agent');
    const all = [first, second];
    const visible = unpresentedPendingActions(all, [card('sig-a')]);

    // `second` renders at visible index 0; its stored resolution id is keyed on 1.
    expect(visible).toEqual([second]);
    expect(pendingActionIndex(all, second)).toBe(1);
  });

  it('is stable for an unsuppressed list', () => {
    const all = [action('sig-a'), action('sig-b'), action('sig-c')];
    expect(all.map(a => pendingActionIndex(all, a))).toEqual([0, 1, 2]);
  });

  it('falls back to 0 for an action that is not in the list', () => {
    expect(pendingActionIndex(undefined, action('sig-a'))).toBe(0);
    expect(pendingActionIndex([], action('sig-a'))).toBe(0);
  });
});
