/**
 * Haptics util — platform routing.
 *
 * Lives in jest (`.test.tsx`) rather than the node:test logic suite because it
 * needs `react-native`'s Platform, which logic tests are barred from importing.
 *
 * `src/utils/haptics.ts` reads `Platform.OS` at module scope, so every case has
 * to re-import the module under a fresh mock rather than mutating Platform.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { HapticScenario } from '@/src/utils/haptics';

type ExpoHapticsMock = {
  impactAsync: jest.Mock;
  notificationAsync: jest.Mock;
  selectionAsync: jest.Mock;
  performAndroidHapticsAsync: jest.Mock;
};

const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
  Rigid: 'rigid',
  Soft: 'soft',
} as const;

const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
} as const;

const AndroidHaptics = {
  Virtual_Key: 'virtual-key',
  Segment_Tick: 'segment-tick',
  Long_Press: 'long-press',
  Confirm: 'confirm',
  Context_Click: 'context-click',
  Reject: 'reject',
  Toggle_On: 'toggle-on',
  Toggle_Off: 'toggle-off',
  Gesture_Start: 'gesture-start',
  Gesture_End: 'gesture-end',
} as const;

const ALL_SCENARIOS: HapticScenario[] = [
  'buttonTap',
  'selection',
  'longPress',
  'success',
  'warning',
  'error',
  'toggleOn',
  'toggleOff',
  'gestureStart',
  'gestureEnd',
];

/**
 * The settings machine is mocked rather than imported for real: the genuine
 * module reaches settingsStorage → localStorage → react-native-mmkv, which
 * cannot initialise against the stubbed `react-native` above.
 *
 * `setting.enabled` is mutable so a test can flip the master switch between
 * two calls and prove the value is read per call rather than at module load.
 *
 * @param resolved whether the mocked native module succeeds or rejects
 * @param enabled initial value of the Settings → Haptic feedback switch
 */
