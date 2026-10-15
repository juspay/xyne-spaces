/**
 * CallStage
 *
 * The stage renders every person in the call as a tile positioned by `computeStageLayout`:
 *  - solo        just you (waiting for others)
 *  - oneToOne    the other person full-bleed, you as a draggable self-view
 *  - grid        3+ people in an adaptive grid with a "+N" overflow tile
 *  - screenShare a presentation with a filmstrip of people
 * Tiles are keyed by person (not by layout slot), so switching layouts animates tiles into
 * their new frames rather than re-mounting their video.
 *
 * Must be rendered inside LiveKitRoomProvider.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useLocalParticipant, useTracks } from '@livekit/react-native';
import type { TrackReferenceOrPlaceholder } from '@livekit/react-native';
import { Track } from 'livekit-client';

import { CallBackdrop } from '../CallBackdrop';
import { OverflowTile, type OverflowPerson } from '../OverflowTile';
import { ParticipantTile, hasLiveVideo } from '../ParticipantTile';
import { RingingParticipantTile } from '../ParticipantTile/RingingParticipantTile';
import { ZoomableView } from '../ZoomableView';
import { useParticipantPicture } from '../hooks/useParticipantPicture';
import type { RingingInvitee } from '../callRoster.utils';
import { isAiAgentIdentity } from '../callIdentity';
import {
  MAX_GRID_SLOTS,
  getStripCapacity,
  limitToSlots,
  resolveHeroKey,
  resolveStageMode,
  type PipCorner,
  type StageInsets,
  type StageMode,
  type StageTile,
  type TileLayout,
} from '../callStage.utils';
import { StageCanvas } from './StageCanvas';

type StageEntry =
  | {
      key: string;
      kind: 'participant';
      isLocal: boolean;
      identity: string;
      name: string;
      trackRef: TrackReferenceOrPlaceholder;
    }
  | {
      key: string;
      kind: 'pending';
      isLocal: false;
      identity: string;
      name: string;
      invitee: RingingInvitee;
    };

export interface StageSummary {
  mode: StageMode;
  /** Full-bleed video is on screen, so the chrome may auto-hide. */
  immersive: boolean;
  /** Identity of the person shown full-bleed (drives the backdrop), if any. */
  heroIdentity: string | null;
  /** Someone other than you and the AI agent is actually in the room. */
  hasRemoteHuman: boolean;
}

interface CallStageProps {
  /** Space taken by the header and control bar; tiles avoid it (except full-bleed heroes). */
  insets: StageInsets;
  /** People being rung (1:1 DM calls only); each becomes a Calling… / Ringing… tile. */
  ringing: readonly RingingInvitee[];
  localCameraOn: boolean;
  aiController: { id: string; name: string } | null;
  onStageTap: () => void;
  onOverflowPress: () => void;
  onStopScreenShare: () => void;
  onSummaryChange: (summary: StageSummary) => void;
}

function HeroBackdrop({ identity }: { identity: string | null }): React.ReactElement {
  const pictureUri = useParticipantPicture(identity ?? '');
  return <CallBackdrop tintIdentity={identity ?? undefined} pictureUri={pictureUri} />;
}

