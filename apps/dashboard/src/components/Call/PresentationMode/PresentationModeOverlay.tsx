import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Track } from 'livekit-client';
import { VideoTrack } from '@livekit/components-react';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { ParticipantAvatar } from '../ParticipantAvatar/ParticipantAvatar';
import { getAvatarColors } from '../ParticipantAvatar/avatarColors';
import { useProfilePictureUrl } from '../../../hooks/useProfilePicture';
import { XyneTelepresenceIcon } from '../../../assets/icons/XyneTelepresenceIcon';
import { isTelepresenceToggleEnable } from '../telepresenceCacConfig';
import { logger, Event } from '../../../utils/logger';

/**
 * The presenter, drawn as bare video.
 *
 * Deliberately NOT `ParticipantTile`: that component exists to render a tile in a
 * grid — name pill, mic/network/hand badges, hover controls, speaking frame — and
 * presentation mode wants none of it. Rendering the LiveKit `VideoTrack` directly
 * (as ScreenShareFullscreenModal and SpotlightView already do for screen shares)
 * keeps this view immune to tile chrome added later: there is no flag to remember
 * and nothing to suppress, because the tile is simply not in this tree.
 *
 * Audio is untouched by this — `RoomAudioRenderer` is mounted once globally in
 * GlobalCallOverlay, never per tile.
 */
function PresenterVideo({ participant }: { participant: ParticipantInfo }): React.ReactElement {
  const cameraPublication = participant.participant?.getTrackPublication(Track.Source.Camera);
  const hasVideo = participant.isCameraEnabled && cameraPublication?.isSubscribed;

  // Memoized so the trackRef keeps a stable identity across unrelated re-renders.
  // Without it VideoTrack re-attaches the <video> element every render, which flickers.
  const trackRef = useMemo(
    () =>
      cameraPublication && participant.participant
        ? {
            participant: participant.participant,
            source: Track.Source.Camera,
            publication: cameraPublication,
          }
        : undefined,
    [cameraPublication, participant.participant],
  );

  // Mirror our own camera, matching ParticipantTile. Presentation mode usually shows a
  // remote presenter, but findPresentationParticipant falls back to the local
  // participant when no remote human is in the call — and an un-mirrored view of
  // yourself reads as wrong, because it is not what a mirror (or every other call UI)
  // shows you. Remote feeds are never flipped. The tile also excluded screen shares
  // here; presentation mode never renders one, so that half of the condition is moot.
  const videoStyle = useMemo(
    () => (participant.isLocal ? { transform: 'scaleX(-1)' } : undefined),
    [participant.isLocal],
  );

  // Profile picture for the camera-off fallback (same metadata shape the tile reads).
  let picturePath: string | null = null;
  try {
    const meta = participant.participant?.metadata;
    if (meta) {
      picturePath = (JSON.parse(meta) as { picture?: string }).picture ?? null;
    }
  } catch {
    // ignore parse errors
  }
  const { url: pictureUrl } = useProfilePictureUrl(participant.identity, picturePath);

  if (hasVideo && trackRef) {
    // object-cover, identical to ParticipantTile's treatment of camera feeds: crop to
    // fill the screen edge-to-edge. object-contain was tried and rejected — it keeps
    // the whole frame but pillarboxes it with black bars whenever the camera and the
    // display disagree on aspect ratio, which does not read as fullscreen.
    return (
      <VideoTrack trackRef={trackRef} className='h-full w-full object-cover' style={videoStyle} />
    );
  }

  // Camera off — show who is on the call rather than a black rectangle, which on an
  // unattended wall is indistinguishable from a dead screen.
  return (
    <div className='flex h-full w-full items-center justify-center'>
      <ParticipantAvatar
        name={participant.name || 'Unknown'}
        size='xl'
        backgroundColor={getAvatarColors(participant.identity).avatar}
        pictureUrl={pictureUrl}
      />
    </div>
  );
}

interface PresentationModeOverlayProps {
  callId: string;
  isOpen: boolean;
  participant: ParticipantInfo | null;
  onExit: () => void;
}

