import { ReactElement } from 'react';
import { Dialog } from '../ui/Dialog/Dialog';
import type { ScheduledMessage } from '../../services/scheduledMessageService';
import ScheduledMessageForm from './ScheduledMessageForm';

interface ScheduledMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduledMessage?: ScheduledMessage;
  onSaved?: () => void;
}

const ScheduledMessageModal = ({
  open,
  onOpenChange,
  scheduledMessage,
  onSaved,
}: ScheduledMessageModalProps): ReactElement => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className='p-6'>
        <ScheduledMessageForm
          {...(scheduledMessage && { scheduledMessage })}
          onSaved={() => {
            onSaved?.();
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </div>
    </Dialog>
  );
};

export default ScheduledMessageModal;
