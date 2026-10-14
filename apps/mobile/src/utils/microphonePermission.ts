import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import { Camera } from 'react-native-vision-camera';

function showMicrophoneBlockedAlert(): void {
  Alert.alert(
    'Microphone access is off',
    'Allow microphone access in Settings so others can hear you. You will stay muted until then.',
    [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: (): void => {
          void Linking.openSettings();
        },
      },
    ],
  );
}

export async function hasMicrophonePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  }
  return Camera.getMicrophonePermissionStatus() === 'granted';
}

/** `blocked`: the OS won't prompt any more, so the Open Settings alert was shown instead. */
export type MicrophonePermissionResult = 'granted' | 'denied' | 'blocked' | 'error';

/**
 * Asks for microphone access, e.g. when a participant who declined it tries to unmute.
 * Shows the system prompt while the OS still allows it; once the OS won't prompt again
 * (iOS after the first denial, Android after "Don't allow" twice) offers Settings instead.
 */
export async function ensureMicrophonePermission(): Promise<MicrophonePermissionResult> {
  try {
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        showMicrophoneBlockedAlert();
        return 'blocked';
      }
      return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
    }

    const status = Camera.getMicrophonePermissionStatus();
    if (status === 'granted') {
      return 'granted';
    }
    if (status === 'not-determined') {
      return (await Camera.requestMicrophonePermission()) === 'granted' ? 'granted' : 'denied';
    }
    showMicrophoneBlockedAlert();
    return 'blocked';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[microphonePermission] Failed to request microphone permission', error);
    return 'error';
  }
}