export function PresentationModeOverlay({
  callId,
  isOpen,
  participant,
  onExit,
}: PresentationModeOverlayProps): React.ReactElement {
  const overlayRef = useRef<HTMLDivElement>(null);
  const fullscreenRequestedRef = useRef(false);
  const [fullscreenFailed, setFullscreenFailed] = useState(false);

  // Enter/exit fullscreen in sync with isOpen.
  // The overlay is fixed inset-0 so it already fills the viewport at opacity:0 —
  // the browser's zoom animation has nothing to zoom, making it invisible.
  // Calling here (not in onAnimationComplete) avoids stale-closure bugs where
  // the exit-animation completion fires the callback with an old isOpen=true value.
  useEffect(() => {
    if (!isOpen) {
      fullscreenRequestedRef.current = false;
      setFullscreenFailed(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen()?.catch((error: unknown) => {
          logger.error(Event.LIVEKIT_ROOM_EVENT, {
            callId,
            eventName: 'presentation_fullscreen_exit_failed',
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      return;
    }
    if (fullscreenRequestedRef.current) return;
    fullscreenRequestedRef.current = true;

    // The Fullscreen API requires transient user activation. When presentation
    // mode is opened programmatically rather than by a click — an unattended wall
    // launched with ?telepresence=1 — there is no activation and the request is
    // guaranteed to reject, which would light up the "Failed to enter presentation
    // mode" hint for something that isn't broken. Skip it instead: the overlay is
    // `fixed inset-0` so it already covers the viewport, and such a display is
    // normally run in a kiosk browser where the viewport is the whole screen.
    if (navigator.userActivation && !navigator.userActivation.isActive) return;

    void overlayRef.current?.requestFullscreen()?.catch((err: Error) => {
      logger.error(Event.LIVEKIT_ROOM_EVENT, {
        callId,
        eventName: 'presentation_fullscreen_request_failed',
        error: err.message,
      });
      fullscreenRequestedRef.current = false;
      setFullscreenFailed(true);
    });
  }, [callId, isOpen]);

  // Exit fullscreen on unmount (route change, error boundary) so the browser
  // doesn't stay fullscreen with nothing rendered.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // Sync with external fullscreen exits (Escape key, browser UI button).
  // Only fire when isOpen is true so we don't double-call onExit.
  useEffect(() => {
    const handleFullscreenChange = (): void => {
      if (!document.fullscreenElement && isOpen) {
        onExit();
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isOpen, onExit]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={overlayRef}
          className='fixed inset-0 z-[9999] bg-black flex items-center justify-center'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          // Fallback: click anywhere to exit when fullscreen API is unavailable
          onClick={fullscreenFailed ? onExit : undefined}
          data-track-category='CALLS'
          data-track-name='EXIT_PRESENTATION_MODE'
        >
          {participant ? (
            <PresenterVideo participant={participant} />
          ) : (
            <p className='text-white/40 text-sm'>Waiting for remote participant…</p>
          )}

          {fullscreenFailed && (
            <div className='absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-center pointer-events-none'>
              <p className='text-white/70 text-sm'>Failed to enter presentation mode.</p>
              <p className='text-white/40 text-xs'>Click × or anywhere to exit.</p>
            </div>
          )}

          {isTelepresenceToggleEnable && (
            <button
              onClick={e => {
                e.stopPropagation();
              }}
              className='absolute top-4 left-1/2 -translate-x-1/2 z-50 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 border border-white/20 flex items-center justify-center text-white/90 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/30'
              title='Enable Xyne Telepresence'
              aria-label='Enable Xyne Telepresence'
              data-track-category='CALLS'
              data-track-name='TOGGLE_XYNE_TELEPRESENCE'
            >
              <XyneTelepresenceIcon className='w-5 h-5' />
            </button>
          )}

          {/* Fallback exit button — only shown when the Fullscreen API is unavailable
              (e.g. iframe context, denied permissions). Matches ScreenShareFullscreenModal. */}
          {fullscreenFailed && (
            <button
              onClick={e => {
                e.stopPropagation();
                onExit();
              }}
              className='absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 border border-white/20 flex items-center justify-center text-white/90 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/30'
              aria-label='Exit presentation mode'
              data-track-category='CALLS'
              data-track-name='EXIT_PRESENTATION_MODE_FALLBACK'
            >
              <X className='w-5 h-5' />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
