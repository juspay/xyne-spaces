import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  awaitKeyboardHidden as v2AwaitKeyboardHidden,
  type KeyboardDismissalDriver as V2Driver,
} from '@/src/features/chat/v2/keyboard/awaitKeyboardHidden';

import { awaitKeyboardHidden, type KeyboardDismissalDriver } from '../composer/awaitKeyboardHidden';

const createDriver = (visible: boolean): KeyboardDismissalDriver & { dismissCalls: number } => {
  let isVisible = visible;
  const driver: KeyboardDismissalDriver & { dismissCalls: number } = {
    dismissCalls: 0,
    isVisible: () => isVisible,
    dismiss: async () => {
      driver.dismissCalls += 1;
      isVisible = false;
    },
  };
  return driver;
};

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

describe('awaitKeyboardHidden', (): void => {
  it('does not dismiss when the keyboard was already hidden', async (): Promise<void> => {
    const driver = createDriver(false);
    await awaitKeyboardHidden(driver);
    assert.equal(driver.dismissCalls, 0);
  });

  it('still dismisses when the caller captured visibility before a blur', async (): Promise<void> => {
    const driver = createDriver(false);
    await awaitKeyboardHidden(driver, { wasVisible: true });
    assert.equal(driver.dismissCalls, 1);
  });

  it('returns immediately and never dismisses when wasVisible is explicitly false', async (): Promise<void> => {
    const { driver, dismissCalls } = makeKeyboard({ isVisible: () => true });
    await awaitKeyboardHidden(driver, { wasVisible: false });
    assert.equal(dismissCalls(), 0);
  });

  it('awaits dismiss when the keyboard was visible', async (): Promise<void> => {
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

  it('is bounded when the native hide event never arrives', async (): Promise<void> => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const driver: KeyboardDismissalDriver & { dismissCalls: number } = {
      dismissCalls: 0,
      isVisible: () => true,
      dismiss: () => {
        driver.dismissCalls += 1;
        return new Promise<void>(() => undefined);
      },
    };
    try {
      const wait = awaitKeyboardHidden(driver, { wasVisible: true, timeoutMs: 5 });
      mock.timers.tick(5);
      await wait;
      assert.equal(driver.dismissCalls, 1);
    } finally {
      mock.timers.reset();
    }
  });

  it('does not reject when dismiss rejects', async (): Promise<void> => {
    const { driver } = makeKeyboard({
      isVisible: () => true,
      dismissImpl: () => Promise.reject(new Error('dismiss failed')),
    });
    await assert.doesNotReject(awaitKeyboardHidden(driver, { timeoutMs: 200 }));
  });
});

describe('§8.1 awaitKeyboardHidden characterisation', (): void => {
  it('matches v2 dismiss counting for the wasVisible matrix', async (): Promise<void> => {
    const cases: { visible: boolean; wasVisible?: boolean }[] = [
      { visible: false },
      { visible: true },
      { visible: false, wasVisible: true },
      { visible: true, wasVisible: false },
    ];
    for (const next of cases) {
      const v2 = createDriver(next.visible);
      const v3 = createDriver(next.visible);
      const options = next.wasVisible === undefined ? {} : { wasVisible: next.wasVisible };
      await v2AwaitKeyboardHidden(v2 as V2Driver, options);
      await awaitKeyboardHidden(v3, options);
      assert.equal(v3.dismissCalls, v2.dismissCalls, JSON.stringify(next));
    }
  });
});
