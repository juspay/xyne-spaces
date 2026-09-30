import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Hourglass,
  LayoutGrid,
  List,
  Loader2,
  XCircle,
} from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { useCopyButton } from '../../../../hooks/useCopyButton';
import {
  fetchAutomationRun,
  fetchAutomationVersions,
  fetchStepCatalog,
  fetchTriggerCatalog,
  type RunDetail as RunDetailData,
} from '../../../../api/automationsApi';
import { CONDITIONAL_STEP_TYPE, SWITCH_STEP_TYPE } from '../../Automation.types';
import type { AutomationConfig, AutomationRunStatus } from '../../Automation.types';
import { FlowAutomationView } from '../../AutomationBuilder/FlowAutomationView/FlowAutomationView';
import type {
  FlowItem,
  FlowRunOverlay,
} from '../../AutomationBuilder/FlowAutomationView/FlowAutomationView.types';
import { stepNameForPath } from '../../AutomationBuilder/FlowAutomationView/FlowAutomationView.utils';
import type { RunDetailProps } from './RunDetail.types';

const noop = (): void => undefined;
// Only used by the builder side panel, which the run overlay replaces.
const renderNothing = (): React.ReactElement => <></>;

const VIEW_OPTIONS = [
  { mode: 'list', label: 'List view', Icon: List },
  { mode: 'flow', label: 'Flow view', Icon: LayoutGrid },
] as const;

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

  const [view, setView] = useState<'list' | 'flow'>('list');
  // Step rows are named by position, so draw the version that actually ran —
  // not the automation's current config. Query keys match the builder's.
  const versionsQuery = useQuery({
    queryKey: ['automation-versions', run?.automationId],
    queryFn: () => fetchAutomationVersions(run?.automationId ?? ''),
    enabled: Boolean(run?.automationId),
  });
  const triggerCatalogQuery = useQuery({
    queryKey: ['automations', 'schema', 'triggers'],
    queryFn: fetchTriggerCatalog,
  });
  const stepCatalogQuery = useQuery({
    queryKey: ['automations', 'schema', 'steps'],
    queryFn: fetchStepCatalog,
  });
  const ranConfig: AutomationConfig | null =
    versionsQuery.data?.find(v => v.id === run?.automationId)?.config ?? null;
  const canShowFlow = ranConfig !== null;

  const runOverlay = useMemo<FlowRunOverlay | undefined>(
    () => (data ? buildRunOverlay(data) : undefined),
    [data],
  );
  const showFlow = view === 'flow' && canShowFlow && runOverlay !== undefined;

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
        {canShowFlow && (
          <div className='ml-auto flex items-center rounded-md border border-border p-0.5'>
            {VIEW_OPTIONS.map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type='button'
                aria-label={label}
                aria-pressed={view === mode}
                data-track-category='automation-runs'
                data-track-name={`run-detail-${mode}-view`}
                onClick={() => setView(mode)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground',
                  view === mode && 'bg-accent text-foreground',
                )}
              >
                <Icon className='size-4' aria-hidden='true' />
              </button>
            ))}
          </div>
        )}
      </div>

      {showFlow && ranConfig && runOverlay && (
        <FlowAutomationView
          config={ranConfig}
          onConfigChange={noop}
          onTriggerTypeChange={noop}
          onTriggerConfigChange={noop}
          onScheduleChange={noop}
          triggerCatalog={triggerCatalogQuery.data ?? []}
          triggerSchema={null}
          stepCatalog={stepCatalogQuery.data ?? []}
          stepSchemaCache={{}}
          schemaLoadingFor={() => false}
          triggerSchemaLoading={false}
          ensureSchema={noop}
          operators={[]}
          validation={null}
          readOnly
          editMode={false}
          onAddStep={() => ''}
          renderConditionalCard={renderNothing}
          renderSwitchCard={renderNothing}
          runOverlay={runOverlay}
        />
      )}

      <div className={cn('flex-1 overflow-y-auto', showFlow && 'hidden')}>
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