const loadHaptics = (
  os: 'ios' | 'android' | 'web',
  resolved = true,
  enabled = true,
): {
  triggerHaptic: (scenario: HapticScenario) => Promise<void>;
  haptics: Record<HapticScenario, () => Promise<void>>;
  native: ExpoHapticsMock;
  setting: { enabled: boolean };
} => {
  jest.resetModules();

  const result = (): Promise<void> =>
    resolved ? Promise.resolve() : Promise.reject(new Error('no haptic engine'));

  const native: ExpoHapticsMock = {
    impactAsync: jest.fn(result),
    notificationAsync: jest.fn(result),
    selectionAsync: jest.fn(result),
    performAndroidHapticsAsync: jest.fn(result),
  };

  const setting = { enabled };

  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  jest.doMock('expo-haptics', () => ({
    ...native,
    ImpactFeedbackStyle,
    NotificationFeedbackType,
    AndroidHaptics,
  }));
  jest.doMock('@/src/machines/settingsMachine', () => ({
    settingsActor: {
      getSnapshot: (): { context: { appearance: { haptics: boolean } } } => ({
        context: { appearance: { haptics: setting.enabled } },
      }),
    },
  }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@/src/utils/haptics') as typeof import('@/src/utils/haptics');
  return {
    triggerHaptic: mod.triggerHaptic,
    haptics: mod.haptics as Record<HapticScenario, () => Promise<void>>,
    native,
    setting,
  };
};

afterEach(() => {
  jest.resetModules();
});

describe('haptics util', () => {
  describe('android', () => {
    it.each([
      ['buttonTap', AndroidHaptics.Virtual_Key],
      ['selection', AndroidHaptics.Segment_Tick],
      ['longPress', AndroidHaptics.Long_Press],
      ['success', AndroidHaptics.Confirm],
      ['warning', AndroidHaptics.Context_Click],
      ['error', AndroidHaptics.Reject],
      ['toggleOn', AndroidHaptics.Toggle_On],
      ['toggleOff', AndroidHaptics.Toggle_Off],
      ['gestureStart', AndroidHaptics.Gesture_Start],
      ['gestureEnd', AndroidHaptics.Gesture_End],
    ] as [HapticScenario, string][])(
      '%s routes to the native android constant %s',
      async (scenario, constant) => {
        const { triggerHaptic, native } = loadHaptics('android');

        await triggerHaptic(scenario);

        expect(native.performAndroidHapticsAsync).toHaveBeenCalledWith(constant);
        expect(native.impactAsync).not.toHaveBeenCalled();
        expect(native.selectionAsync).not.toHaveBeenCalled();
        expect(native.notificationAsync).not.toHaveBeenCalled();
      },
    );

    it('never falls back to the iOS-tuned APIs for any scenario', async () => {
      const { triggerHaptic, native } = loadHaptics('android');

      await Promise.all(ALL_SCENARIOS.map(scenario => triggerHaptic(scenario)));

      expect(native.performAndroidHapticsAsync).toHaveBeenCalledTimes(ALL_SCENARIOS.length);
      expect(native.impactAsync).not.toHaveBeenCalled();
      expect(native.selectionAsync).not.toHaveBeenCalled();
      expect(native.notificationAsync).not.toHaveBeenCalled();
    });
  });

  describe('ios', () => {
    it.each([
      ['buttonTap', ImpactFeedbackStyle.Light],
      ['longPress', ImpactFeedbackStyle.Medium],
      ['toggleOn', ImpactFeedbackStyle.Light],
      ['toggleOff', ImpactFeedbackStyle.Light],
      ['gestureStart', ImpactFeedbackStyle.Rigid],
      ['gestureEnd', ImpactFeedbackStyle.Soft],
    ] as [HapticScenario, string][])('%s uses impactAsync(%s)', async (scenario, style) => {
      const { triggerHaptic, native } = loadHaptics('ios');

      await triggerHaptic(scenario);

      expect(native.impactAsync).toHaveBeenCalledWith(style);
      expect(native.performAndroidHapticsAsync).not.toHaveBeenCalled();
    });

    it.each([
      ['success', NotificationFeedbackType.Success],
      ['warning', NotificationFeedbackType.Warning],
      ['error', NotificationFeedbackType.Error],
    ] as [HapticScenario, string][])('%s uses notificationAsync(%s)', async (scenario, type) => {
      const { triggerHaptic, native } = loadHaptics('ios');

      await triggerHaptic(scenario);

      expect(native.notificationAsync).toHaveBeenCalledWith(type);
      expect(native.performAndroidHapticsAsync).not.toHaveBeenCalled();
    });

    it('selection uses selectionAsync', async () => {
      const { triggerHaptic, native } = loadHaptics('ios');

      await triggerHaptic('selection');

      expect(native.selectionAsync).toHaveBeenCalledTimes(1);
      expect(native.performAndroidHapticsAsync).not.toHaveBeenCalled();
    });
  });

  describe('web', () => {
    it('no-ops without touching the native module', async () => {
      const { triggerHaptic, native } = loadHaptics('web');

      await Promise.all(ALL_SCENARIOS.map(scenario => triggerHaptic(scenario)));

      expect(native.impactAsync).not.toHaveBeenCalled();
      expect(native.selectionAsync).not.toHaveBeenCalled();
      expect(native.notificationAsync).not.toHaveBeenCalled();
      expect(native.performAndroidHapticsAsync).not.toHaveBeenCalled();
    });
  });

  describe('failure handling', () => {
    it('swallows a rejecting native module on ios', async () => {
      const { triggerHaptic } = loadHaptics('ios', false);

      await expect(triggerHaptic('buttonTap')).resolves.toBeUndefined();
    });

    it('swallows a rejecting native module on android', async () => {
      const { triggerHaptic } = loadHaptics('android', false);

      await expect(triggerHaptic('success')).resolves.toBeUndefined();
    });
  });

  describe('haptics facade', () => {
    it('exposes every scenario and delegates to the same routing', async () => {
      const { haptics, native } = loadHaptics('android');

      for (const scenario of ALL_SCENARIOS) {
        expect(typeof haptics[scenario]).toBe('function');
      }

      await haptics.buttonTap();

      expect(native.performAndroidHapticsAsync).toHaveBeenCalledWith(AndroidHaptics.Virtual_Key);
    });
  });

  describe('withHaptic', () => {
    it('fires the haptic and still returns the handler result', async () => {
      const { haptics: h, native } = loadHaptics('ios');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { withHaptic } = require('@/src/utils/haptics') as typeof import('@/src/utils/haptics');
      void h;

      const handler = jest.fn((a: number, b: number) => a + b);
      const wrapped = withHaptic('selection', handler);

      expect(wrapped(2, 3)).toBe(5);
      expect(handler).toHaveBeenCalledWith(2, 3);
      expect(native.selectionAsync).toHaveBeenCalledTimes(1);
    });

    it('still runs the handler when haptics are disabled', async () => {
      const { native } = loadHaptics('ios', true, false);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { withHaptic } = require('@/src/utils/haptics') as typeof import('@/src/utils/haptics');

      const handler = jest.fn((a: number, b: number) => a + b);

      expect(withHaptic('selection', handler)(2, 3)).toBe(5);
      expect(handler).toHaveBeenCalledWith(2, 3);
      expect(native.selectionAsync).not.toHaveBeenCalled();
    });
  });

  describe('master switch (Settings → Haptic feedback)', () => {
    it.each(['ios', 'android'] as const)(
      'no-ops for every scenario on %s when disabled',
      async os => {
        const { triggerHaptic, native } = loadHaptics(os, true, false);

        await Promise.all(ALL_SCENARIOS.map(scenario => triggerHaptic(scenario)));

        expect(native.impactAsync).not.toHaveBeenCalled();
        expect(native.selectionAsync).not.toHaveBeenCalled();
        expect(native.notificationAsync).not.toHaveBeenCalled();
        expect(native.performAndroidHapticsAsync).not.toHaveBeenCalled();
      },
    );

    it('fires for every scenario when enabled', async () => {
      const { triggerHaptic, native } = loadHaptics('android', true, true);

      await Promise.all(ALL_SCENARIOS.map(scenario => triggerHaptic(scenario)));

      expect(native.performAndroidHapticsAsync).toHaveBeenCalledTimes(ALL_SCENARIOS.length);
    });

    it('resolves rather than rejecting when disabled', async () => {
      const { triggerHaptic } = loadHaptics('ios', true, false);

      await expect(triggerHaptic('buttonTap')).resolves.toBeUndefined();
    });

    // The setting is read inside triggerHaptic rather than hoisted to a module
    // const. That is what makes the toggle take effect immediately instead of
    // on next launch, so it is worth pinning.
    it('reads the setting per call, not once at module load', async () => {
      const { triggerHaptic, native, setting } = loadHaptics('ios', true, true);

      await triggerHaptic('buttonTap');
      expect(native.impactAsync).toHaveBeenCalledTimes(1);

      setting.enabled = false;
      await triggerHaptic('buttonTap');
      expect(native.impactAsync).toHaveBeenCalledTimes(1);

      setting.enabled = true;
      await triggerHaptic('buttonTap');
      expect(native.impactAsync).toHaveBeenCalledTimes(2);
    });
  });
});
