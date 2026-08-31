import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { InformationCircle, ListAiGenerated, Settings01 } from '@xyne/icons';
import { createMarkdownComponents } from '../../utils/markdownComponents';
import { cn } from '../../utils/classNames';
import { APP_DRAG_STYLE, APP_NO_DRAG_STYLE } from '../../utils/electronApp';
import { useIsInPanelWebview } from '../../hooks/useIsInPanelWebview';
import { useDailyBriefEnabled } from '../../hooks/useDailyBriefEnabled';
import { BriefHistoryMenu, HEADER_ICON_CLASS } from './BriefHistoryMenu';
import { BriefSettingsDialog } from './BriefSettingsDialog';
import { BriefIntroBanner } from './BriefIntroBanner';
import { BriefFeaturesDialog } from './BriefFeaturesDialog';
import { useBriefIntroSeen } from './useBriefIntroSeen';
import { BriefLine, useBriefRenderContext, type BriefRenderContext } from './briefText';
import { RawBriefView } from './RawBriefView';
import { BriefSkeleton } from './BriefSkeleton';
import {
  dailyBriefApi,
  type DailyBriefHistoryItem,
  type DailyBriefLatest,
  type DailyBriefPayload,
} from '../../api/dailyBriefApi';
import {
  trackDailyBriefRegenerateAbandoned,
  trackDailyBriefSwitched,
  type BriefSwitchSource,
} from '../../services/otel/dailyBriefMetrics';

const REMARK_PLUGINS = [remarkGfm];
const IS_DEV = import.meta.env.DEV;

const FALLBACK_MARKDOWN_COMPONENTS: Components = {
  ...createMarkdownComponents('daily-brief'),
  h1: ({ children }) => <h1 className='mb-3 mt-6 text-xl font-semibold'>{children}</h1>,
  h2: ({ children }) => <h2 className='mb-2 mt-5 text-lg font-semibold'>{children}</h2>,
  h3: ({ children }) => <h3 className='mb-2 mt-4 text-base font-semibold'>{children}</h3>,
  p: ({ children }) => <p className='my-2 leading-relaxed'>{children}</p>,
  ul: ({ children }) => <ul className='my-2 list-disc space-y-1 pl-6'>{children}</ul>,
  ol: ({ children }) => <ol className='my-2 list-decimal space-y-1 pl-6'>{children}</ol>,
  li: ({ children }) => <li className='leading-relaxed'>{children}</li>,
};

type SectionKey = keyof Pick<
  DailyBriefPayload,
  'what_needs_you' | 'overdue' | 'waiting_on_others' | 'assigned_to_you' | 'todays_schedule'
>;

interface SectionSpec {
  field: SectionKey;
  label: string;
  checkable: boolean;
  itemGap: string;
}

const SECTIONS: SectionSpec[] = [
  { field: 'what_needs_you', label: 'What needs you', checkable: false, itemGap: 'gap-3' },
  { field: 'overdue', label: 'Overdue', checkable: true, itemGap: 'gap-3' },
  { field: 'waiting_on_others', label: 'Waiting on others', checkable: true, itemGap: 'gap-4' },
  { field: 'assigned_to_you', label: 'Assigned to you', checkable: true, itemGap: 'gap-3' },
  { field: 'todays_schedule', label: "Today's schedule", checkable: false, itemGap: 'gap-3' },
];

const BODY_TEXT_CLASS = 'text-[15px] font-normal leading-[1.5] tracking-[-0.1px] text-foreground';

interface SelectedBrief {
  date: string | undefined;
  status: string;
  content: string;
  data: DailyBriefPayload | null;
}

function formatBriefTitle(date: string | undefined): string {
  if (!date) return 'Brief';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return `Brief // ${date}`;
  const label = parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Brief // ${label}`;
}

const SECTION_LABEL_CLASS =
  'text-[15px] font-semibold leading-[1.5] tracking-[-0.1px] text-foreground';

function SectionLabel({ label }: { label: string }): ReactElement {
  return (
    <div className='flex w-[145px] shrink-0 items-center p-1.5'>
      <p className={SECTION_LABEL_CLASS}>{label}</p>
    </div>
  );
}

