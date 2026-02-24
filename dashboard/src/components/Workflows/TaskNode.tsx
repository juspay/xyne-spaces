import React from 'react';
import { Handle, NodeProps, Position } from '@juspay/blend-design-system';
import { RotateCcw, Clock, CheckCircle2, AlertCircle, Loader2, PauseCircle } from 'lucide-react';
import { NodeAction, WorkflowStatus } from './constants';

export interface NodeData {
  label: string;
  status?: WorkflowStatus;
  originalStatus?: WorkflowStatus;
  duration?: string;
  retries?: string | number;
  onAction?: (action: NodeAction) => void;
  onStepClick?: () => void;
}

type TaskNodeProps = NodeProps<NodeData>;

const TaskNode: React.FC<TaskNodeProps> = ({ id, data, type }) => {
  const nodeType = type ?? 'task';

  /** normalize status */
  const rawStatus = data.originalStatus || data.status || 'pending';
  const status = rawStatus.toLowerCase();

  /** Status style mappings */
  const STATUS_MAP: Record<string, { icon: React.ReactElement; label: string; style: string }> = {
    completed: {
      label: 'Done',
      icon: <CheckCircle2 size={12} className='text-emerald-600' />,
      style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    success: {
      label: 'Done',
      icon: <CheckCircle2 size={12} className='text-emerald-600' />,
      style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    failed: {
      label: 'Failed',
      icon: <AlertCircle size={12} className='text-red-600' />,
      style: 'bg-red-50 text-red-700 border-red-200',
    },
    running: {
      label: 'Running',
      icon: <Loader2 size={12} className='animate-spin text-blue-600' />,
      style: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    pending: {
      label: 'Pending',
      icon: <PauseCircle size={12} className='text-gray-500' />,
      style: 'bg-gray-50 text-gray-600 border-gray-200',
    },
  };

  const statusConfig = STATUS_MAP[status] ?? STATUS_MAP['pending'];
  const { icon, label, style } = statusConfig!;

  /** Restart available only for completed steps */
  const showRestart = status === 'completed' || status === 'success';

  return (
    <div className='flex flex-col items-center group select-none'>
      {/* CONNECT TOP */}
      {nodeType !== 'start' && (
        <Handle id={id} type='target' position={Position.Top} className='!opacity-0' />
      )}

      {/* CARD */}
      <div
        role='button'
        tabIndex={0}
        onClick={() => data.onStepClick?.()}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            data.onStepClick?.();
          }
        }}
        className='
          w-56 bg-white border border-gray-200 rounded-xl shadow-sm
          px-3 py-2 cursor-pointer hover:shadow-md transition-all relative
        '
        data-track-category='Workflows'
        data-track-name='SelectWorkflowStep'
        data-track-metadata={JSON.stringify({ stepId: id, stepLabel: data.label })}
      >
        <div className='flex items-start justify-between gap-2'>
          <div className='text-[13px] font-semibold text-gray-900 leading-snug whitespace-normal break-words flex-1'>
            {data.label}
          </div>

          <div
            className={`border text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0 flex items-center gap-1 ${style}`}
          >
            {icon}
            <span>{label}</span>
          </div>
        </div>

        {/* META */}
        <div className='flex items-center text-[11px] text-gray-500 gap-1 mt-1'>
          <Clock size={11} />
          {data.duration || '--'}
        </div>

        {/* HOVER RESTART BUTTON */}
        {showRestart && (
          <button
            onClick={e => {
              e.stopPropagation();
              data.onAction?.('restart');
            }}
            className='
              absolute -bottom-3 left-1/2 -translate-x-1/2
              bg-white shadow-md border border-gray-200 rounded-full p-1
              opacity-0 group-hover:opacity-100 transition
            '
            title='Restart this step'
            data-track-category='Workflows'
            data-track-name='RestartWorkflowStep'
            data-track-metadata={JSON.stringify({ stepId: id, stepLabel: data.label })}
          >
            <RotateCcw size={12} className='text-gray-600' />
          </button>
        )}
      </div>

      {/* CONNECT BOTTOM */}
      {nodeType !== 'end' && (
        <Handle id={id} type='source' position={Position.Bottom} className='!opacity-0' />
      )}
    </div>
  );
};

export default TaskNode;
