import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Archive, GitFork, Ticket as TicketIcon } from 'lucide-react';
import type { FlowPlanNode } from '@xyne/shared';
import { getStatusOption } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import { isFlowStepBacklogged, type FlowRunTicket } from './flowRun.utils';
import { FlowGroupNode } from './FlowGroupNode';
import Tooltip from '../../ui/Tooltip';

export interface FlowTicketNodeData {
  planNode: FlowPlanNode | null; // null = the run's main ticket node
  ticket: FlowRunTicket | null; // null = ghost (not yet instantiated)
  skipped: boolean;
  skipReason?: 'decision' | 'blocked';
  decision?: {
    fieldName: string;
    selectedLabel?: string;
  };
  onSelect: () => void;
}

export const FlowTicketNodeCard: React.FC<NodeProps<FlowTicketNodeData>> = ({ data, selected }) => {
  const { planNode, ticket, skipped, decision, onSelect } = data;
  const isRoot = planNode === null;
  const isGhost = !ticket;
  const backlogged = !isRoot && isFlowStepBacklogged(ticket);
  const statusOption = ticket && !backlogged ? getStatusOption(ticket.statusV2) : null;

  return (
    <div
      className={`w-[240px] overflow-hidden bg-background rounded-[10px] border-2 shadow-[0px_2px_8px_0px_rgba(5,5,6,0.07)] transition-all cursor-pointer ${
        decision?.selectedLabel
          ? 'border-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]'
          : decision
            ? 'border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.12)]'
            : selected
              ? 'border-[#6276be]'
              : isGhost
                ? 'border-dashed border-border'
                : isRoot
                  ? 'border-[#6276be]/50'
                  : 'border-border'
      } ${selected && decision ? 'outline outline-2 outline-offset-2 outline-[#6276be]/60' : ''} ${isGhost ? 'opacity-80' : ''}`}
    >
      {!isRoot && (
        <Handle
          type='target'
          position={Position.Top}
          isConnectable={false}
          className='!w-3 !h-3 !bg-[#6276be] !border-2 !border-background !rounded-full'
          style={{ top: -7 }}
        />
      )}
      <Handle
        type='source'
        position={Position.Bottom}
        isConnectable={false}
        className='!w-3 !h-3 !bg-[#6276be] !border-2 !border-background !rounded-full'
        style={{ bottom: -7 }}
      />

      <button
        type='button'
        onClick={onSelect}
        data-track-category='flow_board'
        data-track-name='select_flow_step'
        className='block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
      >
        <span className='flex items-center justify-between px-3 py-2 border-b border-border'>
          <span className='flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.5px]'>
            <TicketIcon size={12} className='text-[#6276be]' />
            {isRoot ? 'Main ticket' : ticket ? ticket.xyneId : 'Sub ticket'}
          </span>
          {backlogged ? (
            <span className='flex items-center gap-1 text-[11px] font-medium text-amber-600'>
              <Archive size={12} />
              Backlog
            </span>
          ) : ticket && statusOption ? (
            <span className='flex items-center gap-1 text-[11px] font-medium text-muted-foreground'>
              {statusOption.icon}
              {statusOption.label}
            </span>
          ) : (
            <span className='text-[10px] font-medium text-muted-foreground uppercase tracking-[0.5px]'>
              {isRoot ? 'No run' : skipped ? 'Skipped' : 'To Do'}
            </span>
          )}
        </span>

        <span className='px-3 py-3 flex items-center gap-2'>
          {isRoot && !ticket ? (
            <span className='flex-1 text-[12px] text-muted-foreground leading-[18px]'>
              Create a ticket to begin — steps below are created as the run progresses.
            </span>
          ) : (
            <Tooltip
              content={ticket?.title ?? planNode?.title ?? 'Main ticket'}
              side='top'
              delayDuration={300}
            >
              <span
                className={`flex-1 text-[13px] font-medium leading-[18px] truncate ${
                  isGhost ? 'text-muted-foreground' : 'text-foreground'
                }`}
              >
                {ticket?.title ?? planNode?.title ?? 'Main ticket'}
              </span>
            </Tooltip>
          )}
        </span>
        {decision && (
          <span
            className={`flex items-center gap-1.5 border-t px-3 py-1.5 text-[10px] font-medium ${
              decision.selectedLabel
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
            }`}
          >
            <GitFork size={11} className='shrink-0' />
            <span className='truncate'>{decision.fieldName}</span>
            <span className='ml-auto shrink-0 font-semibold'>
              {decision.selectedLabel ?? 'Waiting for answer'}
            </span>
          </span>
        )}
      </button>
    </div>
  );
};

export const FLOW_NODE_TYPES = {
  flowTicketNode: FlowTicketNodeCard,
  flowGroupNode: FlowGroupNode,
};
