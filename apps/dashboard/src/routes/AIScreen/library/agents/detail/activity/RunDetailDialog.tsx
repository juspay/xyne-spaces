import { useState, type ReactElement, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bug, Loader2, X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog/Dialog';
import { Link } from '@/components/ui/WorkspaceLink';
import { useAuth } from '@/hooks/useAuth';
import { clawErrorText } from '@/services/claw/clawRequest';
import { closeLostAgentRuns, getAgentRunMonitorDetail } from '@/services/claw/clawRunsService';
import type { AgentRun } from '@/services/claw/clawRunsTypes';
import {
  RUN_SOURCE_LABEL,
  formatRunDuration,
  runElapsedMs,
  runModelLabel,
  runTimeSplit,
  runTraceHref,
} from '@/services/claw/runDetail';
import { cn } from '@/utils/classNames';
import { Pill, type PillTone } from '../../../shared/primitives/Pill';

const POLL_MS = 4000;
const VISIBLE_TOOL_CALLS = 50;

const STATUS_TONE: Record<string, PillTone> = {
  completed: 'success',
  live: 'success',
  running: 'warning',
  stuck: 'warning',
  failed: 'danger',
  lost: 'danger',
  cancelled: 'neutral',
};

export function RunDetailDialog({
  run: listedRun,
  canManage,
  onClose,
}: {
  run: AgentRun;
  canManage: boolean;
  onClose: () => void;
}): ReactElement {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['claw-agent-run-detail', listedRun.agentSlug, listedRun.sessionId, userId],
    queryFn: () => getAgentRunMonitorDetail(userId!, listedRun.agentSlug, listedRun.sessionId),
    enabled: canManage && Boolean(userId),
    staleTime: 0,
    retry: false,
    refetchInterval: query =>
      query.state.data?.run.status === 'running' && query.state.data.inflight?.state !== 'lost'
        ? POLL_MS
        : false,
  });

  const detail = detailQuery.data;
  const run = detail?.run ?? listedRun;
  const inflight = run.status === 'running' ? (detail?.inflight ?? null) : null;
  const status = inflight?.state ?? run.status;
  const invocations = run.toolInvocations ?? [];
  const split = runTimeSplit(run);
  const traceHref = runTraceHref(run);
  const elapsed = runElapsedMs(run);
  const cached = (run.tokensCacheRead ?? 0) + (run.tokensCacheWrite ?? 0);

  const closeAsFailed = async (): Promise<void> => {
    if (!userId || closing) return;
    setClosing(true);
    try {
      const result = await closeLostAgentRuns(userId, run.agentSlug, [run.sessionId]);
      if (result.closed.includes(run.sessionId)) {
        toast.success('Closed as failed');
      } else {
        toast.error('Not closed: this run is no longer stuck');
      }
      await Promise.all([
        detailQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['claw-agent-runs', run.agentSlug] }),
      ]);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not close this run'));
    } finally {
      setClosing(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={run.task || 'Untitled run'}
      description={run.sessionId}
      className='max-w-[720px] p-0'
      testId='run-detail-dialog'
    >
      <div className='flex items-start gap-3 border-b border-border px-5 py-4'>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-base font-semibold text-foreground'>
            {run.task || 'Untitled run'}
          </p>
          <p className='truncate font-mono text-xs text-muted-foreground'>{run.sessionId}</p>
        </div>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: close run detail'
          className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <X className='size-4' aria-hidden />
        </button>
      </div>
      <div className='flex max-h-[75vh] flex-col gap-5 overflow-y-auto px-5 py-4'>
        <div className='flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
          <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Pill>
          <span>
            {run.status === 'running'
              ? `running for ${formatRunDuration(elapsed)}`
              : `took ${formatRunDuration(elapsed)}`}
          </span>
          {detailQuery.isFetching && run.status === 'running' && (
            <Loader2 className='size-3.5 animate-spin' aria-hidden />
          )}
        </div>

        {inflight?.state === 'lost' && (
          <div
            data-testid='run-lost-notice'
            className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground'
          >
            <span className='min-w-0 flex-1'>
              Stuck: no claw pod holds this run and nothing has happened for{' '}
              {formatRunDuration(inflight.idleMs)}. It will not finish.
            </span>
            <button
              type='button'
              disabled={closing}
              onClick={() => void closeAsFailed()}
              data-testid='run-close-as-failed'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: close run as failed'
              className='flex items-center gap-1.5 rounded-md border border-destructive/40 bg-background px-3 py-1 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50'
            >
              {closing && <Loader2 className='size-3.5 animate-spin' aria-hidden />}
              {closing ? 'Closing…' : 'Close as failed'}
            </button>
          </div>
        )}

        {inflight?.state === 'stuck' && (
          <div className='rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-foreground'>
            No progress for {formatRunDuration(inflight.idleMs)}.{' '}
            {inflight.owned
              ? 'A claw pod still holds it, so it may recover.'
              : 'No pod holds it; you can close it once it has been silent for an hour.'}
          </div>
        )}

        {run.status === 'running' && run.currentToolLabel && (
          <p className='text-sm text-muted-foreground'>Now: {run.currentToolLabel}</p>
        )}

        <div className='grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4'>
          <Field
            label='Source'
            value={
              detail
                ? `${RUN_SOURCE_LABEL[detail.source]} · ${run.triggerSource}`
                : run.triggerSource
            }
          />
          <Field label='Started by' value={listedRun.userName || listedRun.userEmail || '—'} />
          <Field label='Started' value={new Date(run.startedAt).toLocaleString()} />
          <Field label='Model' value={runModelLabel(run)} testId='run-detail-model' />
          <Field
            label='LLM time'
            value={`${formatRunDuration(run.llmTotalMs)}${run.llmTurns ? ` · ${run.llmTurns} turn${run.llmTurns === 1 ? '' : 's'}` : ''}`}
          />
          <Field
            label='Tool time'
            value={`${formatRunDuration(run.toolMs)} · ${invocations.length} call${invocations.length === 1 ? '' : 's'}`}
          />
          <Field
            label='Tokens'
            value={
              run.tokensIn || run.tokensOut
                ? `${(run.tokensIn ?? 0).toLocaleString()} in · ${(run.tokensOut ?? 0).toLocaleString()} out${cached ? ` · ${cached.toLocaleString()} cached` : ''}`
                : '—'
            }
          />
          <Field
            label='Retries'
            value={
              run.llmRetries
                ? `${run.llmRetries}${run.lastRetryReason ? ` · ${run.lastRetryReason.slice(0, 60)}` : ''}`
                : '0'
            }
          />
        </div>

        {split && (
          <div className='flex flex-col gap-1.5' data-testid='run-time-split'>
            <div className='flex h-2 overflow-hidden rounded-full bg-muted'>
              <div className='bg-foreground/70' style={{ width: `${split.llmShare * 100}%` }} />
              <div className='flex-1 bg-muted-foreground/30' />
            </div>
            <div className='flex justify-between text-xs text-muted-foreground'>
              <span>LLM {Math.round(split.llmShare * 100)}%</span>
              <span>Tools {100 - Math.round(split.llmShare * 100)}%</span>
            </div>
          </div>
        )}

        {traceHref && (
          <Link
            to={traceHref}
            onClick={onClose}
            data-testid='run-open-trace'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: open run debug trace'
            className='flex w-fit items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-muted'
          >
            <Bug className='size-4' aria-hidden />
            Open debug trace
          </Link>
        )}

        <Block title='Task'>{run.task || '—'}</Block>

        <div className='flex flex-col gap-1.5'>
          <span className='text-sm font-semibold text-foreground'>
            Tool calls ({invocations.length})
          </span>
          {invocations.length > 0 ? (
            <div className='flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border'>
              {invocations.slice(0, VISIBLE_TOOL_CALLS).map((call, index) => (
                <div
                  key={call.toolCallId ?? `${call.toolName}-${index}`}
                  className='flex items-center gap-3 px-3 py-2 text-sm'
                >
                  <span className='min-w-0 flex-1 truncate font-mono text-xs text-foreground'>
                    {call.toolName}
                  </span>
                  {call.isError && <Pill tone='danger'>error</Pill>}
                  <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                    {formatRunDuration(call.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className='text-sm text-muted-foreground'>No tool calls.</span>
          )}
        </div>

        {run.error && (
          <Block title='Error' tone='error'>
            {run.error}
          </Block>
        )}
        {run.result && <Block title='Result'>{run.result}</Block>}
      </div>
    </Dialog>
  );
}

function Field({
  label,
  value,
  testId,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
}): ReactElement {
  return (
    <div className='flex min-w-0 flex-col gap-0.5'>
      <span className='text-[11px] uppercase tracking-wide text-muted-foreground'>{label}</span>
      <span className='break-words text-sm text-foreground' data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

function Block({
  title,
  children,
  tone,
}: {
  title: string;
  children: ReactNode;
  tone?: 'error';
}): ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <span className='text-sm font-semibold text-foreground'>{title}</span>
      <div
        className={cn(
          'max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-sm',
          tone === 'error'
            ? 'border-destructive/40 bg-destructive/5 text-destructive'
            : 'border-border bg-muted/40 text-muted-foreground',
        )}
      >
        {children}
      </div>
    </div>
  );
}
