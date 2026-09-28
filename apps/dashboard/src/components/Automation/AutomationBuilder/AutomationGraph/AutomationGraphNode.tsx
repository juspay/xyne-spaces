import { createContext, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Box,
  CalendarClock,
  ChevronRight,
  CircleDashed,
  GitBranch,
  ListTree,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import type {
  AutoNodeData,
  AutoNodeKind,
  AutomationGraphContextValue,
} from './automationGraph.types';
import { NODE_HEIGHT, NODE_WIDTH } from './automationGraph.layout';

export const AutomationGraphContext = createContext<AutomationGraphContextValue | null>(null);

const useGraphContext = (): AutomationGraphContextValue => {
  const ctx = useContext(AutomationGraphContext);
  if (!ctx) throw new Error('AutomationGraphNode used outside AutomationGraphContext');
  return ctx;
};

type CardKind = Exclude<AutoNodeKind, 'add' | 'join'>;

const KIND_ICON: Record<CardKind, typeof Box> = {
  trigger: Zap,
  schedule: CalendarClock,
  conditions: SlidersHorizontal,
  action: Box,
  conditional: GitBranch,
  switch: ListTree,
  branchEmpty: CircleDashed,
};

/** Icon tile + left accent bar per kind; dark variants keep contrast under `midnight`. */
const KIND_ACCENT: Record<CardKind, { tile: string; bar: string }> = {
  trigger: {
    tile: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
  },
  schedule: { tile: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', bar: 'bg-sky-500' },
  conditions: {
    tile: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    bar: 'bg-violet-500',
  },
  action: { tile: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', bar: 'bg-blue-500' },
  conditional: {
    tile: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
  },
  switch: {
    tile: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
  },
  branchEmpty: { tile: 'bg-muted text-muted-foreground', bar: 'bg-transparent' },
};

const hiddenHandle = '!pointer-events-none !h-1 !w-1 !min-w-0 !border-0 !bg-transparent';

/**
 * A single canvas node. `add` nodes render the shared step picker
 * ({@link AddStepRow}); `join` nodes are the small reconvergence dot after a
 * Conditional / Switch; every other kind renders a compact, keyboard-operable
 * card whose selected / error / muted states are driven purely by props.
 */
export function AutomationGraphNode({ id, data }: NodeProps): React.ReactElement {
  const nodeData = data as AutoNodeData;
  const ctx = useGraphContext();

  if (nodeData.kind === 'add') {
    return (
      <div className='flex items-center justify-center' data-slot='automation-graph-add'>
        <Handle type='target' position={Position.Top} className={hiddenHandle} />
        <AddStepRow
          catalog={ctx.stepCatalog}
          onPick={type => ctx.onAddStep(type, nodeData.insertAt)}
          variant='compact'
        />
        <Handle type='source' position={Position.Bottom} className={hiddenHandle} />
      </div>
    );
  }

  if (nodeData.kind === 'join') {
    return (
      <div
        aria-hidden='true'
        title={nodeData.title}
        className='size-3 rounded-full border-2 border-border bg-background'
      >
        <Handle type='target' position={Position.Top} className={hiddenHandle} />
        <Handle type='source' position={Position.Bottom} className={hiddenHandle} />
      </div>
    );
  }

  const kind = nodeData.kind;
  const Icon = KIND_ICON[kind];
  const accent = KIND_ACCENT[kind];
  const selected = ctx.selectedNodeId === id;
  const isEmpty = kind === 'branchEmpty';
  const hasIssues = nodeData.issueCount > 0;
  const issueText = hasIssues
    ? `${nodeData.issueCount} issue${nodeData.issueCount === 1 ? '' : 's'} to fix`
    : '';
  const actionText = ctx.editMode ? 'Open to edit' : 'Open to view';

  const activate = (): void => {
    if (nodeData.interactive) ctx.onActivateNode(id, nodeData);
  };

  return (
    <div
      data-slot='automation-graph-node'
      data-node-kind={kind}
      data-track-category='automation-graph'
      data-track-name={`node-open-${kind}`}
      data-selected={selected || undefined}
      role={nodeData.interactive ? 'button' : undefined}
      tabIndex={nodeData.interactive ? 0 : -1}
      aria-pressed={nodeData.interactive ? selected : undefined}
      aria-label={[nodeData.kicker, nodeData.title, nodeData.subtitle, issueText, actionText]
        .filter(Boolean)
        .join('. ')}
      onClick={activate}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          activate();
        }
      }}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        'group relative flex items-center gap-3 overflow-hidden rounded-xl border px-3.5 text-left',
        'shadow-sm transition-[border-color,box-shadow,background-color] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        isEmpty ? 'border-dashed bg-background/60 shadow-none' : 'bg-card',
        nodeData.depth > 0 && !isEmpty && 'bg-card/90',
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/25'
          : hasIssues
            ? 'border-red-500/60 dark:border-red-400/60'
            : 'border-border',
        nodeData.interactive && 'cursor-pointer',
        nodeData.interactive && !selected && 'hover:border-foreground/30 hover:shadow-md',
      )}
    >
      <Handle type='target' position={Position.Top} className={hiddenHandle} />
      <span aria-hidden='true' className={cn('absolute inset-y-0 left-0 w-[3px]', accent.bar)} />
      <div
        aria-hidden='true'
        className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', accent.tile)}
      >
        <Icon className='size-[18px]' />
      </div>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'>
          {nodeData.kicker}
        </span>
        <span
          className={cn(
            'truncate text-sm font-medium leading-5',
            isEmpty ? 'text-muted-foreground' : 'text-foreground',
          )}
          title={nodeData.title}
        >
          {nodeData.title}
        </span>
        {nodeData.subtitle && (
          <span
            className='truncate text-xs leading-4 text-muted-foreground'
            title={nodeData.subtitle}
          >
            {nodeData.subtitle}
          </span>
        )}
      </div>
      {hasIssues ? (
        <span
          className='flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400'
          title={issueText}
        >
          <AlertTriangle className='size-3' aria-hidden='true' />
          {nodeData.issueCount}
        </span>
      ) : nodeData.interactive ? (
        <ChevronRight
          aria-hidden='true'
          className={cn(
            'size-4 shrink-0 text-muted-foreground/60 transition-opacity',
            selected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
        />
      ) : null}
      <Handle type='source' position={Position.Bottom} className={hiddenHandle} />
    </div>
  );
}
