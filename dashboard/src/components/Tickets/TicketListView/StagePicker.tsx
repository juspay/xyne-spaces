import { ReactElement, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover } from '../../ui/Popover/Popover';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { getStageColor } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.utils';
import { cn } from '../../../utils/classNames';

interface StagePickerProps {
  ticketId: string;
  stageName: string | null | undefined;
  stageLabel: string;
  stageOptions?: ReadonlyArray<string>;
  /** When provided, called instead of directly mutating zero — allows the parent to intercept and show a form. */
  onStageChange?: (
    ticketId: string,
    newStageName: string,
    currentStageName: string | null | undefined,
  ) => void;
}

const SUPPORT_STAGES: ReadonlyArray<string> = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];

export function StagePicker({
  ticketId,
  stageName,
  stageLabel,
  stageOptions,
  onStageChange,
}: StagePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const zero = useZero();

  const currentStage = stageName ?? '';
  const availableStages = stageOptions && stageOptions.length > 0 ? stageOptions : SUPPORT_STAGES;

  const setStage = (next: string): void => {
    if (next !== currentStage) {
      if (onStageChange) {
        onStageChange(ticketId, next, stageName);
      } else {
        void zero.mutate(
          mutators.ticket.update({ id: ticketId, stageName: next, updatedAt: Date.now() }),
        );
      }
    }
    setOpen(false);
  };

  const dotColor = getStageColor(currentStage);

  const trigger = (
    <button
      type='button'
      onClick={e => {
        e.stopPropagation();
        setOpen(prev => !prev);
      }}
      onKeyDown={e => e.stopPropagation()}
      className='inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors whitespace-nowrap'
      aria-label='Change stage'
      data-track-category='Tickets'
      data-track-name='ToggleRowStage'
    >
      <span
        className='inline-block w-1.5 h-1.5 rounded-full'
        style={{ backgroundColor: dotColor }}
      />
      <span>{stageLabel}</span>
      <ChevronDown className='w-3 h-3 opacity-60' />
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      modal
      align='end'
      sideOffset={4}
      className='p-1 w-44'
    >
      <div className='flex flex-col'>
        {availableStages.map(stage => (
          <button
            key={stage}
            type='button'
            onClick={e => {
              e.stopPropagation();
              setStage(stage);
            }}
            className={cn(
              'w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded-sm flex items-center gap-2',
              currentStage === stage && 'bg-muted',
            )}
            data-track-category='Tickets'
            data-track-name='SelectRowStage'
          >
            <span
              className='inline-block w-1.5 h-1.5 rounded-full'
              style={{ backgroundColor: getStageColor(stage) }}
            />
            <span className='text-foreground'>{stage}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
