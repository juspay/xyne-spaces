/**
 * RecordingCameraBubble - Floating preview of the recording's camera, shown on every page.
 * Drag it anywhere, or maximize it to full screen (Esc exits).
 */

import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { Track, type Room } from 'livekit-client';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useRecordingStore } from '../../../hooks/useRecordingStore';
import { useDraggableOverlay } from '../../../hooks/useDraggableOverlay';
import { cn } from '../../../utils/classNames';

const TILE_SIZE_PX = 200;
const TILE_CLASS = 'touch-none rounded-2xl shadow-2xl ring-1 ring-foreground/10';
const DEFAULT_POSITION_CLASS =
  'bottom-[calc(85px+env(safe-area-inset-bottom))] left-4 min-[700px]:bottom-6 min-[700px]:left-6';
const TRACK_CATEGORY = 'RecordingCameraBubble';

const useLocalCameraPreview = (
  room: Room | null,
  enabled: boolean,
): RefObject<HTMLVideoElement | null> => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!enabled || !video || !track) return;

    track.attach(video);
    return (): void => {
      track.detach(video);
    };
  }, [room, enabled]);

  return videoRef;
};

const useEscapeKey = (enabled: boolean, onEscape: () => void): void => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', handleKeyDown);
    return (): void => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onEscape]);
};

export function RecordingCameraBubble(): ReactElement | null {
  const room = useRecordingStore(context => context.room);
  const status = useRecordingStore(context => context.status);
  const isCameraEnabled = useRecordingStore(context => context.isCameraEnabled);
  const [isMaximized, setIsMaximized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { position, isDragging, hasDragged, handleMouseDown, handleTouchStart } =
    useDraggableOverlay(containerRef, { x: 0, y: 0 });

  const isPaused = status === 'paused';
  const isVisible = !!room && isCameraEnabled && (status === 'recording' || isPaused);
  const videoRef = useLocalCameraPreview(room, isVisible);

  useEscapeKey(isMaximized, () => setIsMaximized(false));

  useEffect(() => {
    if (!isVisible) setIsMaximized(false);
  }, [isVisible]);

  if (!isVisible) return null;

  const tileStyle = {
    width: TILE_SIZE_PX,
    height: TILE_SIZE_PX,
    ...(hasDragged ? { left: position.x, bottom: position.y } : {}),
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={containerRef}
      onMouseDown={isMaximized ? undefined : handleMouseDown}
      onTouchStart={isMaximized ? undefined : handleTouchStart}
      style={isMaximized ? undefined : tileStyle}
      className={cn(
        'group fixed z-50 select-none overflow-hidden bg-black',
        isMaximized && 'inset-0',
        !isMaximized && TILE_CLASS,
        !isMaximized && !hasDragged && DEFAULT_POSITION_CLASS,
        !isMaximized && (isDragging ? 'cursor-grabbing' : 'cursor-grab'),
      )}
      title={isMaximized ? undefined : 'Camera preview — drag to move'}
      data-testid='recording-camera-bubble'
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className={cn('size-full -scale-x-100', isMaximized ? 'object-contain' : 'object-cover')}
        aria-label='Camera preview'
      >
        <track kind='captions' />
      </video>

      {isPaused && (
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-medium text-white'>
          Paused
        </div>
      )}

      <button
        type='button'
        onMouseDown={event => event.stopPropagation()}
        onTouchStart={event => event.stopPropagation()}
        onClick={() => setIsMaximized(maximized => !maximized)}
        className={cn(
          'absolute flex items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-sm transition-opacity hover:bg-black/80 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
          isMaximized
            ? 'right-4 top-4 size-10'
            : 'right-2 top-2 size-7 min-[700px]:opacity-0 min-[700px]:group-hover:opacity-100',
        )}
        aria-label={isMaximized ? 'Exit full screen camera preview' : 'Full screen camera preview'}
        title={isMaximized ? 'Exit full screen (Esc)' : 'Full screen'}
        data-track-category={TRACK_CATEGORY}
        data-track-name={isMaximized ? 'minimize_camera_bubble' : 'maximize_camera_bubble'}
      >
        {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );
}

export default RecordingCameraBubble;
