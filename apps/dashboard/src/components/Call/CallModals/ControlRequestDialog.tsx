import { Bot, Check, XCircle } from 'lucide-react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';

interface ControlRequestDialogProps {
  isOpen: boolean;
  requesterName: string;
  onApprove: () => void;
  onDeny: () => void;
}

export function ControlRequestDialog({
  isOpen,
  requesterName,
  onApprove,
  onDeny,
}: ControlRequestDialogProps): React.ReactElement {
  return (
    <Dialog open={isOpen} onOpenChange={onDeny} title='Control Request'>
      <div className='p-6'>
        <div className='flex items-center gap-3 mb-6'>
          <div className='w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center'>
            <Bot className='w-6 h-6 text-yellow-500' />
          </div>
          <div>
            <h3 className='text-lg font-semibold text-foreground dark:text-white'>
              AI Control Request
            </h3>
            <p className='text-sm text-muted-foreground dark:text-muted-foreground'>
              Xyne Automatic
            </p>
          </div>
        </div>

        <p className='text-base text-foreground dark:text-muted mb-6'>
          <span className='font-semibold text-foreground dark:text-white'>{requesterName}</span> is
          requesting control of the AI assistant.
        </p>

        <div className='flex gap-3'>
          <Button
            variant='ghost'
            onClick={onApprove}
            className='flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-medium transition-all duration-200 shadow-lg hover:shadow-xl'
            trackId='approve_control_request'
            data-track-category='CALLS'
            data-track-name='APPROVE_CONTROL_REQUEST'
            data-track-metadata={JSON.stringify({ requesterName })}
          >
            <Check className='w-5 h-5' />
            Approve
          </Button>
          <Button
            variant='ghost'
            onClick={onDeny}
            className='flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 text-white font-medium transition-all duration-200 shadow-lg hover:shadow-xl'
            trackId='deny_control_request'
            data-track-event='BUTTON_CLICK'
            data-track-category='CALLS'
            data-track-name='DENY_CONTROL_REQUEST'
            data-track-metadata={JSON.stringify({ requesterName })}
          >
            <XCircle className='w-5 h-5' />
            Deny
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
