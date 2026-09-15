import { useCallback, useEffect, useRef } from 'react';
import { Minimize2 } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import type { ParticipantInfo } from '../../../machines/roomMachine';

interface VideoTileFullscreenModalProps {
  participant: ParticipantInfo | null;
  isOpen: boolean;
  onClose: () => void;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
  isHandRaised?: boolean;
  onToggleHandRaise?: (() => void) | undefined;
}

/**
 * Full-screen focus view for a single grid tile (camera or avatar).
 *
 * Mirrors `ScreenShareFullscreenModal`'s lightweight "fixed overlay" approach
 * (no browser Fullscreen API) so it behaves consistently across web/Electron
 * without extra permission prompts or fallback UI — same pattern already
 * proven for screen shares. Fills the ENTIRE viewport edge-to-edge (no
 * padding/max-width) and uses z-[80] — deliberately above the call controls
 * bar and side panels (z-50/z-[60]), which otherwise render later in the DOM
 * and paint on top of an equal z-50 modal.
 */
export function VideoTileFullscreenModal({
  participant,
  isOpen,
  onClose,
  aiController = null,
  requestedAiController = false,
  isHandRaised = false,
  onToggleHandRaise,
}: VideoTileFullscreenModalProps): React.ReactElement | null {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Keyboard: Escape closes.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return (): void => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll + focus the close button while open.
  useEffect((): (() => void) | void => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimeout = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return (): void => {
      document.body.style.overflow = prevOverflow;
      clearTimeout(focusTimeout);
    };
  }, [isOpen]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen || !participant) {
    return null;
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className='fixed inset-0 z-[80] flex items-center justify-center bg-black'
      onClick={handleBackdropClick}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClose();
        }
      }}
      role='dialog'
      aria-modal='true'
      aria-label={`${participant.isLocal ? 'Your' : `${participant.name}'s`} video, expanded`}
      data-testid='video-tile-fullscreen-modal'
      data-track-category='CALLS'
      data-track-name='Close_VideoTile_Fullscreen_Backdrop'
      tabIndex={-1}
    >
      <button
        ref={closeButtonRef}
        onClick={onClose}
        className={cn(
          'absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full',
          'border border-white/20 bg-black/50 text-white/90 backdrop-blur-sm transition-all duration-200',
          'hover:bg-black/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/30',
        )}
        aria-label='Close expanded view'
        data-track-category='CALLS'
        data-track-name='Close_VideoTile_Fullscreen'
      >
        <Minimize2 className='h-5 w-5' />
      </button>

      <div className='h-full w-full'>
        <ParticipantTile
          participant={participant}
          className='h-full w-full rounded-none border-0'
          avatarSize='large'
          aiController={aiController}
          requestedAiController={requestedAiController}
          isHandRaised={isHandRaised}
          onToggleHandRaise={onToggleHandRaise}
        />
      </div>
    </div>
  );
}
