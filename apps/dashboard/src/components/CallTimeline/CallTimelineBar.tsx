/**
 * Call Timeline Bar
 *
 * A read-only track of everything worth jumping to in a finished call: decision
 * and action dots extracted by the summary pipeline, and a flag for each moment
 * the user flagged mid-call. Clicking any of them opens the transcript at that
 * point.
 *
 * Deliberately NOT a player — the Scribe detail screen's bar
 * (LiveRecordingControlBar) doubles as an audio scrubber, this one never does.
 * It shares that bar's marker glyphs through ./TimelineMarkers so the two read
 * identically, and nothing else.
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { formatElapsedTime } from '../../utils/recordingUtils';
import { cn } from '../../utils/classNames';
import {
  fetchTranscriptCached,
  parseTranscript,
  parseTranscriptTimestamp,
} from '../Chat/TranscriptCitationModal/transcriptCache';
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

/**
 * Marker offsets are measured from the FIRST TRANSCRIPT LINE, not the call's
 * wall-clock start. Spanning `endedAt - startedAt` would squash them left by
 * however long the call ran before anyone spoke, so the track uses the
 * transcript's own last timestamp — the space the markers already share.
 *
 * Fetched through the shared per-callId cache, so it costs nothing once a
 * citation or marker has opened the panel for this call.
 */
function useTranscriptSpanSeconds(callId: string, enabled: boolean): number | null {
  const [spanSeconds, setSpanSeconds] = useState<number | null>(null);

  useEffect(() => {
    // Every call detail open would otherwise pull a transcript to position markers
    // that aren't there. Only a call with markers pays for the fetch.
    if (!enabled) return;

    let cancelled = false;
    setSpanSeconds(null);

    fetchTranscriptCached(callId)
      .then(text => {
        if (cancelled) return;

        let last = 0;
        for (const line of parseTranscript(text)) {
          if (!line.timestamp) continue;
          const seconds = parseTranscriptTimestamp(line.timestamp);
          if (seconds !== null && seconds > last) last = seconds;
        }
        setSpanSeconds(last > 0 ? last : null);
      })
      // The wall-clock fallback stands in; a bar is not worth a toast.
      .catch(() => undefined);

    return (): void => {
      cancelled = true;
    };
  }, [callId, enabled]);

  return spanSeconds;
}

export interface CallTimelineBarProps {
  callId: string;
  /** Raw `Call.markedItems` — untyped JSON, validated by parseMarkedItems. */
  markedItems: unknown[] | undefined;
  /** Wall-clock span, used until (or instead of) the transcript's own. */
  fallbackDurationMs: number | null;
  /** Joins and leaves, already measured onto the same axis as the markers. */
  participantEvents?: readonly ParticipantEvent[];
  /** Opens the transcript at the marker. Without it the markers are read-only. */
  onMarkerSelect?: (item: MarkedItem) => void;
  className?: string;
}

export function CallTimelineBar({
  callId,
  markedItems,
  fallbackDurationMs,
  participantEvents = NO_PARTICIPANT_EVENTS,
  onMarkerSelect,
  className,
}: CallTimelineBarProps): ReactElement | null {
  const items = useMemo(() => parseMarkedItems(markedItems), [markedItems]);
  const hasContent = items.length > 0 || participantEvents.length > 0;
  const transcriptSpanSeconds = useTranscriptSpanSeconds(callId, hasContent);

  // Until the transcript resolves, the wall-clock span keeps the bar from
  // jumping in from nothing. Either way the last marker must stay on the track,
  // so a span shorter than the final marker is widened to reach it.
  const lastMarkerSeconds = items.length > 0 ? items[items.length - 1]!.timestampSeconds : 0;
  const lastEventSeconds =
    participantEvents.length > 0
      ? participantEvents[participantEvents.length - 1]!.timestampSeconds
      : 0;

  // Two coordinate spaces meet here, and only one of them may set the span.
  //
  // Markers are offsets from the first transcript line; joins and leaves are
  // offsets from the call's start (participantEvents.ts explains why the real
  // origin is unavailable). Once the transcript has resolved, the track belongs
  // to the markers — letting a late departure stretch it would divide every
  // marker by a span measured from a different zero and slide them all left. Late
  // events clamp to the right edge instead, so the approximation stays confined
  // to the glyphs that made it.
  //
  // Before the transcript resolves there is no marker-space span to protect and
  // everything on the track is already wall-clock, so events may extend it.
  const spanSeconds =
    transcriptSpanSeconds !== null
      ? Math.max(transcriptSpanSeconds, lastMarkerSeconds)
      : Math.max(
          fallbackDurationMs !== null ? fallbackDurationMs / 1000 : 0,
          lastMarkerSeconds,
          lastEventSeconds,
        );

  // An empty track next to an empty legend is noise on every call that predates
  // the extraction pipeline, so the bar only exists once it has something to say.
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
                      {/* Several events on one glyph need a line back to the point
                          they all share; a lone triangle speaks for itself. */}
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
