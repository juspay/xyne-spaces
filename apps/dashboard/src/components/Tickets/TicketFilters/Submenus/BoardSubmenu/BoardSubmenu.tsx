import { ReactElement, useTransition } from 'react';
import { CheckTickSingle as Check } from '@xyne/icons';
import { Button } from '../../../../ui/Button/Button';
import type { BoardOption } from '../../types';

interface BoardSubmenuProps {
  selectedBoards: string[];
  onChange: (boardIds: string[]) => void;
  onClose: () => void;
  boards?: BoardOption[];
}

export const BoardSubmenu = ({
  selectedBoards,
  onChange,
  boards: allBoards = [],
}: BoardSubmenuProps): ReactElement => {
  const [isPending, startTransition] = useTransition();

  const handleBoardToggle = (boardId: string): void => {
    // Mark the filter update as non-urgent to avoid blocking UI
    startTransition(() => {
      onChange([boardId]);
    });
  };

  const isAllBoardsSelected = selectedBoards.length === 0;

  return (
    <div className='py-1.5 px-1 flex flex-col gap-1 w-full max-h-80 overflow-y-auto'>
      {/* All Boards option - only show when there are more than 1 board */}
      {allBoards.length > 1 && (
        <Button
          variant='ghost'
          onClick={() => startTransition(() => onChange([]))}
          data-track-category='TicketFilters'
          data-track-name='SelectAllBoards'
          data-track-metadata={JSON.stringify({ filterType: 'board', selectedBoards })}
          className={`w-full justify-between px-3 py-2 h-auto text-foreground ${
            isAllBoardsSelected ? 'bg-accent' : ''
          } ${isPending ? 'opacity-60' : ''}`}
        >
          <span className='text-sm font-medium'>All Boards</span>
          {isAllBoardsSelected && <Check className='w-5 h-5 text-foreground' strokeWidth={2.5} />}
        </Button>
      )}

      {allBoards && allBoards.length > 0 ? (
        allBoards.map(board => {
          const isSelected = selectedBoards.includes(board.id);
          return (
            <Button
              key={board.id}
              variant='ghost'
              onClick={() => handleBoardToggle(board.id)}
              data-track-category='TicketFilters'
              data-track-name='ToggleBoard'
              data-track-metadata={JSON.stringify({
                filterType: 'board',
                boardId: board.id,
                selectedBoards,
              })}
              className={`w-full justify-between px-3 py-2 h-auto text-foreground ${
                isSelected ? 'bg-accent' : ''
              } ${isPending ? 'opacity-60' : ''}`}
            >
              <span className='text-sm font-medium'>{board.name}</span>

              {isSelected && <Check className='w-5 h-5 text-foreground' strokeWidth={2.5} />}
            </Button>
          );
        })
      ) : (
        <div className='px-4 py-3 text-sm text-muted-foreground'>No boards available</div>
      )}
    </div>
  );
};
