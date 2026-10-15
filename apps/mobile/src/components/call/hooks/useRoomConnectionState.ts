import { ConnectionState, RoomEvent, type Room } from 'livekit-client';

import { useLiveKitValue } from './useLiveKitValue';

const EVENTS: readonly string[] = [RoomEvent.ConnectionStateChanged];
const readState = (room: Room): ConnectionState => room.state;

/**
 * The room's real LiveKit connection state. The room machine's copy maps *Reconnecting* onto
 * *Connecting* in native mode (and can lag), so anything that needs to tell a reconnect from a
 * fresh connect — the status line, the network banner — reads it from the room itself.
 */
export function useRoomConnectionState(room: Room | null): ConnectionState {
  return useLiveKitValue(room, EVENTS, readState, ConnectionState.Disconnected);
}
