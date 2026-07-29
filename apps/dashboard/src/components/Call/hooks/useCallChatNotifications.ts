import { useEffect } from 'react';
import type { Room, RemoteParticipant } from 'livekit-client';
import { RoomEvent } from 'livekit-client';
import { toast } from 'sonner';

/**
 * Subscribes to LiveKit DataReceived events for call-chat messages
 * and shows a toast for each incoming message from other participants.
 */
export function useCallChatNotifications(
  room: Room | null,
  localParticipantId: string | null,
  onNewMessage?: () => void,
): void {
  useEffect(() => {
    if (!room || !localParticipantId) return;

    const handleDataReceived = (
      payload: Uint8Array,
      _participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ): void => {
      if (topic !== 'call-chat') return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (parsed['type'] !== 'call-chat-message') return;
      if (parsed['participantId'] === localParticipantId) return;

      const displayName = parsed['displayName'] as string;
      const message = parsed['message'] as string;
      if (displayName && message) {
        onNewMessage?.();
        toast.info(`${displayName}: ${message}`, { duration: 4000 });
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, localParticipantId, onNewMessage]);
}
