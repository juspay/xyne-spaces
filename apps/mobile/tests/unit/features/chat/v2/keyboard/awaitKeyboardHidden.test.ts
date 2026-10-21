import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  awaitKeyboardHidden,
  type KeyboardDismissalDriver,
} from '@/src/features/chat/v2/keyboard/awaitKeyboardHidden';

const makeKeyboard = (
  overrides: Partial<KeyboardDismissalDriver> & { dismissImpl?: () => Promise<void> },
): { driver: KeyboardDismissalDriver; dismissCalls: () => number } => {
  let calls = 0;
  const driver: KeyboardDismissalDriver = {
    isVisible: overrides.isVisible ?? (() => true),
    dismiss:
      overrides.dismiss ??
      (() => {
        calls += 1;
        return (overrides.dismissImpl ?? (() => Promise.resolve()))();
      }),
  };
  return { driver, dismissCalls: () => calls };
};

describe('awaitKeyboardHidden', () => {
  it('returns immediately and never dismisses when wasVisible is explicitly false', async () => {
    const { driver, dismissCalls } = makeKeyboard({ isVisible: () => true });
    await awaitKeyboardHidden(driver, { wasVisible: false });
    assert.equal(dismissCalls(), 0);
  });

  it('returns immediately when the keyboard is not visible by default', async () => {
    const { driver, dismissCalls } = makeKeyboard({ isVisible: () => false });
    await awaitKeyboardHidden(driver);
    assert.equal(dismissCalls(), 0);
  });

  it('awaits dismiss when the keyboard was visible', async () => {
    let resolved = false;
    const { driver, dismissCalls } = makeKeyboard({
      isVisible: () => true,
      dismissImpl: () =>
        new Promise<void>(resolve =>
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 5),
        ),
    });
    await awaitKeyboardHidden(driver, { timeoutMs: 200 });
    assert.equal(dismissCalls(), 1);
    assert.equal(resolved, true);
  });

  it('resolves via the timeout when the hide event never fires', async () => {
    const { driver } = makeKeyboard({
      isVisible: () => true,
      dismissImpl: () => new Promise<void>(() => undefined),
    });
    const start = Date.now();
    await awaitKeyboardHidden(driver, { timeoutMs: 10 });
    assert.ok(Date.now() - start < 500, 'should resolve promptly via timeout');
  });

  it('does not reject when dismiss rejects', async () => {
    const { driver } = makeKeyboard({
      isVisible: () => true,
      dismissImpl: () => Promise.reject(new Error('dismiss failed')),
    });
    await assert.doesNotReject(awaitKeyboardHidden(driver, { timeoutMs: 200 }));
  });

  it('honours an explicit wasVisible=true even when isVisible() reports false', async () => {
    const { driver, dismissCalls } = makeKeyboard({ isVisible: () => false });
    await awaitKeyboardHidden(driver, { wasVisible: true, timeoutMs: 50 });
    assert.equal(dismissCalls(), 1);
  });
});
