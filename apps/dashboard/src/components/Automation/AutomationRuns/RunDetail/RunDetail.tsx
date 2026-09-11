import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Hourglass, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { fetchAutomationRun } from '../../../../api/automationsApi';
import type { AutomationRunStatus } from '../../Automation.types';
import type { RunDetailProps } from './RunDetail.types';

const STATUS_CLASSES: Record<AutomationRunStatus, string> = {
  PENDING: 'bg-muted text-muted-foreground border-border',
  SCHEDULED:
    'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400 dark:border-amber-500/40',
  RUNNING:
    'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400 dark:border-blue-500/40',
  EXTERNAL_WAIT:
    'bg-purple-500/10 text-purple-700 border-purple-500/30 dark:text-purple-400 dark:border-purple-500/40',
  COMPLETED:
    'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400 dark:border-green-500/40',
  FAILED: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400 dark:border-red-500/40',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  SKIPPED: 'bg-muted text-muted-foreground border-border',
};

const STATUS_LABELS: Record<AutomationRunStatus, string> = {
  PENDING: 'Pending',
  SCHEDULED: 'Scheduled',
  RUNNING: 'Running',
  EXTERNAL_WAIT: 'Waiting on agent',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  SKIPPED: 'Skipped',
};

export function RunDetail({ runId, onBack }: RunDetailProps): React.ReactElement {
  // No automatic polling — the user refreshes the page (or returns to it)
  // to pick up post-pause updates. refetchOnWindowFocus catches the common
  // "come back to tab" case.
  const {
    data,
    isLoading: queryLoading,
    isError,
  } = useQuery({
    queryKey: ['automation-run', runId],
    queryFn: () => fetchAutomationRun(runId),
    refetchOnWindowFocus: true,
  });
  const run = data?.run ?? null;
  const isLoading = queryLoading && !run;
  const notFound = isError || (!queryLoading && !run);

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex items-center gap-3 border-b border-border px-6 py-4'>
        <button
          type='button'
          onClick={onBack}
          aria-label='Back'
          data-track-category='automation-runs'
          data-track-name='run-detail-back'
          className='flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40'
        >
          <ArrowLeft className='size-4' />
        </button>
        <h1 className='font-mono text-sm text-foreground'>Run {runId}</h1>
        {run && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
              STATUS_CLASSES[run.status],
            )}
          >
            {run.status === 'EXTERNAL_WAIT' && <Hourglass className='size-3' />}
            {STATUS_LABELS[run.status] ?? run.status}
          </span>
        )}
      </div>

      <div className='flex-1 overflow-y-auto'>
        {isLoading ? (
          <div className='flex items-center justify-center py-12 text-sm text-muted-foreground'>
            <Loader2 className='mr-2 size-4 animate-spin' />
            Loading run…
          </div>
        ) : notFound || !run ? (
          <div className='py-12 text-center text-sm text-red-600'>Run not found.</div>
        ) : (
          <div className='mx-auto flex max-w-3xl flex-col gap-3 px-6 py-6'>
            <SummaryCard
              startedAt={run.startedAt}
              completedAt={run.completedAt}
              error={run.error}
              status={run.status}
            />

            <SectionCard
              icon={
                run.status === 'FAILED' ? (
                  <XCircle className='size-4 text-red-600' />
                ) : (
                  <CheckCircle2 className='size-4 text-amber-600' />
                )
              }
              title='Trigger payload'
              subtitle='What fired the run.'
              json={run.triggerData}
            />

            <StepOutputs context={run.context} />
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  startedAt,
  completedAt,
  error,
  status,
}: {
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  status: AutomationRunStatus;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-2 rounded-md border border-border bg-background p-5'>
      <div className='grid grid-cols-2 gap-4 text-sm'>
        <Metric label='Started' value={new Date(startedAt).toLocaleString()} />
        <Metric
          label='Completed'
          value={completedAt ? new Date(completedAt).toLocaleString() : '—'}
        />
      </div>
      {error && status === 'FAILED' && (
        <div className='rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700'>
          <div className='font-medium'>Error</div>
          <div className='mt-0.5 whitespace-pre-wrap'>{error}</div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-[11px] uppercase tracking-wide text-muted-foreground'>{label}</span>
      <span className='text-sm text-foreground'>{value}</span>
    </div>
  );
}

function StepOutputs({ context }: { context: Record<string, unknown> }): React.ReactElement {
  const stepsRaw = (
    context && typeof context === 'object' && 'steps' in context
      ? (context as { steps?: unknown }).steps
      : null
  ) as Record<string, { input?: unknown; output?: unknown }> | null;

  if (!stepsRaw || Object.keys(stepsRaw).length === 0) {
    return (
      <div className='rounded-md border border-border bg-background p-5 text-sm text-muted-foreground'>
        No step outputs recorded yet.
      </div>
    );
  }

  return (
    <>
      {Object.entries(stepsRaw).map(([stepId, payload], i) => (
        <StepCard
          key={stepId}
          index={i + 1}
          stepId={stepId}
          input={payload?.input}
          output={payload?.output}
        />
      ))}
    </>
  );
}

function StepCard({
  index,
  stepId,
  input,
  output,
}: {
  index: number;
  stepId: string;
  input: unknown;
  output: unknown;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-3 rounded-md border border-border bg-background p-5'>
      <div className='flex items-start gap-3'>
        <div className='flex size-8 items-center justify-center rounded-md bg-accent/40'>
          <CheckCircle2 className='size-4 text-green-600' />
        </div>
        <div className='flex flex-col'>
          <span className='text-sm font-medium text-foreground'>Step {index}</span>
          <span className='font-mono text-[11px] text-muted-foreground'>{stepId}</span>
        </div>
      </div>
      <div className='grid grid-cols-1 gap-3 lg:grid-cols-2'>
        <div className='flex flex-col gap-1.5'>
          <span className='text-[11px] uppercase tracking-wide text-muted-foreground'>
            Resolved input
          </span>
          <pre className='max-h-[280px] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-foreground font-mono'>
            {input === undefined ? '— (no input recorded)' : prettyJson(input)}
          </pre>
        </div>
        <div className='flex flex-col gap-1.5'>
          <span className='text-[11px] uppercase tracking-wide text-muted-foreground'>Output</span>
          <pre className='max-h-[280px] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-foreground font-mono'>
            {output === undefined || output === null ? '— (no output)' : prettyJson(output)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  subtitle,
  json,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  json: unknown;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-3 rounded-md border border-border bg-background p-5'>
      <div className='flex items-start gap-3'>
        <div className='flex size-8 items-center justify-center rounded-md bg-accent/40'>
          {icon}
        </div>
        <div className='flex flex-col'>
          <span className='text-sm font-medium text-foreground'>{title}</span>
          {subtitle && (
            <span className='font-mono text-[11px] text-muted-foreground'>{subtitle}</span>
          )}
        </div>
      </div>
      <pre className='max-h-[280px] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-foreground font-mono'>
        {prettyJson(json)}
      </pre>
    </div>
  );
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
