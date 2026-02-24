import * as React from 'react';
import { queries } from '../../../zero/queries';
import { cn } from '../../../utils/classNames';
import Button from '../../ui/Button';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

interface BoardFilterBarProps {
  projectId: string;
  selectedBoardIds: string[];
  onChange?: (ids: string[]) => void;
}

export const BoardFilterBar: React.FC<BoardFilterBarProps> = ({
  projectId,
  selectedBoardIds,
  onChange,
}) => {
  const [boards] = useCachedQuery(queries.boardsByProject({ projectId }), {
    enabled: Boolean(projectId),
  });

  if (!boards?.length) return null;

  const allBoardIds = boards.map(board => board.id);

  const isAllSelected =
    selectedBoardIds.length === 0 || selectedBoardIds.length === allBoardIds.length;

  const selectAllBoards = () => {
    onChange?.(allBoardIds);
  };

  const selectSingleBoard = (boardId: string) => {
    onChange?.([boardId]);
  };

  return (
    <div
      role='tablist'
      aria-label='Boards'
      className='flex items-center border border-[#ECEFF3] bg-white absolute bottom-0 right-0 z-20 w-full overflow-x-auto no-scrollbar'
    >
      {/* All Boards Tab */}
      <Button
        variant='ghost'
        role='tab'
        aria-selected={isAllSelected}
        onClick={selectAllBoards}
        className={cn(
          'px-6 py-3 text-sm font-medium whitespace-nowrap min-w-[100px] border-r border-[#ECEFF3] rounded-none h-auto',
          isAllSelected
            ? 'bg-blue-50 text-blue-600 border-b-2 border-b-blue-600'
            : 'text-gray-500 hover:bg-gray-50',
        )}
        data-track-category='Tickets'
        data-track-name='SelectAllBoards'
      >
        All Boards
      </Button>

      {/* Individual Board Tabs */}
      {boards.map(board => {
        const isActive = !isAllSelected && selectedBoardIds.includes(board.id);

        return (
          <Button
            key={board.id}
            variant='ghost'
            role='tab'
            aria-selected={isActive}
            onClick={() => selectSingleBoard(board.id)}
            className={cn(
              'px-6 py-3 text-sm font-medium whitespace-nowrap min-w-[100px] border-r border-[#ECEFF3] rounded-none h-auto',
              isActive
                ? 'text-sidebar-badge-accent border-b-2 border-b-sidebar-badge-accent bg-gray-50'
                : 'text-gray-500 hover:bg-gray-50',
            )}
            data-track-category='Tickets'
            data-track-name='SelectBoardTab'
            data-track-metadata={JSON.stringify({ boardId: board.id, boardName: board.name })}
          >
            {board.name}
          </Button>
        );
      })}
    </div>
  );
};
