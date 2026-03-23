import { ReactElement } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { Button } from '../../ui/Button';
import type { BoardWithStages } from '../BoardCard';

interface BoardsTableProps {
  boards: readonly BoardWithStages[] | undefined;
  onEdit: (board: BoardWithStages) => void;
  onDelete: (boardId: string) => void;
}

export const BoardsTable = ({ boards, onEdit, onDelete }: BoardsTableProps): ReactElement => {
  if (boards?.length === 0) {
    return (
      <EmptyState
        title='No boards yet'
        description='Create your first board to get started'
        icon='📋'
      />
    );
  }

  return (
    <div className='bg-background rounded-lg shadow-sm border border-border overflow-hidden'>
      <table className='min-w-full divide-y divide-border'>
        <thead className='bg-muted'>
          <tr>
            <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              Board Name
            </th>

            <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              Created Date
            </th>
            <th className='px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className='bg-background divide-y divide-border'>
          {boards?.map(board => {
            return (
              <tr key={board.id} className='hover:bg-muted transition-colors cursor-pointer'>
                <td className='px-6 py-4 whitespace-nowrap'>
                  <span className='text-sm font-medium text-muted-foreground'>{board.name}</span>
                </td>
                <td className='px-6 py-4 whitespace-nowrap'>
                  <div className='text-sm text-muted-foreground'>
                    {new Date(board.createdAt).toLocaleDateString()}
                  </div>
                </td>
                <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium'>
                  <div
                    className='flex items-center justify-end gap-2'
                    onClick={e => e.stopPropagation()}
                    role='button'
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                      }
                    }}
                    data-track-category='Board'
                    data-track-name='Board_Actions_Container'
                    data-track-metadata={JSON.stringify({ boardId: board.id })}
                  >
                    <Button
                      variant='secondary'
                      onClick={() => onEdit(board)}
                      data-testid='edit-board-button'
                      data-track-category='Board'
                      data-track-name='Edit_Board_Table'
                      data-track-metadata={JSON.stringify({
                        boardId: board.id,
                        boardName: board.name,
                      })}
                    >
                      <Edit2 size={14} />
                      Edit
                    </Button>
                    <Button
                      variant='destructive'
                      onClick={() => void onDelete(board.id)}
                      data-track-category='Board'
                      data-track-name='Delete_Board_Table'
                      data-track-metadata={JSON.stringify({
                        boardId: board.id,
                        boardName: board.name,
                      })}
                    >
                      <Trash2 size={14} />
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
