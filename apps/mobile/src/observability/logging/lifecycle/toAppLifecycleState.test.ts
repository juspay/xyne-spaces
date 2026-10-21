import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toAppLifecycleState } from './toAppLifecycleState';

describe('toAppLifecycleState', () => {
  it('maps the active state to foreground', () => {
    assert.equal(toAppLifecycleState('active'), 'foreground');
  });

  it('maps unknown to foreground so Android launch is not treated as background', () => {
    assert.equal(toAppLifecycleState('unknown'), 'foreground');
  });

  it('maps background-like states to background', () => {
    const backgroundStates = ['background', 'inactive', 'extension', null] as const;

    for (const state of backgroundStates) {
      assert.equal(toAppLifecycleState(state), 'background');
    }
  });
});
