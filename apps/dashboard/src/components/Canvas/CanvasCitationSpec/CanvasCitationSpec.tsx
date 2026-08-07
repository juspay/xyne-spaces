import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createReactInlineContentSpec } from '@blocknote/react';
import type { ReactCustomInlineContentRenderProps } from '@blocknote/react';
import { Clock } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import { HoverCard } from '../../ui/HoverCard/HoverCard';
import { transcriptCitationStore } from '../../Chat/TranscriptCitationModal';
import {
  fetchTranscriptCached,
  parseTranscript,
  findTargetIndex,
  CITATION_HIGHLIGHT,
  type TranscriptLine,
} from '../../Chat/TranscriptCitationModal/transcriptCache';

// Inline "citation" chip for call-summary canvases. Emitted server-side by
// callDocumentService from `[clf-n]` tokens. A run of adjacent tokens is grouped
// into ONE node carrying a `segments` JSON array — so this renders either a
// single subtle pill (timestamp + speaker) or a grouped cluster (stacked avatars
// + count). Hovering previews the surrounding transcript; clicking opens the full
// transcript modal at that moment. propSchema MUST match the server spec
// (canvasCitationSpec.ts) + the BlockNoteCitationInline type so the Yjs round-trip
// preserves it.

type CitationConfig = {
  type: 'citation';
  propSchema: {
    callId: { default: '' };
    segment: { default: '' };
    timestamp: { default: '' };
    speaker: { default: '' };
    speakerId: { default: '' };
    snippet: { default: '' };
    segments: { default: '' };
  };
  content: 'none';
};

const citationConfig: CitationConfig = {
  type: 'citation',
  propSchema: {
    callId: { default: '' },
    segment: { default: '' },
    timestamp: { default: '' },
    speaker: { default: '' },
    speakerId: { default: '' },
    snippet: { default: '' },
    segments: { default: '' },
  },
  content: 'none',
};

type NoStyleSchema = Record<string, never>;
type CitationRenderProps = ReactCustomInlineContentRenderProps<CitationConfig, NoStyleSchema>;

const HOVER_MAX_HEIGHT = 220;
const PILL_CLASS =
  'xyne-canvas-citation pointer-events-auto inline-flex items-center align-middle whitespace-nowrap ' +
  'mx-[2px] rounded-[5px] border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[11px] ' +
  'font-semibold leading-none text-orange-700 transition-colors hover:border-orange-300 hover:bg-orange-100 ' +
  'hover:text-orange-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 ' +
  'dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-200 dark:hover:bg-orange-400/20 ' +
  'cursor-pointer select-none';

interface ParsedSeg {
  n: number;
  timestamp: string;
  speaker: string;
  speakerId: string;
  snippet: string;
}

function isSegmentRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toSegmentNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSegmentString(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function parseSegments(props: CitationRenderProps['inlineContent']['props']): ParsedSeg[] {
  if (props.segments) {
    try {
      const parsed: unknown = JSON.parse(props.segments);
      if (Array.isArray(parsed)) {
        const records = (parsed as unknown[]).filter(isSegmentRecord);
        if (records.length > 0) {
          return records.map(record => ({
            n: toSegmentNumber(record['n']),
            timestamp: toSegmentString(record['timestamp']),
            speaker: toSegmentString(record['speaker']),
            speakerId: toSegmentString(record['speakerId']),
            snippet: toSegmentString(record['snippet']),
          }));
        }
      }
    } catch {
      /* fall through to the single-segment top-level props */
    }
  }
  return [
    {
      n: Number(props.segment) || 0,
      timestamp: props.timestamp,
      speaker: props.speaker,
      speakerId: props.speakerId,
      snippet: props.snippet,
    },
  ];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '•';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Real user avatar when we resolved a userId; initials disc otherwise.
function SpeakerAvatar({
  speakerId,
  speaker,
  size,
  px,
}: {
  speakerId: string;
  speaker: string;
  size: 'xs' | 'sm' | 'rg';
  px: number;
}) {
  if (speakerId)
    return (
      <Avatar
        userId={speakerId}
        size={size}
        rounded
        showActiveStatus={false}
        className='shrink-0'
      />
    );
  return (
    <span
      className='inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary'
      style={{ height: px, width: px, fontSize: Math.round(px * 0.42) }}
    >
      {initials(speaker || 'Transcript')}
    </span>
  );
}

// -------------------------------------------------------- single hover preview

function TranscriptHoverPreview({ callId, seg }: { callId: string; seg: ParsedSeg }) {
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetchTranscriptCached(callId)
      .then(t => {
        if (!cancelled) setLines(parseTranscript(t));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [callId]);

  const targetIndex = useMemo(
    () => (lines ? findTargetIndex(lines, seg.n, seg.timestamp) : -1),
    [lines, seg.n, seg.timestamp],
  );

  useEffect(() => {
    if (!lines || targetIndex < 0) return;
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-hover-line="${targetIndex}"]`);
    if (el) container.scrollTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
  }, [lines, targetIndex]);

  return (
    <div className='w-[380px] max-w-[92vw] text-left'>
      <div className='flex items-center gap-2 px-3 py-2 border-b border-border/60'>
        <SpeakerAvatar speakerId={seg.speakerId} speaker={seg.speaker} size='sm' px={22} />
        <div className='min-w-0 flex-1'>
          <div className='text-[12px] font-semibold text-foreground truncate leading-tight'>
            {seg.speaker || 'Transcript'}
          </div>
          <div className='flex items-center gap-1 text-[11px] text-muted-foreground leading-tight'>
            <Clock size={11} className='shrink-0' />
            {seg.timestamp || '—'}
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className='relative overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed'
        style={{ maxHeight: HOVER_MAX_HEIGHT }}
      >
        {error && (
          <div className='text-[12px] font-sans text-destructive'>
            Could not load the transcript.
          </div>
        )}
        {!error && lines === null && (
          <div className='text-[12px] font-sans text-muted-foreground'>Loading transcript…</div>
        )}
        {!error && lines !== null && lines.length === 0 && (
          <div className='text-[12px] font-sans text-muted-foreground'>
            No transcript available.
          </div>
        )}
        {!error &&
          lines !== null &&
          lines.map((line, i) => (
            <div
              key={i}
              data-hover-line={i}
              className={
                i === targetIndex
                  ? `px-1 -mx-1 ${CITATION_HIGHLIGHT}`
                  : 'px-1 -mx-1 text-muted-foreground'
              }
            >
              {line.raw}
            </div>
          ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------- grouped hover list

function GroupHoverList({ callId, segs }: { callId: string; segs: ParsedSeg[] }) {
  return (
    <div className='w-[320px] max-w-[92vw] text-left'>
      <div className='px-3 py-2 border-b border-border/60 text-[11px] font-medium text-muted-foreground'>
        {segs.length} references
      </div>
      <div className='max-h-[260px] overflow-y-auto py-1'>
        {segs.map((s, i) => (
          <button
            key={i}
            type='button'
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              transcriptCitationStore.open({
                callId,
                timestamp: s.timestamp,
                speaker: s.speaker,
                segment: String(s.n),
              });
            }}
            className='flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors'
            data-track-category='TranscriptCitation'
            data-track-name='open_grouped_transcript_reference'
          >
            <SpeakerAvatar speakerId={s.speakerId} speaker={s.speaker} size='sm' px={22} />
            <span className='min-w-0 flex-1'>
              <span className='flex items-center gap-1 text-[11px] font-medium text-foreground'>
                <Clock size={10} className='shrink-0 text-muted-foreground' />
                {s.timestamp}
                <span className='text-muted-foreground/60'>·</span>
                <span className='truncate'>{s.speaker}</span>
              </span>
              {s.snippet ? (
                <span className='mt-0.5 block text-[11px] text-muted-foreground line-clamp-2'>
                  {s.snippet}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- render

const CitationRender = ({ inlineContent }: CitationRenderProps): React.ReactElement => {
  const { callId } = inlineContent.props;
  const segs = parseSegments(inlineContent.props);
  const first = segs[0]!;
  const isGroup = segs.length > 1;

  const openFirst = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (callId)
      transcriptCitationStore.open({
        callId,
        timestamp: first.timestamp,
        speaker: first.speaker,
        segment: String(first.n),
      });
  };

  const pill = (
    <button
      type='button'
      contentEditable={false}
      onClick={openFirst}
      className={PILL_CLASS}
      data-track-category='TranscriptCitation'
      data-track-name='open_transcript_citation'
    >
      {isGroup ? <span>{segs.length} refs</span> : <span>{first.timestamp || 'Transcript'}</span>}
    </button>
  );

  // No call → no transcript to preview/open; render a bare pill.
  if (!callId) return pill;

  return (
    <HoverCard
      trigger={pill}
      side='top'
      align='start'
      sideOffset={6}
      openDelay={120}
      closeDelay={120}
      className='w-auto p-0 overflow-hidden rounded-lg border-border/60 shadow-lg'
    >
      {isGroup ? (
        <GroupHoverList callId={callId} segs={segs} />
      ) : (
        <TranscriptHoverPreview callId={callId} seg={first} />
      )}
    </HoverCard>
  );
};

export const citationInlineContentSpec = createReactInlineContentSpec(citationConfig, {
  render: CitationRender,
});
