import React from 'react';
import { ChevronDown, EyeOn, ThreeDotsMenuHorizontal } from '@xyne/icons';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { KanbanIcon } from '../KanbanColumns/KanbanIcon';
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
  <div className='flex h-[52px] items-center gap-[11px] border-b border-border pl-2 pr-1 transition-colors hover:bg-muted'>
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

/**
 * Sits at the end of the column strip and scrolls with it, so it never covers a
 * column. Its header uses the same padding and type as a column header, which is
 * what keeps the two aligned.
 */
export const HiddenColumnsPanel: React.FC<HiddenColumnsPanelProps> = ({
  stages,
  getCount,
  onUnhide,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className={cn('flex shrink-0 flex-col', isOpen ? 'w-72' : 'w-auto')}>
      <button
        type='button'
        onClick={() => setIsOpen(open => !open)}
        aria-expanded={isOpen}
        className='flex w-full items-center gap-2 px-4 pt-3 pb-1 text-left'
        data-track-category='Tickets'
        data-track-name='ToggleHiddenColumnsPanel'
      >
        <ChevronDown
          className={cn(
            'w-4 h-4 shrink-0 text-muted-foreground transition-transform',
            !isOpen && '-rotate-90',
          )}
        />
        <h3 className='text-xs font-medium uppercase whitespace-nowrap text-foreground'>
          Hidden columns
        </h3>
        <span className='text-xs px-2 py-0.5 rounded-full text-muted-foreground bg-muted-foreground/10'>
          {stages.length}
        </span>
      </button>

      {isOpen && (
        <div className='min-h-0 flex-1 overflow-y-auto px-4 pt-2'>
          {stages.length > 0 ? (
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
          ) : (
            <p className='text-[12.5px] leading-[1.6] text-muted-foreground'>
              Nothing hidden. Hide a column from its{' '}
              <span className='font-semibold text-foreground'>⋯</span> menu to park it here without
              changing any counts.
            </p>
          )}
          <p className='mt-3 text-[11.5px] leading-[1.6] text-muted-foreground'>
            Tickets in hidden columns are excluded from column and group counts.
          </p>
        </div>
      )}
    </div>
  );
};
