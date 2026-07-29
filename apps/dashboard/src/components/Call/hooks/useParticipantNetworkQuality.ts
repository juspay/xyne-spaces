import { useState, useEffect } from 'react';
import type { Participant } from 'livekit-client';
import { ConnectionQuality, ParticipantEvent } from 'livekit-client';

/**
 * Tracks the connection quality of a single LiveKit participant.
 * Works for both local and remote participants.
 *
 * Usage:
 *   // In ParticipantTile — pass the individual participant
 *   const quality = useParticipantNetworkQuality(participant.participant);
 *
 *   // In FullCallView — pass the local participant to track your own quality
 *   const quality = useParticipantNetworkQuality(room?.localParticipant ?? null);
 */
export function useParticipantNetworkQuality(
  participant: Participant | null | undefined,
): ConnectionQuality | null {
  const [quality, setQuality] = useState<ConnectionQuality | null>(
    participant?.connectionQuality ?? null,
  );

  useEffect(() => {
    if (!participant) {
      setQuality(null);
      return;
    }

    setQuality(participant.connectionQuality);

    const handleChange = (): void => {
      setQuality(participant.connectionQuality);
    };

    participant.on(ParticipantEvent.ConnectionQualityChanged, handleChange);
    return (): void => {
      participant.off(ParticipantEvent.ConnectionQualityChanged, handleChange);
    };
  }, [participant]);

  return quality;
}

/**
 * Returns true briefly (for `duration` ms) whenever network quality degrades
 * to Poor or Lost, then resets to false. Re-triggers on each degradation.
 */
export function useNetworkQualityToast(
  networkQuality: ConnectionQuality | null,
  duration = 5000,
): boolean {
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (networkQuality === ConnectionQuality.Poor || networkQuality === ConnectionQuality.Lost) {
      setShowToast(true);
      const timer = setTimeout(() => setShowToast(false), duration);
      return (): void => clearTimeout(timer);
    }
    setShowToast(false);
    return undefined;
  }, [networkQuality, duration]);

  return showToast;
}
