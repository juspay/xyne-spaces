import { NativeModules, Platform } from 'react-native';

type NativeLiveActivityModuleShape = {
  startActivity: (startTimeMs: number, externalId: string) => Promise<void>;
  endActivity: () => Promise<void>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

const nativeModule = NativeModules['LiveActivityModule'] as
  NativeLiveActivityModuleShape | undefined;

const isIOS = Platform.OS === 'ios';

/**
 * Lock Screen + Dynamic Island Live Activity showing the live recording
 * timer and a Stop control. Best-effort — a Live Activity failing to start
 * (disabled in Settings, unsupported device) never blocks recording itself.
 */
export const liveActivityModule = {
  startActivity: async (startTimeMs: number, externalId: string): Promise<void> => {
    if (!isIOS || !nativeModule) return;
    try {
      await nativeModule.startActivity(startTimeMs, externalId);
    } catch {
      // Best-effort — see module doc comment.
    }
  },

  endActivity: async (): Promise<void> => {
    if (!isIOS || !nativeModule) return;
    try {
      await nativeModule.endActivity();
    } catch {
      // Best-effort — see module doc comment.
    }
  },
};
