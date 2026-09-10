import { ReactElement, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { type PreviewMode, type TicketPreviewPanelProps } from './TicketPreviewPanel.types';

/**
 * TicketPreviewPanel - A reusable component for previewing tickets
 * Used in both BoardCreateScreen and BoardEditScreen
 */
export const TicketPreviewPanel = ({
  onClose,
  ticketPreviewContent,
  createTicketContent,
  trackCategory = 'Board',
}: TicketPreviewPanelProps): ReactElement => {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('ticket');

  return (
    <div className='w-[50%] flex flex-col bg-card rounded-[12px] shadow-lg m-4 z-10 border border-border'>
      <div className='flex items-center justify-between px-[16px] py-[12px]'>
        <h2 className='text-[14px] font-medium text-foreground'>Ticket Preview</h2>
        <Button
          onClick={onClose}
          variant='ghost'
          size='iconSm'
          className='w-[24px] h-[24px] border border-border rounded-[4px] hover:bg-muted'
          data-track-category={trackCategory}
          data-track-name='CLOSE_PREVIEW'
        >
          <X size={12} className='text-muted-foreground' />
        </Button>
      </div>
      <div className='flex-1 overflow-y-auto pb-[48px]'>
        {previewMode === 'ticket' ? (
          ticketPreviewContent
        ) : (
          <div className='flex items-center justify-center h-full px-6 pt-8 pb-[764px]'>
            {createTicketContent}
          </div>
        )}
      </div>
      {/* Bottom Navigation */}
      <div className='flex items-center justify-center gap-[6px] px-[20px] py-[16px] bg-card flex-shrink-0 rounded-[12px]'>
        <div className='inline-flex rounded-[10px] bg-muted p-[4px] gap-[6px]'>
          <Button
            onClick={() => setPreviewMode('ticket')}
            variant='ghost'
            size='sm'
            className={`px-[12px] py-[8px] text-[13px] font-medium rounded-[8px] transition-colors tracking-[-0.2px] h-auto ${
              previewMode === 'ticket'
                ? 'bg-background text-foreground border border-border hover:bg-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
            }`}
            data-track-category={trackCategory}
            data-track-name='SWITCH_TICKET_PREVIEW'
          >
            Ticket Preview
          </Button>
          <Button
            onClick={() => setPreviewMode('create')}
            variant='ghost'
            size='sm'
            className={`px-[12px] py-[8px] text-[13px] font-medium rounded-[8px] transition-colors tracking-[-0.2px] h-auto ${
              previewMode === 'create'
                ? 'bg-background text-foreground border border-border hover:bg-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
            }`}
            data-track-category={trackCategory}
            data-track-name='SWITCH_CREATE_TICKET'
          >
            Create Ticket
          </Button>
        </div>
      </div>
    </div>
  );
};
