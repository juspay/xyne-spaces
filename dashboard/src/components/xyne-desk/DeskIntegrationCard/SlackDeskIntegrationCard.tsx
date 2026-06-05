import { ReactElement, useState } from 'react';
import { toast } from 'sonner';
import { Hash, Unplug, AlertTriangle } from 'lucide-react';
import { disconnectSlackDesk } from '../../../services/clients/slackDeskApi';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';

interface SlackDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

/**
 * Disconnect control for a Slack desk. Unlike the email desk, a Slack desk
 * has no mailbox address or reconnect-OAuth flow — disconnecting just
 * soft-deactivates the channel's ExternalSource (isActive = false) so new
 * Slack messages stop syncing; existing history is preserved.
 */
export const SlackDeskIntegrationCard = ({
  channelId,
  canManage,
}: SlackDeskIntegrationCardProps): ReactElement | null => {
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Non-managers get no action UI; the server-side ACL is the authoritative gate.
  if (!canManage) return null;

  const handleDisconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    try {
      await disconnectSlackDesk(channelId);
      toast.success('Slack desk disconnected. Message history is preserved.');
      setShowDisconnectConfirm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect — please try again.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className='bg-card p-3 rounded-xl border border-border'>
      <div className='flex flex-col gap-y-2'>
        <p className='text-sm font-medium text-foreground'>Slack integration</p>
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Hash size={14} className='flex-shrink-0' />
          <span className='text-xs'>Slack messages sync into this desk.</span>
        </div>
        <div className='flex items-center gap-2 pt-1'>
          <Button
            variant='destructive'
            size='sm'
            onClick={() => setShowDisconnectConfirm(true)}
            disabled={isDisconnecting}
            data-track-category='slack-desk-integration'
            data-track-name='open-disconnect-confirm'
          >
            <Unplug size={14} className='mr-1.5' />
            Disconnect
          </Button>
        </div>
      </div>

      <Dialog
        open={showDisconnectConfirm}
        onOpenChange={open => !open && setShowDisconnectConfirm(false)}
        title='Disconnect Slack integration'
      >
        <div className='p-5 flex flex-col gap-3'>
          <div className='flex gap-3'>
            <AlertTriangle size={18} className='flex-shrink-0 text-amber-500 mt-0.5' />
            <div className='flex flex-col gap-2 text-sm'>
              <p className='text-foreground'>Disconnect Slack from this desk?</p>
              <ul className='text-muted-foreground list-disc pl-4 space-y-1 text-xs'>
                <li>New Slack messages will stop syncing immediately.</li>
                <li>Your existing message history on this desk is kept.</li>
              </ul>
            </div>
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => setShowDisconnectConfirm(false)}
              disabled={isDisconnecting}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting}
              data-track-category='slack-desk-integration'
              data-track-name='confirm-disconnect'
            >
              {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
