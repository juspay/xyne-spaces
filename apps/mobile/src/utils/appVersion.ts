/**
 * Native app version strings, resolved once at import time.
 *
 * `react-native-device-info` reads the values baked into the binary, so they stay
 * correct for OTA-updated builds where `app.config.js` is not the source of truth:
 * - `getVersion()`     → `CFBundleShortVersionString` (iOS) / `versionName` (Android)
 * - `getBuildNumber()` → `CFBundleVersion` (iOS) / `versionCode` (Android)
 *
 * Web has no native binary, so it falls back to the Expo config version and shows
 * no build number.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

const isNative = Platform.OS !== 'web';

/** Marketing version, e.g. `2.1.1`. Empty when unavailable. */
export const APP_VERSION = isNative
  ? DeviceInfo.getVersion()
  : (Constants.expoConfig?.version ?? '');

/** iOS build number / Android version code, e.g. `201`. Empty when unavailable. */
export const APP_BUILD_NUMBER = ((): string => {
  if (!isNative) {
    return '';
  }
  const build = DeviceInfo.getBuildNumber();
  return !build || build === 'unknown' ? '' : String(build);
})();

/** Display label, e.g. `2.1.1(201)` — drops the parens when no build number exists. */
export const APP_VERSION_LABEL = APP_VERSION
  ? APP_BUILD_NUMBER
    ? `${APP_VERSION}(${APP_BUILD_NUMBER})`
    : APP_VERSION
  : '';
