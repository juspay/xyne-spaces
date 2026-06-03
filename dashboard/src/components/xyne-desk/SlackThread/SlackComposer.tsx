import { ReactElement, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiInstance, BASE_URL } from '../../../services/clients/apiClient';
import { useSlackUserAuth, useDisconnectSlackUser } from '../../../hooks/useSlackUserAuth';

interface SlackComposerProps {
  conversationId: string;
}

const SlackComposer = ({ conversationId }: SlackComposerProps): ReactElement => {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const { data: slackAuth, isLoading: authLoading } = useSlackUserAuth();
  const disconnectMutation = useDisconnectSlackUser();

  const handleSend = async (): Promise<void> => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await apiInstance.post(`/integrations/slack-desk/${conversationId}/reply`, {
        body: trimmed,
      });
      setBody('');
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleConnect = () => {
    window.location.href = `${BASE_URL}/integrations/slack-user/connect`;
  };

  const handleDisconnect = () => {
    disconnectMutation.mutate(undefined, {
      onError: () => toast.error('Failed to disconnect Slack account'),
    });
  };

  return (
    <div className='px-4 py-3 border-t border-border'>
      {!authLoading && (
        <div className='flex items-center gap-2 mb-2 text-xs text-muted-foreground'>
          {slackAuth?.connected ? (
            <>
              <span className='inline-block size-1.5 rounded-full bg-green-500' />
              <span>Replying as you</span>
              <button
                type='button'
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className='text-xs text-muted-foreground underline hover:text-foreground cursor-pointer'
                data-track-category='slack-composer'
                data-track-name='disconnect-slack-user'
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <span className='inline-block size-1.5 rounded-full bg-muted-foreground' />
              <span>Replying as Xyne Bot</span>
              <button
                type='button'
                onClick={handleConnect}
                className='text-xs text-primary underline hover:text-primary/80 cursor-pointer'
                data-track-category='slack-composer'
                data-track-name='connect-slack-user'
              >
                Connect your Slack
              </button>
            </>
          )}
        </div>
      )}
      <div className='flex items-end gap-2'>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder='Reply to thread...'
          rows={1}
          className='flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground'
          data-track-category='slack-composer'
          data-track-name='compose-reply'
        />
        <button
          type='button'
          onClick={() => void handleSend()}
          disabled={!body.trim() || sending}
          className='inline-flex items-center justify-center size-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer'
          data-track-category='slack-composer'
          data-track-name='send-reply'
        >
          {sending ? <Loader2 size={16} className='animate-spin' /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
};

export default SlackComposer;
