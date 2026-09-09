/**
 * A read-only track of a finished call: decision and action dots from the summary
 * pipeline, a flag per moment the user marked, joins and leaves below. Clicking a
 * marker opens the transcript there.
 *
 * Plays too, when given a loader: the recordings run in order against the call's own
 * clock, so an unrecorded stretch is crossed in silence rather than skipped. Unlike
 * the Scribe bar (LiveRecordingControlBar) it cannot be scrubbed. They share only the
 * marker glyphs, via ./TimelineMarkers.
 */

import { useMemo, type ReactElement } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { formatElapsedTime } from '../../utils/recordingUtils';
import { cn } from '../../utils/classNames';
import { parseMarkedItems, type MarkedItem } from './markedItems';
import {
  JoinLeaveGlyph,
  JoinLeaveRow,
  MARKER_NOUN,
  MarkerDot,
  MarkerLegend,
  MomentFlag,
} from './TimelineMarkers';
import { clusterParticipantEvents, type ParticipantEvent } from './participantEvents';
import type { RecordedSpan } from './recordingSpans';
import { useTimelinePlayback, type RecordingLoader } from './useTimelinePlayback';
import Tooltip from '../ui/Tooltip/Tooltip';

/** Stable identity, so a caller passing none doesn't hand this a new array each render. */
const NO_PARTICIPANT_EVENTS: readonly ParticipantEvent[] = [];
const NO_RECORDED_SPANS: readonly RecordedSpan[] = [];

/** Narrow enough to still read as a band rather than a mark. */
const MIN_SPAN_WIDTH = '3px';

export interface CallTimelineBarProps {
  /** Raw `Call.markedItems` — untyped JSON, validated by parseMarkedItems. */
  markedItems: unknown[] | undefined;
  /** Track length: the call's start to its end. */
  spanMs: number;
  /** Joins and leaves, already measured onto the same axis as the markers. */
  participantEvents?: readonly ParticipantEvent[];
  /** Stretches that were recorded, shaded into the track. Same axis again. */
  recordedSpans?: readonly RecordedSpan[];
  /** Opens the transcript at the marker. Without it the markers are read-only. */
  onMarkerSelect?: (item: MarkedItem) => void;
  /** Fetches one recording's audio. Without it the bar has no play button. */
  onLoadRecording?: RecordingLoader;
  className?: string;
}

