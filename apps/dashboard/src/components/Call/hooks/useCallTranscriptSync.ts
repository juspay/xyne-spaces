import { useEffect } from 'react';
import { RoomEvent } from 'livekit-client';
import type { DataPacket_Kind, RemoteParticipant, Room } from 'livekit-client';
import { addCallTranscript, resetCallTranscripts } from '../../../stores/callTranscriptStore';
import { normalizeTimestamp } from '../../../utils/dateUtils';

/** Same topic the transcription agent publishes to (see python-agent publisher). */
export const TRANSCRIPTIONS_TOPIC = 'transcriptions';

/**
 * Agent wire payload — snake_case (modules/multi_user_transcriber.py). Note this differs
 * from the camelCase `recordingStore` historically read; we parse the real keys here.
 */
/* eslint-disable @typescript-eslint/naming-convention -- keys mirror the agent's snake_case wire format */
interface TranscriptionMessage {
  text?: string;
  user?: string;
  timestamp?: number;
  spoken_at?: number;
  participant_identity?: string;
  /** 'ai' for agent/assistant lines; absent for human speech. */
  source?: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Subscribes the `callTranscriptStore` to the `transcriptions` data topic for the current
 * call, independent of recording. Mount once in the in-call view (beside `useReactions`).
 * Coexists with `recordingStore`'s own listener — LiveKit fans `DataReceived` out to both.
 */
export function useCallTranscriptSync(room: Room | null): void {
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      _participant?: RemoteParticipant,
      _kind?: DataPacket_Kind,
      topic?: string,
    ): void => {
      if (topic !== TRANSCRIPTIONS_TOPIC) return;

      let data: TranscriptionMessage;
      try {
        data = JSON.parse(new TextDecoder().decode(payload)) as TranscriptionMessage;
      } catch {
        return;
      }

      if (!data.text || typeof data.text !== 'string') return;

      addCallTranscript({
        speaker: data.user || 'Unknown',
        text: data.text,
        timestamp: normalizeTimestamp(data.timestamp),
        participantIdentity: data.participant_identity || '',
        spokenAt: normalizeTimestamp(data.spoken_at),
      });
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return (): void => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
      resetCallTranscripts();
    };
  }, [room]);
}
