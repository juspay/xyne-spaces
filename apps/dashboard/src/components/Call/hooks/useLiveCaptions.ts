import { useCallback, useEffect, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import type { Room, TextStreamReader } from 'livekit-client';
import { logger, Event } from '../../../utils/logger';

/**
 * Text-stream topic the transcription agent's AgentSession publishes live speech on.
 * Each update is a fresh stream carrying the full text of one speech segment so far,
 * tagged with `lk.segment_id` and `lk.transcription_final`; the sender identity is the
 * participant being transcribed.
 */
export const TRANSCRIPTION_TOPIC = 'lk.transcription';

/** How long a finished line stays on screen after its speaker stops. */
const CAPTION_LINGER_MS = 4_000;
/** Drop a live line that stopped updating and never got its final (muted mid-sentence, lost update). */
const CAPTION_STALE_MS = 5_000;
/** Lines on screen at once, newest last — like film subtitles. */
const MAX_CAPTIONS = 2;
const PRUNE_INTERVAL_MS = 500;

const CAPTIONS_PREF_KEY = 'xyne.call.liveCaptions';

export interface LiveCaption {
  segmentId: string;
  identity: string;
  speakerName: string;
  text: string;
  isFinal: boolean;
  updatedAt: number;
}

function readCaptionsPreference(): boolean {
  try {
    return window.localStorage.getItem(CAPTIONS_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeCaptionsPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(CAPTIONS_PREF_KEY, enabled ? 'on' : 'off');
  } catch {
    // Private mode / blocked storage: the toggle still works for this call
  }
}

/**
 * Captions on/off for the local viewer, remembered across calls. On by default: the CC button
 * only shows on calls the backend flag enabled captions for, and a viewer who turns them off
 * stays off.
 */
export function useCaptionsPreference(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(readCaptionsPreference);
  const toggle = useCallback(() => {
    setEnabled(prev => {
      writeCaptionsPreference(!prev);
      return !prev;
    });
  }, []);
  return [enabled, toggle];
}

function parseLiveCaptionsAvailable(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    return (JSON.parse(metadata) as { liveCaptions?: boolean }).liveCaptions === true;
  } catch {
    return false;
  }
}

/**
 * Whether this call offers live captions. The backend decides per call (feature flag) and
 * sets `liveCaptions` in the room metadata; calls without it show no captions UI at all.
 */
export function useLiveCaptionsAvailable(room: Room | null | undefined): boolean {
  const [available, setAvailable] = useState(() => parseLiveCaptionsAvailable(room?.metadata));

  useEffect(() => {
    if (!room) {
      setAvailable(false);
      return;
    }
    setAvailable(parseLiveCaptionsAvailable(room.metadata));
    const handleMetadataChanged = (metadata: string): void => {
      setAvailable(parseLiveCaptionsAvailable(metadata));
    };
    room.on(RoomEvent.RoomMetadataChanged, handleMetadataChanged);
    return (): void => {
      room.off(RoomEvent.RoomMetadataChanged, handleMetadataChanged);
    };
  }, [room]);

  return available;
}

function pruneCaptions(captions: LiveCaption[], now: number): LiveCaption[] {
  const kept = captions.filter(caption =>
    caption.isFinal
      ? now - caption.updatedAt < CAPTION_LINGER_MS
      : now - caption.updatedAt < CAPTION_STALE_MS,
  );
  return kept.length === captions.length ? captions : kept;
}

/** One update of a speech segment, read once from its text stream. */
interface CaptionUpdate {
  segmentId: string;
  identity: string;
  text: string;
  isFinal: boolean;
}

type CaptionListener = (update: CaptionUpdate) => void;

/** Views listening for captions per room; LiveKit allows one text-stream handler per topic. */
const captionListeners = new WeakMap<Room, Set<CaptionListener>>();

async function readCaptionUpdate(
  reader: TextStreamReader,
  identity: string,
): Promise<CaptionUpdate | null> {
  let text: string;
  try {
    text = (await reader.readAll()).trim();
  } catch {
    return null;
  }
  const attributes = reader.info.attributes ?? {};
  return {
    segmentId: attributes['lk.segment_id'] ?? reader.info.id,
    identity,
    text,
    isFinal: attributes['lk.transcription_final'] === 'true',
  };
}

/**
 * Registers the room's single transcription handler on first use and fans each update out to
 * every listening view (the full and mini call views can be mounted at the same time).
 */
function subscribeToCaptions(room: Room, listener: CaptionListener): () => void {
  let listeners = captionListeners.get(room);
  if (!listeners) {
    const created = new Set<CaptionListener>();
    try {
      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, participantInfo) => {
        void readCaptionUpdate(reader, participantInfo.identity).then(update => {
          if (update) created.forEach(notify => notify(update));
        });
      });
    } catch (error) {
      logger.error(Event.LIVEKIT_ROOM_EVENT, {
        eventName: 'live_captions_subscribe_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return () => undefined;
    }
    captionListeners.set(room, created);
    listeners = created;
  }
  const subscribed = listeners;
  subscribed.add(listener);
  return () => {
    subscribed.delete(listener);
    if (subscribed.size === 0 && captionListeners.get(room) === subscribed) {
      captionListeners.delete(room);
      room.unregisterTextStreamHandler(TRANSCRIPTION_TOPIC);
    }
  };
}

/**
 * Live captions for a call: listens to the transcription agent's text streams and keeps
 * the latest line per speech segment. Interim text grows in place as the speaker talks;
 * the final (corrected) text lingers briefly, then fades out.
 */
export function useLiveCaptions(room: Room | null, enabled: boolean): LiveCaption[] {
  const [captions, setCaptions] = useState<LiveCaption[]>([]);

  useEffect(() => {
    if (!room || !enabled) {
      setCaptions([]);
      return;
    }

    // Last name seen per identity, so a line from someone who already left keeps their name
    const knownNames = new Map<string, string>();
    const resolveSpeakerName = (identity: string): string => {
      if (identity === room.localParticipant.identity) return 'You';
      const name = room.getParticipantByIdentity(identity)?.name;
      if (name) knownNames.set(identity, name);
      return knownNames.get(identity) ?? identity;
    };
    room.remoteParticipants.forEach(participant => {
      if (participant.name) knownNames.set(participant.identity, participant.name);
    });

    const unsubscribe = subscribeToCaptions(room, update => {
      if (!update.text) return;
      const { segmentId } = update;
      const caption: LiveCaption = {
        ...update,
        speakerName: resolveSpeakerName(update.identity),
        updatedAt: Date.now(),
      };
      setCaptions(prev => {
        const others = prev.filter(c => c.segmentId !== segmentId);
        return [...others, caption].slice(-MAX_CAPTIONS);
      });
    });

    const pruneTimer = setInterval(() => {
      setCaptions(prev => pruneCaptions(prev, Date.now()));
    }, PRUNE_INTERVAL_MS);

    return (): void => {
      clearInterval(pruneTimer);
      unsubscribe();
      setCaptions([]);
    };
  }, [room, enabled]);

  return captions;
}
