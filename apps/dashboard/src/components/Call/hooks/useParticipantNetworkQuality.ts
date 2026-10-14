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
 * to Poor or Lost, then resets to false.
 *
 * The toast is debounced: it only appears if the connection stays degraded for
 * `showDelay` ms. LiveKit quality frequently blips to Poor for a single sample,
 * so showing the toast on the first Poor reading was noisy. If quality recovers
 * within the delay the toast never shows; if it recovers while visible, the
 * toast hides immediately. Poor <-> Lost transitions do not restart the timer.
 */
export function useNetworkQualityToast(
  networkQuality: ConnectionQuality | null,
  duration = 5000,
  showDelay = 2000,
): boolean {
  const [showToast, setShowToast] = useState(false);
  const isDegraded =
    networkQuality === ConnectionQuality.Poor || networkQuality === ConnectionQuality.Lost;

  useEffect(() => {
    if (!isDegraded) {
      setShowToast(false);
      return undefined;
    }

    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const showTimer = setTimeout(() => {
      setShowToast(true);
      hideTimer = setTimeout(() => setShowToast(false), duration);
    }, showDelay);

    return (): void => {
      clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [isDegraded, duration, showDelay]);

  return showToast;
}
