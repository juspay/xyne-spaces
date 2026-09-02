import { ReactElement, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TicketStatusV2 } from '@xyne/shared';
import { Popover } from '../ui/Popover/Popover';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { getStageColor } from '../../routes/KanbanBoardScreen/KanbanBoardScreen.utils';
import { surfaceMutationError } from '../../utils/zeroMutationToast';
import { cn } from '../../utils/classNames';
import { StagePicker } from '../Tickets/TicketListView/StagePicker';
import { Button } from '../ui/Button/Button';

export interface ReleaseStageOption {
  name: string;
  // Auto-applied to the ticket's statusV2 on selection — keeps stage and
  // status in sync when the user picks e.g. COMPLETED.
  defaultTicketStatusV2?: TicketStatusV2 | null;
}

interface ReleaseStagePickerProps {
  ticketId: string;
  stageName: string | null | undefined;
  // Stages sourced from the ticket's board (queries.stagesByBoards). Pass
  // an empty array if the board has no stages configured yet.
  stages: readonly ReleaseStageOption[];
  // Board id for transition form gates (opens StageFormModal with merged fields).
  boardId?: string;
  // Optional callback fired after the stage mutation, with the new stage name.
  onAfterChange?: (stageName: string) => void;
  // When provided, replaces the default ticket.update mutation entirely.
  // The caller is responsible for persisting the change. No ticket.update
  // is fired — useful when updating a ticket the current user can't write
  // directly (e.g. a dev ticket owned by another project).
  onSelect?: (stage: ReleaseStageOption) => void;
}

/**
 * Stage picker for release tickets. Renders a Popover with the dot+chevron
 * trigger used elsewhere in the dashboard, but driven by the actual board's
 * stages rather than a hardcoded support-flow list. Mirrors the tickets-flow
 * StagePicker structurally but lives as a separate component so that one stays
 * untouched.
 */
export function ReleaseStagePicker({
  ticketId,
  stageName,
  stages,
  boardId,
  onAfterChange,
  onSelect,
}: ReleaseStagePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const zero = useZero();

  // Release tickets with board context use the shared StagePicker so transition
  // forms (including reusable board fields) gate stage changes correctly.
  if (boardId && !onSelect) {
    return (
      <StagePicker
        ticketId={ticketId}
        stageName={stageName}
        stageLabel={stageName ?? '—'}
        boardId={boardId}
        onAfterStageChange={onAfterChange}
      />
    );
  }

  const currentStage = stageName ?? '';

  const setStage = (next: ReleaseStageOption): void => {
    if (next.name !== currentStage) {
      if (onSelect) {
        // Caller handles persistence — skip ticket.update entirely.
        onSelect(next);
      } else {
        void surfaceMutationError(
          zero.mutate(
            mutators.ticket.update({
              id: ticketId,
              stageName: next.name,
              ...(next.defaultTicketStatusV2 && { statusV2: next.defaultTicketStatusV2 }),
              updatedAt: Date.now(),
            }),
          ),
          'Failed to update stage',
        );
      }
      onAfterChange?.(next.name);
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
      data-track-category='Release'
      data-track-name='ToggleRowStage'
    >
      <span
        className='inline-block w-1.5 h-1.5 rounded-full'
        style={{ backgroundColor: dotColor }}
      />
      <span>{currentStage || '—'}</span>
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
        {stages.length === 0 ? (
          <div className='px-2 py-1.5 text-xs text-muted-foreground'>
            No stages configured for this board.
          </div>
        ) : (
          stages.map(stage => (
            <Button
              key={stage.name}
              variant='ghost'
              type='button'
              onClick={e => {
                e.stopPropagation();
                setStage(stage);
              }}
              className={cn(
                'w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded-sm flex items-center gap-2',
                currentStage === stage.name && 'bg-muted',
              )}
              data-track-category='Release'
              data-track-name='SelectRowStage'
              trackId='select_release_stage'
            >
              <span
                className='inline-block w-1.5 h-1.5 rounded-full'
                style={{ backgroundColor: getStageColor(stage.name) }}
              />
              <span className='text-foreground'>{stage.name}</span>
            </Button>
          ))
        )}
      </div>
    </Popover>
  );
}
