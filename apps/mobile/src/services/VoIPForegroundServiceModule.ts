import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';

type NativeVoipModuleShape = {
  /** Resolves with the service type it ran as; null on binaries that predate that. */
  startService: (startedAt: number) => Promise<string | null>;
  /** Missing on binaries built before recording mode; OTA bundles can outrun native. */
  startRecordingService?: (startedAt: number) => Promise<void>;
  stopService: () => Promise<void>;
  /** Missing on binaries whose call service still requires RECORD_AUDIO to start. */
  supportsCallWithoutMicrophone?: boolean;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

const nativeModule = NativeModules['VoIPForegroundServiceModule'] as
  NativeVoipModuleShape | undefined;

const isAndroid = Platform.OS === 'android';

export const VOIP_END_CALL_EVENT = 'VOIP_END_CALL';

export const voipForegroundServiceModule = {
  /** Whether a call can run without mic access; only Android's service ever needed it. */
  supportsCallWithoutMicrophone: (): boolean =>
    !isAndroid || !nativeModule || nativeModule.supportsCallWithoutMicrophone === true,

  /**
   * Ongoing call: "Call in progress" with an End Call button (VOIP_END_CALL).
   * Resolves with the foreground-service type it ran as, or undefined when there's no service.
   */
  start: async (startedAt?: number): Promise<string | null | undefined> => {
    if (!isAndroid || !nativeModule) {
      return undefined;
    }
    return nativeModule.startService(startedAt ?? Date.now());
  },

  /**
   * Same foreground service for a headless recording: "Recording in progress"
   * with a Stop button that fires the widget's RECORDING_WIDGET_STOP path.
   * Falls back to the call notification on binaries that predate it.
   */
  startRecording: async (startedAt: number): Promise<void> => {
    if (!isAndroid || !nativeModule) {
      return;
    }
    if (nativeModule.startRecordingService) {
      await nativeModule.startRecordingService(startedAt);
    } else {
      await nativeModule.startService(startedAt);
    }
  },

  stop: async (): Promise<void> => {
    if (!isAndroid || !nativeModule) {
      return;
    }
    await nativeModule.stopService();
  },

  /**
   * Listen for the "End Call" action pressed from the notification.
   * Returns an unsubscribe function.
   */
  addEndCallListener: (callback: () => void): (() => void) => {
    if (!isAndroid) return () => {};
    const sub = DeviceEventEmitter.addListener(VOIP_END_CALL_EVENT, callback);
    return () => sub.remove();
  },
};