export function CallTimelineBar({
  markedItems,
  spanMs,
  participantEvents = NO_PARTICIPANT_EVENTS,
  recordedSpans = NO_RECORDED_SPANS,
  onMarkerSelect,
  onLoadRecording,
  className,
}: CallTimelineBarProps): ReactElement | null {
  const items = useMemo(() => parseMarkedItems(markedItems), [markedItems]);
  const hasContent = items.length > 0 || participantEvents.length > 0 || recordedSpans.length > 0;

  // One clock for everything on the track: the call's start. The widening keeps a
  // marker landing past `spanMs` on the track instead of pinned at its end.
  const lastMarkerSeconds = items.length > 0 ? items[items.length - 1]!.timestampSeconds : 0;
  const lastEventSeconds =
    participantEvents.length > 0
      ? participantEvents[participantEvents.length - 1]!.timestampSeconds
      : 0;
  const lastRecordedSeconds = recordedSpans.reduce(
    (latest, span) => Math.max(latest, span.endSeconds),
    0,
  );
  const spanSeconds = Math.max(
    spanMs / 1000,
    lastMarkerSeconds,
    lastEventSeconds,
    lastRecordedSeconds,
  );

  // Hooks run before the gate below, so playback is armed with whatever span the
  // markers settled on.
  const playback = useTimelinePlayback(recordedSpans, spanSeconds, onLoadRecording);

  // Calls predating the extraction pipeline have nothing to show; skip the bar
  // rather than draw an empty track.
  if (!hasContent || spanSeconds <= 0) return null;

  const markedTypes = new Set(items.map(item => item.type));
  const playheadPercent = Math.min((playback.positionSeconds / spanSeconds) * 100, 100);
  const clusters = clusterParticipantEvents(participantEvents, spanSeconds);

  return (
    <div className={cn('rounded-2xl border border-border bg-card px-5 py-4', className)}>
      <div className='flex min-h-11 items-center gap-4'>
        {playback.canPlay && (
          <button
            type='button'
            onClick={playback.toggle}
            disabled={playback.state === 'loading'}
            data-track-category='CallTimeline'
            data-track-name={playback.state === 'playing' ? 'pause_timeline' : 'play_timeline'}
            title={playback.state === 'playing' ? 'Pause' : 'Play recordings'}
            aria-label={playback.state === 'playing' ? 'Pause' : 'Play recordings'}
            className='shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
          >
            {playback.state === 'loading' ? (
              <Loader2 className='size-4 animate-spin' />
            ) : playback.state === 'playing' ? (
              <Pause className='size-4' />
            ) : (
              <Play className='size-4 translate-x-[0.5px]' />
            )}
          </button>
        )}

        <span className='w-12 shrink-0 text-right font-mono text-xs text-muted-foreground'>
          {formatElapsedTime(playback.positionSeconds * 1000)}
        </span>

        <div className='relative h-1.5 flex-1 rounded-full bg-muted'>
          {playback.canPlay && (
            // Taller than the track so it can be grabbed, and layered between the
            // bands and the markers — a marker click still opens the transcript.
            <input
              type='range'
              min={0}
              max={spanSeconds}
              step={0.1}
              value={playback.positionSeconds}
              onChange={event => playback.seek(parseFloat(event.target.value))}
              data-track-category='CallTimeline'
              data-track-name='seek_timeline'
              aria-label='Seek within the call'
              className='absolute -inset-y-2.5 left-0 z-[5] w-full cursor-pointer opacity-0'
            />
          )}

          {playback.spans.map((span, index) => {
            const left = (span.startSeconds / spanSeconds) * 100;
            const width = ((span.endSeconds - span.startSeconds) / spanSeconds) * 100;
            const label = `${span.name?.trim() || 'Recording'} · ${formatElapsedTime(
              span.startSeconds * 1000,
            )}–${formatElapsedTime(span.endSeconds * 1000)}`;

            return (
              <span
                key={index}
                className='absolute inset-y-0 rounded-full bg-muted-foreground/50'
                style={{ left: `${left}%`, width: `${width}%`, minWidth: MIN_SPAN_WIDTH }}
                title={label}
              />
            );
          })}

          {items.map((item, index) => {
            const percent = Math.min((item.timestampSeconds / spanSeconds) * 100, 100);
            const timeLabel = formatElapsedTime(item.timestampSeconds * 1000);
            const title = item.text
              ? `${MARKER_NOUN[item.type]} · ${timeLabel} — ${item.text}`
              : `${MARKER_NOUN[item.type]} at ${timeLabel}`;
            const onSelect = onMarkerSelect ? (): void => onMarkerSelect(item) : undefined;

            return item.type === 'moment' ? (
              <MomentFlag
                key={index}
                percent={percent}
                title={title}
                trackCategory='CallTimeline'
                {...(onSelect ? { onSelect } : {})}
              />
            ) : (
              <MarkerDot
                key={index}
                percent={percent}
                type={item.type}
                title={title}
                trackCategory='CallTimeline'
                {...(onSelect ? { onSelect } : {})}
              />
            );
          })}

          {clusters.length > 0 && (
            <div className='absolute inset-x-0 top-full z-10'>
              {clusters.map((cluster, index) => {
                const percent = Math.min((cluster.timestampSeconds / spanSeconds) * 100, 100);
                const isCluster = cluster.events.length > 1;
                const first = cluster.events[0]!;
                const content = isCluster ? (
                  <div className='space-y-1'>
                    {cluster.events.map((event, eventIndex) => (
                      <JoinLeaveRow
                        key={eventIndex}
                        event={event}
                        timeLabel={formatElapsedTime(event.timestampSeconds * 1000)}
                      />
                    ))}
                  </div>
                ) : (
                  `${first.name} ${first.type === 'join' ? 'joined' : 'left'} · ${formatElapsedTime(
                    first.timestampSeconds * 1000,
                  )}`
                );

                return (
                  <Tooltip key={index} content={content} side='bottom' sideOffset={4}>
                    <span
                      className='absolute top-0 flex -translate-x-1/2 cursor-default flex-col items-center'
                      style={{ left: `${percent}%` }}
                    >
                      {/* A cluster needs a line back to the point it stands for. */}
                      {isCluster && <span className='absolute bottom-full h-3 w-px bg-border' />}
                      {isCluster ? (
                        <span className='mt-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-background px-1 font-mono text-[10px] leading-none text-muted-foreground'>
                          {cluster.events.length}
                        </span>
                      ) : (
                        <span className='mt-1.5 flex'>
                          <JoinLeaveGlyph type={first.type} />
                        </span>
                      )}
                    </span>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {playback.state !== 'idle' && (
            <span
              className='pointer-events-none absolute top-1/2 z-20 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background'
              style={{ left: `${playheadPercent}%` }}
              aria-hidden='true'
            />
          )}

          {/* Says why nothing is playing, rather than leaving it looking stalled. */}
          {playback.state !== 'idle' && playback.isInGap && (
            <span
              className='pointer-events-none absolute bottom-full z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground shadow-sm'
              style={{ left: `${playheadPercent}%` }}
              role='status'
            >
              Not recorded
            </span>
          )}
        </div>

        <span className='w-12 shrink-0 font-mono text-xs font-medium text-muted-foreground'>
          {formatElapsedTime(spanSeconds * 1000)}
        </span>
      </div>

      <MarkerLegend
        types={markedTypes}
        hasParticipantEvents={clusters.length > 0}
        hasRecordedSpans={recordedSpans.length > 0}
        className={clusters.length > 0 ? 'mt-7' : 'mt-3'}
      />
    </div>
  );
}
