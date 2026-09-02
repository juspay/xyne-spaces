import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  Hash,
  Play,
  Square,
  Trash2,
  RotateCcw,
  Check,
  TriangleAlert,
  Clock,
  ShieldCheck,
  Info,
  CloudOff,
  ExternalLink,
  KeyRound,
  ListChecks,
  Megaphone,
} from 'lucide-react';
import { MigrationJobView, MigrationStatus, slackMigrationApi } from '../api/slackMigrationApi';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { DatePicker } from '../components/ui/DatePicker/DatePicker';
import AppNavigator from '../components/AppNavigator/AppNavigator';
import { SLACK_APP_INSTALL_URL } from '../config';
import { cn } from '../utils/classNames';

// Adaptive polling: fast when a job runs, relaxed when idle, paused when hidden,
// and backed off when the pod is down so a restart isn't hammered by every dashboard.
const POLL_ACTIVE_MS = 4000;
const POLL_IDLE_MS = 15000;
const POLL_HIDDEN_MS = 10000;
const POLL_DOWN_MS = 5000;
const POLL_MAX_MS = 60000;

/** No response (network error) or 5xx means the migration pod is down/starting: treat
 *  as "unreachable" and keep polling. 4xx means the pod is up (auth etc.). */
const isServiceDown = (e: unknown): boolean => {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === undefined || status >= 500;
};
const STALE_MS = 45_000; // no heartbeat this long while running ⇒ stalled

const ADMIN_NOTES = [
  'Approve only stages a job onto the ingestion queue — nothing ingests until ingestion is started.',
  'Start ingestion is restricted to authorized users — not every admin can run it.',
  'Processing is serial: one job at a time per queue.',
  'Stop is graceful (stops at the next conversation) and leaves the job resumable.',
  'A stopped or failed job can be resumed; it never re-fetches or re-ingests what is already done.',
  'Delete is destructive: it removes the job and its collected data. Deleting a completed DM lets that person submit again.',
  'If a job fails, resume it — or delete it and have the submitter re-submit. Members can do this for their own jobs too.',
];

// ── status vocabulary ───────────────────────────────────────────────────────
type Tone = 'muted' | 'blue' | 'amber' | 'violet' | 'orange' | 'red' | 'green';

const STATUS: Record<MigrationStatus, { label: string; tone: Tone }> = {
  SUBMITTED: { label: 'Queued', tone: 'muted' },
  QUEUED: { label: 'Queued', tone: 'muted' },
  COLLECTING: { label: 'Collecting', tone: 'blue' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'amber' },
  INGESTING: { label: 'Ingesting', tone: 'violet' },
  STOPPED: { label: 'Stopped', tone: 'orange' },
  FAILED: { label: 'Failed', tone: 'red' },
  COMPLETED: { label: 'Completed', tone: 'green' },
};

const TONE: Record<Tone, { pill: string; dot: string; bar: string; ring: string }> = {
  muted: {
    pill: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground',
    bar: 'bg-muted-foreground',
    ring: 'ring-border',
  },
  blue: {
    pill: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
    bar: 'bg-blue-500',
    ring: 'ring-blue-500',
  },
  amber: {
    pill: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    ring: 'ring-amber-500',
  },
  violet: {
    pill: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    dot: 'bg-violet-500',
    bar: 'bg-violet-500',
    ring: 'ring-violet-500',
  },
  orange: {
    pill: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    dot: 'bg-orange-500',
    bar: 'bg-orange-500',
    ring: 'ring-orange-500',
  },
  red: {
    pill: 'bg-destructive/10 text-destructive',
    dot: 'bg-destructive',
    bar: 'bg-destructive',
    ring: 'ring-destructive',
  },
  green: {
    pill: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    ring: 'ring-emerald-500',
  },
};

const isStalled = (j: MigrationJobView): boolean =>
  (j.status === 'COLLECTING' || j.status === 'INGESTING') && Date.now() - j.heartbeatAt > STALE_MS;

const ago = (ts: number): string => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

// Human-readable ingest duration, e.g. "7m 12s".
const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
};

