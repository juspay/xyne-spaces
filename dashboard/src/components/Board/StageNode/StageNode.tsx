import { ReactElement } from 'react';
import { Trash2, Clock, ChevronRight } from 'lucide-react';
import { TicketStatusV2 } from '@xyne/shared';
import { Button } from '../../ui/Button';
import { type StageNodeProps } from './StageNode.types';

// Status color mapping
const getStatusColor = (status: TicketStatusV2): string => {
  switch (status) {
    case TicketStatusV2.TODO:
      return 'bg-muted/50 border-border';
    case TicketStatusV2.STARTED:
      return 'bg-blue-50 border-blue-200';
    case TicketStatusV2.PAUSED:
      return 'bg-yellow-50 border-yellow-200';
    case TicketStatusV2.COMPLETED:
      return 'bg-green-50 border-green-200';
    case TicketStatusV2.CANCELLED:
      return 'bg-red-50 border-red-200';
    default:
      return 'bg-background border-border';
  }
};

const getStatusDotColor = (status: TicketStatusV2): string => {
  switch (status) {
    case TicketStatusV2.TODO:
      return 'bg-xyne-gray-500';
    case TicketStatusV2.STARTED:
      return 'bg-blue-500';
    case TicketStatusV2.PAUSED:
      return 'bg-yellow-500';
    case TicketStatusV2.COMPLETED:
      return 'bg-green-500';
    case TicketStatusV2.CANCELLED:
      return 'bg-red-500';
    default:
      return 'bg-xyne-gray-400';
  }
};

export const StageNode = ({
  node,
  isSelected,
  isFirst,
  isLast,
  onSelect,
  onDelete,
}: StageNodeProps): ReactElement => {
  const statusColorClass = getStatusColor(node.defaultTicketStatusV2);
  const statusDotClass = getStatusDotColor(node.defaultTicketStatusV2);

  return (
    <>
      {/* Connection Line with Arrow - Left */}
      {!isFirst && (
        <div className='flex items-center'>
          <div className='w-8 h-0.5 bg-xyne-gray-300' />
          <ChevronRight size={16} className='text-xyne-gray-400 -ml-1' />
        </div>
      )}

      {/* Stage Node */}
      <div
        onClick={onSelect}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        role='button'
        tabIndex={0}
        data-track-category='BoardStageConfig'
        data-track-name='StageNodeClick'
        className={`
          relative flex flex-col gap-2 px-4 py-3 rounded-lg border-2 cursor-pointer
          transition-all duration-200 min-w-[180px] max-w-[240px] shadow-sm
          ${isSelected ? 'border-xyne-primary-500 ring-2 ring-xyne-primary-200 bg-background' : statusColorClass}
          hover:shadow-md
        `}
      >
        {/* Header Row */}
        <div className='flex items-center gap-2'>
          {/* Stage Number Badge */}
          <span className='flex-shrink-0 w-5 h-5 rounded-full bg-xyne-primary-100 text-xyne-primary-600 text-xs font-semibold flex items-center justify-center'>
            {node.sequenceNumber}
          </span>

          {/* Stage Name */}
          <div className='flex-1 min-w-0'>
            <span className='font-medium text-xyne-gray-900 text-sm truncate block'>
              {node.name || `Stage ${node.sequenceNumber}`}
            </span>
          </div>

          {/* Delete Button - always visible for better UX */}
          <Button
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            variant='ghost'
            size='iconSm'
            className='flex-shrink-0 p-1 rounded-md text-xyne-gray-400 hover:text-xyne-red-500 hover:bg-xyne-red-50 transition-colors'
            data-track-category='board_config'
            data-track-name='delete_stage_node'
          >
            <Trash2 size={12} />
          </Button>
        </div>

        {/* Info Row */}
        <div className='flex items-center gap-3 pl-5'>
          {/* Status Indicator */}
          <div className='flex items-center gap-1.5'>
            <span className={`w-2 h-2 rounded-full ${statusDotClass}`} />
            <span className='text-xs text-xyne-gray-500 capitalize'>
              {node.defaultTicketStatusV2.toLowerCase()}
            </span>
          </div>

          {/* ETA */}
          {node.eta > 0 && (
            <div className='flex items-center gap-1 text-xs text-xyne-gray-500'>
              <Clock size={12} />
              <span>{node.eta}h</span>
            </div>
          )}

          {/* Approvers Count */}
          {node.approverIds.length > 0 && (
            <span className='text-xs text-xyne-gray-400'>
              {node.approverIds.length} {node.approverIds.length > 1 ? 'approvers' : 'approver'}
            </span>
          )}
        </div>
      </div>

      {/* Connection Arrow - Right */}
      {!isLast && (
        <div className='flex items-center'>
          <ChevronRight size={16} className='text-xyne-gray-400 -mr-1' />
          <div className='w-8 h-0.5 bg-xyne-gray-300' />
        </div>
      )}
    </>
  );
};
