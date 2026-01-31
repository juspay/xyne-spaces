import { ReactElement } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { Button } from '../../ui/Button';
import type { BoardWithStages } from '../BoardCard';
import type { Stage } from '@xyne/shared';

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
    <div className='bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden'>
      <table className='min-w-full divide-y divide-gray-200'>
        <thead className='bg-gray-50'>
          <tr>
            <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
              Board Name
            </th>
            <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
              Stages
            </th>
            <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
              Created Date
            </th>
            <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider'>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className='bg-white divide-y divide-gray-200'>
          {boards?.map(board => {
            const stages = (
              board.stages && Array.isArray(board.stages) ? board.stages : []
            ) as readonly Stage[];

            return (
              <tr key={board.id} className='hover:bg-gray-50 transition-colors cursor-pointer'>
                <td className='px-6 py-4 whitespace-nowrap'>
                  <span className='text-sm font-medium text-gray-600'>{board.name}</span>
                </td>
                <td className='px-6 py-4 whitespace-nowrap'>
                  <div className='text-sm text-gray-600'>
                    {stages.length} {stages.length === 1 ? 'stage' : 'stages'}
                  </div>
                </td>
                <td className='px-6 py-4 whitespace-nowrap'>
                  <div className='text-sm text-gray-600'>
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
                  >
                    <Button variant='secondary' onClick={() => onEdit(board)}>
                      <Edit2 size={14} />
                      Edit
                    </Button>
                    <Button variant='destructive' onClick={() => void onDelete(board.id)}>
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
