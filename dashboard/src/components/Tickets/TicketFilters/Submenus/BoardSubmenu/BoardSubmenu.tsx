import { ReactElement, useMemo } from 'react';
import { Check } from 'lucide-react';
import { createBuilder } from '@rocicorp/zero';
import { schema } from '@xyne/shared';
import { Button } from '../../../../ui/Button/Button';
import { useRawQuery } from '../../../../../hooks/useQuery';

interface BoardSubmenuProps {
  selectedBoards: string[];
  onChange: (boardIds: string[]) => void;
  onClose: () => void;
  availableBoards?: string[] | undefined;
  projectId?: string | undefined;
}

export const BoardSubmenu = ({
  selectedBoards,
  onChange,
  availableBoards: availableBoardIds,
  projectId,
}: BoardSubmenuProps): ReactElement => {
  const builder = createBuilder(schema);
  const [allBoardsRaw] = useRawQuery(
    projectId
      ? builder.boards.where('projectId', projectId).orderBy('name', 'asc')
      : builder.boards.orderBy('name', 'asc'),
    'boards_submenu',
  );

  const availableBoardIdSet = useMemo(() => {
    return availableBoardIds && availableBoardIds.length > 0 ? new Set(availableBoardIds) : null;
  }, [availableBoardIds]);

  const allBoards = useMemo(() => {
    return (allBoardsRaw || []).filter(board => {
      if (availableBoardIdSet && !availableBoardIdSet.has(board.id)) {
        return false;
      }
      return true;
    });
  }, [allBoardsRaw, availableBoardIdSet]);

  const handleBoardToggle = (boardId: string): void => {
    onChange([boardId]);
  };

  const isAllBoardsSelected = selectedBoards.length === 0;

  return (
    <div className='py-1.5 px-1 flex flex-col gap-1 w-full max-h-80 overflow-y-auto'>
      {/* All Boards option - only show when there are more than 1 board */}
      {allBoards.length > 1 && (
        <Button
          variant='ghost'
          onClick={() => onChange([])}
          data-track-category='TicketFilters'
          data-track-name='SelectAllBoards'
          data-track-metadata={JSON.stringify({ filterType: 'board', projectId, selectedBoards })}
          className={`w-full justify-between px-3 py-2 h-auto text-foreground ${
            isAllBoardsSelected ? 'bg-accent' : ''
          }`}
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
                projectId,
                boardId: board.id,
                selectedBoards,
              })}
              className={`w-full justify-between px-3 py-2 h-auto text-foreground ${
                isSelected ? 'bg-accent' : ''
              }`}
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
