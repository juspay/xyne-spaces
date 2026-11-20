import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Globe, KeyRound, Lock, TriangleAlert } from 'lucide-react';
import {
  notionMigrationApi,
  type NotionCoverage,
  type NotionImportJob,
  type NotionSection,
  type NotionSectionChoice,
} from '../api/notionMigrationApi';
import Button from '../components/ui/Button';
import { inAppPath } from '../components/Canvas/canvasInAppLink';
import { openLink } from '../utils/openLink';
import Input from '../components/ui/Input';
import AppNavigator from '../components/AppNavigator/AppNavigator';
import { cn } from '../utils/classNames';

const POLL_MS = 2000;
const CONSENT_WAIT_MS = 10 * 60 * 1000;

const STATUS_LABEL: Record<NotionImportJob['status'], { label: string; className: string }> = {
  collecting: { label: 'Reading from Notion', className: 'bg-blue-500/10 text-blue-600' },
  awaiting_review: { label: 'Awaiting review', className: 'bg-amber-500/10 text-amber-600' },
  ingesting: { label: 'Creating canvases', className: 'bg-violet-500/10 text-violet-600' },
  completed: { label: 'Completed', className: 'bg-green-500/10 text-green-600' },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive' },
};

function Steps({ items }: { items: React.ReactNode[] }): React.JSX.Element {
  return (
    <ol className='space-y-2.5'>
      {items.map((item, i) => (
        <li key={i} className='flex gap-2.5 text-sm leading-relaxed text-muted-foreground'>
          <span className='mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-foreground'>
            {i + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function GuideRail(): React.JSX.Element {
  return (
    <div className='rounded-xl border border-border bg-card p-4 shadow-xs'>
      <div className='mb-3 flex items-center gap-2 text-sm font-semibold text-foreground'>
        <KeyRound className='size-4' />
        Get the Notion token
      </div>
      <p className='mb-3 text-sm leading-relaxed text-muted-foreground'>
        Send these steps to the merchant’s <b className='text-foreground'>Notion workspace owner</b>
        :
      </p>
      <Steps
        items={[
          <>
            In Notion: <b className='text-foreground'>Settings → Connections → Develop</b> →{' '}
            <b className='text-foreground'>New connection</b>, type{' '}
            <b className='text-foreground'>API token</b>, read-only.
          </>,
          <>
            Turn on <b className='text-foreground'>Read user information including emails</b> — it’s
            how each page gets its right owner here.
          </>,
          <>
            On its <b className='text-foreground'>Content access</b> tab, add the pages to migrate.
            Sub-pages and databases come along. On Enterprise, first use{' '}
            <b className='text-foreground'>Content search</b> to grant yourself members’ private
            pages, then add those too.
          </>,
          <>
            Share the token (starts with <code className='rounded bg-muted px-1'>ntn_</code>)
            securely.
          </>,
        ]}
      />
      <div className='mt-4 space-y-2 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground'>
        <p>Read-only: nothing changes in Notion.</p>
        <p>The token is used once to read the pages, then dropped — never stored.</p>
        <p>Members don’t need to do anything. Safe to run again: canvases update in place.</p>
      </div>
    </div>
  );
}

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

  const setAll = (choice: NotionSectionChoice): void =>
    setChoices(Object.fromEntries(sections.map(s => [s.key, choice])));

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
      setError(
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
          (e instanceof Error ? e.message : 'Approval failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='mt-4 space-y-3'>
      <p className='text-sm leading-relaxed text-muted-foreground'>
        Choose who can see each top-level page in Spaces. Everything under a page follows it.
        Private pages go to their owner’s Personal section — only they can see them.
      </p>
      <div className='flex flex-wrap gap-2 text-xs'>
        <button
          className='rounded-md border border-border px-2 py-1 hover:bg-muted'
          onClick={() => setAll('public')}
          data-track-category='NOTION_MIGRATION'
          data-track-name='REVIEW_ALL_PUBLIC'
        >
          Make all public
        </button>
        <button
          className='rounded-md border border-border px-2 py-1 hover:bg-muted'
          onClick={() =>
            setChoices(Object.fromEntries(sections.map(s => [s.key, defaultChoice(s)])))
          }
          data-track-category='NOTION_MIGRATION'
          data-track-name='REVIEW_ALL_PRIVATE'
        >
          Make all private to owner
        </button>
      </div>
      <div className='overflow-x-auto rounded-lg border border-border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50 text-left text-xs text-muted-foreground'>
            <tr>
              <th className='px-3 py-2 font-medium'>Notion page</th>
              <th className='px-3 py-2 font-medium'>Owner → Spaces user</th>
              <th className='px-3 py-2 font-medium'>Access in Spaces</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(s => (
              <tr key={s.key} className='border-t border-border'>
                <td className='px-3 py-2'>
                  <div className='font-medium text-foreground'>{s.title}</div>
                  <div className='text-xs text-muted-foreground'>
                    {s.pages} page{s.pages === 1 ? '' : 's'}
                    {s.databases ? ` · ${s.databases} database${s.databases === 1 ? '' : 's'}` : ''}
                  </div>
                </td>
                <td className='px-3 py-2 text-xs'>
                  <div className='text-foreground'>{s.notionOwner?.name ?? 'Unknown'}</div>
                  {s.spacesOwner ? (
                    <div className='text-green-600'>→ {s.spacesOwner.email}</div>
                  ) : (
                    <div className='text-amber-600'>
                      No Spaces account{s.notionOwner?.email ? ` (${s.notionOwner.email})` : ''}
                    </div>
                  )}
                </td>
                <td className='px-3 py-2'>
                  <select
                    className='w-full rounded-md border border-border bg-background px-2 py-1 text-sm'
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
                        c =>
                          c !== 'private-me' || !s.spacesOwner || s.spacesOwner.id === job.userId,
                      )
                      .map(c => (
                        <option key={c} value={c}>
                          {CHOICE_LABEL[c]}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {publicCount > 0 && (
        <div>
          <label
            htmlFor={`notion-review-channel-${job.id}`}
            className='mb-1.5 block text-sm font-medium text-foreground'
          >
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
      {error && <p className='text-sm text-destructive'>{error}</p>}
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
  );
}

function JobCard({ job }: { job: NotionImportJob }): React.JSX.Element {
  const status = STATUS_LABEL[job.status];
  const running = job.status === 'collecting' || job.status === 'ingesting';
  const lastLog = job.log[job.log.length - 1];
  return (
    <div className='rounded-xl border border-border bg-card p-4 shadow-xs'>
      <div className='flex flex-wrap items-center gap-2'>
        {job.kind === 'member' ? (
          <Lock className='size-4 text-muted-foreground' />
        ) : (
          <Building2 className='size-4 text-muted-foreground' />
        )}
        <span className='text-sm font-medium text-foreground'>
          {job.kind === 'member' ? 'My Notion' : 'Workspace import'}
          {job.notionWorkspace ? ` · ${job.notionWorkspace}` : ''}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', status.className)}>
          {status.label}
        </span>
        <span className='ml-auto text-xs text-muted-foreground'>
          {new Date(job.startedAt).toLocaleString()}
        </span>
      </div>

      {running && lastLog && (
        <p className='mt-2 truncate text-xs text-muted-foreground'>{lastLog}</p>
      )}

      {job.error && (
        <div className='mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0' />
          <span className='break-words'>{job.error}</span>
        </div>
      )}

      {job.status === 'awaiting_review' && <ReviewPanel job={job} />}

      {job.summary && (
        <div className='mt-3'>
          <p className='text-sm text-muted-foreground'>
            {job.summary.created} created · {job.summary.updated} updated
            {job.summary.joined ? ` · ${job.summary.joined} already in Spaces` : ''}
            {job.summary.skipped ? ` · ${job.summary.skipped} skipped` : ''} ·{' '}
            {job.summary.attachments} files · {job.summary.comments} comments
          </p>
          <ul className='mt-2 space-y-1'>
            {job.summary.canvases.map(c => (
              <li key={c.url} className='flex items-center gap-2 text-sm'>
                <Check className='size-3.5 shrink-0 text-green-600' />
                {c.access === 'public' ? (
                  <Globe className='size-3.5 shrink-0 text-muted-foreground' />
                ) : (
                  <Lock className='size-3.5 shrink-0 text-muted-foreground' />
                )}
                <Link
                  to={inAppPath(c.url) ?? c.url}
                  className='truncate text-foreground hover:underline'
                >
                  {c.title}
                </Link>
                {c.ownerEmail && (
                  <span className='truncate text-xs text-muted-foreground'>
                    · owner {c.ownerEmail}
                  </span>
                )}
                {c.sharedWith && c.sharedWith.length > 0 && (
                  <span
                    className='truncate text-xs text-muted-foreground'
                    title={c.sharedWith.join(', ')}
                  >
                    · access: {c.sharedWith.map(e => e.split('@')[0]).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {job.summary.accessRemoved?.length > 0 && (
            <p className='mt-2 text-xs text-muted-foreground'>
              Access removed (no longer visible to you in Notion):{' '}
              {job.summary.accessRemoved.join(', ')}
            </p>
          )}
          {job.summary.unresolvedUsers.length > 0 && (
            <p className='mt-2 text-xs text-amber-600'>
              No Spaces account for:{' '}
              {job.summary.unresolvedUsers.map(u => u.email ?? u.name).join(', ')} — their pages are
              owned by you instead.
            </p>
          )}
          {job.summary.warnings.length > 0 && (
            <details className='mt-3 text-sm'>
              <summary className='cursor-pointer text-amber-600'>
                {job.summary.warnings.length} warning{job.summary.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul className='mt-1 list-disc space-y-1 pl-5 text-muted-foreground'>
                {job.summary.warnings.map(w => (
                  <li key={w} className='break-words'>
                    {w}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function CoverageLine({ coverage }: { coverage: NotionCoverage }): React.JSX.Element {
  const label = (p: NotionCoverage['people'][number]): string => p.email ?? p.name;
  const withAccount = coverage.people.filter(p => p.hasSpacesAccount);
  const done = withAccount.filter(p => p.imported);
  const pending = withAccount.filter(p => !p.imported);
  const noAccount = coverage.people.filter(p => !p.hasSpacesAccount);
  return (
    <p className='mb-3 text-xs leading-relaxed text-muted-foreground'>
      {coverage.source === 'notion' ? (
        <>
          Notion workspace <b className='text-foreground'>{coverage.notionWorkspace ?? ''}</b>:{' '}
        </>
      ) : (
        <>No import yet, so showing Spaces people. </>
      )}
      <b className='text-foreground'>
        {done.length} of {withAccount.length}
      </b>{' '}
      have imported their Notion. Shared and teamspace pages only reach people once they import.
      {pending.length > 0 && <> Not yet: {pending.map(label).join(', ')}.</>}
      {noAccount.length > 0 && (
        <> No Spaces account (can’t get access yet): {noAccount.map(label).join(', ')}.</>
      )}
    </p>
  );
}

const NotionMigration = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [starting, setStarting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get('error'));
  // Set while the user is on Notion's consent screen in another tab / the system browser.
  const [waitingForNotion, setWaitingForNotion] = useState<{ since: number; url: string } | null>(
    null,
  );

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
      setError(
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
          (e instanceof Error ? e.message : 'Could not start the Notion connection'),
      );
    } finally {
      setConnecting(false);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['notion-migration', 'mine'],
    queryFn: notionMigrationApi.listMine,
    refetchInterval: query =>
      waitingForNotion ||
      query.state.data?.jobs.some(j => j.status === 'collecting' || j.status === 'ingesting')
        ? POLL_MS
        : false,
  });
  const jobs = data?.jobs ?? [];
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
  const isAdmin = data?.isAdmin ?? false;
  const { data: coverage } = useQuery({
    queryKey: ['notion-migration', 'coverage'],
    queryFn: notionMigrationApi.coverage,
    enabled: isAdmin,
  });

  const start = async (): Promise<void> => {
    setError(null);
    setStarting(true);
    try {
      await notionMigrationApi.startWithToken(token.trim());
      setToken('');
      await queryClient.invalidateQueries({ queryKey: ['notion-migration', 'mine'] });
    } catch (e) {
      setError(
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
          (e instanceof Error ? e.message : 'Could not start the import'),
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className='flex h-full w-full flex-col'>
      <div className='h-[52px] w-full shrink-0'>
        <AppNavigator />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border-muted'>
        <div className='mx-auto max-w-6xl px-4 py-8 sm:px-6'>
          <div className='lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-10'>
            <aside className='mb-8 lg:sticky lg:top-8 lg:mb-0 lg:self-start'>
              <header className='mb-5'>
                <h1 className='text-2xl font-semibold tracking-tight text-foreground'>
                  Notion migration
                </h1>
                <p className='mt-1.5 text-sm leading-relaxed text-muted-foreground'>
                  Bring a Notion workspace’s pages, sub-pages and databases into Spaces as canvases.
                </p>
              </header>
              {isAdmin && <GuideRail />}
            </aside>

            <div className='min-w-0 space-y-8'>
              {error && (
                <div className='flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive'>
                  <TriangleAlert className='mt-0.5 size-4 shrink-0' />
                  <span className='break-words'>{error}</span>
                </div>
              )}

              <div className='rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5'>
                <div className='mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground'>
                  <Lock className='size-4' />
                  Import my Notion
                </div>
                <p className='mb-3 text-sm leading-relaxed text-muted-foreground'>
                  Bring over everything you can see in Notion. When Notion asks, use{' '}
                  <b className='text-foreground'>select all</b> under Teamspaces, Shared and
                  Private. Every page becomes a private canvas shared with exactly the people who
                  can see it in Notion — as your teammates import too, they’re added to the same
                  canvas.
                </p>
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
                {waitingForNotion && (
                  <p className='mt-3 text-xs leading-relaxed text-muted-foreground'>
                    Finish in the Notion window that just opened: pick your pages and click{' '}
                    <b className='text-foreground'>Allow access</b>. This page updates by itself.
                    Didn’t open?{' '}
                    <button
                      className='underline'
                      onClick={() => openLink(waitingForNotion.url, null, { force: 'external' })}
                      data-track-category='NOTION_MIGRATION'
                      data-track-name='REOPEN_CONSENT'
                    >
                      Open Notion again
                    </button>
                  </p>
                )}
              </div>

              {isAdmin && !isLoading && (
                <div className='rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5'>
                  <div className='mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground'>
                    <Building2 className='size-4' />
                    Workspace import (admin)
                  </div>
                  {coverage && <CoverageLine coverage={coverage} />}
                  <label
                    htmlFor='notion-token'
                    className='mb-1.5 block text-sm font-medium text-foreground'
                  >
                    Notion integration token
                  </label>
                  <div className='flex flex-col gap-2 sm:flex-row'>
                    <Input
                      id='notion-token'
                      type='password'
                      placeholder='ntn_…'
                      value={token}
                      onChange={e => setToken(e.target.value)}
                      className='flex-1 font-mono'
                    />
                    <Button
                      disabled={starting || !token.trim()}
                      loading={starting}
                      trackId='notion_migration_start'
                      onClick={() => void start()}
                      data-track-category='NOTION_MIGRATION'
                      data-track-name='START_WITH_TOKEN'
                    >
                      Start import
                    </Button>
                  </div>
                  <p className='mt-2 text-xs text-muted-foreground'>
                    Reads every page shared with the integration, then asks you to review who can
                    see each one before anything is created.
                  </p>
                </div>
              )}

              {jobs.length > 0 && (
                <section className='space-y-3'>
                  <h2 className='text-sm font-semibold text-foreground'>Notion imports</h2>
                  {jobs.map(job => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotionMigration;
