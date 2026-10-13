import type { ReactNode } from 'react';
import {
  Box,
  CheckCircle2,
  GitBranch,
  Hourglass,
  ListTree,
  Loader2,
  Plus,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { cn } from '../../../../utils/classNames';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import { DiffBadge } from '../DiffHighlight/DiffBadge';
import {
  SCHEDULE_DIFF_KEY,
  TRIGGER_DIFF_KEY,
  diffHighlightClass,
  useDiffMark,
} from '../DiffHighlight/DiffHighlight';
import { ResolveIcon } from '../TriggerCard/TriggerCard';
import { StepIssueBadge } from '../ValidationBanner/StepIssueBadge';
import type { FlowNodeData } from './FlowAutomationView.types';
import { TRACK_CATEGORY } from './FlowAutomationView.utils';

/** Run view: step-row status (see the executor's markStep* helpers) → badge. */
function RunStatusBadge({ status }: { status: string }): React.ReactElement {
  const [Icon, className, label]: [LucideIcon, string, string] =
    status === 'COMPLETED'
      ? [CheckCircle2, 'text-green-600', 'Completed']
      : status === 'FAILED'
        ? [XCircle, 'text-red-600', 'Failed']
        : status === 'EXTERNAL_WAIT'
          ? [Hourglass, 'text-purple-600', 'Waiting']
          : status === 'CANCELLED'
            ? [XCircle, 'text-muted-foreground', 'Stopped']
            : [Loader2, 'animate-spin text-blue-600', 'Running'];
  return (
    <span className='absolute right-2 top-2' title={label} aria-label={label}>
      <Icon className={cn('size-4', className)} aria-hidden='true' />
    </span>
  );
}

// Invisible anchors the edges attach to; nodes are never connected by hand.
const TARGET_HANDLE = (
  <Handle type='target' position={Position.Top} className='!opacity-0' isConnectable={false} />
);
const SOURCE_HANDLE = (
  <Handle type='source' position={Position.Bottom} className='!opacity-0' isConnectable={false} />
);

/**
 * Shared chrome for trigger and step nodes: icon, kicker and title. Selection
 * comes from React Flow's `selected` prop; clicks are handled on the canvas.
 */
function NodeShell({
  data,
  selected,
  accent,
  trackingName,
  icon,
  iconClassName,
  kicker,
  title,
}: {
  data: FlowNodeData;
  selected: boolean;
  accent: string;
  trackingName: string;
  icon: ReactNode;
  iconClassName: string;
  kicker: string;
  title: string;
}): React.ReactElement {
  const issueCount = data.issueMessages.length;
  // Version review/compare: the same marks the List cards and sections show.
  const isTrigger = data.item.nodeType === 'trigger';
  const ownDiff = useDiffMark(isTrigger ? TRIGGER_DIFF_KEY : (data.item.step?.id ?? ''));
  const scheduleDiff = useDiffMark(isTrigger ? SCHEDULE_DIFF_KEY : '');
  const diff = ownDiff ?? scheduleDiff;
  return (
    <div
      data-track-category={TRACK_CATEGORY}
      data-track-name={trackingName}
      title={issueCount ? data.issueMessages.join('\n') : undefined}
      className={cn(
        'relative flex h-full w-full cursor-pointer flex-col gap-1 overflow-hidden rounded-lg border bg-background px-3 py-2.5 text-left shadow-sm transition-shadow',
        'hover:shadow-md',
        accent,
        issueCount > 0 && 'border-destructive/60',
        !selected && issueCount > 0 && 'ring-1 ring-destructive/40',
        diff && diffHighlightClass(diff),
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
        data.runStatus === 'FAILED' && 'border-red-500/60',
        data.runStatus === null && 'opacity-50',
      )}
    >
      {TARGET_HANDLE}
      <div className='flex min-w-0 items-center gap-2.5 pr-8'>
        <div
          className={cn(
            'flex size-8 flex-shrink-0 items-center justify-center rounded-md',
            iconClassName,
          )}
        >
          {icon}
        </div>
        <div className='flex min-w-0 flex-col'>
          <span className='truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            {/* "Step 2.1 · Messaging": the same number as the List view's card. */}
            {data.stepNumber ? `Step ${data.stepNumber} · ${kicker}` : kicker}
          </span>
          <span className='truncate text-sm font-semibold text-foreground'>{title}</span>
        </div>
      </div>
      {data.runStatus && <RunStatusBadge status={data.runStatus} />}
      {issueCount > 0 && (
        <StepIssueBadge messages={data.issueMessages} className='absolute right-2 top-2' />
      )}
      {diff && (
        <span className='absolute bottom-1 right-2'>
          <DiffBadge diff={diff} />
        </span>
      )}
      {SOURCE_HANDLE}
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-amber-500/40'
      trackingName='select-trigger-node'
      icon={<ResolveIcon name={data.catalogItem?.icon} className='size-4' />}
      iconClassName='bg-amber-500/10 text-amber-600 dark:text-amber-400'
      kicker='When this happens'
      title={data.catalogItem?.name ?? 'Choose a trigger'}
    />
  );
}

function ActionNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-border'
      trackingName='select-action-node'
      icon={<ResolveIcon name={data.catalogItem?.icon} fallback={Box} className='size-4' />}
      iconClassName='bg-primary/10 text-primary'
      kicker={data.catalogItem?.category ?? 'Action'}
      title={data.item.label ?? 'Action'}
    />
  );
}

function ConditionalNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-purple-500/40'
      trackingName='select-conditional-node'
      icon={<GitBranch className='size-4' />}
      iconClassName='bg-purple-500/10 text-purple-600 dark:text-purple-400'
      kicker='If / else'
      title='Condition'
    />
  );
}

function SwitchNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-sky-500/40'
      trackingName='select-switch-node'
      icon={<ListTree className='size-4' />}
      iconClassName='bg-sky-500/10 text-sky-600 dark:text-sky-400'
      kicker='Switch'
      title='Route by case'
    />
  );
}

/** Dashed "add step" slot: empty branches and the end of the main flow. */
function PlaceholderNode({ data }: NodeProps<FlowNodeData>): React.ReactElement {
  const insert = data.item.insert;
  const isEnd = data.item.id === 'add:root';
  const text = isEnd ? 'Add step' : `${data.item.label ?? 'Branch'}: add step`;
  const className = cn(
    'nodrag nopan flex h-full w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background/60 text-xs text-muted-foreground transition-colors',
    'hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );
  let body: ReactNode;
  if (!insert || (data.readOnly && !data.onRequestEdit)) {
    body = (
      <div
        className={cn(className, 'cursor-default hover:border-border hover:text-muted-foreground')}
      >
        {isEnd ? 'End' : `${data.item.label ?? 'Branch'}: no steps`}
      </div>
    );
  } else if (data.readOnly) {
    body = (
      <button
        type='button'
        className={className}
        data-track-category={TRACK_CATEGORY}
        data-track-name='placeholder-request-edit'
        onClick={() => data.onRequestEdit?.()}
      >
        <Plus className='size-3.5' aria-hidden='true' />
        {text}
      </button>
    );
  } else {
    body = (
      <AddStepRow
        catalog={data.stepCatalog}
        onPick={type => data.onInsert(insert, type)}
        trigger={
          <button
            type='button'
            className={className}
            aria-haspopup='listbox'
            data-track-category={TRACK_CATEGORY}
            data-track-name={isEnd ? 'add-step-end' : 'add-step-empty-branch'}
          >
            <Plus className='size-3.5' aria-hidden='true' />
            {text}
          </button>
        }
      />
    );
  }
  return (
    <div className='h-full w-full'>
      {TARGET_HANDLE}
      {body}
      {SOURCE_HANDLE}
    </div>
  );
}

/** Where branches rejoin. Purely visual: not selectable, focusable, or announced. */
function MergeNode(): React.ReactElement {
  return (
    <div
      aria-hidden='true'
      className='flex size-3 items-center justify-center rounded-full border border-border bg-muted'
    >
      {TARGET_HANDLE}
      {SOURCE_HANDLE}
    </div>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  conditional: ConditionalNode,
  switch: SwitchNode,
  merge: MergeNode,
  placeholder: PlaceholderNode,
};
