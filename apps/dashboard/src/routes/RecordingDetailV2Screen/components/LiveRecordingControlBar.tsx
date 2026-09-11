/**
 * Live Recording Control Bar
 *
 * Displays the timeline strip for the V2 recording detail screen.
 *
 * While the recording is live:
 *   • Stop button
 *   • Pause / resume button (only when this browser owns the recording session)
 *   • Elapsed timer
 *   • Read-only timeline with the current position and any flagged moments
 *   • LIVE / PAUSED status label
 *   • Audio-level visualizer
 *
 * Once the recording has ended the bar becomes a player over the full duration,
 * with every marked item on the track: decision and action dots extracted by the
 * summary pipeline, and a flag for each moment the user flagged mid-call. Given
 * `onMarkerSelect`, clicking any of the three opens the transcript at that point.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { StopSmall, Spinner, PauseBig, PlayBig, Flag, AlertTriangle } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { sendRecordingEvent, useRecordingStore } from '../../../hooks/useRecordingStore';
import { calculateRecordingElapsedMs, formatElapsedTime } from '../../../utils/recordingUtils';
import { useAudioPlayback } from '../../../components/ui/AudioPlayer/useAudioPlayback';
import type { RecordingDetail } from '../../../services/Recording/recordingService';
import type { MarkedMoment } from '../../../stores/recordingStore';
import { parseMarkedItems, type MarkedItem, type MarkedItemType } from './markedItems';

const TIMELINE_WINDOW_MS = 40 * 60 * 1000; // 40 min fixed window for the live timeline

const PLAYBACK_SPEEDS = [
  { value: 1, label: '1x' },
  { value: 1.2, label: '1.2x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
] as const;

interface LiveRecordingControlBarProps {
  recording: RecordingDetail;
  isLive: boolean;
  onStopped?: () => void;
  onLoadAudio?: (signal: AbortSignal) => Promise<Blob>;
  onMarkerSelect?: (item: MarkedItem) => void;
  onOpenTranscript?: () => void;
  isAudioPreparing?: boolean;
  /** True once playback is known to be unavailable for this recording. */
  isAudioUnavailable?: boolean;
}

/** Stands in when there is no audio to load, so the playback hook can stay unconditional. */
const EMPTY_AUDIO_LOADER = (): Promise<Blob> => Promise.reject(new Error('No audio available'));

