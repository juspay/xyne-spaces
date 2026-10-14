export const MESSAGE_NOTIFICATION_TYPES = new Set([
  'CHANNEL_MESSAGE',
  'DIRECT_MESSAGE',
  'THREAD_REPLY',
  'THREAD_MENTION',
  'MENTION',
]);

export const CALL_NOTIFICATION_TYPES = new Set([
  'INCOMING_CALL',
  'CALL_DISMISS',
  'MISSED_CALL',
  'ONGOING_CALL',
]);

export const CONTROL_NOTIFICATION_TYPES = new Set([
  'CHANNEL_READ',
  'THREAD_READ',
  'MESSAGE_DELETED',
  'MESSAGE_EDITED',
]);

export const REMINDER_NOTIFICATION_TYPES = new Set(['CALL_UPDATED']);

/** Standalone ticket events from the backend, e.g. TICKET_PRIORITY_CHANGED. */
export function isTicketNotificationType(type: string): boolean {
  return type.startsWith('TICKET_');
}
