import { useCallback } from 'react';
import {
  ParticipantEvent,
  type Participant,
  type Track,
  type TrackPublication,
} from 'livekit-client';

import { useLiveKitValue } from './useLiveKitValue';

/** The publication's renderable track: subscribed (or, for your own, published) and not muted. */
export function liveVideoTrack(publication: TrackPublication | undefined): Track | undefined {
  if (!publication || publication.isMuted || !publication.isSubscribed) return undefined;
  return publication.track;
}

/** Everything that can start, stop or replace a participant's renderable track. */
const TRACK_STATE_EVENTS: readonly string[] = [
  ParticipantEvent.TrackPublished,
  ParticipantEvent.TrackUnpublished,
  ParticipantEvent.LocalTrackPublished,
  ParticipantEvent.LocalTrackUnpublished,
  ParticipantEvent.TrackSubscribed,
  ParticipantEvent.TrackUnsubscribed,
  ParticipantEvent.TrackSubscriptionStatusChanged,
  ParticipantEvent.TrackMuted,
  ParticipantEvent.TrackUnmuted,
];

/**
 * The participant's live video track for `source`, or undefined while there is nothing to show.
 * Read from the participant on LiveKit's own events rather than from a `useTracks` reference:
 * LiveKit mutates one publication object in place (published → subscribed → muted …), so a
 * reference captured in props can't be diffed to notice those steps.
 */
export function useLiveVideoTrack(
  participant: Participant,
  source: Track.Source,
): Track | undefined {
  const read = useCallback(
    (p: Participant): Track | undefined => liveVideoTrack(p.getTrackPublication(source)),
    [source],
  );
  return useLiveKitValue(participant, TRACK_STATE_EVENTS, read, undefined);
}
