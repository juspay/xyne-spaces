/**
 * A read-only track of a finished call: decision and action dots from the summary
 * pipeline, a flag per moment the user marked, joins and leaves below. Clicking a
 * marker opens the transcript there.
 *
 * Not a player — the Scribe bar (LiveRecordingControlBar) scrubs audio, this never
 * does. They share only the marker glyphs, via ./TimelineMarkers.
 */

import { useMemo, type ReactElement } from 'react';
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
import Tooltip from '../ui/Tooltip/Tooltip';

/** Stable identity, so a caller passing none doesn't hand this a new array each render. */
const NO_PARTICIPANT_EVENTS: readonly ParticipantEvent[] = [];

export interface CallTimelineBarProps {
  /** Raw `Call.markedItems` — untyped JSON, validated by parseMarkedItems. */
  markedItems: unknown[] | undefined;
  /** Track length: the call's start to its end. */
  spanMs: number;
  /** Joins and leaves, already measured onto the same axis as the markers. */
  participantEvents?: readonly ParticipantEvent[];
  /** Opens the transcript at the marker. Without it the markers are read-only. */
  onMarkerSelect?: (item: MarkedItem) => void;
  className?: string;
}

export function CallTimelineBar({
  markedItems,
  spanMs,
  participantEvents = NO_PARTICIPANT_EVENTS,
  onMarkerSelect,
  className,
}: CallTimelineBarProps): ReactElement | null {
  const items = useMemo(() => parseMarkedItems(markedItems), [markedItems]);
  const hasContent = items.length > 0 || participantEvents.length > 0;

  // One clock for everything on the track: the call's start. The widening keeps a
  // marker landing past `spanMs` on the track instead of pinned at its end.
  const lastMarkerSeconds = items.length > 0 ? items[items.length - 1]!.timestampSeconds : 0;
  const lastEventSeconds =
    participantEvents.length > 0
      ? participantEvents[participantEvents.length - 1]!.timestampSeconds
      : 0;
  const spanSeconds = Math.max(spanMs / 1000, lastMarkerSeconds, lastEventSeconds);

  // Calls predating the extraction pipeline have nothing to show; skip the bar
  // rather than draw an empty track.
  if (!hasContent || spanSeconds <= 0) return null;

  const markedTypes = new Set(items.map(item => item.type));
  const clusters = clusterParticipantEvents(participantEvents, spanSeconds);

  return (
    <div className={cn('rounded-2xl border border-border bg-card px-5 py-4', className)}>
      <div className='flex min-h-11 items-center gap-4'>
        <span className='w-12 shrink-0 text-right font-mono text-xs text-muted-foreground'>
          {formatElapsedTime(0)}
        </span>

        <div className='relative h-1.5 flex-1 rounded-full bg-muted'>
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
            <div className='absolute inset-x-0 top-full'>
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
        </div>

        <span className='w-12 shrink-0 font-mono text-xs font-medium text-muted-foreground'>
          {formatElapsedTime(spanSeconds * 1000)}
        </span>
      </div>

      <MarkerLegend
        types={markedTypes}
        hasParticipantEvents={clusters.length > 0}
        className={clusters.length > 0 ? 'mt-7' : 'mt-3'}
      />
    </div>
  );
}
