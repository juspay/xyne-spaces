/**
 * ParticipantTile
 *
 * LiveKit-connected tile. Every piece of live state (speaking, mic, network, video) comes from a
 * hook subscribed to the participant itself, so the tile updates the moment LiveKit does — no
 * matter when, or whether, its parent re-renders — and hands plain values to `ParticipantTileView`.
 */
import React, { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  VideoTrack,
  useIsSpeaking,
  useParticipantInfo,
  useTrackMutedIndicator,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';
import { Track } from 'livekit-client';

import { useConnectionLevel } from '../hooks/useConnectionLevel';
import { liveVideoTrack, useLiveVideoTrack } from '../hooks/useLiveVideoTrack';
import { useLocalCameraMirror } from '../hooks/useLocalCameraMirror';
import { useParticipantPicture } from '../hooks/useParticipantPicture';
import { AI_AGENT_DISPLAY_NAME, isAiAgentIdentity } from '../callIdentity';
import type { StageInsets, TileVariant } from '../callStage.utils';
import { ParticipantTileView } from './ParticipantTileView';

/** True when the reference has a live, renderable video track *right now* (read it during render). */
export function hasLiveVideo(trackRef: TrackReferenceOrPlaceholder): boolean {
  return liveVideoTrack(trackRef.publication) !== undefined;
}

interface ParticipantTileProps {
  /**
   * Who this tile shows and which of their sources. Only `participant` and `source` are used:
   * the publication inside is a live object, so the tile reads its state through hooks instead.
   */
  trackRef: TrackReferenceOrPlaceholder;
  isLocal?: boolean;
  variant: TileVariant;
  width: number;
  height: number;
  aiController?: { id: string; name: string } | null;
  insets?: StageInsets;
  onStopScreenShare?: () => void;
}

function ParticipantTileInner({
  trackRef,
  isLocal = false,
  variant,
  width,
  height,
  aiController = null,
  insets,
  onStopScreenShare,
}: ParticipantTileProps): React.ReactElement {
  const { participant, source } = trackRef;
  const { identity, name, metadata } = useParticipantInfo({ participant });
  // NOTE: useIsSpeaking re-renders on audio-level changes; everything expensive below is memoised.
  const isSpeaking = useIsSpeaking(participant);
  const { isMuted: isMicMuted } = useTrackMutedIndicator({
    participant,
    source: Track.Source.Microphone,
  });
  const connection = useConnectionLevel(participant);
  const mirrorFront = useLocalCameraMirror();
  const videoTrack = useLiveVideoTrack(participant, source);

  const isScreenShare = source === Track.Source.ScreenShare;
  const isAgent = isAiAgentIdentity(identity);
  const displayName = isAgent ? AI_AGENT_DISPLAY_NAME : name || identity || 'Unknown';
  const userId = identity ?? '';
  const pictureUri = useParticipantPicture(userId, metadata);

  const mirror = isLocal && !isScreenShare && mirrorFront;
  const isPip = variant === 'pip';
  // Keyed on the track itself: speaking / network re-renders never touch the native video view,
  // while a track that starts, stops or is replaced swaps it immediately.
  const video = useMemo(() => {
    const publication = videoTrack ? participant.getTrackPublication(source) : undefined;
    if (!publication) return null;
    return (
      <VideoTrack
        // Android fixes a video surface's z-order when it is created; recreating just the surface
        // when the tile becomes / stops being the PiP keeps the self-view above the remote video.
        key={isPip ? 'pip' : 'main'}
        trackRef={{ participant, publication, source }}
        style={styles.video}
        mirror={mirror}
        objectFit={isScreenShare ? 'contain' : 'cover'}
        // Android: the self-view must draw above the full-bleed remote video.
        zOrder={isPip ? 1 : 0}
      />
    );
  }, [videoTrack, participant, source, mirror, isScreenShare, isPip]);

  return (
    <ParticipantTileView
      variant={variant}
      width={width}
      height={height}
      identity={userId}
      name={displayName}
      isLocal={isLocal}
      isAgent={isAgent}
      pictureUri={pictureUri}
      isMicMuted={isMicMuted}
      isSpeaking={isSpeaking}
      video={video}
      isScreenShare={isScreenShare}
      aiControllerName={isAgent ? (aiController?.name ?? null) : null}
      connection={connection}
      {...(insets ? { insets } : {})}
      onStopScreenShare={onStopScreenShare}
    />
  );
}

// `useTracks` hands the stage a fresh trackRef wrapper on every room event, so compare what the
// tile is *of* (the participant object and source) plus its layout props. Never compare the
// publication's state here: prev and next hold the same live publication, so its fields always
// look equal — that state reaches the tile through the hooks above instead.
export const ParticipantTile = memo(
  ParticipantTileInner,
  (prev, next) =>
    prev.trackRef.participant === next.trackRef.participant &&
    prev.trackRef.source === next.trackRef.source &&
    prev.isLocal === next.isLocal &&
    prev.variant === next.variant &&
    prev.width === next.width &&
    prev.height === next.height &&
    prev.aiController?.id === next.aiController?.id &&
    prev.aiController?.name === next.aiController?.name &&
    prev.insets?.top === next.insets?.top &&
    prev.insets?.bottom === next.insets?.bottom &&
    prev.onStopScreenShare === next.onStopScreenShare,
);

const styles = StyleSheet.create({
  video: {
    ...StyleSheet.absoluteFill,
  },
});
