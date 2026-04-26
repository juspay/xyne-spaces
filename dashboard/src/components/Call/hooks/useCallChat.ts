import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import type { RemoteParticipant, Room } from 'livekit-client';
import { callLobbyService } from '../../../services/Call/callLobbyService';
import { callChatService } from '../../../services/Call/callChatService';
import type { CallChatMessage } from '@xyne/shared';

export const CALL_CHAT_TOPIC = 'call-chat';

export interface ChatMessage extends CallChatMessage {
  isLocal: boolean;
}

interface CallChatDataMessage {
  type: 'call-chat-message';
  id: string;
  participantId: string;
  displayName: string;
  message: string;
  createdAt: string;
  isExternal: boolean;
}

function isCallChatMessage(value: unknown): value is CallChatDataMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['type'] === 'call-chat-message' &&
    typeof v['id'] === 'string' &&
    typeof v['participantId'] === 'string' &&
    typeof v['displayName'] === 'string' &&
    typeof v['message'] === 'string' &&
    typeof v['createdAt'] === 'string' &&
    typeof v['isExternal'] === 'boolean'
  );
}

export interface UseCallChatReturn {
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
}

export function useCallChat(
  room: Room | null,
  externalId: string | null,
  localParticipantId: string | null,
  isExternalUser = false,
): UseCallChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const seenIdsRef = useRef(new Set<string>());
  const fetchedRef = useRef(false);

  // Fetch historical messages on mount
  useEffect(() => {
    if (!externalId || !localParticipantId || fetchedRef.current) return;
    fetchedRef.current = true;
    setIsLoading(true);

    const fetchMessages = isExternalUser
      ? callLobbyService.getMessages(externalId)
      : callChatService.getMessages(externalId);

    void fetchMessages
      .then(msgs => {
        const chatMsgs: ChatMessage[] = msgs.map(m => ({
          ...m,
          isLocal: m.participantId === localParticipantId,
        }));
        chatMsgs.forEach(m => seenIdsRef.current.add(m.id));
        setMessages(chatMsgs);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, [externalId, localParticipantId, isExternalUser]);

  // Add a message to state, deduplicating by id
  const addMessage = useCallback((msg: ChatMessage) => {
    if (seenIdsRef.current.has(msg.id)) return;
    seenIdsRef.current.add(msg.id);
    setMessages(prev => [...prev, msg]);
  }, []);

  // Listen for data channel messages
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      _participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ): void => {
      if (topic !== CALL_CHAT_TOPIC) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }

      if (!isCallChatMessage(parsed)) return;
      // Skip own echoes
      if (parsed.participantId === localParticipantId) return;

      addMessage({
        id: parsed.id,
        callId: '',
        participantId: parsed.participantId,
        displayName: parsed.displayName,
        message: parsed.message,
        createdAt: parsed.createdAt,
        isExternal: parsed.isExternal,
        isLocal: false,
      });
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, localParticipantId, addMessage]);

  // Send a message: persist via API, broadcast via LiveKit, add locally
  const sendMessage = useCallback(
    async (text: string) => {
      if (!room || !externalId || !localParticipantId || !text.trim()) return;

      const created = isExternalUser
        ? await callLobbyService.sendMessage(externalId, text.trim())
        : await callChatService.sendMessage(externalId, text.trim());

      // Broadcast to other participants via LiveKit data channel
      const dataMsg: CallChatDataMessage = {
        type: 'call-chat-message',
        id: created.id,
        participantId: created.participantId,
        displayName: created.displayName,
        message: created.message,
        createdAt: created.createdAt,
        isExternal: created.isExternal,
      };

      void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(dataMsg)), {
        reliable: true,
        topic: CALL_CHAT_TOPIC,
      });

      // Add locally immediately
      addMessage({
        ...created,
        isLocal: true,
      });
    },
    [room, externalId, localParticipantId, isExternalUser, addMessage],
  );

  return { messages, sendMessage, isLoading };
}
