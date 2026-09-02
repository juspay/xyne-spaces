import { ReactElement, useCallback, useRef, useState } from 'react';
import { Sparkles, Loader2, X } from 'lucide-react';
import { BASE_URL } from '../../../services/clients/apiClient';
import Button from '../../ui/Button';

/**
 * On-demand "Summarise unreads" panel for the Unreads inbox.
 *
 * Streams per-channel summaries from `POST /api/unread-digest/generate` (SSE)
 * and renders them progressively. Generation is read-only — it never marks
 * anything as read, so the inbox is untouched after summarising.
 */

interface KeyPoint {
  point: string;
}

interface ChannelSummary {
  channelId: string;
  channelName: string;
  summary: string;
  keyPoints: KeyPoint[];
  includedCount: number;
  omittedCount: number;
  failed: boolean;
}

interface DigestMeta {
  totalChannels: number;
  omittedChannelCount: number;
}

/** Shape of a single parsed SSE `data:` frame from the digest stream. */
interface DigestEvent {
  type?: string;
  totalChannels?: number;
  omittedChannelCount?: number;
  index?: number;
  total?: number;
  channelId?: string;
  channelName?: string;
  includedCount?: number;
  omittedCount?: number;
  failed?: boolean;
  error?: string;
  output?: { summary?: string; keyPoints?: { point: string }[] } | null;
}

const UnreadDigestPanel = (): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<DigestMeta | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [summaries, setSummaries] = useState<ChannelSummary[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setProgress(null);
  }, []);

  const generate = useCallback(async () => {
    setIsOpen(true);
    setIsLoading(true);
    setError(null);
    setMeta(null);
    setProgress(null);
    setSummaries([]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // eslint-disable-next-line local-rules/no-fetch-use-axios
      const response = await fetch(`${BASE_URL}/unread-digest/generate`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
        credentials: 'include',
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data: DigestEvent;
          try {
            data = JSON.parse(line.slice(6)) as DigestEvent;
          } catch {
            continue;
          }

          switch (data.type) {
            case 'snapshot':
              setMeta({
                totalChannels: Number(data.totalChannels ?? 0),
                omittedChannelCount: Number(data.omittedChannelCount ?? 0),
              });
              break;
            case 'progress':
              setProgress({ index: Number(data.index ?? 0), total: Number(data.total ?? 0) });
              break;
            case 'channel': {
              const output = data.output ?? null;
              setSummaries(prev => [
                ...prev,
                {
                  channelId: String(data.channelId ?? ''),
                  channelName: String(data.channelName ?? 'Channel'),
                  summary: output?.summary ?? '',
                  keyPoints: (output?.keyPoints ?? []).map(k => ({ point: k.point })),
                  includedCount: Number(data.includedCount ?? 0),
                  omittedCount: Number(data.omittedCount ?? 0),
                  failed: Boolean(data.failed),
                },
              ]);
              break;
            }
            case 'complete':
              setIsLoading(false);
              setProgress(null);
              break;
            case 'error':
              setError(String(data.error ?? 'Failed to summarise unreads'));
              setIsLoading(false);
              break;
            default:
              break;
          }
        }
      }
      setIsLoading(false);
      setProgress(null);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to summarise unreads');
      setIsLoading(false);
      setProgress(null);
    }
  }, []);

  return (
    <div className='flex flex-col'>
      <Button
        variant='secondary'
        size='sm'
        onClick={() => void generate()}
        disabled={isLoading}
        className='h-8 gap-1.5'
        data-track-category='UNREADS_INBOX'
        data-track-name='SUMMARISE_UNREADS'
      >
        {isLoading ? (
          <Loader2 className='w-4 h-4 animate-spin' />
        ) : (
          <Sparkles className='w-4 h-4' />
        )}
        <span className='text-sm font-medium'>Summarise unreads</span>
      </Button>

      {isOpen && (
        <div className='mt-3 rounded-lg border border-border/50 bg-card shadow-sm'>
          <div className='flex items-center justify-between px-4 py-2.5 border-b border-border/40'>
            <div className='flex items-center gap-2 text-foreground'>
              <Sparkles className='w-4 h-4 text-primary' />
              <span className='text-sm font-semibold'>Unread digest</span>
              {meta && (
                <span className='text-xs text-muted-foreground'>
                  {meta.totalChannels} channel{meta.totalChannels === 1 ? '' : 's'}
                  {meta.omittedChannelCount > 0
                    ? ` · ${meta.omittedChannelCount} more not shown`
                    : ''}
                </span>
              )}
            </div>
            <div className='flex items-center gap-2'>
              {isLoading && (
                <Button variant='ghost' size='sm' className='h-7 px-2' onClick={stop}>
                  Stop
                </Button>
              )}
              <Button
                variant='ghost'
                size='sm'
                className='h-7 w-7 p-0'
                aria-label='Close digest'
                onClick={() => {
                  stop();
                  setIsOpen(false);
                }}
              >
                <X className='w-4 h-4' />
              </Button>
            </div>
          </div>

          <div className='px-4 py-3 max-h-[calc(100vh-260px)] overflow-y-auto space-y-3'>
            {error && <p className='text-sm text-destructive'>{error}</p>}

            {isLoading && progress && (
              <p className='text-xs text-muted-foreground'>
                Summarising {progress.index} of {progress.total}…
              </p>
            )}

            {!isLoading && !error && summaries.length === 0 && (
              <p className='text-sm text-muted-foreground'>
                You&apos;re all caught up — nothing to summarise.
              </p>
            )}

            {summaries.map(s => (
              <div
                key={s.channelId}
                className='rounded-md border border-border/40 bg-background p-3'
              >
                <div className='flex items-center justify-between mb-1.5'>
                  <span className='text-sm font-semibold text-foreground'>#{s.channelName}</span>
                  <span className='text-[11px] text-muted-foreground'>
                    {s.includedCount} message{s.includedCount === 1 ? '' : 's'}
                    {s.omittedCount > 0 ? ` · +${s.omittedCount} older` : ''}
                  </span>
                </div>
                {s.failed ? (
                  <p className='text-xs text-muted-foreground italic'>
                    Could not summarise this channel.
                  </p>
                ) : (
                  <>
                    {s.summary && (
                      <p className='text-sm text-foreground/90 whitespace-pre-wrap'>{s.summary}</p>
                    )}
                    {s.keyPoints.length > 0 && (
                      <ul className='mt-2 list-disc pl-5 space-y-1'>
                        {s.keyPoints.map((k, i) => (
                          <li key={i} className='text-sm text-foreground/80'>
                            {k.point}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default UnreadDigestPanel;
