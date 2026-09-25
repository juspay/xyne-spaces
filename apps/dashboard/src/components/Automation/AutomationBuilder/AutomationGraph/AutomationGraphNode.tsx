import { createContext, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Box,
  CalendarClock,
  GitBranch,
  ListTree,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import type { AutoNodeData, AutomationGraphContextValue } from './automationGraph.types';

export const AutomationGraphContext = createContext<AutomationGraphContextValue | null>(null);

const useGraphContext = (): AutomationGraphContextValue => {
  const ctx = useContext(AutomationGraphContext);
  if (!ctx) throw new Error('AutomationGraphNode used outside AutomationGraphContext');
  return ctx;
};

const KIND_ICON = {
  trigger: Zap,
  schedule: CalendarClock,
  conditions: SlidersHorizontal,
  action: Box,
  conditional: GitBranch,
  switch: ListTree,
  branchEmpty: Box,
  add: Box,
} as const;

const KIND_ACCENT: Record<string, string> = {
  trigger: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  schedule: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  conditions: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  action: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  conditional: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  switch: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  branchEmpty: 'bg-muted text-muted-foreground',
};

/**
 * A single canvas node. `add` nodes render the shared step picker
 * ({@link AddStepRow}); every other kind renders a compact card whose selected
 * / error / muted states are driven purely by props so the same component works
 * for spine and nested branch nodes.
 */
export function AutomationGraphNode({ id, data }: NodeProps): React.ReactElement {
  const nodeData = data as AutoNodeData;
  const ctx = useGraphContext();

  if (nodeData.kind === 'add') {
    return (
      <div className='flex items-center justify-center'>
        <Handle type='target' position={Position.Top} className='!opacity-0' />
        <AddStepRow
          catalog={ctx.stepCatalog}
          onPick={type => ctx.onAddStep(type, nodeData.insertAt)}
          variant='compact'
        />
        <Handle type='source' position={Position.Bottom} className='!opacity-0' />
      </div>
    );
  }

  const Icon = KIND_ICON[nodeData.kind] ?? Box;
  const selected = ctx.selectedNodeId === id;
  const isEmpty = nodeData.kind === 'branchEmpty';

  return (
    <div
      data-slot='automation-graph-node'
      data-node-kind={nodeData.kind}
      style={{ width: 264 }}
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-background px-3.5 py-3 text-left shadow-sm transition-colors',
        selected ? 'border-foreground ring-2 ring-foreground/30' : 'border-border',
        nodeData.hasError && !selected && 'border-red-500/60',
        isEmpty && 'border-dashed opacity-80',
        nodeData.interactive && 'hover:border-foreground/50',
        nodeData.depth > 0 && 'bg-muted/30',
      )}
    >
      <Handle
        type='target'
        position={Position.Top}
        className='!h-2 !w-2 !border-border !bg-muted'
      />
      <div
        aria-hidden='true'
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          KIND_ACCENT[nodeData.kind] ?? 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className='size-4' />
      </div>
      <div className='flex min-w-0 flex-col'>
        {nodeData.category && (
          <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            {nodeData.category}
          </span>
        )}
        <span className='truncate text-sm font-medium text-foreground'>{nodeData.title}</span>
        {nodeData.subtitle && (
          <span className='truncate text-xs text-muted-foreground'>{nodeData.subtitle}</span>
        )}
      </div>
      {nodeData.hasError && (
        <AlertTriangle className='ml-auto size-4 shrink-0 text-red-500' aria-hidden='true' />
      )}
      <Handle
        type='source'
        position={Position.Bottom}
        className='!h-2 !w-2 !border-border !bg-muted'
      />
    </div>
  );
}
