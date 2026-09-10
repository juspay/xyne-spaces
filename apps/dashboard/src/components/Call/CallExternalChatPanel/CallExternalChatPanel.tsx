import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Button from '../../ui/Button';
import { ExternalChatMessages, useExternalChatMessages } from '../ExternalChatMessages';

interface CallExternalChatPanelProps {
  callExternalId: string;
}

export function CallExternalChatPanel({ callExternalId }: CallExternalChatPanelProps) {
  const navigate = useNavigate();
  const { messages, loading, error } = useExternalChatMessages({
    callExternalId,
  });

  return (
    <div className='flex flex-col h-full bg-background'>
      {/* Header */}
      <div className='bg-background border-b border-border p-2 md:p-4 flex items-center gap-2'>
        <Button
          variant='ghost'
          size='iconSm'
          onClick={() => void navigate(-1)}
          aria-label='Go back'
          data-track-category='CALLS'
          data-track-name='Go_Back_From_External_Chat'
        >
          <ArrowLeft size={16} />
        </Button>
        <h3 className='text-sm font-semibold text-foreground'>External Chat History</h3>
      </div>

      {/* Messages */}
      <div className='flex-1 overflow-y-auto py-2'>
        <ExternalChatMessages messages={messages} loading={loading} error={error} />
      </div>
    </div>
  );
}
