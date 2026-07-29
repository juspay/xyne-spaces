import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import type { RemoteParticipant, Room } from 'livekit-client';
import { playAudio } from '../../../utils/audioPlayer';
import { logger, Event } from '../../../utils/logger';

export const HAND_RAISE_TOPIC = 'hand_raise';

// The sender's identity is taken from the authenticated transport (the LiveKit
// participant), never from the body; the topic already identifies the message
// kind — so the payload only carries the new state.
interface HandRaiseMessage {
  raised: boolean;
}

function encodeHandRaise(raised: boolean): Uint8Array {
  const message: HandRaiseMessage = { raised };
  return new TextEncoder().encode(JSON.stringify(message));
}

export interface UseHandRaiseReturn {
  /** Identities of participants with hand currently raised */
  raisedHands: string[];
  /** True if the local participant's hand is raised */
  isHandRaised: boolean;
  /** Toggle the local participant's hand up/down */
  toggleHandRaise: () => void;
}

function isHandRaiseMessage(value: unknown): value is HandRaiseMessage {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>)['raised'] === 'boolean';
}

/**
 * Hand-raise state synced over the LiveKit data channel.
 * Mirrors the proven useReactions pattern: own DataReceived listener + dedicated topic,
 * state held in React (not the room state machine) so receipt is reliable across clients.
 */
export function useHandRaise(room: Room | null): UseHandRaiseReturn {
  const [raisedHands, setRaisedHands] = useState<string[]>([]);
  // Mirror of raisedHands for synchronous reads inside event handlers (whose
  // closures would otherwise see a stale state value).
  const raisedRef = useRef<Set<string>>(new Set());

  const localIdentity = room?.localParticipant.identity ?? null;
  const isHandRaised = localIdentity ? raisedHands.includes(localIdentity) : false;

  const apply = useCallback((identity: string, raised: boolean) => {
    const set = raisedRef.current;
    if (raised) set.add(identity);
    else set.delete(identity);
    setRaisedHands(Array.from(set));
  }, []);

  const toggleHandRaise = useCallback(() => {
    if (!room) return;
    const identity = room.localParticipant.identity;
    const raised = !raisedRef.current.has(identity);
    void room.localParticipant.publishData(encodeHandRaise(raised), {
      reliable: true,
      topic: HAND_RAISE_TOPIC,
    });
    // Apply locally immediately — the sender does not receive its own data echo
    apply(identity, raised);
  }, [room, apply]);

  useEffect(() => {
    if (!room) return;

    // Fresh state per room.
    raisedRef.current = new Set();
    setRaisedHands([]);

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ): void => {
      if (topic !== HAND_RAISE_TOPIC) return;
      // Trust the authenticated sender, not the payload — prevents a peer from
      // raising/lowering someone else's hand (or spoofing identity).
      if (!participant) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload));
      } catch (err) {
        // Malformed payload — log to telemetry so protocol mismatches are
        // visible, but never crash the receiver.
        logger.warn(
          Event.FRONTEND_ERROR,
          { context: 'useHandRaise.parse', message: String(err) },
          false,
        );
        return;
      }
      if (!isHandRaiseMessage(parsed)) return;

      const identity = participant.identity;
      // Soft chime only on the transition to raised (not on re-sends or lowers)
      // so a peer can't loop messages to spam everyone's notification sound.
      if (parsed.raised && !raisedRef.current.has(identity)) {
        playAudio('/sounds/notification.wav', 0.25);
      }
      apply(identity, parsed.raised);
    };

    // Clear a participant's hand when they leave
    const handleDisconnect = (participant: RemoteParticipant): void => {
      apply(participant.identity, false);
    };

    // The sync path is event-only, so a hand raised before someone joins is
    // invisible to them. Replay our current raised state to each late joiner
    // (targeted, so we don't re-notify everyone) to close that gap.
    const handleParticipantConnected = (participant: RemoteParticipant): void => {
      if (!raisedRef.current.has(room.localParticipant.identity)) return;
      void room.localParticipant.publishData(encodeHandRaise(true), {
        reliable: true,
        topic: HAND_RAISE_TOPIC,
        destinationIdentities: [participant.identity],
      });
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    room.on(RoomEvent.ParticipantDisconnected, handleDisconnect);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    return (): void => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
      room.off(RoomEvent.ParticipantDisconnected, handleDisconnect);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
    };
  }, [room, apply]);

  return { raisedHands, isHandRaised, toggleHandRaise };
}
