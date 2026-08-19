import React from 'react';
import { GitBranch, Columns3 } from 'lucide-react';
import { Dialog } from '../../ui/Dialog';

interface BoardTypeChooserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onChooseFlow: () => void;
  onChooseStandard: () => void;
}

export const BoardTypeChooserDialog: React.FC<BoardTypeChooserDialogProps> = ({
  isOpen,
  onClose,
  onChooseFlow,
  onChooseStandard,
}) => (
  <Dialog
    open={isOpen}
    onOpenChange={open => {
      if (!open) onClose();
    }}
    title='Create Board'
    description='Choose the kind of board you want to create.'
    className='max-w-[780px] p-6'
  >
    <div className='flex flex-col gap-4'>
      <div>
        <h2 className='text-[16px] font-semibold text-foreground'>Create Board</h2>
        <p className='text-[13px] text-muted-foreground mt-0.5'>
          Choose the kind of board you want to create.
        </p>
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <button
          type='button'
          onClick={onChooseStandard}
          data-track-category='board_type_chooser'
          data-track-name='choose_standard_board'
          className='flex flex-col items-start gap-2 rounded-xl border border-border hover:border-[#6276be] bg-background p-4 text-left transition-colors'
        >
          <span className='flex items-center justify-center w-9 h-9 rounded-lg bg-muted'>
            <Columns3 size={18} className='text-[#6276be]' />
          </span>
          <span className='text-[14px] font-semibold text-foreground'>Standard board</span>
          <span className='text-[12px] text-muted-foreground leading-[18px]'>
            Kanban with configurable stages. Includes Default and Non-linear types.
          </span>
        </button>
        <button
          type='button'
          onClick={onChooseFlow}
          data-track-category='board_type_chooser'
          data-track-name='choose_flow_board'
          className='flex flex-col items-start gap-2 rounded-xl border border-border hover:border-[#6276be] bg-background p-4 text-left transition-colors'
        >
          <span className='flex items-center justify-center w-9 h-9 rounded-lg bg-muted'>
            <GitBranch size={18} className='text-[#6276be]' />
          </span>
          <span className='text-[14px] font-semibold text-foreground'>Flow board</span>
          <span className='text-[12px] text-muted-foreground leading-[18px]'>
            A designed graph of steps. Each run is a main ticket whose sub tickets are created
            automatically as the flow progresses.
          </span>
        </button>
      </div>
    </div>
  </Dialog>
);
