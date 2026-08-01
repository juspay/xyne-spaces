import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Copy, Download, FileText, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip } from '../../ui/Tooltip';
import { CITATION_HIGHLIGHT, findTargetIndex, parseTranscript } from './transcriptCache';

export interface TranscriptPanelTarget {
  timestamp?: string;
  speaker?: string;
  segment?: string | number;
  timestampSeconds?: number;
}

export interface TranscriptSidePanelProps {
  transcript: string;
  target?: TranscriptPanelTarget | null;
  openNonce?: number;
  isLoading?: boolean;
  error?: string | null;
  onClose: () => void;
  className?: string;
}

export function TranscriptSidePanel({
  transcript,
  target,
  openNonce = 0,
  isLoading = false,
  error = null,
  onClose,
  className = '',
}: TranscriptSidePanelProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const lineRefs = useRef(new Map<number, HTMLDivElement>());
  const lines = useMemo(() => parseTranscript(transcript), [transcript]);
  const targetIndex = useMemo(
    () => findTargetIndex(lines, target?.segment, target?.timestamp, target?.timestampSeconds),
    [lines, target?.segment, target?.timestamp, target?.timestampSeconds],
  );

  useEffect(() => {
    if (targetIndex < 0) return;
    setSearchQuery('');
  }, [targetIndex, openNonce]);

  useEffect(() => {
    if (targetIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      lineRefs.current.get(targetIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [targetIndex, openNonce]);

  const visibleLines = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !needle || line.raw.toLowerCase().includes(needle));
  }, [lines, searchQuery]);

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(transcript);
      toast.success('Transcript copied');
    } catch {
      toast.error('Could not copy the transcript');
    }
  }, [transcript]);

  const handleDownload = useCallback((): void => {
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'transcript.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  }, [transcript]);

  return (
    <aside
      aria-label='Transcript'
      className={[
        'flex h-full w-full flex-col overflow-hidden border-l border-border/70 bg-background shadow-2xl',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className='flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-3.5'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <FileText className='size-4 shrink-0 text-muted-foreground' aria-hidden='true' />
          <h2 className='truncate text-base font-semibold text-foreground'>Transcript</h2>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <Tooltip content='Copy transcript' side='bottom'>
            <button
              type='button'
              onClick={() => void handleCopy()}
              className='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              aria-label='Copy transcript'
              data-track-category='TranscriptPanel'
              data-track-name='copy_transcript'
            >
              <Copy className='size-4' aria-hidden='true' />
            </button>
          </Tooltip>
          <Tooltip content='Download transcript' side='bottom'>
            <button
              type='button'
              onClick={handleDownload}
              className='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              aria-label='Download transcript'
              data-track-category='TranscriptPanel'
              data-track-name='download_transcript'
            >
              <Download className='size-4' aria-hidden='true' />
            </button>
          </Tooltip>
          <Tooltip content='Close transcript' side='bottom'>
            <button
              type='button'
              onClick={onClose}
              className='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              aria-label='Close transcript'
              data-track-category='TranscriptPanel'
              data-track-name='close_transcript'
            >
              <X className='size-4' aria-hidden='true' />
            </button>
          </Tooltip>
        </div>
      </header>

      <div className='shrink-0 border-b border-border/60 px-5 py-3'>
        <div className='relative'>
          <Search
            className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
            aria-hidden='true'
          />
          <input
            type='search'
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder='Search transcript'
            aria-label='Search transcript'
            className='h-10 w-full rounded-lg border border-border bg-muted/45 py-2 pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20'
            data-track-category='TranscriptPanel'
            data-track-name='search_transcript'
          />
          {searchQuery ? (
            <button
              type='button'
              onClick={() => setSearchQuery('')}
              className='absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground'
              aria-label='Clear transcript search'
              data-track-category='TranscriptPanel'
              data-track-name='clear_transcript_search'
            >
              <X className='size-3.5' aria-hidden='true' />
            </button>
          ) : null}
        </div>
      </div>

      <div className='thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4'>
        {isLoading ? (
          <div
            className='flex items-center gap-2 py-6 text-sm text-muted-foreground'
            aria-live='polite'
          >
            <Loader2 className='size-4 animate-spin' aria-hidden='true' />
            Loading transcript
          </div>
        ) : null}
        {!isLoading && error ? <p className='py-6 text-sm text-destructive'>{error}</p> : null}
        {!isLoading && !error && lines.length === 0 ? (
          <p className='py-6 text-sm text-muted-foreground'>
            No transcript is available for this call.
          </p>
        ) : null}
        {!isLoading && !error && lines.length > 0 && visibleLines.length === 0 ? (
          <p className='py-6 text-sm text-muted-foreground'>No matching transcript text.</p>
        ) : null}
        {!isLoading && !error && visibleLines.length > 0 ? (
          <div className='space-y-1'>
            {visibleLines.map(({ line, index }) => {
              const isTarget = index === targetIndex;
              return (
                <div
                  key={index}
                  ref={element => {
                    if (element) lineRefs.current.set(index, element);
                    else lineRefs.current.delete(index);
                  }}
                  className={[
                    'grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2.5 text-[13px] leading-5 transition-colors',
                    isTarget ? CITATION_HIGHLIGHT : 'hover:bg-muted/55',
                  ].join(' ')}
                >
                  <span className='pt-px font-mono text-[11px] tabular-nums text-muted-foreground'>
                    {line.timestamp ?? ' '}
                  </span>
                  <p className='min-w-0 text-foreground'>
                    {line.speaker ? (
                      <span className='mr-1 font-semibold text-foreground'>{line.speaker}</span>
                    ) : null}
                    <span className='text-muted-foreground'>{line.text ?? line.raw}</span>
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