type ContextSteps = Record<string, { input?: unknown; output?: unknown }>;

function readContextSteps(context: Record<string, unknown>): ContextSteps | null {
  return (
    context && typeof context === 'object' && 'steps' in context
      ? (context as { steps?: unknown }).steps
      : null
  ) as ContextSteps | null;
}

function StepOutputs({ context }: { context: Record<string, unknown> }): React.ReactElement {
  const stepsRaw = readContextSteps(context);

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
  title,
  error,
  stacked = false,
  status,
}: {
  index: number;
  stepId: string;
  input: unknown;
  output: unknown;
  /** Replaces "Step {index}" (the flow panel passes the step's name). */
  title?: string;
  error?: string | undefined;
  /** Single column, for the narrow flow side panel. */
  stacked?: boolean;
  /** The flow panel's resolved step status; the list view leaves it unset. */
  status?: string | null;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-3 rounded-md border border-border bg-background p-5'>
      <div className='flex items-start gap-3'>
        <div className='flex size-8 items-center justify-center rounded-md bg-accent/40'>
          {error || status === 'FAILED' ? (
            <XCircle className='size-4 text-red-600' />
          ) : status === undefined || status === 'COMPLETED' ? (
            <CheckCircle2 className='size-4 text-green-600' />
          ) : status === 'EXTERNAL_WAIT' ? (
            <Hourglass className='size-4 text-purple-600' />
          ) : status === 'RUNNING' ? (
            <Loader2 className='size-4 animate-spin text-blue-600' />
          ) : (
            <XCircle className='size-4 text-muted-foreground' />
          )}
        </div>
        <div className='flex flex-col'>
          <span className='text-sm font-medium text-foreground'>{title ?? `Step ${index}`}</span>
          <span className='font-mono text-[11px] text-muted-foreground'>{stepId}</span>
        </div>
      </div>
      {error && (
        <div className='whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700'>
          {error}
        </div>
      )}
      <div className={cn('grid grid-cols-1 gap-3', !stacked && 'lg:grid-cols-2')}>
        <div className='flex flex-col gap-1.5'>
          <span className='text-[11px] uppercase tracking-wide text-muted-foreground'>
            Resolved input
          </span>
          <JsonBlock
            text={input === undefined ? null : prettyJson(input)}
            placeholder='— (no input recorded)'
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <span className='text-[11px] uppercase tracking-wide text-muted-foreground'>Output</span>
          <JsonBlock
            text={output === undefined || output === null ? null : prettyJson(output)}
            placeholder='— (no output)'
          />
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
      <JsonBlock text={prettyJson(json)} />
    </div>
  );
}

