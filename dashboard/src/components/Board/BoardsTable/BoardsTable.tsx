import { ReactElement, useState } from 'react';
import { Edit2, Copy, Check } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { Button } from '../../ui/Button';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { toast } from 'sonner';
import { getBoardEditLabel } from '../BoardCard';
import type { BoardWithStages } from '../BoardCard';

interface BoardsTableProps {
  boards: readonly BoardWithStages[] | undefined;
  onEdit: (board: BoardWithStages) => void;
  applicationBoardIds?: Set<string>;
}

export const BoardsTable = ({
  boards,
  onEdit,
  applicationBoardIds,
}: BoardsTableProps): ReactElement => {
  const [copiedBoardId, setCopiedBoardId] = useState<string | null>(null);

  const handleCopyId = (e: React.MouseEvent, boardId: string): void => {
    e.stopPropagation();
    copyTextToClipboard(boardId)
      .then(() => {
        toast.success('Board ID copied to clipboard');
        setCopiedBoardId(boardId);
        setTimeout(() => setCopiedBoardId(null), 1500);
      })
      .catch(() => {
        toast.error('Failed to copy board ID');
      });
  };

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
              Board ID
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
                  <div className='flex items-center gap-1'>
                    <code className='text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[140px] inline-block'>
                      {board.id}
                    </code>
                    <Button
                      variant='ghost'
                      size='iconSm'
                      className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
                      onClick={e => handleCopyId(e, board.id)}
                      title='Copy board ID'
                    >
                      {copiedBoardId === board.id ? <Check size={12} /> : <Copy size={12} />}
                    </Button>
                  </div>
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
                      {getBoardEditLabel(board, applicationBoardIds)}
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
