import { ReactElement, useState } from 'react';
import { Clock, ChevronDown, Plus } from 'lucide-react';
import { TicketStatusV2 } from '@xyne/shared';
import { Button } from '../../ui/Button';
import {
  type ETAChipProps,
  type StageColumnProps,
  type StageConnectorProps,
} from './StageColumn.types';

// ─── Column color config per ticket status ────────────────────────────────────
const STATUS_CONFIG: Record<
  TicketStatusV2,
  {
    label: string;
    columnBg: string;
    headerBg: string;
    borderColor: string;
  }
> = {
  [TicketStatusV2.TODO]: {
    label: 'Todo',
    columnBg: 'bg-muted/50',
    headerBg: 'bg-muted',
    borderColor: 'border-border',
  },
  [TicketStatusV2.STARTED]: {
    label: 'In Progress',
    columnBg: 'bg-blue-50',
    headerBg: 'bg-blue-100',
    borderColor: 'border-blue-200',
  },
  [TicketStatusV2.PAUSED]: {
    label: 'Paused',
    columnBg: 'bg-yellow-50',
    headerBg: 'bg-yellow-100',
    borderColor: 'border-yellow-200',
  },
  [TicketStatusV2.COMPLETED]: {
    label: 'Done',
    columnBg: 'bg-green-50',
    headerBg: 'bg-green-100',
    borderColor: 'border-green-200',
  },
  [TicketStatusV2.CANCELLED]: {
    label: 'Cancelled',
    columnBg: 'bg-red-50',
    headerBg: 'bg-red-100',
    borderColor: 'border-red-200',
  },
};

// ─── ETA Button ──────────────────────────────────────────────────────────────
const ETAChip = ({ eta, onUpdate }: ETAChipProps): ReactElement => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(eta || ''));

  const handleBlur = (): void => {
    setEditing(false);
    onUpdate(parseInt(value) || 0);
  };

  if (editing) {
    return (
      <div className='flex items-center gap-1 bg-background border border-blue-300 rounded px-2 py-1 shadow-sm'>
        <Clock size={13} className='text-muted-foreground shrink-0' />
        <input
          type='number'
          min={0}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={e => {
            if (e.key === 'Enter') handleBlur();
            if (e.key === 'Escape') setEditing(false);
          }}
          data-track-category='board_config'
          data-track-name='eta_edit'
          className='w-12 text-xs outline-none bg-transparent text-foreground'
        />
      </div>
    );
  }

  return (
    <Button
      onClick={() => setEditing(true)}
      variant='outline'
      size='sm'
      className='flex items-center gap-1 text-muted-foreground bg-background border-border text-xs font-medium hover:bg-muted h-auto py-1 px-2'
      data-track-category='board_config'
      data-track-name='eta_edit_trigger'
    >
      <Clock size={13} className='shrink-0' />
      <span className='whitespace-nowrap'>{eta > 0 ? `${eta}h` : 'Set ETA'}</span>
    </Button>
  );
};

// ─── StageColumn ──────────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  TicketStatusV2.TODO,
  TicketStatusV2.STARTED,
  TicketStatusV2.PAUSED,
  TicketStatusV2.COMPLETED,
  TicketStatusV2.CANCELLED,
];

export const StageColumn = ({
  node,
  isSelected,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onUpdateEta,
  onStatusChange,
}: StageColumnProps): ReactElement => {
  const [isDragging, setIsDragging] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const config = STATUS_CONFIG[node.defaultTicketStatusV2] ?? STATUS_CONFIG[TicketStatusV2.TODO];

  const handleDragStart = (e: React.DragEvent): void => {
    setIsDragging(true);
    onDragStart();
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = (): void => {
    setIsDragging(false);
    onDragEnd();
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={onDragOver}
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
      data-track-name='StageColumnClick'
      className={`
        relative flex flex-col rounded border transition-all duration-200
        w-56 h-full cursor-grab active:cursor-grabbing
        ${config.columnBg} ${config.borderColor} border
        ${isSelected ? 'ring-2 ring-blue-400' : ''}
        ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'}
      `}
    >
      {/* ── Column Header ── */}
      <div
        className={`flex items-center justify-between px-4 py-3 ${config.headerBg} border-b ${config.borderColor}`}
      >
        {/* Status dropdown */}
        <div className='relative'>
          <button
            onClick={e => {
              e.stopPropagation();
              setShowStatusMenu(v => !v);
            }}
            className='flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80'
            data-track-category='board_config'
            data-track-name='toggle_status_menu'
            type='button'
          >
            {config.label}
            <ChevronDown size={14} className='text-muted-foreground' />
          </button>

          {showStatusMenu && (
            <div
              className='absolute top-full left-0 mt-1 z-10 bg-background border border-border rounded shadow-lg py-1 min-w-[140px]'
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                }
              }}
              role='button'
              tabIndex={-1}
              data-track-category='board_config'
              data-track-name='status_menu_container'
            >
              {STATUS_OPTIONS.map(status => {
                const opt = STATUS_CONFIG[status];
                return (
                  <button
                    key={status}
                    onClick={() => {
                      onStatusChange(status);
                      setShowStatusMenu(false);
                    }}
                    className={`
                      w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors
                      ${node.defaultTicketStatusV2 === status ? 'text-blue-600 font-medium' : 'text-foreground'}
                    `}
                    type='button'
                    data-track-category='board_config'
                    data-track-name='select_status'
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ETA button */}
        <div
          className='pointer-events-auto'
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
            }
          }}
          role='presentation'
          data-track-category='board_config'
          data-track-name='eta_container'
        >
          <ETAChip eta={node.eta} onUpdate={onUpdateEta} />
        </div>
      </div>

      {/* ── Column Content ── */}
      <div className='flex-1 p-4 flex flex-col gap-2'>
        {/* Backlog label if TODO status */}
        {node.defaultTicketStatusV2 === TicketStatusV2.TODO && (
          <div className='text-xs font-semibold text-foreground uppercase tracking-wide mb-1'>
            BACKLOG
          </div>
        )}

        {/* Add Condition link */}
        <Button
          onClick={e => {
            e.stopPropagation();
          }}
          variant='ghost'
          size='sm'
          className='flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium h-auto py-0 px-0'
          data-track-category='board_config'
          data-track-name='add_condition'
        >
          <Plus size={12} />
          Add Condition
        </Button>
      </div>
    </div>
  );
};

// ─── Stage Connector (+ button between columns) ───────────────────────────────
export const StageConnector = ({ onClick }: StageConnectorProps): ReactElement => (
  <div className='flex items-start pt-8 px-2 flex-shrink-0'>
    <div className='flex items-center gap-1'>
      <div className='w-6 h-px bg-border' />
      <button
        onClick={onClick}
        className='
        w-6 h-6 rounded-full border border-border bg-background
        flex items-center justify-center text-muted-foreground
        hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50
        transition-all
      '
        title='Add stage here'
        type='button'
        data-track-category='board_config'
        data-track-name='add_stage_connector'
      >
        <Plus size={14} />
      </button>
      <div className='w-6 h-px bg-border' />
    </div>
  </div>
);
