import React from 'react';
import { ChevronDown, EyeOn, ThreeDotsMenuHorizontal } from '@xyne/icons';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { KanbanIcon } from '../KanbanColumns/KanbanColumns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { cn } from '../../../utils/classNames';
import type { HiddenColumnsPanelProps } from './HiddenColumnsPanel.types';

const HiddenColumnRow: React.FC<{
  stage: Stage;
  count: number;
  onUnhide: (stageId: string) => void;
}> = ({ stage, count, onUnhide }) => (
  <div className='relative flex h-[52px] items-center gap-[11px] border-b border-border pl-3 pr-1.5 transition-colors hover:bg-muted'>
    <KanbanIcon status={stage.defaultTicketStatusV2} />
    <span className='min-w-0 flex-1 truncate text-[13.5px] text-foreground'>{stage.name}</span>
    <span className='text-[13px] tabular-nums text-muted-foreground'>{count}</span>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label={`${stage.name} hidden column options`}
          className='flex size-[26px] shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground'
          data-track-category='Tickets'
          data-track-name='OpenHiddenKanbanColumnMenu'
          data-track-metadata={JSON.stringify({ stageId: stage.id, stageName: stage.name })}
        >
          <ThreeDotsMenuHorizontal className='size-4' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[206px] rounded-xl p-[5px]'>
        <DropdownMenuItem
          className='h-[34px] gap-2.5 rounded-lg px-2.5 text-[13.5px]'
          onSelect={() => onUnhide(stage.id)}
          data-track-category='Tickets'
          data-track-name='UnhideKanbanColumn'
          data-track-metadata={JSON.stringify({ stageId: stage.id, stageName: stage.name })}
        >
          <EyeOn className='size-4 shrink-0' />
          <span>Unhide column</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const HiddenColumnsPanel: React.FC<HiddenColumnsPanelProps> = ({
  stages,
  getCount,
  onUnhide,
}) => {
  const [isOpen, setIsOpen] = React.useState(true);

  // Nothing to park: the rail would only take width away from the board.
  if (stages.length === 0) return null;

  return (
    <div
      className={cn(
        'shrink-0 self-start sticky top-0 pr-5 pl-1.5 pt-2 sm:pt-3',
        isOpen ? 'w-[300px]' : 'w-auto',
      )}
    >
      <button
        type='button'
        onClick={() => setIsOpen(open => !open)}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Collapse hidden columns' : 'Show hidden columns'}
        className={cn(
          'flex h-9 items-center gap-[7px] rounded-[9px] px-1.5 text-left transition-colors hover:bg-muted',
          isOpen ? 'w-full' : 'whitespace-nowrap',
        )}
        data-track-category='Tickets'
        data-track-name='ToggleHiddenColumnsPanel'
      >
        <ChevronDown
          className={cn('size-3.5 shrink-0 text-muted-foreground', !isOpen && '-rotate-90')}
        />
        <span className='flex-1 text-[13px] font-medium text-muted-foreground'>Hidden columns</span>
        <span className='text-[12.5px] tabular-nums text-muted-foreground'>{stages.length}</span>
      </button>

      {isOpen && (
        <>
          <div className='flex flex-col border-t border-border'>
            {stages.map(stage => (
              <HiddenColumnRow
                key={stage.id}
                stage={stage}
                count={getCount(stage)}
                onUnhide={onUnhide}
              />
            ))}
          </div>
          <p className='mt-3 px-1.5 text-[11.5px] leading-[1.6] text-muted-foreground'>
            Tickets in hidden columns are excluded from column and group counts.
          </p>
        </>
      )}
    </div>
  );
};
