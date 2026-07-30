import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createMarkdownComponents } from '../../utils/markdownComponents';
import {
  dailyBriefApi,
  type DailyBriefHistoryItem,
  type DailyBriefLatest,
} from '../../api/dailyBriefApi';

const REMARK_PLUGINS = [remarkGfm];

// Reuse the app's shared renderers (code blocks, tables, links) and layer on a
// few base element styles so headings/lists stay legible without the Tailwind
// typography plugin (which this app doesn't include).
const BRIEF_MARKDOWN_COMPONENTS: Components = {
  ...createMarkdownComponents('daily-brief'),
  h1: ({ children }) => <h1 className='text-xl font-semibold mt-6 mb-3'>{children}</h1>,
  h2: ({ children }) => <h2 className='text-lg font-semibold mt-5 mb-2'>{children}</h2>,
  h3: ({ children }) => <h3 className='text-base font-semibold mt-4 mb-2'>{children}</h3>,
  p: ({ children }) => <p className='my-2 leading-relaxed'>{children}</p>,
  ul: ({ children }) => <ul className='list-disc pl-6 my-2 space-y-1'>{children}</ul>,
  ol: ({ children }) => <ol className='list-decimal pl-6 my-2 space-y-1'>{children}</ol>,
  li: ({ children }) => <li className='leading-relaxed'>{children}</li>,
};

/**
 * Daily Brief dashboard page — intentionally minimal.
 *
 * Surfaces the three things the feature exposes so UI developers have a
 * working scaffold to build on:
 *   1. Current brief content (today's, or the most recent).
 *   2. History of past briefs (click to view).
 *   3. Regenerate — re-runs the brief now and streams progress.
 *
 * There is deliberately no polished styling / empty-state art here.
 */

function formatDate(date?: string | null): string {
  if (!date) return '—';
  return date;
}

const DailyBriefScreen = (): ReactElement => {
  const [latest, setLatest] = useState<DailyBriefLatest | null>(null);
  const [history, setHistory] = useState<DailyBriefHistoryItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [regenerating, setRegenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [latestRes, historyRes] = await Promise.all([
        dailyBriefApi.getLatest(),
        dailyBriefApi.getHistory(),
      ]);
      setLatest(latestRes);
      setHistory(historyRes);
      // Default the selection to whatever the "current" brief points at.
      setSelectedDate(prev => prev ?? latestRes.date ?? historyRes[0]?.date ?? null);
    } catch {
      setError('Failed to load daily brief.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // The brief shown in the main panel: the selected history row, else `latest`.
  const selected = useMemo(() => {
    if (selectedDate) {
      const fromHistory = history.find(h => h.date === selectedDate);
      if (fromHistory)
        return { date: fromHistory.date, status: fromHistory.status, content: fromHistory.content };
    }
    if (latest && latest.status !== 'none') {
      return { date: latest.date, status: latest.status, content: latest.content ?? '' };
    }
    return null;
  }, [selectedDate, history, latest]);

  const handleRegenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    setProgress('Starting…');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await dailyBriefApi.regenerate(
        {
          onStart: () => setProgress('Generating…'),
          onProgress: label => setProgress(label || 'Generating…'),
          onComplete: () => setProgress('Done'),
          onError: message => setError(message),
        },
        controller.signal,
      );
      // Refresh from the server so the new brief lands in both panels.
      await load();
      setSelectedDate(null);
    } catch {
      setError('Regeneration failed.');
    } finally {
      setRegenerating(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [regenerating, load]);

  return (
    <div
      data-testid='daily-brief-page'
      className='h-full bg-background text-foreground overflow-hidden flex flex-col'
    >
      {/* Header */}
      <div className='flex items-center justify-between px-6 py-4 border-b border-border'>
        <div>
          <h1 className='text-lg font-semibold'>Daily Brief</h1>
          <p className='text-sm text-muted-foreground'>
            {latest?.status === 'none'
              ? 'No brief has been generated yet.'
              : latest?.isToday
                ? "Today's brief"
                : `Latest brief${latest?.date ? ` · ${latest.date}` : ''}`}
          </p>
        </div>
        <div className='flex items-center gap-3'>
          {progress && <span className='text-sm text-muted-foreground'>{progress}</span>}
          <button
            type='button'
            onClick={() => void handleRegenerate()}
            disabled={regenerating}
            data-track-category='DailyBrief'
            data-track-name='daily-brief-regenerate'
            className='px-3 py-1.5 text-sm rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>

      {error && (
        <div className='px-6 py-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border-b border-border'>
          {error}
        </div>
      )}

      <div className='flex-1 flex min-h-0'>
        {/* History list */}
        <aside className='w-64 shrink-0 border-r border-border overflow-y-auto'>
          <div className='px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            History
          </div>
          {loading && history.length === 0 ? (
            <div className='px-4 py-2 text-sm text-muted-foreground'>Loading…</div>
          ) : history.length === 0 ? (
            <div className='px-4 py-2 text-sm text-muted-foreground'>No past briefs.</div>
          ) : (
            <ul>
              {history.map(item => {
                const isActive = (selectedDate ?? latest?.date) === item.date;
                return (
                  <li key={item.date}>
                    <button
                      type='button'
                      onClick={() => setSelectedDate(item.date)}
                      data-track-category='DailyBrief'
                      data-track-name='daily-brief-history-item'
                      className={`w-full text-left px-4 py-2.5 text-sm border-l-2 ${
                        isActive
                          ? 'border-primary bg-muted'
                          : 'border-transparent hover:bg-muted/60'
                      }`}
                    >
                      <div className='font-medium'>{formatDate(item.date)}</div>
                      <div className='text-xs text-muted-foreground capitalize'>{item.status}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Current / selected brief content */}
        <main className='flex-1 overflow-y-auto px-8 py-6'>
          {loading && !selected ? (
            <div className='text-sm text-muted-foreground'>Loading…</div>
          ) : !selected ? (
            <div className='text-sm text-muted-foreground'>
              No brief to show yet. Use “Regenerate” to create one.
            </div>
          ) : (
            <article className='max-w-3xl'>
              <div className='mb-4 text-xs text-muted-foreground'>
                {formatDate(selected.date)} · <span className='capitalize'>{selected.status}</span>
              </div>
              {selected.content ? (
                <div className='text-sm'>
                  <Markdown remarkPlugins={REMARK_PLUGINS} components={BRIEF_MARKDOWN_COMPONENTS}>
                    {selected.content}
                  </Markdown>
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>This brief has no content.</div>
              )}
            </article>
          )}
        </main>
      </div>
    </div>
  );
};

export default DailyBriefScreen;
