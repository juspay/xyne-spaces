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
import type { HiddenColumnsPanelProps } from './HiddenColumnsPanel.types';

const HiddenColumnRow: React.FC<{
  stage: Stage;
  count: number;
  onUnhide: (stageId: string) => void;
}> = ({ stage, count, onUnhide }) => (
  <div className='group/hiddencol relative flex h-[52px] items-center gap-[11px] border-b border-border py-0 pl-3 pr-1.5 transition-colors hover:bg-muted'>
    <KanbanIcon status={stage.defaultTicketStatusV2} />
    <span className='min-w-0 flex-1 truncate text-[13.5px] text-foreground'>{stage.name}</span>
    <span className='font-mono text-[13px] tabular-nums text-muted-foreground'>{count}</span>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label={`${stage.name} hidden column options`}
          className='flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground'
          data-track-category='Tickets'
          data-track-name='OpenHiddenKanbanColumnMenu'
          data-track-metadata={JSON.stringify({ stageId: stage.id, stageName: stage.name })}
        >
          <ThreeDotsMenuHorizontal className='h-4 w-4' />
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
          <EyeOn className='h-4 w-4 shrink-0' />
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
  isOpen,
  onToggle,
}) => {
  if (!isOpen) {
    return (
      <button
        type='button'
        onClick={onToggle}
        aria-label='Show hidden columns'
        className='sticky top-0 mb-1 ml-1.5 mr-5 mt-2 sm:mt-3 flex h-9 shrink-0 items-center gap-[7px] self-start whitespace-nowrap rounded-[9px] px-2 transition-colors hover:bg-muted'
        data-track-category='Tickets'
        data-track-name='ExpandHiddenColumnsPanel'
      >
        <ChevronDown className='h-3.5 w-3.5 shrink-0 -rotate-90 text-muted-foreground' />
        <span className='text-[13px] font-medium text-muted-foreground'>Hidden columns</span>
        <span className='font-mono text-[12.5px] tabular-nums text-muted-foreground'>
          {stages.length || ''}
        </span>
      </button>
    );
  }

  return (
    <div className='sticky top-0 mb-1 ml-1.5 mr-5 mt-2 sm:mt-3 w-[300px] shrink-0 self-start'>
      <button
        type='button'
        onClick={onToggle}
        aria-label='Hide the hidden-columns panel'
        className='flex h-9 w-full items-center gap-[7px] px-1.5 text-left'
        data-track-category='Tickets'
        data-track-name='CollapseHiddenColumnsPanel'
      >
        <ChevronDown className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
        <span className='flex-1 text-[13px] font-medium text-muted-foreground'>Hidden columns</span>
        <span className='font-mono text-[12.5px] tabular-nums text-muted-foreground'>
          {stages.length || ''}
        </span>
      </button>

      <div className='flex flex-col border-t border-border'>
        {stages.map(stage => (
          <HiddenColumnRow
            key={stage.id}
            stage={stage}
            count={getCount(stage)}
            onUnhide={onUnhide}
          />
        ))}
        {stages.length === 0 && (
          <p className='px-3 py-4 text-[12.5px] leading-[1.6] text-muted-foreground'>
            Nothing hidden. Hide a column from its{' '}
            <span className='font-semibold text-foreground'>⋯</span> menu to park it here without
            changing any counts.
          </p>
        )}
      </div>

      <p className='mt-3 px-1.5 text-[11.5px] leading-[1.6] text-muted-foreground'>
        Tickets in hidden columns are excluded from column and group counts.
      </p>
    </div>
  );
};
