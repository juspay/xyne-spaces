import { describe, it, expect } from 'vitest';
import type { FlowDefinition } from '@xyne/shared';
import { mergeUiFlows } from '../../../components/Chat/XyneAISidebar/utils/XyneAITypes';

const flow = (screenId: string, opts: { token?: string; phase?: string } = {}): FlowDefinition =>
  ({
    version: '2.0',
    screenId,
    components: [
      { id: 'questions', type: 'user_question', props: { phase: opts.phase ?? 'pending' } },
    ],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    data: { ...(opts.token ? { __xyneFlowToken: opts.token } : {}) },
    state: {
      values: {},
      touched: {},
      errors: {},
      submitting: false,
      submitted: false,
      history: [],
      loadingComponentIds: [],
    },
  }) as unknown as FlowDefinition;

describe('mergeUiFlows', () => {
  it('appends a new card', () => {
    expect(mergeUiFlows(undefined, flow('a')).map(f => f.screenId)).toEqual(['a']);
    expect(mergeUiFlows([flow('a')], flow('b')).map(f => f.screenId)).toEqual(['a', 'b']);
  });

  it('dedupes by screenId rather than appending a duplicate', () => {
    const merged = mergeUiFlows([flow('a'), flow('b')], flow('a'));
    expect(merged.map(f => f.screenId)).toEqual(['a', 'b']);
  });

  it('lets a later version replace an earlier one (pending -> answered)', () => {
    const merged = mergeUiFlows(
      [flow('a', { token: 't1', phase: 'pending' })],
      flow('a', { token: 't1', phase: 'answered' }),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.components[0]!.props!['phase']).toBe('answered');
  });

  it('never lets an untokenized copy overwrite a tokenized one', () => {
    const merged = mergeUiFlows([flow('a', { token: 'real' })], flow('a'));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.data?.['__xyneFlowToken']).toBe('real');
  });

  it('does allow a tokenized copy to replace an untokenized one', () => {
    const merged = mergeUiFlows([flow('a')], flow('a', { token: 'fresh' }));
    expect(merged[0]!.data?.['__xyneFlowToken']).toBe('fresh');
  });

  it('treats an empty-string token as absent', () => {
    const merged = mergeUiFlows([flow('a', { token: 'real' })], flow('a', { token: '' }));
    expect(merged[0]!.data?.['__xyneFlowToken']).toBe('real');
  });

  it('does not mutate the input array', () => {
    const existing = [flow('a')];
    mergeUiFlows(existing, flow('b'));
    expect(existing).toHaveLength(1);
  });
});
