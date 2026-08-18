import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Track } from 'livekit-client';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { logger, Event } from '../../../utils/logger';
import { sortParticipants } from '../ParticipantGrid/sortParticipants';
import { isScreenShareActive } from '../../../utils/livekitScreenShare';
import { isTranscriptionAgentIdentity } from '../../../utils/livekitAgent';
import { SpotlightView, type SpotlightMode } from '../SpotlightView';

interface ScreenShareViewProps {
  focusedScreenShare: ParticipantInfo;
  participants: ParticipantInfo[];
  onScreenShareClick: (identity: string) => void;
  className?: string | undefined;
  compact?: boolean | undefined;
  showSidebar?: boolean | undefined;
  showDrawingTools?: boolean | undefined;
  allowFullScreen?: boolean | undefined;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
  raisedHands?: string[];
  onToggleHandRaise?: (() => void) | undefined;
}

export function ScreenShareView({
  focusedScreenShare,
  participants,
  onScreenShareClick,
  className = '',
  compact = false,
  showSidebar = true,
  showDrawingTools = false,
  allowFullScreen = true,
  aiController,
  requestedAiController,
  raisedHands = [],
  onToggleHandRaise,
}: ScreenShareViewProps): React.ReactElement {
  // Derive AI enablement from aiController presence — same pattern as ParticipantGrid
  const isAIAssistantEnabled = aiController !== null;
  const callId = useSelector(roomActor, state => state.context.callId);

  // Discord-style "swap to main stage": clicking a non-sharing participant's
  // sidebar tile pins their camera into the main area in place of the screen
  // share (which then becomes a clickable sidebar thumbnail so it's easy to
  // swap back). Independent of `onScreenShareClick`, which still switches
  // *which screen share* is focused when there are multiple presenters.
  const [pinnedCameraIdentity, setPinnedCameraIdentity] = useState<string | null>(null);

  // Clear the pin only if the pinned participant leaves the call. Deliberately
  // does NOT clear when the pinned participant "is sharing" — the presenter
  // themselves is always sharing (that's what makes them the presenter), so
  // pinning their own camera (screen+camera both on) would otherwise get
  // reverted on the very next render, which is exactly the glitch this fixes.
  useEffect(() => {
    if (!pinnedCameraIdentity) return;
    const stillPresent = participants.some(p => p.identity === pinnedCameraIdentity);
    if (!stillPresent) {
      setPinnedCameraIdentity(null);
    }
  }, [participants, pinnedCameraIdentity]);

  // Clear the pin whenever the focused screen share switches to a different
  // presenter, so the new presenter's share takes over the main stage by default.
  const prevFocusedIdentityRef = useRef(focusedScreenShare.identity);
  useEffect(() => {
    if (prevFocusedIdentityRef.current !== focusedScreenShare.identity) {
      prevFocusedIdentityRef.current = focusedScreenShare.identity;
      setPinnedCameraIdentity(null);
    }
  }, [focusedScreenShare.identity]);

  // What's currently on the main stage: the pinned camera, or the focused screen share.
  const mainIdentity = pinnedCameraIdentity ?? focusedScreenShare.identity;
  const mainMode: SpotlightMode = pinnedCameraIdentity ? 'camera' : 'screen';

  // `SpotlightView` reports swaps generically (identity + which feed was
  // clicked); route screen-share swaps through `onScreenShareClick` (existing
  // multi-presenter focus logic upstream) and camera swaps through the pin.
  const handleSelect = useCallback(
    (identity: string, mode: SpotlightMode): void => {
      if (mode === 'screen') {
        onScreenShareClick(identity);
        setPinnedCameraIdentity(null);
      } else {
        setPinnedCameraIdentity(identity);
      }
    },
    [onScreenShareClick],
  );

  // Log screen share rendering diagnostics for debugging invisible screen shares
  useEffect(() => {
    const publication = focusedScreenShare.participant?.getTrackPublication(
      Track.Source.ScreenShare,
    );
    const track = publication?.track;
    const hasTrackRef =
      isScreenShareActive(focusedScreenShare.participant) && !!publication && !pinnedCameraIdentity;

    logger.info(Event.LIVEKIT_SCREEN_SHARE_RENDERED, {
      callId,
      participantIdentity: focusedScreenShare.identity,
      hasPublication: !!publication,
      hasTrack: !!track,
      isSubscribed: publication?.isSubscribed ?? false,
      isMuted: publication?.isMuted ?? false,
      trackSid: publication?.trackSid ?? null,
      hasTrackRef,
      trackDimensions: track?.mediaStreamTrack
        ? {
            width: track.mediaStreamTrack.getSettings().width,
            height: track.mediaStreamTrack.getSettings().height,
          }
        : null,
      mediaStreamTrackState: track?.mediaStreamTrack?.readyState ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedScreenShare.identity, focusedScreenShare.participant, pinnedCameraIdentity]);

  // Host kill-switch: hide the agent tile from the sidebar while transcription is off.
  const isTranscriptionEnabled = useSelector(
    roomActor,
    state => state.context.isTranscriptionEnabled,
  );

  // Sort sidebar: mic on → camera on → earlier joinedAt, always applied.
  // Agent (Xyne Automatic) pinned to end unless AI assistant is enabled.
  const sortedParticipants = useMemo(() => {
    const visible = isTranscriptionEnabled
      ? participants
      : participants.filter(p => !isTranscriptionAgentIdentity(p.identity));
    return sortParticipants(visible, isAIAssistantEnabled);
  }, [participants, isAIAssistantEnabled, isTranscriptionEnabled]);

  return (
    <SpotlightView
      participants={sortedParticipants}
      mainIdentity={mainIdentity}
      mainMode={mainMode}
      onSelect={handleSelect}
      showSidebar={showSidebar}
      showDrawingTools={showDrawingTools}
      allowFullScreen={allowFullScreen}
      compact={compact}
      className={className}
      aiController={aiController ?? null}
      requestedAiController={requestedAiController ?? false}
      raisedHands={raisedHands}
      onToggleHandRaise={onToggleHandRaise}
    />
  );
}
