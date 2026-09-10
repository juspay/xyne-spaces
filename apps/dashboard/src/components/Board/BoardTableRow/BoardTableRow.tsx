import { ReactElement } from 'react';
import { Zap } from 'lucide-react';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { Button } from '../../ui/Button';
import type { BoardTableRowProps } from './BoardTableRow.types';
import { formatCustomFields } from './BoardTableRow.utils';

export const BoardTableRow = ({
  board,
  onDuplicate,
  onPreview,
  selectedBoardId,
}: BoardTableRowProps): ReactElement => {
  const isSelected = selectedBoardId === board.id;

  const createdByName = typeof board.createdBy === 'string' ? board.createdBy : 'Unknown';

  return (
    <div className='group flex items-center gap-[24px] px-[16px] py-[12px] transition-colors rounded-xl bg-background hover:bg-muted'>
      {/* Board Title */}
      <div className='flex-1 truncate min-w-0'>
        <p
          className={`text-[14px] text-foreground leading-[20px] truncate ${isSelected ? 'font-semibold' : ''}`}
        >
          {board.title}
        </p>
      </div>

      {/* Created by */}
      <div className='flex-1 flex items-center gap-[8px] min-w-0'>
        <UserAvatar userId={board.createdByUserId} showActiveStatus={false} />
        <p
          className={`text-[14px] text-muted-foreground truncate ${isSelected ? 'font-semibold' : ''}`}
        >
          {createdByName}
        </p>
      </div>

      {/* Automations */}
      <div className='flex-1 flex items-center gap-[4px] min-w-0'>
        <Zap size={14} className='text-[#6276be] flex-shrink-0' />
        <span className={`text-[14px] text-foreground ${isSelected ? 'font-semibold' : ''}`}>
          {board.automations || 0}
        </span>
      </div>

      {/* Custom Fields */}
      <div className='flex-1 truncate min-w-0'>
        <p
          className={`text-[14px] text-muted-foreground truncate ${isSelected ? 'font-semibold' : ''}`}
        >
          {formatCustomFields(board.customFieldNames)}
        </p>
      </div>

      {/* Actions */}
      <div className='w-[200px] flex gap-[8px] flex-shrink-0 invisible group-hover:visible'>
        <Button
          onClick={() => onPreview(board)}
          variant='secondary'
          size='sm'
          className='flex-shrink-0 whitespace-nowrap bg-background border border-border'
          data-track-category='BOARD_CREATE'
          data-track-name='PREVIEW_BOARD'
        >
          Preview
        </Button>
        <Button
          onClick={() => onDuplicate(board)}
          size='sm'
          className='bg-[#6276be] hover:bg-[#5060a0] text-white flex-shrink-0 whitespace-nowrap'
          data-track-category='BOARD_CREATE'
          data-track-name='CLONE_BOARD'
        >
          Clone
        </Button>
      </div>
    </div>
  );
};