// Pipeline stages; position derived from status (and phase when stopped/failed).
const STAGES = ['Collect', 'Approve', 'Ingest', 'Done'] as const;
const activeStage = (j: MigrationJobView): number => {
  switch (j.status) {
    case 'SUBMITTED':
    case 'COLLECTING':
      return 0;
    case 'QUEUED':
      return j.phase === 'ingest' ? 2 : 0; // queued to (re)run in its current phase
    case 'AWAITING_APPROVAL':
      return j.phase === 'ingest' ? 2 : 1; // approved ⇒ ingest gate
    case 'INGESTING':
      return 2;
    case 'COMPLETED':
      return 3;
    case 'STOPPED':
    case 'FAILED':
      return j.phase === 'ingest' ? 2 : 0;
    default:
      return 0;
  }
};

// ── small pieces ─────────────────────────────────────────────────────────────
function StatusPill({ job }: { job: MigrationJobView }): React.JSX.Element {
  const running = job.status === 'COLLECTING' || job.status === 'INGESTING';
  const stopping = running && job.stopRequested;
  const stalled = running && !stopping && isStalled(job);
  const approvedQueued = job.status === 'AWAITING_APPROVAL' && job.phase === 'ingest';
  const desc = stopping
    ? { label: 'Stopping at next conversation…', tone: 'orange' as Tone }
    : stalled
      ? { label: 'Stalled · recovering', tone: 'amber' as Tone }
      : approvedQueued
        ? { label: 'Approved · waiting to ingest', tone: 'violet' as Tone }
        : STATUS[job.status];
  const t = TONE[desc.tone];
  const live = running && !stalled; // pulse while collecting/ingesting
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        t.pill,
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          t.dot,
          live && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      {desc.label}
    </span>
  );
}

