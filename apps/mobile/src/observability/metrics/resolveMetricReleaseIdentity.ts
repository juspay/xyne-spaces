import { LOGGER_CONFIG } from '../../config';
import { ReactNativeDeviceInfo } from '../logging/device/ReactNativeDeviceInfo';
import { firstKnownReleaseValue } from './config/firstKnownReleaseValue';

const deviceInfo = new ReactNativeDeviceInfo();

/**
 * Dashboard variables filter `service_version` / `app_build_version`. Logs
 * already prefer `react-native-device-info` (Android `versionName` /
 * `versionCode`). Expo constants are often `unknown` in a headless FCM wake,
 * which made Android metrics miss the version dropdown.
 */
export function resolveMetricReleaseIdentity(): Readonly<{
  serviceVersion: string;
  buildVersion: string;
}> {
  const device = deviceInfo.snapshot();

  return {
    serviceVersion: firstKnownReleaseValue(device.appVersion, LOGGER_CONFIG.version),
    buildVersion: firstKnownReleaseValue(device.buildVersion, LOGGER_CONFIG.buildVersion),
  };
}
