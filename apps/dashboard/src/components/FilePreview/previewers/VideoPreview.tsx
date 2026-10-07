import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Film,
  Maximize,
  Minimize,
  Minus,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getAttachmentStreamUrl } from '../../../services/clients/apiClient';
import { cn } from '../../../utils/classNames';
import {
  PreviewButton,
  PreviewControls,
  PreviewMessage,
  PreviewMeta,
  usePreviewDownload,
} from '../chrome';
import type { PreviewerProps } from '../types';
import { AmbientVideo } from './media/Ambient';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;
/** Room left round a fitted picture. */
const FIT_MARGIN = 32;
/** The controls fade this long after the pointer last moved, while it plays. */
const CONTROLS_IDLE_MS = 2200;
/** A press that moves less than this is a click (play, pause), not a drag. */
const DRAG_THRESHOLD = 4;
const SEEK_STEP = 5;

type Zoom = 'fit' | number;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Zoomed out no further than 25%, or than fitting the pane when that takes less. */
const clampZoom = (scale: number, fit: number): number =>
  Math.min(MAX_ZOOM, Math.max(Math.min(MIN_ZOOM, fit), scale));
/** The smallest a fitted picture is drawn, however small the pane. */
const SMALLEST_FIT = 0.02;

/**
 * A video, played as it streams — the attachment's ranged stream, which chat plays
 * from too — on its own colours, blurred out behind it as YouTube's ambient mode
 * does. Its controls sit over the picture and stay put while the picture is zoomed
 * (toolbar, ⌘/Ctrl and the wheel) and dragged about. Click plays and pauses, a
 * double-click goes full screen; Space, ←/→, M and F do as they do everywhere.
 * Every video is offered to the browser, and only one it says it can't decode is
 * offered for download instead.
 */
