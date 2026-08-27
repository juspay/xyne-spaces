import { Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '../../ui/Button';

interface ClearChatConfirmOverlayProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export const ClearChatConfirmOverlay = ({
  onCancel,
  onConfirm,
}: ClearChatConfirmOverlayProps): ReactElement => (
  <div className='fixed inset-0 z-[60] flex items-center justify-center'>
    <button
      type='button'
      aria-label='Dismiss'
      onClick={onCancel}
      data-track-category='DYNAMIC_DASHBOARD'
      data-track-name='Clear_Chat_Dismiss'
      className='absolute inset-0 bg-black/50'
    />
    <div className='relative w-[min(420px,92vw)] bg-popover rounded-lg shadow-lg border border-border p-5'>
      <div className='flex items-start gap-3'>
        <div className='flex items-center justify-center w-9 h-9 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-500 shrink-0'>
          <Trash2 size={18} />
        </div>
        <div className='min-w-0'>
          <h3 className='text-sm font-semibold text-foreground'>Clear this conversation?</h3>
          <p className='text-xs text-muted-foreground mt-1.5 leading-relaxed'>
            This clears the current conversation and starts a fresh one. You won&apos;t be able to
            return to this thread.
          </p>
        </div>
      </div>
      <div className='flex items-center justify-end gap-2 mt-5'>
        <Button
          variant='secondary'
          onClick={onCancel}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='CANCEL_CLEAR_AI_CHAT'
        >
          Cancel
        </Button>
        <Button
          variant='destructive'
          onClick={onConfirm}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='CONFIRM_CLEAR_AI_CHAT'
        >
          Clear history
        </Button>
      </div>
    </div>
  </div>
);
