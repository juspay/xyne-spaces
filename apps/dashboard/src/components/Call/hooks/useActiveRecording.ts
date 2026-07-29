import { useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import { RoomEvent } from 'livekit-client';

/**
 * The active-recording descriptor the backend publishes into room metadata when a
 * recording starts (and clears on stop). Reading it from room metadata — rather
 * than a one-shot data message — means participants who join mid-recording also
 * see the indicator (H4).
 */
export interface ActiveRecording {
  recordingId: string;
  startedBy: string | null;
  startedByName?: string | null;
  startedAt: number;
  recordingType: string;
}

function parseActiveRecording(metadata: string | undefined): ActiveRecording | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { activeRecording?: ActiveRecording | null };
    return parsed.activeRecording ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to the call's active-recording state via room metadata. Returns the
 * active recording (or null), updating live as recordings start/stop and reflecting
 * the current state immediately on join.
 */
export function useActiveRecording(room: Room | null | undefined): ActiveRecording | null {
  const [active, setActive] = useState<ActiveRecording | null>(() =>
    parseActiveRecording(room?.metadata),
  );

  useEffect(() => {
    if (!room) {
      setActive(null);
      return;
    }
    // Reflect current state on (re)connect / room change.
    setActive(parseActiveRecording(room.metadata));

    const handleMetadataChanged = (metadata: string): void => {
      setActive(parseActiveRecording(metadata));
    };
    room.on(RoomEvent.RoomMetadataChanged, handleMetadataChanged);
    return () => {
      room.off(RoomEvent.RoomMetadataChanged, handleMetadataChanged);
    };
  }, [room]);

  return active;
}
