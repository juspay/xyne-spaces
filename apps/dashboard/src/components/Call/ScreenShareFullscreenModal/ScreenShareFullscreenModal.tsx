import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import {
  TransformWrapper,
  TransformComponent,
  ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { VideoTrack, type TrackReference } from '@livekit/components-react';
import { cn } from '../../../utils/classNames';
import { DrawingCanvas, DrawingToolbar } from '../DrawingCanvas';
import type { DrawingCanvasHandle } from '../DrawingCanvas';
import { useDrawStore } from '../../../hooks/useDrawStore';

interface ScreenShareFullscreenModalProps {
  trackRef: TrackReference | undefined;
  isOpen: boolean;
  onClose: () => void;
  participantName: string;
}

export function ScreenShareFullscreenModal({
  trackRef,
  isOpen,
  onClose,
  participantName,
}: ScreenShareFullscreenModalProps): React.ReactElement | null {
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const isDrawingEnabled = useDrawStore(s => s.isDrawingEnabled);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case '+':
        case '=':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            transformRef.current?.zoomIn(0.25);
          }
          break;
        case '-':
        case '_':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            transformRef.current?.zoomOut(0.25);
          }
          break;
        case '0':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            transformRef.current?.resetTransform();
          }
          break;
      }
    },
    [isOpen, onClose],
  );

  // Keyboard listener - separate because it depends on handleKeyDown callback
  useEffect((): (() => void) | void => {
    if (!isOpen) return;

    document.addEventListener('keydown', handleKeyDown);
    return (): void => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Modal open/close setup: body scroll lock, focus management, transform reset
  useEffect((): (() => void) | void => {
    if (!isOpen) return;

    // Lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Reset zoom/pan transform
    transformRef.current?.resetTransform();

    // Focus close button after render
    const focusTimeout = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return (): void => {
      document.body.style.overflow = prevOverflow;
      clearTimeout(focusTimeout);
    };
  }, [isOpen]);

  // Close modal if track becomes invalid
  useEffect(() => {
    if (!isOpen) return;

    const mediaStreamTrack = trackRef?.publication?.track?.mediaStreamTrack;
    if (!mediaStreamTrack || mediaStreamTrack.readyState !== 'live') {
      onClose();
    }
  }, [trackRef, isOpen, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Don't close when drawing mode is active (clicks go to the drawing canvas)
      if (isDrawingEnabled) return;
      // Only close if clicking the backdrop itself, not during pan
      if (e.target === e.currentTarget && !isPanning) {
        onClose();
      }
    },
    [onClose, isPanning, isDrawingEnabled],
  );

  const handlePanStart = useCallback((): void => {
    setIsPanning(true);
  }, []);

  const handlePanStop = useCallback((): void => {
    // Small delay to prevent click from triggering backdrop close
    setTimeout(() => setIsPanning(false), 50);
  }, []);

  if (!isOpen || !trackRef) {
    return null;
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={cn(
        'fixed inset-0 z-[80] bg-black',
        !isDrawingEnabled && 'cursor-grab active:cursor-grabbing',
      )}
      onClick={handleBackdropClick}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClose();
        }
      }}
      role='dialog'
      aria-modal='true'
      aria-label={`${participantName}'s screen share`}
      data-testid='screen-share-fullscreen-modal'
      data-track-category='CALLS'
      data-track-name='Close_ScreenShare_Fullscreen_Backdrop'
      tabIndex={-1}
    >
      {/* Close Button */}
      <button
        ref={closeButtonRef}
        onClick={onClose}
        className={cn(
          'absolute top-4 right-4 z-10',
          'w-10 h-10 rounded-full',
          'bg-black/50 hover:bg-black/70',
          'border border-white/20',
          'flex items-center justify-center',
          'text-white/90 hover:text-white',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-white/30',
        )}
        aria-label='Close fullscreen view'
        data-track-category='CALLS'
        data-track-name='Close_ScreenShare_Fullscreen'
      >
        <Minimize2 className='w-5 h-5' />
      </button>

      {/* Participant Name Label */}
      <div
        className={cn(
          'absolute top-4 left-4 z-10',
          'bg-black/50 backdrop-blur-sm',
          'rounded-lg px-4 py-2',
          'border border-white/10',
        )}
      >
        <span className='text-white font-medium text-sm'>{participantName}&apos;s Screen</span>
      </div>

      {/* Zoom/Pan Container — disabled while drawing so gestures don't interfere */}

      <TransformWrapper
        ref={transformRef}
        minScale={1}
        maxScale={5}
        limitToBounds
        disabled={isDrawingEnabled}
        doubleClick={{ mode: 'reset' }}
        wheel={{ step: 0.2, disabled: isDrawingEnabled }}
        pinch={{ step: 5, disabled: isDrawingEnabled }}
        panning={{ disabled: isDrawingEnabled }}
        onPanningStart={handlePanStart}
        onPanningStop={handlePanStop}
      >
        <TransformComponent wrapperClass='!w-full !h-full'>
          <div
            className='flex items-center justify-center'
            style={{ width: '100vw', height: '100vh' }}
          >
            <VideoTrack trackRef={trackRef} className='max-w-full max-h-full object-contain' />
          </div>
        </TransformComponent>
      </TransformWrapper>

      {/* Drawing overlay — sits outside TransformWrapper so it's not affected by zoom/pan */}
      <DrawingCanvas ref={drawingCanvasRef} />

      {/* Drawing toolbar — only shown when drawing mode is active */}
      {isDrawingEnabled && <DrawingToolbar />}

      {/* Hint Text - Positioned at top center, below the participant label */}
      <div
        className={cn(
          'absolute top-16 left-1/2 -translate-x-1/2 z-10',
          'bg-black/50 backdrop-blur-sm',
          'rounded-full px-4 py-2',
          'border border-white/10',
          isDrawingEnabled && 'hidden', // hide hints while drawing to reduce visual noise
        )}
        role='status'
        aria-live='polite'
      >
        <span className='text-white/70 text-sm'>
          Scroll to zoom · Drag to pan · Double-click to reset · ESC to close
        </span>
      </div>
    </div>
  );
}
