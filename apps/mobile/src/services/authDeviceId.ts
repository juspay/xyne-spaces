import * as SecureStore from 'expo-secure-store';
import { v4 as uuidv4 } from 'uuid';

import { getString, setString } from './localStorage';

/**
 * The `x-device-id` sent with every request. The backend keeps one auth session per
 * device key, so the key must never travel to another phone. It lives in SecureStore as
 * a this-device-only item: iOS never restores it onto another device, and Android
 * excludes SecureStore from cloud backup and device transfer (withAndroidBackupProtection).
 */
const DEVICE_ID_KEY = 'lotus_auth_device_id_v1';
const DEVICE_ID_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * A copy of the device id in ordinary storage, which backup and device transfer do carry.
 * Finding it without the device-only id means this app's data was restored onto a new
 * install or another phone, cookie jar included.
 */
const BACKED_UP_DEVICE_ID_KEY = '@lotus/auth_device_id_backed_up';

interface DeviceIdentity {
  deviceId: string;
  /** This install's data (and its `xs`) came from another install via backup or transfer. */
  restoredFromAnotherInstall: boolean;
}

let identity: Promise<DeviceIdentity> | null = null;

// Every request awaits the device id, so nothing on this path may throw: a storage error
// must cost at most the restore detection, never the request itself.
function readBackedUpDeviceId(): string | null {
  try {
    return getString(BACKED_UP_DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

function writeBackedUpDeviceId(deviceId: string): void {
  try {
    setString(BACKED_UP_DEVICE_ID_KEY, deviceId);
  } catch {
    // Only the restore detection on a later launch depends on it.
  }
}

async function loadDeviceIdentity(): Promise<DeviceIdentity> {
  const backedUpId = readBackedUpDeviceId();
  let storedId: string | null;
  try {
    storedId = await SecureStore.getItemAsync(DEVICE_ID_KEY, DEVICE_ID_OPTIONS);
  } catch {
    // Unreadable is not missing (e.g. before the first unlock): never persist a new id or
    // call this a restore on the strength of it, and never borrow the backed-up copy,
    // which may be another phone's. Use a throwaway id and retry on the next call.
    identity = null;
    return { deviceId: uuidv4(), restoredFromAnotherInstall: false };
  }

  if (storedId) {
    if (backedUpId !== storedId) {
      writeBackedUpDeviceId(storedId);
    }
    return { deviceId: storedId, restoredFromAnotherInstall: false };
  }

  const deviceId = uuidv4();
  try {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId, DEVICE_ID_OPTIONS);
    writeBackedUpDeviceId(deviceId);
  } catch {
    // Not persisted: keep this id for the process and decide again on the next launch.
  }
  // No backed-up copy either: a fresh install, or the first run of a build that
  // introduced this id. Only a backed-up copy without its device-only original is a restore.
  return { deviceId, restoredFromAnotherInstall: backedUpId !== null };
}

/**
 * One shared load, so concurrent first callers (a login racing start-up) all get the same
 * id instead of each minting and storing their own.
 */
function resolveDeviceIdentity(): Promise<DeviceIdentity> {
  identity ??= loadDeviceIdentity();
  return identity;
}

/** This install's device key, created on first use. */
export async function getAuthDeviceId(): Promise<string> {
  return (await resolveDeviceIdentity()).deviceId;
}

/**
 * Whether this launch runs on data restored from another install. Its `xs` and cookies
 * belong to that install's session, so they must be dropped rather than refreshed: two
 * holders of one `xs` share one session, and signing out on either ends it on both.
 */
export async function isRestoredFromAnotherInstall(): Promise<boolean> {
  return (await resolveDeviceIdentity()).restoredFromAnotherInstall;
}
