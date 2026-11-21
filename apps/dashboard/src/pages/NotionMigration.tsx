import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import {
  notionMigrationApi,
  type NotionCoverage,
  type NotionImportJob,
  type NotionSection,
  type NotionSectionChoice,
} from '../api/notionMigrationApi';
import AppNavigator from '../components/AppNavigator/AppNavigator';
import { inAppPath } from '../components/Canvas/canvasInAppLink';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { cn } from '../utils/classNames';
import { openLink } from '../utils/openLink';

const POLL_MS = 2000;
const CONSENT_WAIT_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^(ntn_|secret_).{4,}/;

const STATUS: Record<
  NotionImportJob['status'],
  { label: string; variant: 'success' | 'secondary' | 'destructive' | 'outline' }
> = {
  collecting: { label: 'Reading Notion', variant: 'secondary' },
  awaiting_review: { label: 'Needs review', variant: 'outline' },
  ingesting: { label: 'Creating', variant: 'secondary' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
};

const TOKEN_STEPS: Array<{ text: string; note: string }> = [
  { text: 'Settings → Connections → Develop → New connection', note: ' · API token, read-only' },
  { text: 'Enable “Read user information including emails”', note: ' · sets page owners' },
  {
    text: 'Content access → add pages to migrate',
    note: ' · sub-pages included; Enterprise: use Content search for private pages',
  },
  { text: 'Share the token (starts with ntn_) securely', note: '' },
];

const errorMessage = (e: unknown, fallback: string): string =>
  (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
  (e instanceof Error ? e.message : fallback);

const formatDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

const shortName = (email: string): string => email.split('@')[0] ?? email;

const isRunning = (job: NotionImportJob): boolean =>
  job.status === 'collecting' || job.status === 'ingesting';

// ---------------------------------------------------------------------------------------------
// Admin review (a token import waits here before anything is created)
// ---------------------------------------------------------------------------------------------
const CHOICE_LABEL: Record<NotionSectionChoice, string> = {
  'private-owner': 'Private to its owner',
  public: 'Public in channel',
  'private-me': 'Private to me',
  skip: 'Skip',
};

/** Least access by default: private to the page's Notion owner when they have a Spaces account. */
const defaultChoice = (s: NotionSection): NotionSectionChoice =>
  s.spacesOwner ? 'private-owner' : 'private-me';

function ReviewPanel({ job }: { job: NotionImportJob }): React.JSX.Element {
  const queryClient = useQueryClient();
  const sections = job.sections ?? [];
  const [choices, setChoices] = useState<Record<string, NotionSectionChoice>>(() =>
    Object.fromEntries(sections.map(s => [s.key, defaultChoice(s)])),
  );
  const [channel, setChannel] = useState(job.channel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publicCount = Object.values(choices).filter(c => c === 'public').length;

  const approve = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await notionMigrationApi.approve(job.id, {
        channel: channel.trim() || undefined,
        sections: choices,
      });
      await queryClient.invalidateQueries({ queryKey: ['notion-migration', 'mine'] });
    } catch (e) {
      setError(errorMessage(e, 'Approval failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-3 px-[14px] py-3 pl-[46px]'>
      <p className='text-[13px] text-muted-foreground'>
        Choose who can see each top-level page. Everything under a page follows it.
      </p>
      <div className='flex flex-wrap gap-2 text-xs'>
        <button
          className='rounded-md border border-border px-2 py-1 hover:bg-accent'
          onClick={() => setChoices(Object.fromEntries(sections.map(s => [s.key, 'public'])))}
          data-track-category='NOTION_MIGRATION'
          data-track-name='REVIEW_ALL_PUBLIC'
        >
          Make all public
        </button>
        <button
          className='rounded-md border border-border px-2 py-1 hover:bg-accent'
          onClick={() =>
            setChoices(Object.fromEntries(sections.map(s => [s.key, defaultChoice(s)])))
          }
          data-track-category='NOTION_MIGRATION'
          data-track-name='REVIEW_ALL_PRIVATE'
        >
          Make all private to owner
        </button>
      </div>
      <div className='overflow-hidden rounded-[10px] border border-border text-[13px]'>
        <div className='grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_180px] gap-3 bg-muted/50 px-[14px] py-2 text-xs font-medium text-muted-foreground'>
          <span>Page</span>
          <span>Owner</span>
          <span>Access</span>
        </div>
        {sections.map(s => (
          <div
            key={s.key}
            className='grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_180px] items-center gap-3 border-t border-border px-[14px] py-2'
          >
            <span className='min-w-0'>
              <span className='block truncate font-medium'>{s.title}</span>
              <span className='block text-xs text-muted-foreground'>
                {s.pages} page{s.pages === 1 ? '' : 's'}
                {s.databases ? ` · ${s.databases} database${s.databases === 1 ? '' : 's'}` : ''}
              </span>
            </span>
            <span className='min-w-0 truncate text-muted-foreground'>
              {s.spacesOwner
                ? s.spacesOwner.email
                : `${s.notionOwner?.name ?? 'Unknown'} · no Spaces account`}
            </span>
            <select
              className='w-full rounded-md border border-border bg-background px-2 py-1 text-[13px]'
              data-track-category='NOTION_MIGRATION'
              data-track-name='REVIEW_SECTION_ACCESS'
              value={choices[s.key]}
              onChange={e =>
                setChoices({ ...choices, [s.key]: e.target.value as NotionSectionChoice })
              }
            >
              {(Object.keys(CHOICE_LABEL) as NotionSectionChoice[])
                .filter(c => c !== 'private-owner' || s.spacesOwner)
                // Someone else's page can't be taken as "private to me".
                .filter(
                  c => c !== 'private-me' || !s.spacesOwner || s.spacesOwner.id === job.userId,
                )
                .map(c => (
                  <option key={c} value={c}>
                    {CHOICE_LABEL[c]}
                  </option>
                ))}
            </select>
          </div>
        ))}
      </div>
      {publicCount > 0 && (
        <div className='flex flex-col gap-2'>
          <label htmlFor={`notion-review-channel-${job.id}`} className='text-[13px] font-medium'>
            Channel for the {publicCount} public page{publicCount === 1 ? '' : 's'}
          </label>
          <Input
            id={`notion-review-channel-${job.id}`}
            placeholder='general'
            value={channel}
            onChange={e => setChannel(e.target.value.replace(/^#/, ''))}
          />
        </div>
      )}
      {error && <p className='text-[13px] text-destructive'>{error}</p>}
      <div>
        <Button
          disabled={busy}
          loading={busy}
          trackId='notion_migration_approve'
          onClick={() => void approve()}
          data-track-category='NOTION_MIGRATION'
          data-track-name='APPROVE_IMPORT'
        >
          Approve and import
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Workspace import (admin)
// ---------------------------------------------------------------------------------------------
function WorkspaceImportCard({
  coverage,
  onStarted,
}: {
  coverage: NotionCoverage | undefined;
  onStarted: () => Promise<void>;
}): React.JSX.Element {
  const [token, setToken] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);

  const people = coverage?.people ?? [];
  const doneCount = people.filter(p => p.imported).length;
  const progress = people.length ? `${(doneCount / people.length) * 100}%` : '0%';
  const workspaceName =
    coverage?.source === 'notion'
      ? (coverage.notionWorkspace ?? 'Notion workspace')
      : 'Spaces members';

  const start = async (): Promise<void> => {
    setError(null);
    setStarting(true);
    try {
      await notionMigrationApi.startWithToken(token.trim());
      setToken('');
      await onStarted();
    } catch (e) {
      setError(errorMessage(e, 'Could not start the import'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className='flex flex-col gap-4 rounded-xl border border-border bg-card p-5'>
      <div className='flex items-center gap-2'>
        <div className='text-sm font-semibold'>Workspace import</div>
        <Badge variant='secondary'>Admin</Badge>
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex items-baseline justify-between gap-3 text-[13px]'>
          <span className='font-medium'>{workspaceName}</span>
          <span className='tabular-nums text-muted-foreground'>
            {doneCount} of {people.length} members imported
          </span>
        </div>
        <div className='h-1 rounded-sm bg-muted'>
          <div className='h-1 rounded-sm bg-primary' style={{ width: progress }} />
        </div>
      </div>

      {people.length > 0 && (
        <div className='overflow-hidden rounded-[10px] border border-border text-[13px]'>
          <div className='grid grid-cols-[minmax(0,1fr)_120px] gap-3 bg-muted/50 px-[14px] py-2 text-xs font-medium text-muted-foreground'>
            <span>Member</span>
            <span>Status</span>
          </div>
          {people.map(p => {
            const status = p.imported ? 'Imported' : p.hasSpacesAccount ? 'Pending' : 'No account';
            return (
              <div
                key={p.email ?? p.name}
                className='grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3 border-t border-border px-[14px] py-[9px]'
              >
                <span className='truncate'>{p.email ?? p.name}</span>
                <span
                  className={cn(
                    'flex items-center gap-1.5',
                    p.imported ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      p.imported ? 'bg-[hsl(142_60%_40%)]' : 'bg-border',
                    )}
                  />
                  {status}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className='text-xs text-muted-foreground'>
        Shared and teamspace pages reach members only after they import.
      </div>

      <div className='flex flex-col gap-2 pt-1'>
        <label htmlFor='notion-token' className='text-[13px] font-medium'>
          Integration token
        </label>
        <div className='flex flex-wrap gap-2'>
          <div className='min-w-0 flex-[1_1_280px]'>
            <Input
              id='notion-token'
              type='password'
              placeholder='ntn_…'
              value={token}
              onChange={e => setToken(e.target.value)}
              className='font-mono'
            />
          </div>
          <Button
            disabled={starting || !TOKEN_PATTERN.test(token.trim())}
            loading={starting}
            trackId='notion_migration_start'
            onClick={() => void start()}
            data-track-category='NOTION_MIGRATION'
            data-track-name='START_WITH_TOKEN'
          >
            Start import
          </Button>
        </div>
        {error && <div className='text-xs text-destructive'>{error}</div>}
        <div className='text-xs text-muted-foreground'>
          You’ll review page access before anything is created. Token is used once, never stored.
        </div>
      </div>

      <div className='flex flex-col gap-2.5 border-t border-border pt-3'>
        <button
          className='flex w-fit select-none items-center gap-1.5 text-[13px] font-medium'
          onClick={() => setStepsOpen(open => !open)}
          aria-expanded={stepsOpen}
          data-track-category='NOTION_MIGRATION'
          data-track-name='TOGGLE_TOKEN_STEPS'
        >
          <span className='inline-block w-3 text-muted-foreground'>{stepsOpen ? '▾' : '▸'}</span>
          How to get a token
        </button>
        {stepsOpen && (
          <div className='flex flex-col gap-0.5 text-[13px]'>
            <div className='pb-1.5 pl-[18px] text-xs text-muted-foreground'>
              Send to the Notion workspace owner
            </div>
            {TOKEN_STEPS.map((s, i) => (
              <div
                key={s.text}
                className='grid grid-cols-[18px_minmax(0,1fr)] items-baseline gap-2.5 py-1.5 pl-[18px]'
              >
                <span className='font-mono text-xs text-muted-foreground'>{i + 1}</span>
                <span>
                  {s.text}
                  <span className='text-muted-foreground'>{s.note}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------
const HISTORY_COLS = 'grid-cols-[20px_minmax(0,1fr)_100px_64px_64px_150px]';
const PAGE_COLS = 'grid-cols-[20px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)]';

function HistoryRow({
  job,
  open,
  onToggle,
}: {
  job: NotionImportJob;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const status = STATUS[job.status];
  const name = `${job.kind === 'member' ? 'My Notion' : 'Workspace import'}${job.notionWorkspace ? ` · ${job.notionWorkspace}` : ''}`;
  const summary = job.summary;
  const notes = [
    summary?.comments ? `${summary.comments} comment${summary.comments === 1 ? '' : 's'}` : '',
    summary?.joined ? `${summary.joined} already in Spaces` : '',
    summary?.skipped ? `${summary.skipped} skipped` : '',
    summary?.accessRemoved?.length ? `access removed: ${summary.accessRemoved.join(', ')}` : '',
    summary?.unresolvedUsers.length
      ? `no Spaces account: ${summary.unresolvedUsers.map(u => u.email ?? u.name).join(', ')}`
      : '',
  ].filter(Boolean);

  return (
    <>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'grid w-full items-center gap-3 border-t border-border px-[14px] py-[11px] text-left hover:bg-accent',
          HISTORY_COLS,
        )}
        data-track-category='NOTION_MIGRATION'
        data-track-name='TOGGLE_HISTORY_ROW'
      >
        <span className='text-[11px] text-muted-foreground'>{open ? '▾' : '▸'}</span>
        <span className='truncate font-medium'>{name}</span>
        <span>
          <Badge variant={status.variant}>{status.label}</Badge>
        </span>
        <span className='text-right tabular-nums'>{summary?.created ?? '—'}</span>
        <span className='text-right tabular-nums'>{summary?.updated ?? '—'}</span>
        <span className='text-right tabular-nums text-muted-foreground'>
          {formatDate(job.startedAt)}
        </span>
      </button>

      {open && (
        <div className='border-t border-border bg-background'>
          {isRunning(job) && (
            <div className='truncate px-[14px] py-2.5 pl-[46px] text-xs text-muted-foreground'>
              {job.log[job.log.length - 1] ?? 'Starting…'}
            </div>
          )}
          {job.error && (
            <div className='flex items-start gap-2 px-[14px] py-2.5 pl-[46px] text-[13px] text-destructive'>
              <TriangleAlert className='mt-0.5 size-4 shrink-0' />
              <span className='break-words'>{job.error}</span>
            </div>
          )}
          {job.status === 'awaiting_review' && <ReviewPanel job={job} />}

          {summary && summary.canvases.length > 0 && (
            <>
              <div
                className={cn(
                  'grid gap-3 px-[14px] py-2 pl-[46px] text-xs font-medium text-muted-foreground',
                  PAGE_COLS,
                )}
              >
                <span />
                <span>Page</span>
                <span>Owner</span>
                <span>Access</span>
              </div>
              {summary.canvases.map(c => (
                <div
                  key={c.url}
                  className={cn(
                    'grid items-center gap-3 border-t border-border/60 px-[14px] py-[7px] pl-[46px]',
                    PAGE_COLS,
                  )}
                >
                  <span className='text-[hsl(142_60%_40%)]'>✓</span>
                  <Link to={inAppPath(c.url) ?? c.url} className='truncate hover:underline'>
                    {c.title}
                  </Link>
                  <span className='truncate text-muted-foreground'>{c.ownerEmail ?? '—'}</span>
                  <span className='truncate text-muted-foreground'>
                    {(c.sharedWith ?? []).map(shortName).join(', ') || '—'}
                  </span>
                </div>
              ))}
            </>
          )}
          {notes.length > 0 && (
            <div className='border-t border-border/60 px-[14px] py-2 pl-[46px] text-xs text-muted-foreground'>
              {notes.join(' · ')}
            </div>
          )}
          {summary && summary.warnings.length > 0 && (
            <details className='border-t border-border/60 px-[14px] py-2 pl-[46px] text-xs'>
              <summary className='cursor-pointer text-amber-600'>
                {summary.warnings.length} warning{summary.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul className='mt-1 list-disc space-y-1 pl-5 text-muted-foreground'>
                {summary.warnings.map(w => (
                  <li key={w} className='break-words'>
                    {w}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------
const NotionMigration = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get('error'));
  // Set while the user is on Notion's consent screen in another tab / the system browser.
  const [waitingForNotion, setWaitingForNotion] = useState<{ since: number; url: string } | null>(
    null,
  );
  // Expanded history rows; the newest import starts open.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const connect = async (): Promise<void> => {
    setError(null);
    setConnecting(true);
    try {
      const url = await notionMigrationApi.connectUrl();
      // Never navigate the app itself to Notion: on desktop this opens the system browser, on the
      // web a new tab. The consent finishes there; this page picks the new import up by polling.
      openLink(url, null, { force: 'external' });
      setWaitingForNotion({ since: Date.now(), url });
    } catch (e) {
      setError(errorMessage(e, 'Could not start the Notion connection'));
    } finally {
      setConnecting(false);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['notion-migration', 'mine'],
    queryFn: notionMigrationApi.listMine,
    refetchInterval: query =>
      waitingForNotion || query.state.data?.jobs.some(isRunning) ? POLL_MS : false,
  });
  const jobs = data?.jobs ?? [];
  const isAdmin = data?.isAdmin ?? false;

  // Stop waiting once the import shows up (the user clicked Allow), or after 10 minutes.
  const notionJobArrived =
    waitingForNotion !== null && jobs.some(j => j.startedAt >= waitingForNotion.since - 5000);
  useEffect((): (() => void) | undefined => {
    if (!waitingForNotion) return undefined;
    if (notionJobArrived) {
      setWaitingForNotion(null);
      return undefined;
    }
    const timer = setTimeout(
      () => setWaitingForNotion(null),
      Math.max(0, waitingForNotion.since + CONSENT_WAIT_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [waitingForNotion, notionJobArrived]);

  const { data: coverage } = useQuery({
    queryKey: ['notion-migration', 'coverage'],
    queryFn: notionMigrationApi.coverage,
    enabled: isAdmin,
    refetchInterval: jobs.some(isRunning) ? POLL_MS * 5 : false,
  });

  const newestId = jobs[0]?.id;
  const isOpen = (id: string): boolean => openRows[id] ?? id === newestId;

  return (
    <div className='flex h-full w-full flex-col'>
      <div className='h-[52px] w-full shrink-0'>
        <AppNavigator />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border-muted'>
        <main className='mx-auto box-border flex max-w-[880px] flex-col gap-8 px-6 pb-16 pt-8'>
          <div className='flex flex-col gap-1'>
            <h2 className='m-0 text-lg font-semibold'>Notion</h2>
            <p className='m-0 text-[13px] text-muted-foreground'>
              Import pages and databases as canvases. Read-only — nothing changes in Notion.
            </p>
          </div>

          {error && (
            <div className='flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive'>
              <TriangleAlert className='mt-0.5 size-4 shrink-0' />
              <span className='break-words'>{error}</span>
            </div>
          )}

          <section className='flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4'>
            <div className='flex flex-wrap items-center justify-between gap-4'>
              <div className='flex min-w-0 flex-[1_1_320px] flex-col gap-1'>
                <div className='text-sm font-semibold'>Import my Notion</div>
                <div className='text-[13px] text-muted-foreground'>
                  Choose <b className='font-medium text-foreground'>Select all</b> when Notion asks.
                  Pages stay visible only to the people who can see them in Notion.
                </div>
              </div>
              <Button
                disabled={connecting}
                loading={connecting}
                trackId='notion_migration_connect'
                onClick={() => void connect()}
                data-track-category='NOTION_MIGRATION'
                data-track-name='CONNECT_MEMBER'
              >
                Connect Notion
              </Button>
            </div>
            {waitingForNotion && (
              <div className='text-xs text-muted-foreground'>
                Finish in the Notion window that just opened, then come back — this page updates by
                itself. Didn’t open?{' '}
                <button
                  className='underline'
                  onClick={() => openLink(waitingForNotion.url, null, { force: 'external' })}
                  data-track-category='NOTION_MIGRATION'
                  data-track-name='REOPEN_CONSENT'
                >
                  Open Notion again
                </button>
              </div>
            )}
          </section>

          {isAdmin && !isLoading && (
            <WorkspaceImportCard
              coverage={coverage}
              onStarted={() =>
                queryClient.invalidateQueries({ queryKey: ['notion-migration', 'mine'] })
              }
            />
          )}

          {jobs.length > 0 && (
            <section className='flex flex-col gap-3'>
              <div className='text-sm font-semibold'>History</div>
              <div className='overflow-hidden rounded-xl border border-border bg-card text-[13px]'>
                <div
                  className={cn(
                    'grid gap-3 bg-muted/50 px-[14px] py-[9px] text-xs font-medium text-muted-foreground',
                    HISTORY_COLS,
                  )}
                >
                  <span />
                  <span>Import</span>
                  <span>Status</span>
                  <span className='text-right'>Created</span>
                  <span className='text-right'>Updated</span>
                  <span className='text-right'>Date</span>
                </div>
                {jobs.map(job => (
                  <HistoryRow
                    key={job.id}
                    job={job}
                    open={isOpen(job.id)}
                    onToggle={() => setOpenRows(rows => ({ ...rows, [job.id]: !isOpen(job.id) }))}
                  />
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

export default NotionMigration;
