import { NativeModules, Platform } from 'react-native';

export interface IncomingCallUiState {
  notificationsGranted: boolean;
  fullScreenIntentGranted: boolean | null;
}

type IncomingCallUiNativeModule = {
  getIncomingCallUiState: () => Promise<IncomingCallUiState>;
  openFullScreenIntentSettings: () => Promise<void>;
};

const nativeModule = NativeModules['IncomingCallUiModule'] as
  IncomingCallUiNativeModule | undefined;

const androidFallbackState: IncomingCallUiState = {
  notificationsGranted: false,
  fullScreenIntentGranted: null,
};

export async function getIncomingCallUiState(): Promise<IncomingCallUiState> {
  if (Platform.OS !== 'android') {
    return {
      notificationsGranted: true,
      fullScreenIntentGranted: null,
    };
  }

  if (!nativeModule) {
    return androidFallbackState;
  }

  return nativeModule.getIncomingCallUiState();
}

export async function openFullScreenIntentSettings(): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule) {
    return;
  }

  await nativeModule.openFullScreenIntentSettings();
}

export default {
  getIncomingCallUiState,
  openFullScreenIntentSettings,
};