function ScheduleSection({
  label,
  lines,
  renderContext,
  date,
}: {
  label: string;
  lines: string[];
  renderContext: BriefRenderContext;
  date: string | undefined;
}): ReactElement {
  const parsed = date ? new Date(`${date}T00:00:00`) : null;
  const valid = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

  return (
    <section className='flex w-full items-start gap-4'>
      <SectionLabel label={label} />
      <div className='flex min-w-0 flex-1 items-start gap-3 py-1.5 pl-10 pr-1.5'>
        {valid && (
          <div className='flex shrink-0 flex-col items-center gap-px text-center'>
            <p className='text-[13px] leading-[1.2] tracking-[-0.1px] text-muted-foreground'>
              {valid.toLocaleDateString(undefined, { weekday: 'short' })}
            </p>
            <p className='w-[33px] text-[24px] font-semibold leading-normal text-foreground'>
              {valid.getDate()}
            </p>
          </div>
        )}
        <div className='flex min-w-0 flex-1 flex-col gap-3'>
          {lines.map((line, index) => (
            <div
              key={index}
              className='flex w-full items-start gap-1.5 border-l-[3px] border-xyne-orange-500 py-2 pl-4'
            >
              <div className={cn('min-w-0 flex-1', BODY_TEXT_CLASS)}>
                <BriefLine context={renderContext}>{line}</BriefLine>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BriefSection({
  label,
  checkable,
  itemGap,
  lines,
  renderContext,
}: SectionSpec & { lines: string[]; renderContext: BriefRenderContext }): ReactElement {
  return (
    <section className='flex w-full items-start gap-4'>
      <SectionLabel label={label} />
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col',
          itemGap,
          checkable ? 'p-1.5' : 'py-1.5 pl-10 pr-1.5',
        )}
      >
        {lines.map((line, index) => (
          <div key={index} className='flex w-full items-start gap-3'>
            {checkable && (
              <span className='flex size-[22px] shrink-0 items-center justify-center'>
                <span className='size-1.5 rounded-full bg-muted-foreground' aria-hidden />
              </span>
            )}
            <div className={cn('min-w-0 flex-1', BODY_TEXT_CLASS)}>
              <BriefLine context={renderContext}>{line}</BriefLine>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const BRIEF_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TODAY_SEGMENT = 'today';
// Today's brief plus the previous seven. Anything older is fetched on demand
// when the date picker routes to it.
const HISTORY_LIMIT = 7;

const DailyBriefScreen = (): ReactElement => {
  const [latest, setLatest] = useState<DailyBriefLatest | null>(null);
  const [history, setHistory] = useState<DailyBriefHistoryItem[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A brief older than the loaded window, pulled in by URL/date-picker.
  const [fetched, setFetched] = useState<SelectedBrief | null>(null);
  const [fetching, setFetching] = useState(false);

  const [regenerating, setRegenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const mountedRef = useRef(true);
  const navigate = useNavigate();
  const { workspaceId, briefDate } = useParams();
  const briefPath = workspaceId ? `/${workspaceId}/ai/daily-brief` : '/ai/daily-brief';
  const todayPath = `${briefPath}/${TODAY_SEGMENT}`;
  // The URL owns which brief is shown; `null` means the today/latest view.
  const selectedDate = briefDate && BRIEF_DATE_RE.test(briefDate) ? briefDate : null;
  const todayBucket = latest?.isToday ? (latest.date ?? null) : null;
  const viewingToday = selectedDate === null || selectedDate === todayBucket;
  // Read on unmount, where component state is already stale.
  const regenerateStartedAtRef = useRef<number | null>(null);
  const isInPanelWebview = useIsInPanelWebview();
  const { introSeen, markIntroSeen } = useBriefIntroSeen();
  const {
    enabled: briefEnabled,
    saving: briefEnabling,
    setEnabled: setBriefEnabled,
  } = useDailyBriefEnabled();

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!mountedRef.current) return;
    if (!opts?.quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const [latestRes, historyRes, datesRes] = await Promise.all([
        dailyBriefApi.getLatest(),
        dailyBriefApi.getHistory(HISTORY_LIMIT),
        dailyBriefApi.getDates(),
      ]);
      if (!mountedRef.current) return;
      setLatest(latestRes);
      setHistory(historyRes);
      setAvailableDates(datesRes.map(item => item.date));
    } catch {
      if (mountedRef.current && !opts?.quiet) setError('Failed to load daily brief.');
    } finally {
      if (mountedRef.current && !opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const startedAt = regenerateStartedAtRef.current;
      if (startedAt !== null) {
        trackDailyBriefRegenerateAbandoned(Math.round((Date.now() - startedAt) / 1000));
      }
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Normalise anything that isn't `today` or a YYYY-MM-DD date.
  useEffect(() => {
    if (briefDate === TODAY_SEGMENT) return;
    if (briefDate && BRIEF_DATE_RE.test(briefDate)) return;
    void navigate(todayPath, { replace: true });
  }, [briefDate, navigate, todayPath]);

  const inHistory = selectedDate !== null && history.some(item => item.date === selectedDate);

  // Dates outside the loaded window are legitimate — the picker can reach any
  // day the user has a brief for, so fetch it rather than bouncing to today.
  useEffect(() => {
    if (loading || selectedDate === null || inHistory) {
      setFetched(null);
      setFetching(false);
      return undefined;
    }
    let cancelled = false;
    setFetching(true);
    void dailyBriefApi
      .getByDate(selectedDate)
      .then(res => {
        if (cancelled) return;
        if (!res || res.status === 'none') {
          setFetched(null);
          void navigate(todayPath, { replace: true });
          return;
        }
        setFetched({
          date: res.date ?? selectedDate,
          status: res.status,
          content: res.content ?? '',
          data: res.data ?? null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFetched(null);
        setError('Failed to load that brief.');
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [loading, selectedDate, inHistory, navigate, todayPath]);

  const selected = useMemo((): SelectedBrief | null => {
    if (selectedDate) {
      const fromHistory = history.find(h => h.date === selectedDate);
      if (fromHistory) {
        return {
          date: fromHistory.date,
          status: fromHistory.status,
          content: fromHistory.content,
          data: fromHistory.data ?? null,
        };
      }
      return fetched?.date === selectedDate ? fetched : null;
    }
    if (latest && latest.status !== 'none') {
      return {
        date: latest.date,
        status: latest.status,
        content: latest.content ?? '',
        data: latest.data ?? null,
      };
    }
    return null;
  }, [selectedDate, history, latest, fetched]);

  const briefStatus = selected?.status;
  const briefGenerating = briefStatus === 'generating';
  // Today's row, not the viewed one — so a cron/other-tab run is still visible
  // while reading an older brief.
  const latestGenerating = latest?.status === 'generating';
  const generationInFlight = regenerating || latestGenerating || briefGenerating;

  useEffect(() => {
    if (!generationInFlight) return undefined;
    const id = window.setInterval(() => void load({ quiet: true }), 10_000);
    return () => window.clearInterval(id);
  }, [generationInFlight, load]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load({ quiet: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const handleRegenerate = useCallback(async () => {
    if (generationInFlight) return;
    setRegenerating(true);
    setProgress('Starting…');
    setError(null);
    const update = (fn: () => void): void => {
      if (mountedRef.current) fn();
    };
    regenerateStartedAtRef.current = Date.now();
    let failureMessage: string | null = null;
    try {
      await dailyBriefApi.regenerate({
        onStart: () => update(() => setProgress('Generating…')),
        onProgress: label => update(() => setProgress(label || 'Generating…')),
        onComplete: () => update(() => setProgress('Done')),
        onError: message => {
          failureMessage = message || 'Brief generation failed.';
          update(() => setError(message));
        },
      });
      if (failureMessage === null) {
        await load();
        update(() => void navigate(todayPath));
        if (!mountedRef.current || document.hidden) {
          toast.success('Your daily brief is ready', {
            action: {
              label: 'View',
              onClick: () => {
                void navigate(todayPath);
              },
            },
          });
        }
      }
    } catch {
      failureMessage = 'Regeneration failed.';
      update(() => setError('Regeneration failed.'));
    } finally {
      if (failureMessage !== null) toast.error(failureMessage);
      regenerateStartedAtRef.current = null;
      update(() => {
        setRegenerating(false);
        setProgress(null);
      });
    }
  }, [generationInFlight, load, navigate, todayPath]);

  const currentDate = selected?.date ?? null;
  const activeDate = currentDate ?? selectedDate;
  const handleSelectDate = useCallback(
    (date: string, source: BriefSwitchSource) => {
      if (date !== currentDate) {
        trackDailyBriefSwitched(source);
        // Device-scoped `instance` cannot answer "how many users" — the server
        // counts distinct userIds behind this beacon instead.
        void dailyBriefApi.trackSwitch(source);
      }
      void navigate(date === todayBucket ? todayPath : `${briefPath}/${date}`);
    },
    [currentDate, navigate, todayBucket, todayPath, briefPath],
  );

  const renderContext = useBriefRenderContext(
    selected?.data ?? null,
    selected?.content ?? '',
    `daily-brief-${selected?.date ?? 'none'}`,
  );

  const sections = useMemo(() => {
    const data = selected?.data;
    if (!data) return null;
    return SECTIONS.map(spec => ({
      spec,
      lines: (data[spec.field] ?? []).filter(line => line.trim().length > 0),
    })).filter(entry => entry.lines.length > 0);
  }, [selected]);

  const hasBrief = selected !== null;
  // A regeneration always targets today, so it only blanks the body when today
  // is what you're looking at — other briefs stay readable while it runs.
  const isBusy =
    (loading && !selected) ||
    fetching ||
    (viewingToday && regenerating) ||
    (!showRaw && briefGenerating);

  const actionLabel = ((): string => {
    if ((loading && !selected) || fetching) return 'Loading…';
    if (regenerating) return hasBrief ? 'Regenerating…' : 'Generating…';
    if (briefGenerating) return 'Generating…';
    return hasBrief ? 'Regenerate' : 'Generate';
  })();

  const renderBody = (): ReactElement => {
    if (isBusy) {
      return <BriefSkeleton />;
    }
    if (!selected) {
      return (
        <div className='flex flex-col items-start gap-3'>
          <p className={BODY_TEXT_CLASS}>
            {briefEnabled === false
              ? 'No brief to show yet. Turn on the morning brief to get one each day, or use “Generate” to create one now.'
              : 'No brief to show yet. Use “Generate” to create one.'}
          </p>
          {briefEnabled === false && (
            <button
              type='button'
              onClick={() => setBriefEnabled(true)}
              disabled={briefEnabling}
              data-track-category='DailyBrief'
              data-track-name='daily-brief-empty-enable'
              className='flex h-7 items-center rounded-[8px] bg-foreground px-2.5 text-[14px] font-semibold leading-[20px] text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50'
            >
              {briefEnabling ? 'Turning on…' : 'Turn on morning brief'}
            </button>
          )}
        </div>
      );
    }
    if (IS_DEV && showRaw) {
      return (
        <RawBriefView
          date={selected.date}
          status={selected.status}
          content={selected.content}
          data={selected.data}
        />
      );
    }
    const hasContent = (sections && sections.length > 0) || Boolean(selected.content);
    if (selected.status === 'failed' && !hasContent) {
      return <p className={BODY_TEXT_CLASS}>This brief failed to generate.</p>;
    }
    const staleNotice = selected.status === 'failed' && (
      <p className='mb-6 text-center text-[13px] text-muted-foreground'>
        The last refresh failed — showing the previous brief.
      </p>
    );
    if (sections && sections.length > 0) {
      return (
        <div className='flex w-full flex-col gap-9'>
          {staleNotice}
          {sections.map(({ spec, lines }) =>
            spec.field === 'todays_schedule' ? (
              <ScheduleSection
                key={spec.field}
                label={spec.label}
                lines={lines}
                renderContext={renderContext}
                date={selected.date}
              />
            ) : (
              <BriefSection
                key={spec.field}
                {...spec}
                lines={lines}
                renderContext={renderContext}
              />
            ),
          )}
        </div>
      );
    }
    if (selected.content) {
      return (
        <div className='text-sm'>
          {staleNotice}
          <Markdown remarkPlugins={REMARK_PLUGINS} components={FALLBACK_MARKDOWN_COMPONENTS}>
            {selected.content}
          </Markdown>
        </div>
      );
    }
    return <p className={BODY_TEXT_CLASS}>This brief has no content.</p>;
  };

  return (
    <div
      data-testid='daily-brief-page'
      className={cn(
        'relative flex h-full flex-1 flex-col overflow-hidden text-foreground',
        !isInPanelWebview && 'rounded-lg',
      )}
    >
      <header
        style={APP_DRAG_STYLE}
        className='flex h-14 shrink-0 items-center justify-between gap-3 px-4'
      >
        <p className='text-[15px] font-semibold tracking-[-0.1px] text-foreground'>Morning Brief</p>
        <div className='flex items-center gap-1'>
          {progress && <span className='mr-1 text-[13px] text-muted-foreground'>{progress}</span>}
          {IS_DEV && (
            <button
              type='button'
              onClick={() => setShowRaw(prev => !prev)}
              aria-pressed={showRaw}
              style={APP_NO_DRAG_STYLE}
              data-track-category='DailyBrief'
              data-track-name='daily-brief-toggle-raw'
              className={cn(
                'mr-1 rounded-[8px] border px-3 py-1.5 text-[13px] transition-colors',
                showRaw
                  ? 'border-border bg-accent text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {showRaw ? 'Rendered' : 'Raw'}
            </button>
          )}
          <button
            type='button'
            onClick={() => void handleRegenerate()}
            disabled={isBusy}
            style={APP_NO_DRAG_STYLE}
            data-track-category='DailyBrief'
            data-track-name='daily-brief-regenerate'
            className='mr-1 flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
          >
            <ListAiGenerated size={16} className='shrink-0' />
            {actionLabel}
          </button>
          <button
            type='button'
            aria-label='Brief settings'
            onClick={() => setSettingsOpen(true)}
            style={APP_NO_DRAG_STYLE}
            data-track-category='DailyBrief'
            data-track-name='daily-brief-open-settings'
            className={cn(HEADER_ICON_CLASS, settingsOpen && 'bg-accent text-foreground')}
          >
            <Settings01 size={18} />
          </button>
          <BriefHistoryMenu
            history={history}
            availableDates={availableDates}
            selectedDate={activeDate}
            onSelect={handleSelectDate}
          />
          <button
            type='button'
            aria-label='About the daily brief'
            onClick={() => setFeaturesOpen(true)}
            style={APP_NO_DRAG_STYLE}
            data-track-category='DailyBrief'
            data-track-name='daily-brief-open-features'
            className={cn(HEADER_ICON_CLASS, featuresOpen && 'bg-accent text-foreground')}
          >
            <InformationCircle size={18} />
          </button>
        </div>
      </header>

      {error && (
        <div className='border-b border-border bg-red-50 px-6 py-2 text-sm text-red-600 dark:bg-red-950/30'>
          {error}
        </div>
      )}

      <main className='min-h-0 flex-1 overflow-y-auto px-6 pb-16'>
        <article className='mx-auto w-full max-w-[750px]'>
          {!introSeen && !isBusy && (
            <BriefIntroBanner
              onSeeMore={() => setFeaturesOpen(true)}
              onDismiss={markIntroSeen}
              briefEnabled={briefEnabled ?? undefined}
              onEnableBrief={() => setBriefEnabled(true)}
              enabling={briefEnabling}
            />
          )}
          {hasBrief && !isBusy && (
            <h1 className='py-10 text-center font-serif text-[40px] font-semibold italic leading-[1.2] text-foreground'>
              {formatBriefTitle(selected.date)}
            </h1>
          )}
          {generationInFlight && !viewingToday && (
            <button
              type='button'
              onClick={() => void navigate(todayPath)}
              data-track-category='DailyBrief'
              data-track-name='daily-brief-view-generating'
              className='mb-6 flex w-full items-center justify-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground'
            >
              <span
                className='size-1.5 animate-pulse rounded-full bg-xyne-orange-500'
                aria-hidden
              />
              {progress ?? 'Today’s brief is generating…'}
              <span className='underline underline-offset-2'>View</span>
            </button>
          )}
          {!isBusy &&
            selected?.status === 'ready' &&
            latest?.isToday === false &&
            selected.date === latest.date && (
              <p className='mb-6 text-center text-[13px] text-muted-foreground'>
                Showing the most recent brief — today’s has not been generated yet.
              </p>
            )}
          {renderBody()}
        </article>
      </main>

      <BriefFeaturesDialog open={featuresOpen} onOpenChange={setFeaturesOpen} />

      <BriefSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onRegenerate={() => void handleRegenerate()}
        busy={generationInFlight}
      />
    </div>
  );
};

export default DailyBriefScreen;