export function CallStage({
  insets,
  ringing,
  localCameraOn,
  aiController,
  onStageTap,
  onOverflowPress,
  onStopScreenShare,
  onSummaryChange,
}: CallStageProps): React.ReactElement {
  const [pipCorner, setPipCorner] = useState<PipCorner>('bottomRight');
  const [swapped, setSwapped] = useState(false);

  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  // Placeholders make this re-render when screen shares start / stop.
  const screenShareTracks = useTracks(
    [{ source: Track.Source.ScreenShare, withPlaceholder: true }],
    { onlySubscribed: false },
  );
  const { localParticipant } = useLocalParticipant();
  const localIdentity = localParticipant?.identity;

  const activeScreenShare = useMemo(
    () => screenShareTracks.find(hasLiveVideo) ?? null,
    [screenShareTracks],
  );

  // The AI agent's tile stays hidden until someone invokes it (aiController set), like the dashboard.
  const showAgent = !!aiController;

  const entries = useMemo<StageEntry[]>(() => {
    const seen = new Set<string>();
    const result: StageEntry[] = [];
    for (const trackRef of cameraTracks) {
      const identity = trackRef.participant.identity;
      if (!showAgent && isAiAgentIdentity(identity)) continue;
      if (seen.has(identity)) continue;
      seen.add(identity);
      result.push({
        key: `p:${identity}`,
        kind: 'participant',
        isLocal: identity === localIdentity,
        identity,
        name: trackRef.participant.name || identity,
        trackRef,
      });
    }
    for (const p of ringing) {
      if (seen.has(p.userId)) continue;
      seen.add(p.userId);
      result.push({
        key: `pending:${p.userId}`,
        kind: 'pending',
        isLocal: false,
        identity: p.userId,
        name: p.name,
        invitee: p,
      });
    }
    return result;
  }, [cameraTracks, localIdentity, ringing, showAgent]);

  const mode = resolveStageMode({
    hasScreenShare: !!activeScreenShare,
    occupantCount: entries.length,
  });

  const localEntry = entries.find(e => e.isLocal);
  const otherEntry = entries.find(e => !e.isLocal);
  const canSwap = mode === 'oneToOne' && localCameraOn && !!localEntry && !!otherEntry;
  useEffect(() => {
    if (!canSwap && swapped) setSwapped(false);
  }, [canSwap, swapped]);
  const effectiveSwapped = swapped && canSwap;

  // ── Which entries become tiles, and how many fit ─────────────────────────
  const { width: windowWidth } = useWindowDimensions();
  const { tiles, overflowPeople } = useMemo(() => {
    const tileList: StageTile[] = [];
    let hidden: OverflowPerson[] = [];
    const toTile = (e: StageEntry): StageTile => ({
      key: e.key,
      kind: e.kind === 'pending' ? 'pending' : 'participant',
      isLocal: e.isLocal,
    });
    const toPerson = (e: StageEntry): OverflowPerson => ({ identity: e.identity, name: e.name });

    if (mode === 'grid') {
      const split = limitToSlots(entries, MAX_GRID_SLOTS);
      split.visible.forEach(e => tileList.push(toTile(e)));
      hidden = split.hidden.map(toPerson);
    } else if (mode === 'screenShare' && activeScreenShare) {
      tileList.push({
        key: `screen:${activeScreenShare.participant.identity}`,
        kind: 'screen',
        isLocal: activeScreenShare.participant.identity === localIdentity,
      });
      const split = limitToSlots(entries, getStripCapacity(windowWidth));
      split.visible.forEach(e => tileList.push(toTile(e)));
      hidden = split.hidden.map(toPerson);
    } else {
      entries.forEach(e => tileList.push(toTile(e)));
    }

    if (hidden.length > 0) tileList.push({ key: 'overflow', kind: 'overflow', isLocal: false });
    return { tiles: tileList, overflowPeople: hidden };
  }, [entries, mode, activeScreenShare, localIdentity, windowWidth]);

  const heroKey = resolveHeroKey(mode, tiles, effectiveSwapped ? localEntry?.key : otherEntry?.key);
  const pipKey = canSwap ? (effectiveSwapped ? otherEntry?.key : localEntry?.key) : null;

  const heroEntry = entries.find(e => e.key === heroKey);
  const heroIdentity = heroEntry?.identity ?? null;
  const immersive =
    (mode === 'solo' || mode === 'oneToOne') &&
    heroEntry?.kind === 'participant' &&
    hasLiveVideo(heroEntry.trackRef);
  const hasRemoteHuman = entries.some(
    e => e.kind === 'participant' && !e.isLocal && !isAiAgentIdentity(e.identity),
  );

  useEffect(() => {
    onSummaryChange({ mode, immersive, heroIdentity, hasRemoteHuman });
  }, [mode, immersive, heroIdentity, hasRemoteHuman, onSummaryChange]);

  const handleSwap = useCallback((): void => setSwapped(current => !current), []);

  const renderTile = (tile: StageTile, { frame, variant }: TileLayout): React.ReactNode => {
    const dims = { width: Math.round(frame.width), height: Math.round(frame.height) };

    if (tile.kind === 'overflow') {
      return (
        <OverflowTile
          people={overflowPeople}
          compact={variant === 'strip'}
          onPress={onOverflowPress}
        />
      );
    }

    if (tile.kind === 'screen' && activeScreenShare) {
      const isLocalShare = activeScreenShare.participant.identity === localIdentity;
      const shareTile = (
        <ParticipantTile
          trackRef={activeScreenShare}
          isLocal={isLocalShare}
          variant={variant}
          {...dims}
          insets={insets}
          onStopScreenShare={onStopScreenShare}
        />
      );
      // Pinch / double-tap to zoom another person's screen; keyed so zoom resets per share.
      return isLocalShare ? (
        shareTile
      ) : (
        <ZoomableView key={activeScreenShare.publication?.trackSid}>{shareTile}</ZoomableView>
      );
    }

    const entry = entries.find(e => e.key === tile.key);
    if (!entry) return null;
    if (entry.kind === 'pending') {
      return (
        <RingingParticipantTile
          invitee={entry.invitee}
          variant={variant}
          {...dims}
          insets={insets}
        />
      );
    }
    return (
      <ParticipantTile
        trackRef={entry.trackRef}
        isLocal={entry.isLocal}
        variant={variant}
        {...dims}
        aiController={aiController}
        insets={insets}
      />
    );
  };

  return (
    <StageCanvas
      mode={mode}
      tiles={tiles}
      insets={insets}
      heroKey={heroKey}
      pipKey={pipKey ?? null}
      pipCorner={pipCorner}
      onPipCornerChange={setPipCorner}
      onPipPress={handleSwap}
      onStageTap={onStageTap}
      backdrop={<HeroBackdrop identity={heroIdentity} />}
      renderTile={renderTile}
    />
  );
}
