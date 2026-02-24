import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Bot, PlayCircle } from 'lucide-react';

interface BotCardProps {
  workflowId: string;
  workflowName: string;
  workflowType: string;
  ticketId?: string;
  status?: string;
}

export const BotCard: React.FC<BotCardProps> = ({
  workflowId,
  workflowName,
  workflowType,
  ticketId,
  status = 'NEW',
}) => {
  const navigate = useNavigate();
  const handleWorkflowClick = (): void => {
    if (ticketId) {
      void navigate(`/tickets/${ticketId}/workflow`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleWorkflowClick();
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status.toUpperCase()) {
      case 'RUNNING':
        return 'text-blue-600 bg-blue-50';
      case 'COMPLETED':
        return 'text-green-600 bg-green-50';
      case 'FAILED':
        return 'text-red-600 bg-red-50';
      case 'PAUSED':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getWorkflowTypeDisplay = (type: string): string => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <div
      onClick={handleWorkflowClick}
      onKeyDown={handleKeyDown}
      role='button'
      tabIndex={0}
      className='bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer group'
      data-track-category='Workflows'
      data-track-name='OpenWorkflow'
      data-track-metadata={JSON.stringify({ workflowId, workflowName, status })}
    >
      {/* Header: ID and Icons */}
      <div className='flex items-start justify-between mb-2'>
        <span className='text-xs font-medium text-gray-400'>WF-{workflowId.slice(-8)}</span>
        <div className='flex items-center gap-2 text-gray-400'>
          <Bot className='w-3.5 h-3.5' />
          <span
            className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${getStatusColor(status)}`}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Title */}
      <h4 className='text-sm font-medium text-gray-900 mb-3 line-clamp-2 leading-snug'>
        {workflowName}
      </h4>

      {/* Workflow Type and Ticket Info */}
      <div className='flex items-center gap-2 mb-4 flex-wrap'>
        <span className='inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-medium'>
          <PlayCircle className='w-3 h-3' />
          {getWorkflowTypeDisplay(workflowType)}
        </span>
        {ticketId && (
          <span className='inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded-md text-xs font-medium'>
            Ticket: {ticketId.slice(-8)}
          </span>
        )}
      </div>

      {/* Footer: Status and Action */}
      <div className='flex items-center justify-between mt-auto'>
        {/* Status Indicator */}
        <div className='flex items-center gap-1 text-xs text-gray-500'>
          <ChevronRight className='w-3.5 h-3.5' />
          <span>View Workflow Details</span>
        </div>

        {/* Bot Indicator */}
        <div className='flex items-center gap-1 text-xs text-gray-400'>
          <Bot className='w-3 h-3' />
          <span>Bot</span>
        </div>
      </div>
    </div>
  );
};
