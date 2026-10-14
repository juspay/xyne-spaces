import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { awaitKeyboardHidden, type KeyboardDismissalDriver } from './awaitKeyboardHidden';

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

describe('awaitKeyboardHidden', () => {
  it('does not dismiss when the keyboard was already hidden', async () => {
    const driver = createDriver(false);

    await awaitKeyboardHidden(driver);

    assert.equal(driver.dismissCalls, 0);
  });

  it('still dismisses when the caller captured visibility before a blur', async () => {
    const driver = createDriver(false);

    await awaitKeyboardHidden(driver, { wasVisible: true });

    assert.equal(driver.dismissCalls, 1);
  });

  it('is bounded when the native hide event never arrives', async () => {
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
});
