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
          className={`w-full justify-between px-3 py-2 h-auto text-[#181B1D] ${
            isAllBoardsSelected ? 'bg-[#F2F2F3]' : ''
          }`}
        >
          <span className='text-sm font-medium'>All Boards</span>
          {isAllBoardsSelected && <Check className='w-5 h-5 text-[#3B4145]' strokeWidth={2.5} />}
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
              className={`w-full justify-between px-3 py-2 h-auto text-[#181B1D] ${
                isSelected ? 'bg-[#F2F2F3]' : ''
              }`}
            >
              <span className='text-sm font-medium'>{board.name}</span>

              {isSelected && <Check className='w-5 h-5 text-[#3B4145]' strokeWidth={2.5} />}
            </Button>
          );
        })
      ) : (
        <div className='px-4 py-3 text-sm text-gray-500'>No boards available</div>
      )}
    </div>
  );
};
