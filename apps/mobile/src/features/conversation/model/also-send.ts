import type { RoomKind } from './room-title';

/**
 * The thread reply's "Also send to …" choice: the channel by name once it is
 * known, and a person or group chat as the conversation it belongs to.
 */
export function alsoSendLabel(name: string, kind: RoomKind): string {
  if (kind !== 'channel') return 'Also send to conversation';
  const trimmed = name.trim();
  return trimmed ? `Also send to #${trimmed}` : 'Also send to channel';
}
