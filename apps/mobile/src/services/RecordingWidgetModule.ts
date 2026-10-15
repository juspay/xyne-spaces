import { NativeModules, NativeEventEmitter, DeviceEventEmitter, Platform } from 'react-native';

import type { RecordingWidgetState } from '@/src/types/recordingWidgetState';

type NativeRecordingWidgetModuleShape = {
  publishState: (
    isRecording: boolean,
    startTimeMs: number,
    externalId: string | null,
    hasError: boolean,
  ) => Promise<void>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

const nativeModule = NativeModules['RecordingWidgetModule'] as
  NativeRecordingWidgetModuleShape | undefined;

export const RECORDING_WIDGET_STOP_EVENT = 'RECORDING_WIDGET_STOP';

// iOS's RecordingWidgetModule is an RCTEventEmitter subclass — its events are
// module-scoped (NativeEventEmitter), not the global DeviceEventEmitter that
// Android's plain-NativeModule VOIP/widget bridge uses.
const iosEventEmitter =
  Platform.OS === 'ios' && nativeModule ? new NativeEventEmitter(nativeModule as never) : null;

/**
 * Bridges recording state to the home-screen widget (Android: SharedPreferences
 * + AppWidgetManager, iOS: App Group UserDefaults + WidgetCenter) and listens
 * for a no-foreground Stop request coming back from the widget/Live Activity
 * (iOS 17+ AppIntent, Android in-process broadcast).
 */
export const recordingWidgetModule = {
  publishState: async (state: RecordingWidgetState): Promise<void> => {
    if (!nativeModule) return;
    try {
      await nativeModule.publishState(
        state.isRecording,
        state.startTimeMs ?? 0,
        state.externalId,
        state.hasError ?? false,
      );
    } catch {
      // Widget state is best-effort — never let a bridge failure affect recording itself.
    }
  },

  /**
   * Fires when the user taps Stop from the widget, Live Activity, or the
   * Android foreground-service notification while the app was never
   * foregrounded. Android passes where the tap came from ('widget' |
   * 'notification'); iOS taps are always the widget/Live Activity.
   * Returns an unsubscribe function.
   */
  addWidgetStopListener: (callback: (source?: string) => void): (() => void) => {
    if (Platform.OS === 'ios') {
      if (!iosEventEmitter) return () => {};
      const sub = iosEventEmitter.addListener(RECORDING_WIDGET_STOP_EVENT, () => callback());
      return () => sub.remove();
    }
    const sub = DeviceEventEmitter.addListener(RECORDING_WIDGET_STOP_EVENT, (source?: string) =>
      callback(source),
    );
    return () => sub.remove();
  },
};
