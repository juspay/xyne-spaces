import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import type { RemoteParticipant, Room } from 'livekit-client';

export const REACTIONS_TOPIC = 'reactions';

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🔥', '🎉', '💯'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

const REACTION_LIFETIME_MS = 4_000;
/** Keep spawns 10 %–90 % from the left so they never clip the edges */
const SPAWN_X_MIN = 10;
const SPAWN_X_RANGE = 60;

export interface ReactionEvent {
  id: string;
  emoji: string;
  senderName: string;
  senderIdentity: string;
  isLocal: boolean;
  timestamp: number;
  /** 0–100 horizontal spawn position (%) */
  spawnX: number;
}

interface ReactionMessage {
  type: 'reaction';
  emoji: string;
  senderName: string;
  senderIdentity: string;
}

export interface UseReactionsReturn {
  reactions: ReactionEvent[];
  sendReaction: (emoji: string) => void;
}

function isReactionMessage(value: unknown): value is ReactionMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['type'] === 'reaction' &&
    typeof v['emoji'] === 'string' &&
    typeof v['senderName'] === 'string' &&
    typeof v['senderIdentity'] === 'string'
  );
}

export function useReactions(room: Room | null): UseReactionsReturn {
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const timerIdsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Clean up pending timers on unmount
  useEffect(() => {
    return () => {
      timerIdsRef.current.forEach(id => clearTimeout(id));
    };
  }, []);

  const addReaction = useCallback(
    (emoji: string, senderName: string, senderIdentity: string, isLocal: boolean) => {
      const reaction: ReactionEvent = {
        id: crypto.randomUUID(),
        emoji,
        senderName,
        senderIdentity,
        isLocal,
        timestamp: Date.now(),
        spawnX: SPAWN_X_MIN + Math.random() * SPAWN_X_RANGE,
      };
      setReactions(prev => [...prev, reaction]);
      const timerId = setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== reaction.id));
        timerIdsRef.current.delete(timerId);
      }, REACTION_LIFETIME_MS);
      timerIdsRef.current.add(timerId);
    },
    [],
  );

  const sendReaction = useCallback(
    (emoji: string) => {
      if (!room) return;
      if (!REACTION_EMOJIS.includes(emoji as ReactionEmoji)) return;
      const local = room.localParticipant;
      const msg: ReactionMessage = {
        type: 'reaction',
        emoji,
        senderName: local.name || local.identity,
        senderIdentity: local.identity,
      };
      void local.publishData(new TextEncoder().encode(JSON.stringify(msg)), {
        reliable: true,
        topic: REACTIONS_TOPIC,
      });
      // Render locally immediately — remote echo is filtered out below
      addReaction(emoji, msg.senderName, msg.senderIdentity, true);
    },
    [room, addReaction],
  );

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      _participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ): void => {
      if (topic !== REACTIONS_TOPIC) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }

      if (!isReactionMessage(parsed)) return;
      // Skip own echoes — local reaction was already shown in sendReaction
      if (parsed.senderIdentity === room.localParticipant.identity) return;

      addReaction(parsed.emoji, parsed.senderName, parsed.senderIdentity, false);
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return (): void => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, addReaction]);

  return { reactions, sendReaction };
}