function Stepper({ job }: { job: MigrationJobView }): React.JSX.Element {
  const idx = activeStage(job);
  const failed = job.status === 'FAILED';
  const stopped = job.status === 'STOPPED';
  const stalled = isStalled(job);
  const activeTone: Tone = failed
    ? 'red'
    : stopped
      ? 'orange'
      : stalled
        ? 'amber'
        : STATUS[job.status].tone;

  return (
    <div className='flex items-center'>
      {STAGES.map((stage, i) => {
        const done = i < idx || job.status === 'COMPLETED';
        const active = i === idx && job.status !== 'COMPLETED';
        const t = TONE[done ? 'green' : active ? activeTone : 'muted'];
        return (
          <div key={stage} className='flex flex-1 items-center last:flex-none'>
            <div className='flex flex-col items-center gap-1'>
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold',
                  done && 'bg-emerald-500 text-white',
                  active && cn(t.pill, 'ring-2', t.ring, 'ring-offset-1 ring-offset-background'),
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? (
                  <Check className='size-3' />
                ) : active && (failed || stopped) ? (
                  <TriangleAlert className='size-3' />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  'text-[10px] leading-none',
                  active ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {stage}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={cn(
                  'mx-1.5 h-px flex-1',
                  i < idx || job.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PhaseProgress({ job }: { job: MigrationJobView }): React.JSX.Element | null {
  const { total, collected, ingested } = job.progress;
  if (total === 0 && job.status === 'SUBMITTED') return null;
  const ingestPhase = job.phase === 'ingest' && job.status !== 'AWAITING_APPROVAL';
  const tone = TONE[job.status === 'COMPLETED' ? 'green' : ingestPhase ? 'violet' : 'blue'];

  // Slack gives no channel message total, but every message has a ts, so show progress
  // through the date window with collectedThrough (oldest reached) as position.
  if (job.channel) {
    const active = job.status === 'COLLECTING' || job.status === 'INGESTING';
    const complete = job.status === 'COMPLETED';
    const { windowStart, windowEnd, collectedThrough } = job.channel;
    const pct =
      job.status === 'COLLECTING' &&
      windowStart &&
      windowEnd &&
      collectedThrough &&
      windowEnd > windowStart
        ? Math.min(
            100,
            Math.max(
              0,
              Math.round(((windowEnd - collectedThrough) / (windowEnd - windowStart)) * 100),
            ),
          )
        : null;
    const throughLabel = collectedThrough
      ? new Date(collectedThrough * 1000).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
        })
      : null;
    return (
      <div>
        <div className='mb-1 flex items-center justify-between text-xs text-muted-foreground'>
          <span>
            {job.stats.messages.toLocaleString()} messages{ingestPhase ? '' : ' collected'}
          </span>
          {pct !== null ? (
            <span className='tabular-nums'>
              back to {throughLabel} · {pct}%
            </span>
          ) : (
            active && (
              <span className='text-muted-foreground/70'>
                {ingestPhase ? 'ingesting…' : 'collecting…'}
              </span>
            )
          )}
        </div>
        <div className='h-1.5 overflow-hidden rounded-full bg-muted'>
          {complete ? (
            <div className={cn('h-full w-full rounded-full', TONE.green.bar)} />
          ) : pct !== null ? (
            <div
              className={cn('h-full rounded-full transition-[width] duration-500', tone.bar)}
              style={{ width: `${pct}%` }}
            />
          ) : active ? (
            <div className={cn('h-full w-1/3 rounded-full animate-pulse', tone.bar)} />
          ) : (
            <div className='h-full w-0' />
          )}
        </div>
      </div>
    );
  }

  // DM: many conversations → a real percentage.
  const done = ingestPhase ? ingested : collected;
  const verb = ingestPhase ? 'ingested' : 'collected';
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div>
      <div className='mb-1 flex items-center justify-between text-xs text-muted-foreground'>
        <span>
          {done.toLocaleString()} / {total.toLocaleString()} conversations {verb}
        </span>
        <span className='tabular-nums'>{pct}%</span>
      </div>
      <div className='h-1.5 overflow-hidden rounded-full bg-muted'>
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', tone.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function JobCard({
  job,
  actions,
}: {
  job: MigrationJobView;
  actions?: React.ReactNode;
}): React.JSX.Element {
  const isDm = job.type === 'DM';
  return (
    <div className='rounded-xl border border-border bg-card p-4 shadow-xs'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-center gap-2.5'>
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-lg',
              isDm
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
            )}
          >
            {isDm ? <MessageSquare className='size-4' /> : <Hash className='size-4' />}
          </span>
          <div className='leading-tight'>
            <div className='text-sm font-medium text-foreground'>
              {isDm ? (
                'Direct messages'
              ) : job.channel ? (
                <>
                  #{job.channel.slackName ?? job.channel.slackId}{' '}
                  <span className='text-muted-foreground'>→</span>{' '}
                  {job.channel.xyneName ?? job.channel.xyneId}
                </>
              ) : (
                'Channel'
              )}
            </div>
            <div className='text-xs text-muted-foreground'>
              {job.submittedByName ? `${job.submittedByName} · ` : ''}submitted {ago(job.createdAt)}
              {job.channel?.startDate ? ` · from ${job.channel.startDate}` : ''}
            </div>
            {job.channel?.announceInSlack && (
              <span className='mt-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground'>
                <Megaphone className='size-3' />
                {job.status === 'COMPLETED'
                  ? 'Notice posted in Slack'
                  : 'Posts a Slack notice when done'}
              </span>
            )}
          </div>
        </div>
        <StatusPill job={job} />
      </div>

      <div className='mt-4'>
        <Stepper job={job} />
      </div>

      <div className='mt-4'>
        <PhaseProgress job={job} />
      </div>

      {job.status === 'COMPLETED' && typeof job.ingestDurationMs === 'number' && (
        <div className='mt-3 flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400'>
          <Info className='mt-0.5 size-3.5 shrink-0' />
          <span>
            Ingested {job.stats.messages.toLocaleString()} messages in{' '}
            <span className='font-medium tabular-nums'>{fmtDuration(job.ingestDurationMs)}</span>
          </span>
        </div>
      )}

      {job.status === 'FAILED' && job.error && (
        <div className='mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive'>
          <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
          <span className='break-words'>{job.error}</span>
        </div>
      )}

      {job.stopReason && (job.status === 'STOPPED' || job.stopRequested) && (
        <div className='mt-3 flex items-start gap-2 rounded-lg bg-orange-500/10 px-3 py-2 text-xs text-orange-600 dark:text-orange-400'>
          <Info className='mt-0.5 size-3.5 shrink-0' />
          <span className='break-words'>
            {job.stopReason === 'system'
              ? 'Stopped after a system restart — an admin can resume it.'
              : 'An admin stopped this migration — not a failure. An admin can resume it.'}
          </span>
        </div>
      )}

      {job.issues && job.issues.length > 0 && (
        <div className='mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400'>
          <div className='flex items-center gap-2 font-medium'>
            <TriangleAlert className='size-3.5 shrink-0' />
            {job.issues.length} conversation{job.issues.length > 1 ? 's' : ''} not fully migrated
          </div>
          <ul className='mt-1.5 space-y-1 pl-5'>
            {job.issues.map((issue, i) => (
              <li key={`${issue.conversationId}-${i}`} className='break-words'>
                <span className='font-medium'>{issue.label ?? issue.conversationId}</span>
                <span className='text-amber-600/70 dark:text-amber-400/70'> — {issue.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className='mt-4 flex items-center justify-between border-t border-border pt-3'>
        <div className='flex items-center gap-4 text-xs text-muted-foreground'>
          <span>
            <span className='font-medium text-foreground tabular-nums'>
              {job.stats.messages.toLocaleString()}
            </span>{' '}
            messages
          </span>
          <span className='inline-flex items-center gap-1'>
            <Clock className='size-3' />
            updated {ago(job.updatedAt)}
          </span>
        </div>
        {actions && <div className='flex items-center gap-1.5'>{actions}</div>}
      </div>
    </div>
  );
}

// Ordered sequence: the numbers are meaningful steps, not decoration.
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

function Checklist({ items }: { items: React.ReactNode[] }): React.JSX.Element {
  return (
    <ul className='space-y-2.5'>
      {items.map((item, i) => (
        <li key={i} className='flex gap-2.5 text-sm leading-relaxed text-muted-foreground'>
          <Check className='mt-0.5 size-4 shrink-0 text-emerald-500' />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function RailCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className='rounded-xl border border-border bg-card p-4 shadow-xs'>
      <h3 className='mb-3 flex items-center gap-2 text-sm font-semibold text-foreground'>
        <span className='text-muted-foreground'>{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

// Token steps on the DM tab, channel prerequisites on the Channel tab.
function GuideRail({
  tab,
  isAdmin,
}: {
  tab: 'dm' | 'channel';
  isAdmin: boolean;
}): React.JSX.Element {
  return (
    <div className='space-y-4'>
      {tab === 'dm' ? (
        <RailCard title='Get your Slack token' icon={<KeyRound className='size-4' />}>
          <Steps
            items={[
              SLACK_APP_INSTALL_URL ? (
                <>
                  Open the{' '}
                  <a
                    href={SLACK_APP_INSTALL_URL}
                    target='_blank'
                    rel='noreferrer'
                    data-track-category='SLACK_MIGRATION'
                    data-track-name='OPEN_SLACK_APP_INSTALL_PAGE'
                    className='inline-flex items-center gap-0.5 font-medium text-primary hover:underline'
                  >
                    Slack app install page
                    <ExternalLink className='size-3' />
                  </a>
                  .
                </>
              ) : (
                <>
                  Open your workspace’s{' '}
                  <span className='font-medium text-foreground'>Slack app install page</span> — ask
                  an admin for the link if you don’t have it.
                </>
              ),
              <>
                Can’t open it? You need to be a{' '}
                <span className='font-medium text-foreground'>collaborator</span> on the app first —
                ask a workspace admin to add you, then reopen the link.
              </>,
              <>
                Click <span className='font-medium text-foreground'>Install</span> or{' '}
                <span className='font-medium text-foreground'>Re-install</span> to your workspace —
                you’ll get the token.
              </>,
              <>
                Copy your <span className='font-medium text-foreground'>User OAuth token</span>{' '}
                (starts with <code className='rounded bg-muted px-1 py-0.5 text-xs'>xoxp-</code>)
                and paste it into the form.
              </>,
            ]}
          />
          <ul className='mt-4 space-y-2 border-t border-border pt-3.5 text-sm leading-relaxed text-muted-foreground'>
            <li>Used once to fetch your data, then dropped — never stored, shown, or exported.</li>
            <li>Must be your own account: the token’s email has to match your Xyne email.</li>
            <li>One-time per person; an admin deletes your job to let you redo it.</li>
          </ul>
        </RailCard>
      ) : (
        <RailCard title='Before you migrate a channel' icon={<ListChecks className='size-4' />}>
          <Checklist
            items={[
              <>
                Add the <span className='font-medium text-foreground'>Xyne Spaces bot</span> to the
                channel — in Slack, run{' '}
                <code className='rounded bg-muted px-1 py-0.5 text-xs'>/invite @Xyne Spaces</code>.
                A channel the bot isn’t in is rejected.
              </>,
              <>
                You must be a <span className='font-medium text-foreground'>member</span> of{' '}
                <span className='font-medium text-foreground'>both</span> the Slack channel and the
                destination Xyne channel.
              </>,
              <>One migration per channel at a time — request again once it completes.</>,
            ]}
          />
        </RailCard>
      )}
      {isAdmin && (
        <RailCard title='For admins' icon={<ShieldCheck className='size-4' />}>
          <ul className='space-y-2 text-sm leading-relaxed text-muted-foreground'>
            {ADMIN_NOTES.map(n => (
              <li key={n} className='flex gap-2.5'>
                <span className='mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/50' />
                {n}
              </li>
            ))}
          </ul>
        </RailCard>
      )}
    </div>
  );
}

const inputCls =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/10 outline-none';

// ── page ─────────────────────────────────────────────────────────────────────
export default function SlackMigration(): React.JSX.Element {
  const [mine, setMine] = useState<MigrationJobView[]>([]);
  const [all, setAll] = useState<MigrationJobView[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ingest, setIngest] = useState<{ canIngest: boolean; running: boolean } | null>(null);
  const [tab, setTab] = useState<'dm' | 'channel'>('dm');
  const [token, setToken] = useState('');
  const [channel, setChannel] = useState({
    slackChannelId: '',
    xyneChannelId: '',
    startDate: '',
    announceInSlack: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      setMine(await slackMigrationApi.listMine());
      try {
        const adminJobs = await slackMigrationApi.listAdmin();
        setIsAdmin(true);
        setAll(adminJobs);
        setIngest(await slackMigrationApi.ingestionStatus());
      } catch (e) {
        // Only a real 403 means "not an admin"; a transient 5xx/network blip must not hide the panel.
        if ((e as { response?: { status?: number } })?.response?.status === 403) {
          setIsAdmin(false);
          setAll(null);
        }
      }
      setUnreachable(false); // a successful poll clears the banner
      setError(null);
      return true;
    } catch (e) {
      const down = isServiceDown(e);
      setUnreachable(down);
      if (!down) setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  // Mirror "is a job running?" into a ref so the poll loop reads it without re-subscribing.
  const hasActive = useMemo(
    () =>
      [...(mine ?? []), ...(all ?? [])].some(
        j => j.status === 'COLLECTING' || j.status === 'INGESTING',
      ),
    [mine, all],
  );
  const hasActiveRef = useRef(hasActive);
  hasActiveRef.current = hasActive;

  useEffect(() => {
    let stopped = false;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(() => void loop(), POLL_HIDDEN_MS);
        return;
      } // skip background tabs
      const ok = await refresh();
      if (stopped) return;
      fails = ok ? 0 : fails + 1;
      const next = ok
        ? hasActiveRef.current
          ? POLL_ACTIVE_MS
          : POLL_IDLE_MS
        : Math.min(POLL_DOWN_MS * 2 ** Math.min(fails - 1, 4), POLL_MAX_MS); // backoff when down
      timer = setTimeout(() => void loop(), next);
    };
    void loop();
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void loop();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const [exporting, setExporting] = useState(false);
  const onExportHistory = useCallback(async (): Promise<void> => {
    setExporting(true);
    setError(null);
    try {
      const jobs = await slackMigrationApi.exportHistory();
      const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `slack-migration-history-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, []);

  const activeDm = useMemo(() => mine.find(m => m.type === 'DM'), [mine]);

  return (
    <div className='flex h-full w-full flex-col'>
      {/* Shared app navigator (back/forward + search). */}
      <div className='h-[52px] w-full shrink-0'>
        <AppNavigator />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border-muted'>
        <div className='mx-auto max-w-6xl px-4 py-8 sm:px-6'>
          <div className='lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-10'>
            {/* LEFT — sticky rail: title + guide */}
            <aside className='mb-8 lg:mb-0 lg:sticky lg:top-8 lg:self-start'>
              <header className='mb-5'>
                <h1 className='text-2xl font-semibold tracking-tight text-foreground'>
                  Slack migration
                </h1>
                <p className='mt-1.5 text-sm leading-relaxed text-muted-foreground'>
                  Bring your Slack direct messages, group DMs, and channels into Xyne Spaces.
                </p>
              </header>
              <GuideRail tab={tab} isAdmin={isAdmin} />
            </aside>

            {/* RIGHT — actions */}
            <div className='min-w-0 space-y-8'>
              {unreachable && (
                <div className='flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-600 dark:text-amber-400'>
                  <CloudOff className='mt-0.5 size-4 shrink-0' />
                  <span className='break-words'>
                    The migration service is unreachable — the pod may be starting up or briefly
                    down. This page keeps retrying; new submissions are paused until it’s back.
                  </span>
                </div>
              )}

              {error && !unreachable && (
                <div className='flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive'>
                  <TriangleAlert className='mt-0.5 size-4 shrink-0' />
                  <span className='break-words'>{error}</span>
                </div>
              )}

              {/* Start a migration */}
              <div className='rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5'>
                <div className='mb-4 inline-flex rounded-lg bg-muted p-0.5'>
                  {(['dm', 'channel'] as const).map(k => (
                    <button
                      key={k}
                      onClick={() => setTab(k)}
                      data-track-category='SLACK_MIGRATION'
                      data-track-name={`TAB_${k.toUpperCase()}`}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        tab === k
                          ? 'bg-background text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {k === 'dm' ? 'Direct messages' : 'Channel'}
                    </button>
                  ))}
                </div>

                {tab === 'dm' ? (
                  activeDm ? (
                    <p className='text-sm leading-relaxed text-muted-foreground'>
                      {activeDm.status === 'COMPLETED'
                        ? 'Your DMs have already been migrated.'
                        : activeDm.status === 'STOPPED'
                          ? 'Your DM migration was stopped.'
                          : activeDm.status === 'FAILED'
                            ? 'Your DM migration failed.'
                            : 'Your DM migration is already in progress.'}{' '}
                      DM migration is one-time per person — an admin must delete it before you can
                      start again.
                    </p>
                  ) : (
                    <div>
                      <label
                        htmlFor='mig-token'
                        className='mb-1.5 block text-sm font-medium text-foreground'
                      >
                        Your Slack user token
                      </label>
                      <div className='flex flex-col gap-2 sm:flex-row'>
                        <Input
                          id='mig-token'
                          type='password'
                          placeholder='xoxp-…'
                          value={token}
                          onChange={e => setToken(e.target.value)}
                          className='flex-1 font-mono'
                        />
                        <Button
                          disabled={busy || unreachable || !token.trim()}
                          loading={busy}
                          onClick={() =>
                            void run(() => slackMigrationApi.submitDm(token.trim())).then(ok => {
                              if (ok) setToken('');
                            })
                          }
                          data-track-category='SLACK_MIGRATION'
                          data-track-name='SUBMIT_DM_MIGRATION'
                        >
                          Migrate my DMs
                        </Button>
                      </div>
                      <p className='mt-2 text-xs text-muted-foreground'>
                        Used once to fetch your DMs, then dropped. Steps to get your token are on
                        the left.
                      </p>
                    </div>
                  )
                ) : (
                  <div className='space-y-4'>
                    <div className='grid gap-3 sm:grid-cols-2'>
                      <div>
                        <label
                          htmlFor='mig-slack-channel'
                          className='mb-1.5 block text-sm font-medium text-foreground'
                        >
                          Slack channel ID
                        </label>
                        <Input
                          id='mig-slack-channel'
                          placeholder='C0…'
                          value={channel.slackChannelId}
                          onChange={e => setChannel({ ...channel, slackChannelId: e.target.value })}
                          data-track-category='SLACK_MIGRATION'
                          data-track-name='SLACK_CHANNEL_ID_INPUT'
                          className='font-mono'
                        />
                      </div>
                      <div>
                        <label
                          htmlFor='mig-xyne-channel'
                          className='mb-1.5 block text-sm font-medium text-foreground'
                        >
                          Xyne channel ID
                        </label>
                        <Input
                          id='mig-xyne-channel'
                          placeholder='Destination channel'
                          value={channel.xyneChannelId}
                          onChange={e => setChannel({ ...channel, xyneChannelId: e.target.value })}
                          data-track-category='SLACK_MIGRATION'
                          data-track-name='XYNE_CHANNEL_ID_INPUT'
                          className='font-mono'
                        />
                      </div>
                    </div>
                    <div>
                      <span className='mb-1.5 block text-sm font-medium text-foreground'>
                        Start date{' '}
                        <span className='font-normal text-muted-foreground'>· optional</span>
                      </span>
                      <DatePicker
                        selectedDate={channel.startDate ? new Date(channel.startDate) : null}
                        onSelect={d =>
                          setChannel({
                            ...channel,
                            startDate: d ? d.toISOString().slice(0, 10) : '',
                          })
                        }
                        placeholder='From the beginning'
                        maxDate={new Date()}
                        showClearButton
                        inputClassName={inputCls}
                      />
                    </div>
                    <Checkbox
                      checked={channel.announceInSlack}
                      onChange={c => setChannel({ ...channel, announceInSlack: c })}
                      data-track-category='SLACK_MIGRATION'
                      data-track-name='ANNOUNCE_IN_SLACK_TOGGLE'
                      label='Post a “Migrated to Xyne Spaces” notice in the Slack channel when it’s done'
                      size='md'
                    />
                    <div className='flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3.5'>
                      <p className='text-xs text-muted-foreground'>
                        Add the Xyne Spaces bot to the channel first — checklist on the left.
                      </p>
                      <Button
                        disabled={
                          busy ||
                          unreachable ||
                          !channel.slackChannelId.trim() ||
                          !channel.xyneChannelId.trim()
                        }
                        loading={busy}
                        data-track-category='SLACK_MIGRATION'
                        data-track-name='SUBMIT_CHANNEL_MIGRATION'
                        onClick={() =>
                          void run(() => slackMigrationApi.submitChannel(channel)).then(ok => {
                            if (ok)
                              setChannel({
                                slackChannelId: '',
                                xyneChannelId: '',
                                startDate: '',
                                announceInSlack: false,
                              });
                          })
                        }
                      >
                        Request channel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {mine.length > 0 && (
                <section className='space-y-3'>
                  <h2 className='text-sm font-semibold text-foreground'>Your migrations</h2>
                  <p className='text-xs text-muted-foreground'>
                    If a migration fails, delete it and submit again. You can resume or delete your
                    own jobs here — or ask an admin to do it for you.
                  </p>
                  {mine.map(job => (
                    <JobCard
                      key={job.id}
                      job={job}
                      actions={<OwnerActions job={job} busy={busy} run={run} />}
                    />
                  ))}
                </section>
              )}

              {/* Admin control panel */}
              {isAdmin && all && (
                <section className='space-y-4'>
                  <div className='flex items-center justify-between'>
                    <h2 className='text-sm font-semibold text-foreground'>Admin control panel</h2>
                    <button
                      type='button'
                      onClick={() => void onExportHistory()}
                      disabled={exporting}
                      data-track-category='SLACK_MIGRATION'
                      data-track-name='EXPORT_HISTORY'
                      className='text-xs font-medium text-primary hover:underline disabled:opacity-50'
                    >
                      {exporting ? 'Exporting…' : 'Export history'}
                    </button>
                  </div>
                  {ingest && <IngestionControl status={ingest} busy={busy} run={run} />}
                  {all.length === 0 ? (
                    <p className='rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground'>
                      No migrations yet.
                    </p>
                  ) : (
                    <div className='space-y-3'>
                      {all.map(job => (
                        <JobCard
                          key={job.id}
                          job={job}
                          actions={<AdminActions job={job} busy={busy} run={run} />}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IngestionControl({
  status,
  busy,
  run,
}: {
  status: { canIngest: boolean; running: boolean };
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
}): React.JSX.Element {
  const t = TONE[status.running ? 'green' : 'orange'];
  return (
    <div className='flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-xs'>
      <span className={cn('flex size-8 items-center justify-center rounded-lg', t.pill)}>
        {status.running ? <Play className='size-4' /> : <Square className='size-4' />}
      </span>
      <div className='leading-tight'>
        <div className='text-sm font-medium text-foreground'>
          Ingestion {status.running ? 'running' : 'paused'}
        </div>
        <div className='text-xs text-muted-foreground'>
          {status.running
            ? 'The queue is on — approved jobs process one at a time, in order.'
            : 'The queue is off — approved jobs stage here and wait until you start.'}
        </div>
      </div>
      <div className='ml-auto'>
        {status.canIngest ? (
          status.running ? (
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => void run(() => slackMigrationApi.stopIngestion())}
              data-track-category='SLACK_MIGRATION'
              data-track-name='STOP_INGESTION'
            >
              <Square className='size-3.5' />
              Stop ingestion
            </Button>
          ) : (
            <Button
              size='sm'
              disabled={busy}
              onClick={() => void run(() => slackMigrationApi.startIngestion())}
              data-track-category='SLACK_MIGRATION'
              data-track-name='START_INGESTION'
            >
              <Play className='size-3.5' />
              Start ingestion
            </Button>
          )
        ) : (
          <span className='text-xs text-muted-foreground'>
            You don’t have permission to start or stop ingestion.
          </span>
        )}
      </div>
    </div>
  );
}

// Actions the submitter gets on their OWN jobs: resume a stopped/failed one, or delete it (when not running).
function OwnerActions({
  job,
  busy,
  run,
}: {
  job: MigrationJobView;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
}): React.JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const act = (key: string, fn: () => Promise<unknown>): void => {
    setPending(key);
    void run(fn).finally(() => setPending(null));
  };
  const canResume = job.status === 'STOPPED' || job.status === 'FAILED';
  const canDelete = job.status !== 'COLLECTING' && job.status !== 'INGESTING';
  return (
    <>
      {canResume && (
        <Button
          variant='outline'
          size='sm'
          disabled={busy}
          loading={pending === 'resume'}
          onClick={() => act('resume', () => slackMigrationApi.resumeMine(job.id))}
          data-track-category='SLACK_MIGRATION'
          data-track-name='RESUME_OWN_JOB'
        >
          <RotateCcw className='size-3.5' />
          Resume
        </Button>
      )}
      {canDelete && (
        <Button
          variant='ghost'
          size='sm'
          disabled={busy}
          loading={pending === 'remove'}
          onClick={() => act('remove', () => slackMigrationApi.removeMine(job.id))}
          data-track-category='SLACK_MIGRATION'
          data-track-name='DELETE_OWN_JOB'
          className='text-destructive hover:text-destructive'
        >
          <Trash2 className='size-3.5' />
        </Button>
      )}
    </>
  );
}

function AdminActions({
  job,
  busy,
  run,
}: {
  job: MigrationJobView;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
}): React.JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const act = (key: string, fn: () => Promise<unknown>): void => {
    setPending(key);
    void run(fn).finally(() => setPending(null));
  };
  const canApprove = job.status === 'AWAITING_APPROVAL' && job.phase === 'collect';
  const canStop =
    job.status === 'COLLECTING' || job.status === 'INGESTING' || job.status === 'QUEUED';
  const canResume = job.status === 'STOPPED' || job.status === 'FAILED';
  return (
    <>
      {canApprove && (
        <Button
          size='sm'
          disabled={busy}
          loading={pending === 'approve'}
          onClick={() => act('approve', () => slackMigrationApi.approve(job.id))}
          data-track-category='SLACK_MIGRATION'
          data-track-name='APPROVE_JOB'
        >
          <Check className='size-3.5' />
          Approve
        </Button>
      )}
      {canStop && (
        <Button
          variant='outline'
          size='sm'
          disabled={busy}
          loading={pending === 'stop'}
          onClick={() => act('stop', () => slackMigrationApi.stop(job.id))}
          data-track-category='SLACK_MIGRATION'
          data-track-name='STOP_JOB'
        >
          <Square className='size-3.5' />
          Stop
        </Button>
      )}
      {canResume && (
        <Button
          variant='outline'
          size='sm'
          disabled={busy}
          loading={pending === 'resume'}
          onClick={() => act('resume', () => slackMigrationApi.resume(job.id))}
          data-track-category='SLACK_MIGRATION'
          data-track-name='RESUME_JOB'
        >
          <RotateCcw className='size-3.5' />
          Resume
        </Button>
      )}
      <Button
        variant='ghost'
        size='sm'
        disabled={busy}
        loading={pending === 'remove'}
        onClick={() => act('remove', () => slackMigrationApi.remove(job.id))}
        data-track-category='SLACK_MIGRATION'
        data-track-name='DELETE_JOB'
        className='text-destructive hover:text-destructive'
      >
        <Trash2 className='size-3.5' />
      </Button>
    </>
  );
}
