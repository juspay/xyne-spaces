import React, { useContext, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '@xyne/icons';
import type { AgentChange, AgentUpdateProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../../FlowContext';
import { cn } from '../../../../utils/classNames';
import { computeLineDiff, lineDiffStats } from '../../../../utils/lineDiff';
import { CardShell, StatusChip } from '../cardPrimitives';
import { InsideAgentPreviewContext } from './AgentPreview';

const PromptDiff: React.FC<{ before: string; after: string }> = ({ before, after }) => {
  const rows = useMemo(() => computeLineDiff(before, after), [before, after]);
  const stats = lineDiffStats(rows);

  return (
    <div className='flex flex-col gap-1.5'>
      <span className='flex items-center gap-2 text-xs leading-4'>
        <span className='text-emerald-600 dark:text-emerald-400'>+{stats.added}</span>
        <span className='text-destructive'>−{stats.removed}</span>
      </span>
      <div className='max-h-60 overflow-auto rounded-lg border border-border bg-muted/30 py-1'>
        <div className='flex flex-col font-mono text-xs leading-5'>
          {rows.map((row, index) => (
            <span
              key={`${row.type}-${index}`}
              className={cn(
                'whitespace-pre-wrap break-words px-2',
                row.type === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                row.type === 'del' && 'bg-destructive/10 text-destructive',
                row.type === 'eq' && 'text-muted-foreground',
              )}
            >
              <span className='select-none opacity-60' aria-hidden>
                {row.type === 'add' ? '+ ' : row.type === 'del' ? '− ' : '  '}
              </span>
              {row.text || ' '}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const ToolList: React.FC<{ label: string; tools: string[]; tone: 'add' | 'del' }> = ({
  label,
  tools,
  tone,
}) => (
  <div className='flex flex-wrap items-center gap-1.5'>
    <span className='text-xs leading-5 text-muted-foreground'>{label}</span>
    {tools.map(tool => (
      <span
        key={tool}
        className={cn(
          'rounded px-1.5 py-px text-xs font-medium leading-[18px]',
          tone === 'add'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'bg-destructive/10 text-destructive',
        )}
      >
        {tool}
      </span>
    ))}
  </div>
);

const ChangeValue: React.FC<{ change: AgentChange }> = ({ change }) => {
  if (change.field === 'systemPrompt') {
    return <PromptDiff before={change.before ?? ''} after={change.after ?? ''} />;
  }
  if (change.field === 'tools') {
    return (
      <div className='flex flex-col gap-1'>
        {change.added && <ToolList label='Added' tools={change.added} tone='add' />}
        {change.removed && <ToolList label='Removed' tools={change.removed} tone='del' />}
      </div>
    );
  }
  return (
    <div className='flex flex-col gap-0.5 text-sm leading-5'>
      <span className='break-words text-muted-foreground line-through'>
        {change.before ?? 'Not set'}
      </span>
      <span className='break-words text-foreground'>{change.after ?? 'Not set'}</span>
    </div>
  );
};

export const UpdateAgentCard: React.FC<{ node: FlowComponent; props: AgentUpdateProps }> = ({
  node,
  props,
}) => {
  const { state, executeAction } = useFlow();
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null);
  const insidePreview = useContext(InsideAgentPreviewContext);
  const locked = state.submitting || pending !== null;

  const submit = async (actionId: 'approve-write' | 'decline-write'): Promise<void> => {
    if (locked) {
      return;
    }
    setPending(actionId === 'approve-write' ? 'approve' : 'decline');
    try {
      await executeAction({ type: 'submit', actionId });
    } finally {
      setPending(null);
    }
  };

  const ghostButton = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-[10px] px-2.5',
    'text-sm font-semibold leading-5 text-foreground',
    'hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60',
  );
  const primaryButton = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5',
    'text-sm font-semibold leading-5 text-foreground',
    'hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60',
  );

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 rounded-b-[11px] border-b border-border bg-card/80 p-3'>
        <div className='flex h-6 items-center gap-1.5 pl-1'>
          <div className='flex min-w-0 flex-1 items-center gap-1.5'>
            <span className='text-sm font-semibold leading-5 tracking-[-0.5px] text-muted-foreground'>
              Agent
            </span>
            <StatusChip label='Update' tone='muted' />
          </div>
          {!insidePreview && (
            <Link
              to={`/ai/library/agent/${encodeURIComponent(props.agent.slug)}?tab=persona`}
              className='shrink-0 rounded-[10px] px-2 py-1 text-sm font-medium leading-5 !text-muted-foreground !no-underline transition-colors hover:bg-accent hover:!text-foreground'
              data-track-category='AGENT_ARTIFACT'
              data-track-name='VIEW_AGENT_FROM_UPDATE_CARD'
            >
              View
            </Link>
          )}
        </div>

        <div className='flex flex-col gap-3'>
          <div className='flex min-w-0 flex-col gap-1 pl-1'>
            <p className='break-words text-sm font-semibold leading-5 text-foreground'>
              {props.agent.name}
            </p>
            <span className='block truncate text-sm font-normal leading-5 tracking-[-0.07px] text-foreground'>
              @{props.agent.slug}
            </span>
          </div>

          {props.summary && (
            <span className='block break-words px-1 text-sm leading-5 text-foreground'>
              {props.summary}
            </span>
          )}

          {props.changes.map(change => (
            <div key={change.field} className='flex min-w-0 flex-col gap-1 px-1'>
              <span className='text-sm font-semibold leading-5 text-foreground'>
                {change.label}
              </span>
              <ChangeValue change={change} />
            </div>
          ))}

          {props.note && (
            <span className='block break-words px-1 text-xs leading-4 text-muted-foreground'>
              {props.note}
            </span>
          )}
        </div>
      </div>

      <div className='flex min-h-[44px] items-center justify-end gap-2 px-3 py-2'>
        <button
          type='button'
          onClick={() => void submit('decline-write')}
          disabled={locked}
          className={ghostButton}
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_DECLINE_UPDATE'
          data-ph-capture-attribute-track-id='agent_update_decline'
        >
          {pending === 'decline' && <Spinner size={14} className='animate-spin' />}
          {pending === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button
          type='button'
          onClick={() => void submit('approve-write')}
          disabled={locked}
          className={primaryButton}
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_APPROVE_UPDATE'
          data-ph-capture-attribute-track-id='agent_update_approve'
        >
          {pending === 'approve' && <Spinner size={14} className='animate-spin' />}
          {pending === 'approve' ? 'Applying…' : 'Apply changes'}
        </button>
      </div>
    </CardShell>
  );
};
