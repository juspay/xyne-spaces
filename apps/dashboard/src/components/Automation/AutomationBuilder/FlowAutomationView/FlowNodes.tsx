// Canvas node components. Presentational: every node renders from the `FlowNodeData`
// the view builds, has no click handler of its own (the canvas owns `onNodeClick`),
// and reads selection from React Flow's `selected` prop.
import type { ReactNode } from 'react';
import * as LucideIcons from 'lucide-react';
import { AlertTriangle, Box, GitBranch, ListTree, Plus, Zap, type LucideIcon } from 'lucide-react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { cn } from '../../../../utils/classNames';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import type { FlowNodeData } from './FlowAutomationView.types';
import { TRACK_CATEGORY } from './FlowAutomationView.utils';

function ResolveIcon({
  name,
  className,
  fallback = Box,
}: {
  name: string | undefined;
  className?: string;
  fallback?: LucideIcon;
}): React.ReactElement {
  const Icon = name
    ? (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name]
    : undefined;
  const IconComponent = Icon ?? fallback;
  return <IconComponent className={className} />;
}

/* ─────────────────────────────── Nodes ─────────────────────────────── */

/**
 * Shared node chrome. Selection comes from the `selected` prop that the view
 * derives from its own `selectedNodeId`; clicks are handled by `onNodeClick`
 * on the canvas, so the node body itself has no click handler.
 */
function NodeShell({
  data,
  selected,
  accent,
  trackingName,
  children,
}: {
  data: FlowNodeData;
  selected: boolean;
  accent: string;
  trackingName: string;
  children: ReactNode;
}): React.ReactElement {
  const issueCount = data.issueMessages.length;
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
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
        !selected && issueCount > 0 && 'ring-1 ring-destructive/40',
      )}
    >
      <Handle type='target' position={Position.Top} className='!opacity-0' isConnectable={false} />
      {children}
      {issueCount > 0 && (
        <span
          className='absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive'
          aria-label={`${issueCount} validation ${issueCount === 1 ? 'issue' : 'issues'}`}
        >
          <AlertTriangle className='size-3' aria-hidden='true' />
          {issueCount}
        </span>
      )}
      <Handle
        type='source'
        position={Position.Bottom}
        className='!opacity-0'
        isConnectable={false}
      />
    </div>
  );
}

function NodeHeader({
  icon,
  iconClassName,
  kicker,
  title,
}: {
  icon: ReactNode;
  iconClassName: string;
  kicker: string;
  title: string;
}): React.ReactElement {
  return (
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
          {kicker}
        </span>
        <span className='truncate text-sm font-semibold text-foreground'>{title}</span>
      </div>
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  const name = data.catalogItem?.name;
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-amber-500/40'
      trackingName='select-trigger-node'
    >
      <NodeHeader
        icon={<ResolveIcon name={data.catalogItem?.icon} fallback={Zap} className='size-4' />}
        iconClassName='bg-amber-500/10 text-amber-600 dark:text-amber-400'
        kicker='When this happens'
        title={name ?? 'Choose a trigger'}
      />
    </NodeShell>
  );
}

function ActionNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-border'
      trackingName='select-action-node'
    >
      <NodeHeader
        icon={<ResolveIcon name={data.catalogItem?.icon} className='size-4' />}
        iconClassName='bg-primary/10 text-primary'
        kicker={data.catalogItem?.category ?? 'Action'}
        title={data.item.label ?? 'Action'}
      />
    </NodeShell>
  );
}

function ConditionalNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-purple-500/40'
      trackingName='select-conditional-node'
    >
      <NodeHeader
        icon={<GitBranch className='size-4' />}
        iconClassName='bg-purple-500/10 text-purple-600 dark:text-purple-400'
        kicker='If / else'
        title='Condition'
      />
    </NodeShell>
  );
}

function SwitchNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-sky-500/40'
      trackingName='select-switch-node'
    >
      <NodeHeader
        icon={<ListTree className='size-4' />}
        iconClassName='bg-sky-500/10 text-sky-600 dark:text-sky-400'
        kicker='Switch'
        title='Route by case'
      />
    </NodeShell>
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
      <Handle type='target' position={Position.Top} className='!opacity-0' isConnectable={false} />
      {body}
      <Handle
        type='source'
        position={Position.Bottom}
        className='!opacity-0'
        isConnectable={false}
      />
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
      <Handle type='target' position={Position.Top} className='!opacity-0' isConnectable={false} />
      <Handle
        type='source'
        position={Position.Bottom}
        className='!opacity-0'
        isConnectable={false}
      />
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
