import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

let iosLaunchUrl: Promise<string | null> | undefined;

/**
 * The URL that launched the app. With the iOS scene lifecycle the launch URL reaches the scene
 * delegate after React Native has started, so `getInitialURL()` is null and expo-linking's
 * `getLinkingURL()` holds it instead. That value tracks the latest link, so it is read once.
 */
export function getInitialLinkingURL(): Promise<string | null> {
  if (Platform.OS !== 'ios') return Linking.getInitialURL();
  iosLaunchUrl ??= Linking.getInitialURL().then(url => url ?? Linking.getLinkingURL());
  return iosLaunchUrl;
}