export default function VideoPreview(props: PreviewerProps): ReactElement {
  const download = usePreviewDownload();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // Why the video isn't showing, when it isn't: a format the browser can't decode is
  // offered for download; anything else — the network, an expired session — can be
  // tried again.
  const [failure, setFailure] = useState<'unplayable' | 'unreachable' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const unplayable = failure !== null;
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const [volume, setVolume] = useState({ level: 1, muted: false });
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const idleTimer = useRef<number | null>(null);
  const press = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPane({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [unplayable]);

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // A big recording in a small pane fits however far down that takes: the 25% floor
  // is for zooming out by hand, not for fitting.
  const fitScale = natural
    ? Math.max(
        SMALLEST_FIT,
        Math.min(
          (pane.width - FIT_MARGIN) / natural.width,
          (pane.height - FIT_MARGIN) / natural.height,
        ),
      )
    : 1;
  const scale = zoom === 'fit' ? fitScale : zoom;
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;
  const zoomBy = useCallback(
    (factor: number) =>
      setZoom(current =>
        clampZoom(
          (current === 'fit' ? fitScaleRef.current : current) * factor,
          fitScaleRef.current,
        ),
      ),
    [],
  );

  // ⌘/Ctrl and the wheel zooms the picture, not the page.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY / 300));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomBy, unplayable]);

  const reveal = useCallback(() => {
    setControlsShown(true);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setControlsShown(false), CONTROLS_IDLE_MS);
  }, []);
  useEffect(
    () => () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    },
    [],
  );

  // The picture's size and length, once the browser has read them.
  const readMetadata = useCallback((element: HTMLVideoElement) => {
    setNatural({ width: element.videoWidth || 1280, height: element.videoHeight || 720 });
    setTime({ current: element.currentTime, duration: element.duration });
    // The first frame, for the picture and its backdrop before it plays.
    if (element.currentTime === 0) element.currentTime = 0.001;
  }, []);
  // A stream that answers fast — or from the cache — is read before React is
  // listening, and loadedmetadata doesn't fire twice: what is already read is taken
  // as soon as the element is here.
  useEffect(() => {
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) readMetadata(video);
  }, [video, readMetadata]);

  const togglePlay = useCallback(() => {
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, [video]);
  const seekBy = (seconds: number): void => {
    if (video)
      video.currentTime = Math.min(video.duration || 0, Math.max(0, video.currentTime + seconds));
  };
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  if (failure === 'unplayable') {
    return (
      <PreviewMessage
        icon={<Film className='size-10 text-muted-foreground' />}
        title="This video can't play in this browser"
        body='Its format isn’t one the browser can decode. Download it to watch it in a video player.'
        actions={[
          { label: 'Download', onClick: download, primary: true, trackName: 'PreviewDownloaded' },
        ]}
      />
    );
  }
  if (failure === 'unreachable') {
    return (
      <PreviewMessage
        icon={<Film className='size-10 text-muted-foreground' />}
        title="Couldn't load this video"
        body='The connection dropped, or the session needs a refresh. Try again, or download it.'
        actions={[
          {
            label: 'Try again',
            onClick: () => {
              setNatural(null);
              setFailure(null);
              setAttempt(current => current + 1);
            },
            trackName: 'PreviewVideoRetried',
          },
          { label: 'Download', onClick: download, primary: true, trackName: 'PreviewDownloaded' },
        ]}
      />
    );
  }

  const box = natural
    ? { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) }
    : null;
  const pannable = box !== null && (box.width > pane.width || box.height > pane.height);
  const showControls = controlsShown || !playing;

  return (
    <>
      {natural && (
        <PreviewMeta>
          {formatTime(time.duration)} · {natural.width} × {natural.height}
        </PreviewMeta>
      )}
      <PreviewControls>
        <PreviewButton
          title='Zoom out'
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={scale <= Math.min(MIN_ZOOM, fitScale)}
          trackName='PreviewZoomedOut'
        >
          <Minus className='size-4' />
        </PreviewButton>
        <button
          type='button'
          title={zoom === 'fit' ? 'Actual size' : 'Fit to the pane'}
          onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
          className='h-7 min-w-[52px] rounded-md px-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
          data-track-category='FilePreview'
          data-track-name='PreviewZoomReset'
        >
          {Math.round(scale * 100)}%
        </button>
        <PreviewButton
          title='Zoom in'
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={scale >= MAX_ZOOM}
          trackName='PreviewZoomedIn'
        >
          <Plus className='size-4' />
        </PreviewButton>
      </PreviewControls>

      <div
        ref={stageRef}
        className={cn('relative h-full overflow-hidden bg-black', !showControls && 'cursor-none')}
      >
        <AmbientVideo video={video} />
        {/* The picture is the play button — a click plays or pauses — and, focused,
            takes Space, the arrows, M and F as a player does. */}
        <div
          ref={scrollRef}
          role='button'
          aria-label={playing ? `Pause ${props.file.name}` : `Play ${props.file.name}`}
          tabIndex={0}
          onKeyDown={event => {
            const key = event.key.toLowerCase();
            if (key === ' ' || key === 'k' || key === 'enter') togglePlay();
            else if (key === 'arrowleft') seekBy(-SEEK_STEP);
            else if (key === 'arrowright') seekBy(SEEK_STEP);
            else if (key === 'm' && video) video.muted = !video.muted;
            else if (key === 'f') toggleFullscreen();
            else return;
            event.preventDefault();
            reveal();
          }}
          className={cn(
            'scrollbar-none absolute inset-0 overflow-auto outline-none',
            pannable && 'cursor-grab active:cursor-grabbing',
          )}
          data-track-category='FilePreview'
          data-track-name='PreviewVideoPlayToggled'
          onPointerDown={event => {
            const element = scrollRef.current;
            if (!element || event.button !== 0) return;
            press.current = {
              x: event.clientX,
              y: event.clientY,
              left: element.scrollLeft,
              top: element.scrollTop,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            reveal();
            const element = scrollRef.current;
            const start = press.current;
            if (!start || !element) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            start.moved = true;
            if (!pannable) return;
            element.scrollLeft = start.left - dx;
            element.scrollTop = start.top - dy;
          }}
          onPointerUp={() => {
            if (press.current && !press.current.moved) togglePlay();
            press.current = null;
          }}
          onPointerCancel={() => {
            press.current = null;
          }}
          onDoubleClick={toggleFullscreen}
        >
          <div
            className='relative flex min-h-full min-w-full items-center justify-center p-4'
            style={{ width: 'max-content' }}
          >
            <video
              ref={setVideo}
              key={`${props.file.id}:${attempt}`}
              src={getAttachmentStreamUrl(props.file.id)}
              // The stream may be another origin's; its cookies still have to go.
              crossOrigin='use-credentials'
              playsInline
              preload='metadata'
              className='block max-w-none select-none rounded-sm shadow-2xl'
              style={box ? { width: box.width, height: box.height } : { visibility: 'hidden' }}
              onLoadedMetadata={event => readMetadata(event.currentTarget)}
              onTimeUpdate={event =>
                setTime({
                  current: event.currentTarget.currentTime,
                  duration: event.currentTarget.duration,
                })
              }
              onDurationChange={event => {
                // Read now: by the time the update runs, React has let go of the event.
                const duration = event.currentTarget.duration;
                setTime(current => ({ ...current, duration }));
              }}
              onPlay={() => {
                setPlaying(true);
                reveal();
              }}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onVolumeChange={event =>
                setVolume({ level: event.currentTarget.volume, muted: event.currentTarget.muted })
              }
              onRateChange={event => setSpeed(event.currentTarget.playbackRate)}
              onError={event => {
                const code = event.currentTarget.error?.code;
                setFailure(
                  code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
                    code === MediaError.MEDIA_ERR_DECODE
                    ? 'unplayable'
                    : 'unreachable',
                );
              }}
            >
              <track kind='captions' />
            </video>
          </div>
        </div>

        {!playing && natural && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
            <span className='flex size-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm'>
              <Play className='ml-1 size-7 fill-current' />
            </span>
          </div>
        )}

        {/* Over the picture, not on it: the controls stay put however it is zoomed. */}
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-4 pb-3 pt-10 text-white transition-opacity duration-200',
            // Kept in sight while the pointer is on them, as well as while it moves.
            showControls ? 'opacity-100' : 'opacity-0 hover:opacity-100',
          )}
        >
          <input
            type='range'
            min={0}
            max={time.duration || 0}
            step={0.05}
            value={time.current}
            onChange={event => {
              if (video) video.currentTime = Number(event.target.value);
            }}
            aria-label='Seek'
            className='mb-2 h-1 w-full cursor-pointer accent-white'
            data-track-category='FilePreview'
            data-track-name='PreviewVideoSeeked'
          />
          <div className='flex items-center gap-1'>
            <VideoButton
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
              onClick={togglePlay}
              track='PreviewVideoPlayToggled'
            >
              {playing ? (
                <Pause className='size-4 fill-current' />
              ) : (
                <Play className='size-4 fill-current' />
              )}
            </VideoButton>
            <VideoButton
              title={volume.muted || volume.level === 0 ? 'Unmute (M)' : 'Mute (M)'}
              onClick={() => {
                if (video) video.muted = !video.muted;
              }}
              track='PreviewVideoMuteToggled'
            >
              {volume.muted || volume.level === 0 ? (
                <VolumeX className='size-4' />
              ) : (
                <Volume2 className='size-4' />
              )}
            </VideoButton>
            <input
              type='range'
              min={0}
              max={1}
              step={0.05}
              value={volume.muted ? 0 : volume.level}
              onChange={event => {
                if (!video) return;
                video.volume = Number(event.target.value);
                video.muted = video.volume === 0;
              }}
              aria-label='Volume'
              className='h-1 w-20 cursor-pointer accent-white'
              data-track-category='FilePreview'
              data-track-name='PreviewVideoVolumeChanged'
            />
            <span className='ml-2 text-xs tabular-nums text-white/85'>
              {formatTime(time.current)} / {formatTime(time.duration)}
            </span>
            <span className='flex-1' />
            <VideoButton
              title='Playback speed'
              onClick={() => {
                if (!video) return;
                const at = SPEEDS.findIndex(each => each === speed);
                video.playbackRate = SPEEDS[(at + 1) % SPEEDS.length] ?? 1;
              }}
              track='PreviewVideoSpeedChanged'
            >
              <span className='w-9 text-xs font-medium tabular-nums'>{speed}×</span>
            </VideoButton>
            {document.pictureInPictureEnabled && (
              <VideoButton
                title='Picture in picture'
                onClick={() => {
                  if (!video) return;
                  if (document.pictureInPictureElement) void document.exitPictureInPicture();
                  else void video.requestPictureInPicture().catch(() => undefined);
                }}
                track='PreviewVideoPipToggled'
              >
                <PictureInPicture2 className='size-4' />
              </VideoButton>
            )}
            <VideoButton
              title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
              onClick={toggleFullscreen}
              track='PreviewVideoFullscreenToggled'
            >
              {fullscreen ? <Minimize className='size-4' /> : <Maximize className='size-4' />}
            </VideoButton>
          </div>
        </div>
      </div>
    </>
  );
}

function VideoButton(props: {
  title: string;
  onClick: () => void;
  track: string;
  children: ReactElement;
}): ReactElement {
  return (
    <button
      type='button'
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
      className='flex h-8 min-w-8 items-center justify-center rounded-md px-1 text-white/90 transition-colors hover:bg-white/15 hover:text-white'
      data-track-category='FilePreview'
      data-track-name={props.track}
    >
      {props.children}
    </button>
  );
}
