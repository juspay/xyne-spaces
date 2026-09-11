import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { XyneTelepresenceIcon } from '../../../assets/icons/XyneTelepresenceIcon';
import { isTelepresenceToggleEnable } from '../telepresenceCacConfig';
import { logger, Event } from '../../../utils/logger';

interface PresentationModeOverlayProps {
  callId: string;
  isOpen: boolean;
  participant: ParticipantInfo | null;
  aiController: { id: string; name: string } | null;
  requestedAiController: boolean;
  onExit: () => void;
}

export function PresentationModeOverlay({
  callId,
  isOpen,
  participant,
  aiController,
  requestedAiController,
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
            <ParticipantTile
              participant={participant}
              className='h-full w-full'
              avatarSize='large'
              aiController={aiController}
              requestedAiController={requestedAiController}
              // Presentation mode is a clean full-bleed view: no name label and no
              // speaking/raised-hand ring (a coloured frame around the whole screen).
              hideNameLabel={true}
              hideSpeakingIndicator={true}
            />
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
