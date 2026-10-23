import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';

/** Kept under the logger's original key so existing installs keep their id. */
const STORAGE_KEY_DEVICE_ID = '@lotus/logger_session_id';

let deviceIdPromise: Promise<string> | null = null;

async function loadOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(STORAGE_KEY_DEVICE_ID);
  if (existing) return existing;
  const created = uuidv4();
  await AsyncStorage.setItem(STORAGE_KEY_DEVICE_ID, created);
  return created;
}

/**
 * The persistent per-install id sent as `x-device-id`.
 *
 * Loaded on first use rather than by the logger, whose initialization is
 * deferred until after the first frame: requests sent before then went out
 * without the header. Cached, so only the first caller pays for the read and
 * concurrent callers never create two ids.
 */
export function getDeviceId(): Promise<string> {
  deviceIdPromise ??= loadOrCreateDeviceId().catch(error => {
    deviceIdPromise = null;
    throw error;
  });
  return deviceIdPromise;
}
