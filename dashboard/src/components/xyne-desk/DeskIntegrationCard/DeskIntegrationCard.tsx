import { ReactElement, useState } from 'react';
import { toast } from 'sonner';
import { Mail, Plug, Unplug, AlertTriangle } from 'lucide-react';
import {
  disconnectDeskIntegration,
  initDeskIntegrationReconnect,
} from '../../../services/clients/deskIntegrationApi';
import {
  useChannelIntegrationInfo,
  clearChannelConnectedEmailCache,
} from '../../../hooks/useChannelConnectedEmail';
import { clearDeskContactsCache } from '../../../hooks/useDeskContacts';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';

interface DeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const DeskIntegrationCard = ({
  channelId,
  canManage,
}: DeskIntegrationCardProps): ReactElement | null => {
  const { email: connectedEmail, isConnected, hasSource } = useChannelIntegrationInfo(channelId);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  if (!hasSource || !connectedEmail) return null;

  const handleDisconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    try {
      await disconnectDeskIntegration(channelId);
      toast.success('Mailbox disconnected. Email history is preserved.');
      setShowDisconnectConfirm(false);
      clearChannelConnectedEmailCache(channelId);
      clearDeskContactsCache(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect — please try again.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleReconnect = async (): Promise<void> => {
    setIsReconnecting(true);
    try {
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const authUrl = await initDeskIntegrationReconnect(
        channelId,
        isElectron ? 'electron' : 'web',
      );
      if (isElectron && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(authUrl);
        setIsReconnecting(false);
      } else {
        window.location.href = authUrl;
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to start reconnect — please try again.',
      );
      setIsReconnecting(false);
    }
  };

  return (
    <div className='bg-card p-3 rounded-xl border border-border'>
      <div className='flex flex-col gap-y-2'>
        <p className='text-sm font-medium text-foreground'>Email integration</p>
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Mail size={14} className='flex-shrink-0' />
          <span className='truncate font-mono text-xs' title={connectedEmail}>
            {connectedEmail}
          </span>
        </div>
        {/* Non-managers (neither channel creator nor desk owner) get no
            action UI and no "you can't do this" copy — just the read-only
            email display above. The server-side ACL on the disconnect /
            reconnect endpoints is the authoritative gate; this is purely
            visual cleanup so the panel doesn't advertise actions the
            user can't take. */}
        {canManage && (
          <div className='flex items-center gap-2 pt-1'>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => void handleReconnect()}
              disabled={isReconnecting || isDisconnecting}
              data-track-category='desk-integration'
              data-track-name='reconnect'
            >
              <Plug size={14} className='mr-1.5' />
              {isReconnecting ? 'Redirecting…' : isConnected ? 'Reconnect' : 'Reconnect mailbox'}
            </Button>
            {isConnected && (
              <Button
                variant='destructive'
                size='sm'
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={isReconnecting || isDisconnecting}
                data-track-category='desk-integration'
                data-track-name='open-disconnect-confirm'
              >
                <Unplug size={14} className='mr-1.5' />
                Disconnect
              </Button>
            )}
            {!isConnected && (
              <span className='text-xs text-muted-foreground'>Currently disconnected</span>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={showDisconnectConfirm}
        onOpenChange={open => !open && setShowDisconnectConfirm(false)}
        title='Disconnect email integration'
      >
        <div className='p-5 flex flex-col gap-3'>
          <div className='flex gap-3'>
            <AlertTriangle size={18} className='flex-shrink-0 text-amber-500 mt-0.5' />
            <div className='flex flex-col gap-2 text-sm'>
              <p className='text-foreground'>
                Disconnect <span className='font-mono text-xs'>{connectedEmail}</span> from this
                desk?
              </p>
              <ul className='text-muted-foreground list-disc pl-4 space-y-1 text-xs'>
                <li>New emails will stop syncing immediately.</li>
                <li>Your existing email history on this desk is kept.</li>
                <li>You can reconnect later with the same mailbox.</li>
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
              data-track-category='desk-integration'
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
