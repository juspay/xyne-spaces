import { ConnectionQuality, ParticipantEvent, type Participant } from 'livekit-client';

import type { ConnectionLevel } from '../ParticipantTile/ParticipantTileView';
import { useLiveKitValue } from './useLiveKitValue';

const EVENTS: readonly string[] = [ParticipantEvent.ConnectionQualityChanged];

function readLevel(participant: Participant): ConnectionLevel {
  if (participant.connectionQuality === ConnectionQuality.Poor) return 'poor';
  if (participant.connectionQuality === ConnectionQuality.Lost) return 'lost';
  return 'good';
}

/** LiveKit's network-quality estimate for a participant, as the tile / banner shows it. */
export function useConnectionLevel(participant: Participant | null | undefined): ConnectionLevel {
  return useLiveKitValue(participant, EVENTS, readLevel, 'good');
}