/** A JSON `<pre>` with a copy button; `placeholder` shows (uncopyable) when `text` is null. */
function JsonBlock({
  text,
  placeholder,
}: {
  text: string | null;
  placeholder?: string;
}): React.ReactElement {
  const { copied, copy } = useCopyButton();
  return (
    <div className='relative'>
      <pre className='max-h-[280px] overflow-auto rounded-md border border-border bg-muted/40 p-3 pr-9 text-[11px] leading-relaxed text-foreground font-mono'>
        {text ?? placeholder}
      </pre>
      {text !== null && (
        <button
          type='button'
          aria-label='Copy JSON'
          title='Copy JSON'
          onClick={() => copy(text)}
          data-track-category='automation-runs'
          data-track-name='run-detail-copy-json'
          className='absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground'
        >
          {copied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
        </button>
      )}
    </div>
  );
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED', 'SKIPPED']);

/**
 * A step row's status, corrected by the run's: rows left RUNNING/EXTERNAL_WAIT by a
 * nested pause or a cancel/fail outside the walk would otherwise show a live badge.
 * CANCELLED means the step started but never finished.
 */
function resolveStepStatus(rowStatus: string, runStatus: AutomationRunStatus): string {
  if (rowStatus !== 'RUNNING' && rowStatus !== 'EXTERNAL_WAIT') return rowStatus;
  if (runStatus === 'EXTERNAL_WAIT') return 'EXTERNAL_WAIT';
  if (runStatus === 'FAILED') return 'FAILED';
  return TERMINAL_RUN_STATUSES.has(runStatus) ? 'CANCELLED' : rowStatus;
}

/** A nested row name, e.g. `step_1__case_0__step_2` → owner `step_1`, branch `case_0`. */
const NESTED_STEP_NAME = /^(.*)__(if_true|if_false|default|case_\d+)__step_\d+$/;

/** Node statuses + side panel for the flow view, from the run's step rows and context. */
function buildRunOverlay({ run, steps }: RunDetailData): FlowRunOverlay {
  const statusByStepName: Record<string, string> = {};
  const errorByStepName: Record<string, string> = {};
  const takenBranchByStepName: Record<string, string> = {};
  for (const row of steps) {
    if (!row.stepName || !row.status) continue;
    statusByStepName[row.stepName] = resolveStepStatus(row.status, run.status);
    const data = row.data as { type?: unknown; output?: unknown; error?: unknown } | null;
    // markStepFailed stores the message on the row, not in the run context.
    if (typeof data?.error === 'string') errorByStepName[row.stepName] = data.error;
    // A finished If/Switch records its branch (conditional.step.ts / switch.step.ts)…
    const output = data?.output as { result?: unknown; matchedIndex?: unknown } | undefined;
    if (data?.type === CONDITIONAL_STEP_TYPE && typeof output?.result === 'boolean') {
      takenBranchByStepName[row.stepName] = output.result ? 'if_true' : 'if_false';
    } else if (data?.type === SWITCH_STEP_TYPE && typeof output?.matchedIndex === 'number') {
      takenBranchByStepName[row.stepName] =
        output.matchedIndex >= 0 ? `case:${output.matchedIndex}` : 'default';
    }
    // …one still running, paused or failed inside a branch only shows it via its nested rows.
    const nested = NESTED_STEP_NAME.exec(row.stepName);
    if (nested?.[1] && nested[2]) {
      takenBranchByStepName[nested[1]] ??= nested[2].replace(/^case_/, 'case:');
    }
  }
  const contextSteps = readContextSteps(run.context) ?? {};

  const renderPanel = (item: FlowItem | null): React.ReactNode => {
    if (!item) {
      return (
        <div className='flex flex-col gap-3'>
          <SummaryCard
            startedAt={run.startedAt}
            completedAt={run.completedAt}
            error={run.error}
            status={run.status}
          />
          <p className='text-xs text-muted-foreground'>
            Select a step to see its input and output. Faded steps did not run.
          </p>
        </div>
      );
    }
    if (item.nodeType === 'trigger') {
      return (
        <SectionCard
          icon={<CheckCircle2 className='size-4 text-amber-600' />}
          title='Trigger payload'
          subtitle='What fired the run.'
          json={run.triggerData}
        />
      );
    }
    if (!item.step) return null;
    const stepName = stepNameForPath(item.path);
    const title =
      item.label ??
      (item.nodeType === 'conditional' ? 'Condition' : item.nodeType === 'switch' ? 'Switch' : '');
    const status = statusByStepName[stepName];
    if (!status) {
      return (
        <div className='rounded-md border border-border bg-background p-5 text-sm text-muted-foreground'>
          {title || 'This step'} did not run.
        </div>
      );
    }
    const payload = contextSteps[item.step.id];
    return (
      <StepCard
        index={0}
        title={title}
        stepId={item.step.id}
        input={payload?.input}
        output={payload?.output}
        error={errorByStepName[stepName]}
        status={status}
        stacked
      />
    );
  };

  return { statusByStepName, takenBranchByStepName, renderPanel };
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
