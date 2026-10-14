import { Platform } from 'react-native';

import { logger, type EventType } from '@/src/utils/logger';

// Not in the pinned @xyne/shared Event enum yet; the string is what the remote logger ingests.
const CALL_ACTION_EVENT = 'lotus_call_action' as EventType;

/** Where an in-call action came from; the same action can be triggered from several places. */
export type CallActionSource =
  | 'call_screen'
  | 'more_sheet'
  | 'ongoing_banner'
  | 'callkit'
  | 'android_notification'
  | 'push_to_talk'
  | 'room_event';

type CallActionLevel = 'info' | 'warn' | 'error';

/**
 * Logs one in-call action (mute, camera, screen share, audio route, end…) or its outcome.
 * Goes to the device console as `[XCALL][ACTION] <action>` (logcat / Xcode) and to the remote
 * logger as `lotus_call_action`, so a user's call can be reconstructed from Grafana afterwards.
 */
export function logCallAction(
  action: string,
  fields: Record<string, unknown> = {},
  level: CallActionLevel = 'info',
): void {
  const entry = { action, platform: Platform.OS, ...fields };
  // eslint-disable-next-line no-console
  console.log(`[XCALL][ACTION] ${action}`, entry);
  logger[level](CALL_ACTION_EVENT, entry);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
