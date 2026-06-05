import { ReactElement } from 'react';
import { BoardCard, type BoardWithStages } from '../BoardCard';
import { EmptyState } from '../EmptyState';

interface BoardsGridProps {
  boards: readonly BoardWithStages[] | undefined;
  onEdit: (board: BoardWithStages) => void;
}

export const BoardsGrid = ({ boards, onEdit }: BoardsGridProps): ReactElement => {
  if (boards?.length === 0) {
    return (
      <EmptyState
        title='No boards yet'
        description='Get started by creating your first board'
        icon='📋'
      />
    );
  }

  return (
    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
      {boards?.map(board => (
        <BoardCard key={board.id} board={board} onEdit={onEdit} />
      ))}
    </div>
  );
};