export const LiveRecordingControlBar = ({
  recording,
  isLive,
  onStopped,
  onLoadAudio,
  onMarkerSelect,
  onOpenTranscript,
  isAudioPreparing = false,
  isAudioUnavailable = false,
}: LiveRecordingControlBarProps): ReactElement | null => {
  // Recording session state — only meaningful when this tab owns the live session.
  const activeExternalId = useRecordingStore(context => context.externalId);
  const sessionStatus = useRecordingStore(context => context.status);
  const sessionStartTime = useRecordingStore(context => context.startTime);
  const pauseStartedAt = useRecordingStore(context => context.pauseStartedAt);
  const accumulatedPausedMs = useRecordingStore(context => context.accumulatedPausedMs);
  const markedMoments = useRecordingStore(context => context.markedMoments);

  const ownsSession =
    activeExternalId === recording.externalId &&
    (sessionStatus === 'recording' || sessionStatus === 'paused');
  const isPaused = ownsSession && sessionStatus === 'paused';

  const startTime =
    (ownsSession ? sessionStartTime : null) ?? new Date(recording.startedAt).getTime();

  const [elapsedMs, setElapsedMs] = useState(0);
  const [stopRequested, setStopRequested] = useState(false);
  /** The session is torn down asynchronously, so keep the spinner until it's gone. */
  const isStopping = stopRequested && ownsSession;

  useEffect(() => {
    if (!isLive) return;

    const pausedAt = ownsSession ? pauseStartedAt : null;
    const pausedMs = ownsSession ? accumulatedPausedMs : 0;

    const tick = (): void =>
      setElapsedMs(calculateRecordingElapsedMs(startTime, pausedAt, pausedMs));

    tick();
    if (isPaused) return; // the timer is frozen while paused

    const interval = window.setInterval(tick, 1000);
    return (): void => window.clearInterval(interval);
  }, [isLive, isPaused, ownsSession, pauseStartedAt, accumulatedPausedMs, startTime]);

  const handleStop = useCallback((): void => {
    if (!ownsSession || stopRequested) return;
    setStopRequested(true);
    sendRecordingEvent({ type: 'requestStop' });
  }, [ownsSession, stopRequested]);

  // The call is only marked ENDED once LiveKit reports the room finished, so give
  // the webhook a moment before reloading the detail.
  useEffect(() => {
    if (!stopRequested || ownsSession) return;

    const timer = window.setTimeout(() => onStopped?.(), 1500);
    return (): void => window.clearTimeout(timer);
  }, [stopRequested, ownsSession, onStopped]);

  const handleTogglePause = useCallback((): void => {
    sendRecordingEvent({ type: isPaused ? 'resumeRecording' : 'pauseRecording' });
  }, [isPaused]);

  // Once the l ocal session is gone the recording is over, even if the API hasn't
  // caught up yet.
  if (!isLive || (stopRequested && !ownsSession)) {
    return (
      <RecordedTimelineBar
        recording={recording}
        isAudioPreparing={isAudioPreparing}
        isAudioUnavailable={isAudioUnavailable}
        {...(onLoadAudio ? { onLoadAudio } : {})}
        {...(onMarkerSelect ? { onMarkerSelect } : {})}
        {...(onOpenTranscript ? { onOpenTranscript } : {})}
      />
    );
  }

  return (
    <div className='mb-6 flex items-center gap-4 rounded-2xl border border-border bg-card/10 px-5 py-4'>
      {/* Only the tab running the session can stop or pause it. */}
      {ownsSession && (
        <>
          <Button
            type='button'
            variant='destructive'
            size='icon'
            onClick={handleStop}
            disabled={isStopping}
            className='size-11 shrink-0 rounded-full transition-transform active:scale-95 motion-reduce:transform-none'
            aria-label='Stop recording'
            title='Recording — click to stop and finalize'
            data-track-category='RecordingDetailV2'
            data-track-name='stop_live_recording'
          >
            {isStopping ? (
              <Spinner size={22} className='animate-spin' />
            ) : (
              <StopSmall className='size-10' variant='Solid' />
            )}
          </Button>

          <Button
            type='button'
            variant='outline'
            size='icon'
            onClick={handleTogglePause}
            disabled={isStopping}
            className='size-8 shrink-0 rounded-full border-border bg-card text-muted-foreground transition-colors hover:text-foreground'
            aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
            title={isPaused ? 'Resume recording' : 'Pause recording'}
            data-track-category='RecordingDetailV2'
            data-track-name={isPaused ? 'resume_live_recording' : 'pause_live_recording'}
          >
            {isPaused ? (
              <PlayBig size={14} variant='Solid' />
            ) : (
              <PauseBig size={14} strokeWidth={4} variant='Solid' />
            )}
          </Button>
        </>
      )}

      <span className='w-12 shrink-0 text-right font-mono text-xs text-foreground'>
        {formatElapsedTime(elapsedMs)}
      </span>

      <LiveRecordingTimeline
        elapsedMs={elapsedMs}
        isPaused={isPaused}
        // Moments only exist locally, on the tab running the session.
        moments={ownsSession ? markedMoments : []}
        className='flex-1'
      />

      <span
        className={[
          'shrink-0 font-mono text-xs font-medium uppercase tracking-wide w-12',
          isPaused ? 'text-muted-foreground' : 'text-primary',
        ].join(' ')}
      >
        {isPaused ? 'Paused' : 'Live'}
      </span>

      <RecordingVisualizer
        isAnimated={!isPaused}
        className='h-7 w-14 justify-center rounded-lg border border-border px-2'
        {...(onOpenTranscript ? { onClick: onOpenTranscript } : {})}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Timeline markers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Decisions and actions the summary pipeline extracted, as dots sitting on the track
 * itself — moments get a flag above it instead
 */
const MARKER_DOT_COLOR: Record<Exclude<MarkedItemType, 'moment'>, string> = {
  decision: 'bg-yellow-500',
  action: 'bg-orange-500',
};

/** Names the marker in its tooltip, so the three kinds read apart without the legend. */
const MARKER_NOUN: Record<MarkedItemType, string> = {
  decision: 'Decision',
  action: 'Action',
  moment: 'Marked moment',
};

const MARKER_INTERACTIVE =
  "cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-2 after:content-[''] motion-reduce:transform-none";

interface MomentFlagProps {
  percent: number;
  title: string;
  onSelect?: () => void;
}

/** Flag pinned to a point on either timeline — a button only when it can be acted on. */
const MomentFlag = ({ percent, title, onSelect }: MomentFlagProps): ReactElement => {
  const className = cn(
    'absolute bottom-1.5 z-10 flex -translate-x-0.5',
    onSelect && MARKER_INTERACTIVE,
  );
  const glyph = <Flag size={14} variant='Solid' className='text-primary' aria-hidden='true' />;

  if (!onSelect) {
    return (
      <span className={className} style={{ left: `${percent}%` }} title={title}>
        {glyph}
      </span>
    );
  }

  return (
    <button
      type='button'
      onClick={onSelect}
      data-track-category='RecordingDetailV2'
      data-track-name='marker_open_transcript_moment'
      className={className}
      style={{ left: `${percent}%` }}
      title={title}
      aria-label={title}
    >
      {glyph}
    </button>
  );
};

interface MarkerDotProps {
  percent: number;
  type: Exclude<MarkedItemType, 'moment'>;
  title: string;
  onSelect?: () => void;
}

const MarkerDot = ({ percent, type, title, onSelect }: MarkerDotProps): ReactElement => {
  const className = cn(
    'absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background',
    MARKER_DOT_COLOR[type],
    onSelect && MARKER_INTERACTIVE,
  );

  if (!onSelect) {
    return <span className={className} style={{ left: `${percent}%` }} title={title} />;
  }

  return (
    <button
      type='button'
      onClick={onSelect}
      data-track-category='RecordingDetailV2'
      data-track-name='marker_open_transcript_item'
      className={className}
      style={{ left: `${percent}%` }}
      title={title}
      aria-label={title}
    />
  );
};

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

interface LiveRecordingTimelineProps {
  elapsedMs: number;
  isPaused: boolean;
  /** Moments flagged during this session, positioned by their `elapsedMs`. */
  moments: MarkedMoment[];
  className?: string;
}

const LiveRecordingTimeline = ({
  elapsedMs,
  isPaused,
  moments,
  className = '',
}: LiveRecordingTimelineProps): ReactElement => {
  const progressPercent = Math.min((elapsedMs / TIMELINE_WINDOW_MS) * 100, 100);

  return (
    <div className={className}>
      <div className='relative h-1.5 w-full rounded-full bg-muted'>
        <div
          className='absolute inset-y-0 left-0 rounded-full bg-foreground'
          style={{ width: `${progressPercent}%` }}
        />

        {moments.map((moment, index) => (
          <MomentFlag
            key={index}
            percent={Math.min((moment.elapsedMs / TIMELINE_WINDOW_MS) * 100, 100)}
            title={`Marked moment at ${formatElapsedTime(moment.elapsedMs)}`}
          />
        ))}

        {/* Playhead: the halo and the dot share the wrapper's box so the ping
            always expands from the dot's centre. */}
        <div
          className='absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2'
          style={{ left: `${progressPercent}%` }}
        >
          {!isPaused && <span className='absolute inset-0 animate-ping rounded-full bg-primary' />}
          <span className='absolute inset-0 rounded-full border-2 border-background bg-primary shadow-sm' />
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Ended recording — static timeline                                          */
/* -------------------------------------------------------------------------- */

interface RecordedTimelineBarProps {
  recording: RecordingDetail;
  /** Supplied once the audio is stitched; without it the bar is read-only. */
  onLoadAudio?: (signal: AbortSignal) => Promise<Blob>;
  /** Supplied once there is a transcript to open at the marker's timestamp. */
  onMarkerSelect?: (item: MarkedItem) => void;
  /** Supplied once there is a transcript to open — the waveform pill opens it directly. */
  onOpenTranscript?: () => void;
  /** True while the stitched audio is still on its way. */
  isAudioPreparing?: boolean;
  /** True once playback is known to be unavailable (e.g. older recordings). */
  isAudioUnavailable?: boolean;
}

const RecordedTimelineBar = ({
  recording,
  onLoadAudio,
  onMarkerSelect,
  onOpenTranscript,
  isAudioPreparing = false,
  isAudioUnavailable = false,
}: RecordedTimelineBarProps): ReactElement => {
  const fallbackDurationMs =
    recording.durationMs ??
    (recording.endedAt
      ? new Date(recording.endedAt).getTime() - new Date(recording.startedAt).getTime()
      : null);

  const playback = useAudioPlayback({
    onLoad: onLoadAudio ?? EMPTY_AUDIO_LOADER,
    initialDurationSec: fallbackDurationMs ? fallbackDurationMs / 1000 : undefined,
    showToastOnError: true,
  });
  const shouldReduceMotion = useReducedMotion();

  // Prefer the media's own duration once it has loaded — the call's wall-clock span
  // can differ from the recorded audio by a second or two. It can also be unknown for
  // a moment after the recording ends, which the bar rides out rather than unmounting.
  const durationMs = playback.duration > 0 ? playback.duration * 1000 : (fallbackDurationMs ?? 0);
  // Markers are positioned as a fraction of the duration, so they wait for one.
  const markedItems = durationMs > 0 ? parseMarkedItems(recording.markedItems) : [];
  const markedTypes = new Set(markedItems.map(item => item.type));
  const elapsedMs = playback.currentTime * 1000;
  const progressPercent = durationMs > 0 ? Math.min((elapsedMs / durationMs) * 100, 100) : 0;
  const isPlaying = playback.state === 'playing';
  const isStitching = !onLoadAudio && isAudioPreparing;
  const isAudioBusy = isStitching || playback.state === 'loading';
  // Once stitching has given up (or never applied) and there is still no audio to
  // load, the recording simply has no playable audio (e.g. older recordings) — show
  // an alert-triangle instead of a spinner that would otherwise never resolve.
  const showAudioUnavailable = !onLoadAudio && !isStitching && isAudioUnavailable;
  const audioControlLabel = isStitching
    ? 'Preparing audio'
    : showAudioUnavailable
      ? 'Recording is not available for playback.'
      : !onLoadAudio
        ? 'Audio is unavailable for this recording'
        : playback.state === 'loading'
          ? 'Loading audio'
          : isPlaying
            ? 'Pause recording'
            : 'Play recording';
  const audioIconKey = isAudioBusy
    ? 'loading'
    : showAudioUnavailable
      ? 'unavailable'
      : isPlaying
        ? 'pause'
        : 'play';

  const selectMarker =
    playback.canSeek || onMarkerSelect
      ? (item: MarkedItem): void => {
          if (playback.canSeek) playback.seek(item.timestampSeconds);
          onMarkerSelect?.(item);
        }
      : null;

  const playButton = (
    <motion.div
      className='shrink-0'
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={
        shouldReduceMotion ? { duration: 0.15 } : { type: 'spring', stiffness: 480, damping: 30 }
      }
    >
      <Button
        type='button'
        variant='outline'
        size='icon'
        onClick={() => void playback.toggle()}
        disabled={!onLoadAudio || playback.state === 'loading'}
        aria-busy={isAudioBusy}
        className='size-8 rounded-full border-border bg-card text-muted-foreground hover:text-foreground'
        aria-label={audioControlLabel}
        title={audioControlLabel}
        data-track-category='RecordingDetailV2'
        data-track-name={isPlaying ? 'pause_recording' : 'play_recording'}
      >
        <AnimatePresence mode='wait' initial={false}>
          <motion.span
            key={audioIconKey}
            className='flex items-center justify-center'
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.14 }}
          >
            {isAudioBusy ? (
              <Spinner size={14} className='animate-spin' />
            ) : showAudioUnavailable ? (
              <AlertTriangle size={14} className='text-muted-foreground' />
            ) : isPlaying ? (
              <PauseBig size={14} strokeWidth={4} variant='Solid' />
            ) : (
              <PlayBig size={14} variant='Solid' />
            )}
          </motion.span>
        </AnimatePresence>
      </Button>
    </motion.div>
  );

  return (
    <div className='mb-6 rounded-2xl border border-border bg-card px-5 py-4'>
      <div className='flex min-h-11 items-center gap-4'>
        {showAudioUnavailable ? (
          <Tooltip content='Recording is not available for playback.'>{playButton}</Tooltip>
        ) : (
          playButton
        )}

        <span className='w-12 shrink-0 text-right font-mono text-xs text-foreground'>
          {formatElapsedTime(elapsedMs)}
        </span>

        <div className='relative h-1.5 flex-1 rounded-full bg-muted'>
          <div
            className='absolute inset-y-0 left-0 rounded-full bg-foreground'
            style={{ width: `${progressPercent}%` }}
          />

          {markedItems.map((item, index) => {
            const percent = Math.min((item.timestampSeconds * 1000 * 100) / durationMs, 100);
            const onSelect = selectMarker ? (): void => selectMarker(item) : undefined;
            const timeLabel = formatElapsedTime(item.timestampSeconds * 1000);
            const title = item.text
              ? `${MARKER_NOUN[item.type]} · ${timeLabel} — ${item.text}`
              : `${MARKER_NOUN[item.type]} at ${timeLabel}`;

            return item.type === 'moment' ? (
              <MomentFlag
                key={index}
                percent={percent}
                title={title}
                {...(onSelect ? { onSelect } : {})}
              />
            ) : (
              <MarkerDot
                key={index}
                percent={percent}
                type={item.type}
                title={title}
                {...(onSelect ? { onSelect } : {})}
              />
            );
          })}

          {playback.canSeek && (
            <>
              <span
                className='absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm'
                style={{ left: `${progressPercent}%` }}
                aria-hidden='true'
              />
              {/* Invisible range on top of the track so the bar is scrubbable. */}
              <input
                type='range'
                min={0}
                max={durationMs / 1000}
                step={0.1}
                value={playback.currentTime}
                onChange={event => playback.seek(parseFloat(event.target.value))}
                className='absolute inset-y-0 -inset-x-1 w-full cursor-pointer opacity-0'
                aria-label='Seek recording'
                data-track-category='RecordingDetailV2'
                data-track-name='seek_recording'
              />
            </>
          )}
        </div>

        <span className='w-12 shrink-0 font-mono text-xs font-medium text-muted-foreground'>
          {formatElapsedTime(durationMs)}
        </span>

        <RecordingVisualizer
          isAnimated={false}
          className='h-7 w-14 justify-center rounded-lg border border-border px-2'
          {...(onOpenTranscript ? { onClick: onOpenTranscript } : {})}
        />
      </div>

      {/* Legend only when there's something to explain; speed only once audio can load. */}
      {(markedTypes.size > 0 || onLoadAudio) && (
        <div className='mt-3 flex items-center gap-4 pl-1'>
          {markedTypes.size > 0 && <MarkerLegend types={markedTypes} />}
          {onLoadAudio && (
            <div className='ml-auto'>
              <PlaybackSpeedControl
                rate={playback.playbackRate}
                onChange={playback.setPlaybackRate}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Reads the marker vocabulary of the track above it — only the kinds actually on it. */
const MarkerLegend = ({ types }: { types: ReadonlySet<MarkedItemType> }): ReactElement => (
  <div className='flex items-center gap-5 text-xs text-muted-foreground'>
    {types.has('decision') && (
      <span className='flex items-center gap-1.5'>
        <span className={cn('size-2 rounded-full', MARKER_DOT_COLOR.decision)} aria-hidden='true' />
        Decisions
      </span>
    )}
    {types.has('action') && (
      <span className='flex items-center gap-1.5'>
        <span className={cn('size-2 rounded-full', MARKER_DOT_COLOR.action)} aria-hidden='true' />
        Actions
      </span>
    )}
    {types.has('moment') && (
      <span className='flex items-center gap-1.5'>
        <Flag size={12} variant='Solid' className='text-primary' aria-hidden='true' />
        Marked moments
      </span>
    )}
  </div>
);

interface PlaybackSpeedControlProps {
  rate: number;
  onChange: (rate: number) => void;
}

/** Playback speed control after the audio has loaded. */
const PlaybackSpeedControl = ({ rate, onChange }: PlaybackSpeedControlProps): ReactElement => (
  <div className='flex shrink-0 items-center gap-2 text-xs text-muted-foreground'>
    <span>Speed</span>
    <div className='flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5'>
      {PLAYBACK_SPEEDS.map(speed => (
        <button
          key={speed.value}
          type='button'
          onClick={() => onChange(speed.value)}
          className={cn(
            'rounded-full px-2.5 py-1 font-mono text-xs transition-colors',
            rate === speed.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          data-track-category='RecordingDetailV2'
          data-track-name='set_playback_speed'
        >
          {speed.label}
        </button>
      ))}
    </div>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Audio visualizer                                                           */
/* -------------------------------------------------------------------------- */

export interface RecordingVisualizerProps {
  isAnimated: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
  colorClassName?: string;
  className?: string;
}

const RECORDING_VISUALIZER_REST_HEIGHT = '40%';

const RECORDING_VISUALIZER_SIZE_CLASSES = {
  md: { wrapperHeight: 'h-4', barWidth: 'w-1.5' },
  sm: { wrapperHeight: 'h-3', barWidth: 'w-0.5' },
} as const;

export const RecordingVisualizer = ({
  isAnimated,
  onClick,
  size = 'md',
  colorClassName = 'bg-primary',
  className,
}: RecordingVisualizerProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();
  const isWaving = isAnimated && !shouldReduceMotion;
  const { wrapperHeight, barWidth } = RECORDING_VISUALIZER_SIZE_CLASSES[size];

  const bars = Array.from({ length: 4 }, (_, i) => (
    <div key={i} className={cn('flex items-center', wrapperHeight)}>
      <motion.div
        className={cn('rounded-full', barWidth, colorClassName)}
        initial={{ height: isWaving ? '25%' : RECORDING_VISUALIZER_REST_HEIGHT }}
        animate={
          isWaving ? { height: ['25%', '100%'] } : { height: RECORDING_VISUALIZER_REST_HEIGHT }
        }
        transition={
          isWaving
            ? {
                duration: 0.55,
                delay: i * 0.08,
                repeat: Infinity,
                repeatType: 'mirror',
                ease: 'easeInOut',
              }
            : { duration: 0.3, ease: 'easeOut' }
        }
      />
    </div>
  ));

  const wrapperClassName = cn('inline-flex items-center gap-0.5', className);

  if (!onClick) {
    return <div className={wrapperClassName}>{bars}</div>;
  }

  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(wrapperClassName, 'transition-colors hover:border-primary/50')}
      aria-label='Open transcript'
      title='Open transcript'
      data-track-category='RecordingDetailV2'
      data-track-name='waveform_open_transcript'
    >
      {bars}
    </button>
  );
};
