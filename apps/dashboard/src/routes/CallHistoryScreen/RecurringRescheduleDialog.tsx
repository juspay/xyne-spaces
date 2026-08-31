import { ReactElement } from 'react';
import { Headphones } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog/Dialog';

interface RecurringRescheduleDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

const RecurringRescheduleDialog = ({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Reschedule recurring call?',
  description = 'This is a recurring call. Only this occurrence will be rescheduled — the rest of the series stays unchanged.',
}: RecurringRescheduleDialogProps): ReactElement => (
  <Dialog open={isOpen} onOpenChange={open => !open && onCancel()}>
    <div className='p-4 w-[450px] max-w-full'>
      <div className='mb-4'>
        <div className='size-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center'>
          <Headphones className='size-6 text-blue-500 dark:text-blue-400' />
        </div>
      </div>

      <h2 className='font-semibold text-foreground text-base mb-1'>{title}</h2>

      <p className='text-sm text-muted-foreground mb-5'>{description}</p>

      <div className='flex justify-end gap-2'>
        <button
          onClick={onCancel}
          data-track-category='CALLS'
          data-track-name='recurring-reschedule-cancel'
          className='text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer text-foreground'
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          data-track-category='CALLS'
          data-track-name='recurring-reschedule-confirm'
          className='text-sm px-4 py-2 rounded-lg bg-[#6276BE] text-white hover:bg-[#5566ae] transition-colors cursor-pointer'
        >
          Reschedule this event
        </button>
      </div>
    </div>
  </Dialog>
);

export default RecurringRescheduleDialog;
