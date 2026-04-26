import { useEffect } from 'react';
import Dialog from '../../ui/Dialog';
import { ExternalChatMessages, useExternalChatMessages } from '../ExternalChatMessages';

interface CallExternalChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callExternalId: string;
}

export function CallExternalChatDialog({
  open,
  onOpenChange,
  callExternalId,
}: CallExternalChatDialogProps) {
  const { messages, loading, error, reset } = useExternalChatMessages({
    callExternalId,
    enabled: open,
  });

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className='max-w-lg'>
      <div className='flex flex-col w-full max-h-[70vh] overflow-hidden'>
        {/* Header */}
        <div className='px-4 py-3 border-b border-border'>
          <h3 className='text-sm font-semibold text-foreground'>External Chat History</h3>
        </div>

        {/* Messages */}
        <div className='flex-1 overflow-y-auto py-2 min-h-[200px]'>
          <ExternalChatMessages messages={messages} loading={loading} error={error} />
        </div>
      </div>
    </Dialog>
  );
}
