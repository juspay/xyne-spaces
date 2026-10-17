// This module is the single allowed entry point to expo-haptics. Every other
// call site must import { haptics } from here, so the Android branch is
// never bypassed — enforced by no-restricted-imports in eslint.config.mjs.
// eslint-disable-next-line no-restricted-imports
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { settingsActor } from '@/src/machines/settingsMachine';

type HapticExecutor = () => Promise<void>;

export type HapticScenario =
  | 'buttonTap'
  | 'selection'
  | 'longPress'
  | 'success'
  | 'warning'
  | 'error'
  | 'toggleOn'
  | 'toggleOff'
  | 'gestureStart'
  | 'gestureEnd';

const isAndroid = Platform.OS === 'android';
const isWeb = Platform.OS === 'web';

const hapticScenarios: Record<HapticScenario, HapticExecutor> = {
  buttonTap: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),

  selection: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick)
      : Haptics.selectionAsync(),

  longPress: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),

  success: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),

  warning: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),

  error: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),

  toggleOn: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Toggle_On)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),

  toggleOff: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Toggle_Off)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),

  gestureStart: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Gesture_Start)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),

  gestureEnd: () =>
    isAndroid
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Gesture_End)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
};

/**
 * The user-facing master switch (Settings → Haptic feedback).
 *
 * Read per call rather than hoisted to a module const, so flipping the setting
 * takes effect immediately instead of on next launch. `triggerHaptic` is a
 * plain function called outside React, so it reads the actor snapshot directly
 * rather than through the `useSetting` hook. `getSnapshot()` is O(1).
 */
const isHapticsEnabled = (): boolean => settingsActor.getSnapshot().context.appearance.haptics;

/**
 * Fire-and-forget. Never rejects: the native module is absent on web and can
 * fail on devices without a haptic engine, and a missing buzz must never break
 * the interaction that triggered it.
 */
export function triggerHaptic(scenario: HapticScenario): Promise<void> {
  if (isWeb) return Promise.resolve();
  if (!isHapticsEnabled()) return Promise.resolve();
  return hapticScenarios[scenario]().catch(() => undefined);
}

export function withHaptic<Args extends unknown[], ReturnValue>(
  scenario: HapticScenario,
  handler: (...args: Args) => ReturnValue,
) {
  return (...args: Args): ReturnValue => {
    void triggerHaptic(scenario);
    return handler(...args);
  };
}

export const haptics = {
  buttonTap: () => triggerHaptic('buttonTap'),
  selection: () => triggerHaptic('selection'),
  longPress: () => triggerHaptic('longPress'),
  success: () => triggerHaptic('success'),
  warning: () => triggerHaptic('warning'),
  error: () => triggerHaptic('error'),
  toggleOn: () => triggerHaptic('toggleOn'),
  toggleOff: () => triggerHaptic('toggleOff'),
  gestureStart: () => triggerHaptic('gestureStart'),
  gestureEnd: () => triggerHaptic('gestureEnd'),
} as const;
