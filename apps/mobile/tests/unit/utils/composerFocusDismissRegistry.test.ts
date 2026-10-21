import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dismissRegisteredComposerFocus,
  registerComposerFocusDismissHandler,
} from '@/src/utils/composerFocusDismissRegistry';

describe('composerFocusDismissRegistry', () => {
  it('invokes a registered handler on dismiss', () => {
    let calls = 0;
    const unregister = registerComposerFocusDismissHandler(() => {
      calls += 1;
    });
    dismissRegisteredComposerFocus();
    assert.equal(calls, 1);
    unregister();
  });

  it('stops invoking a handler after it is unregistered', () => {
    let calls = 0;
    const unregister = registerComposerFocusDismissHandler(() => {
      calls += 1;
    });
    unregister();
    dismissRegisteredComposerFocus();
    assert.equal(calls, 0);
  });

  it('invokes every registered handler', () => {
    let a = 0;
    let b = 0;
    const unregisterA = registerComposerFocusDismissHandler(() => {
      a += 1;
    });
    const unregisterB = registerComposerFocusDismissHandler(() => {
      b += 1;
    });
    dismissRegisteredComposerFocus();
    assert.equal(a, 1);
    assert.equal(b, 1);
    unregisterA();
    unregisterB();
  });

  it('does not throw when there are no handlers', () => {
    assert.doesNotThrow(() => dismissRegisteredComposerFocus());
  });
});
