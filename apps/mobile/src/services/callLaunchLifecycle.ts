import AsyncStorage from '@react-native-async-storage/async-storage';

import { cacheMmkv } from '@/src/storage/mmkv/instances';

/**
 * Pending call actions are scoped to a monotonically increasing session
 * marker. A successfully persisted marker makes an old AsyncStorage value
 * harmless even when a best-effort deletion is interrupted by app termination;
 * an unavailable marker fails closed instead of selecting any pending value.
 */
export const LEGACY_PENDING_CALL_ACTION_KEY = '@lotus_pending_call_action';
const PENDING_CALL_ACTION_KEY_PREFIX = `${LEGACY_PENDING_CALL_ACTION_KEY}:`;
const PENDING_CALL_ACTION_SESSION_MARKER_KEY = '@lotus_pending_call_action_session_marker';

let lifecycleGeneration = 0;

function readSessionMarker(): number | null {
  try {
    const marker = cacheMmkv.getNumber(PENDING_CALL_ACTION_SESSION_MARKER_KEY);
    if (marker === undefined) return 0;
    return typeof marker === 'number' && Number.isSafeInteger(marker) && marker >= 0
      ? marker
      : null;
  } catch {
    // An unavailable marker is not a fresh session. Callers must fail closed
    // rather than accidentally selecting a stale :0 action after relaunch.
    return null;
  }
}

function retireSession(): number | null {
  const previousMarker = readSessionMarker();
  lifecycleGeneration += 1;
  if (previousMarker === null) return null;
  try {
    cacheMmkv.set(PENDING_CALL_ACTION_SESSION_MARKER_KEY, previousMarker + 1);
  } catch {
    // The in-memory generation still fail-closes the current process. Cleanup
    // also attempts to retire the old namespaced AsyncStorage key below.
  }
  return previousMarker;
}

export function getCallLaunchLifecycleGeneration(): number {
  return lifecycleGeneration;
}

export function isCurrentCallLaunchLifecycle(generation: number): boolean {
  return generation === lifecycleGeneration;
}

export function getCallLaunchSessionMarker(): number | null {
  return readSessionMarker();
}

export function pendingCallActionKey(sessionMarker: number): string {
  return `${PENDING_CALL_ACTION_KEY_PREFIX}${sessionMarker}`;
}

/** Invalidate in-flight work and make the current session marker obsolete. */
export function invalidateCallLaunchSession(): void {
  retireSession();
}

/**
 * Retire the pending action for the session that started cleanup. The
 * generation check prevents a delayed cleanup callback from touching a newer
 * account/session. The versioned key prevents a late remove from deleting a
 * new session's action.
 */
export async function clearPendingCallActionForSession(expectedGeneration: number): Promise<void> {
  if (!isCurrentCallLaunchLifecycle(expectedGeneration)) return;
  const retiredMarker = retireSession();
  if (retiredMarker === null) {
    await AsyncStorage.removeItem(LEGACY_PENDING_CALL_ACTION_KEY);
    return;
  }
  await Promise.all([
    AsyncStorage.removeItem(pendingCallActionKey(retiredMarker)),
    AsyncStorage.removeItem(LEGACY_PENDING_CALL_ACTION_KEY),
  ]);
}
