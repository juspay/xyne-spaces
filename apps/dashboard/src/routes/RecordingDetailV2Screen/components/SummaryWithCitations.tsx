import { type ReactElement, type ReactNode, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clock } from 'lucide-react';
import Avatar from '../../../components/ui/Avatar/Avatar';
import Popover from '../../../components/ui/Popover';
import type { CitationSegment } from '../../../services/Recording/recordingService';

const CITATION_TOKEN_RE = /\[clf-(\d+)\]/g;

interface ParsedSeg {
  n: number;
  timestamp: string;
  speaker: string;
  speakerId?: string | undefined;
  snippet: string;
}

interface TokenMatch {
  index: number;
  end: number;
  n: number;
}

function findTokens(text: string): TokenMatch[] {
  const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
  const matches: TokenMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ index: m.index, end: m.index + m[0].length, n: Number(m[1]) });
  }
  return matches;
}

function groupConsecutive(text: string, matches: TokenMatch[]): TokenMatch[][] {
  const groups: TokenMatch[][] = [];
  let i = 0;
  while (i < matches.length) {
    let j = i;
    while (
      j + 1 < matches.length &&
      /^\s*$/.test(text.slice(matches[j]!.end, matches[j + 1]!.index))
    ) {
      j += 1;
    }
    groups.push(matches.slice(i, j + 1));
    i = j + 1;
  }
  return groups;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '\u2022';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function SpeakerAvatar({
  speakerId,
  speaker,
  px,
}: {
  speakerId?: string | undefined;
  speaker: string;
  px: number;
}) {
  if (speakerId) {
    return (
      <Avatar userId={speakerId} size='xs' rounded showActiveStatus={false} className='shrink-0' />
    );
  }
  return (
    <span
      className='inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary'
      style={{ height: px, width: px, fontSize: Math.round(px * 0.42) }}
    >
      {initials(speaker || 'Transcript')}
    </span>
  );
}

export interface CitationClickRef {
  segment: number;
  timestamp: string;
  speaker: string;
}

const PILL_CLASS =
  'inline-flex items-center align-middle whitespace-nowrap mx-[2px] rounded-[5px] border border-orange-200 ' +
  'bg-orange-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-orange-700 ' +
  'transition-colors hover:border-orange-300 hover:bg-orange-100 hover:text-orange-800 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 dark:border-orange-400/40 ' +
  'dark:bg-orange-400/10 dark:text-orange-200 dark:hover:bg-orange-400/20 cursor-pointer select-none';

function CitationChip({
  segs,
  onCitationClick,
}: {
  segs: ParsedSeg[];
  onCitationClick: (ref: CitationClickRef) => void;
}): ReactElement {
  const first = segs[0]!;
  const isGroup = segs.length > 1;

  const handleClick = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    onCitationClick({ segment: first.n, timestamp: first.timestamp, speaker: first.speaker });
  };

  if (!isGroup) {
    return (
      <button
        type='button'
        contentEditable={false}
        onClick={handleClick}
        className={PILL_CLASS}
        data-track-category='RecordingCitation'
        data-track-name='open_transcript_citation'
      >
        {first.timestamp || 'Transcript'}
      </button>
    );
  }

  return (
    <Popover
      trigger={
        <button type='button' contentEditable={false} className={PILL_CLASS}>
          {segs.length} refs
        </button>
      }
      side='top'
      align='start'
      sideOffset={4}
      className='p-1 max-w-[300px]'
    >
      <div className='flex flex-col gap-0.5 max-h-[260px] overflow-y-auto'>
        {segs.map((s, i) => (
          <button
            key={i}
            type='button'
            className='flex w-full items-center gap-1.5 px-2 py-1.5 rounded text-[12px] text-left text-foreground hover:bg-accent transition-colors'
            data-track-category='RecordingCitation'
            data-track-name='open_grouped_transcript_citation'
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onCitationClick({ segment: s.n, timestamp: s.timestamp, speaker: s.speaker });
            }}
          >
            <SpeakerAvatar speakerId={s.speakerId} speaker={s.speaker} px={20} />
            <span className='min-w-0 truncate flex-1'>
              <Clock size={10} className='inline mr-1 text-muted-foreground' />
              {s.timestamp}
              <span className='mx-1 text-muted-foreground/60'>{'\u00B7'}</span>
              {s.speaker}
            </span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

function processTextWithCitations(
  text: string,
  segmentMap: Map<number, ParsedSeg>,
  onCitationClick: (ref: CitationClickRef) => void,
  keyPrefix: string,
): ReactNode[] {
  if (!text || text.indexOf('[clf-') === -1) return [text];

  const matches = findTokens(text);
  if (matches.length === 0) return [text];

  const groups = groupConsecutive(text, matches);
  const out: ReactNode[] = [];
  let last = 0;
  let keyIdx = 0;

  for (const group of groups) {
    const groupStart = group[0]!.index;
    const groupEnd = group[group.length - 1]!.end;
    let pre = text.slice(last, groupStart);

    const segs: ParsedSeg[] = [];
    for (const tok of group) {
      const seg = segmentMap.get(tok.n);
      if (seg) segs.push(seg);
    }

    if (segs.length > 0) {
      if (pre.endsWith(' ')) pre = pre.slice(0, -1);
      if (pre) out.push(pre);
      out.push(
        <CitationChip
          key={`${keyPrefix}-clf-${keyIdx}`}
          segs={segs}
          onCitationClick={onCitationClick}
        />,
      );
      last = groupEnd;
    } else {
      if (pre.endsWith(' ')) {
        if (pre) out.push(pre);
        last = groupEnd;
      } else if (text[groupEnd] === ' ') {
        if (pre) out.push(pre);
        last = groupEnd + 1;
      } else {
        if (pre) out.push(pre);
        last = groupEnd;
      }
    }
    keyIdx++;
  }

  const tail = text.slice(last);
  if (tail) out.push(tail);

  return out;
}

function processChildrenWithCitations(
  children: ReactNode,
  segmentMap: Map<number, ParsedSeg>,
  onCitationClick: (ref: CitationClickRef) => void,
  keyPrefix = '',
): ReactNode {
  if (typeof children === 'string') {
    return processTextWithCitations(children, segmentMap, onCitationClick, keyPrefix);
  }
  if (Array.isArray(children)) {
    const childNodes = children as ReactNode[];
    return childNodes.map((child, i) =>
      processChildrenWithCitations(child, segmentMap, onCitationClick, `${keyPrefix}-${i}`),
    );
  }
  return children;
}

export interface SummaryWithCitationsProps {
  aiSummary: string;
  citationSegments: CitationSegment[];
  onCitationClick?: (ref: CitationClickRef) => void;
}

export function SummaryWithCitations({
  aiSummary,
  citationSegments,
  onCitationClick,
}: SummaryWithCitationsProps): ReactElement {
  const segmentMap = useMemo(() => {
    const map = new Map<number, ParsedSeg>();
    for (const seg of citationSegments) {
      map.set(seg.n, {
        n: seg.n,
        timestamp: seg.timestamp,
        speaker: seg.speaker,
        ...(seg.speakerId ? { speakerId: seg.speakerId } : {}),
        snippet: seg.snippet,
      });
    }
    return map;
  }, [citationSegments]);

  const handleCitationClick = useCallback(
    (ref: CitationClickRef) => onCitationClick?.(ref),
    [onCitationClick],
  );

  return (
    <div className='recording-summary-content bot-markdown-content-call-summary'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className='relative'>
              {processChildrenWithCitations(children, segmentMap, handleCitationClick, 'p')}
            </p>
          ),
          li: ({ children }) => (
            <li className='relative'>
              {processChildrenWithCitations(children, segmentMap, handleCitationClick, 'li')}
            </li>
          ),
        }}
      >
        {aiSummary}
      </ReactMarkdown>
    </div>
  );
}
