import { ReactElement } from 'react';
import { toast } from 'sonner';
import { disconnectInstagramDesk, reconnectInstagramDesk } from '../../../services/clients/socialMediaDeskApi';
import {
  useChannelIntegrationInfo,
  clearChannelConnectedEmailCache,
} from '../../../hooks/useChannelConnectedEmail';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { DeskConnectionCard } from './DeskConnectionCard';

interface InstagramDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const InstagramDeskIntegrationCard = ({
  channelId,
  canManage,
}: InstagramDeskIntegrationCardProps): ReactElement | null => {
  const { isConnected, hasSource, sourceType, connectedLabel } =
    useChannelIntegrationInfo(channelId);
  const { confirm, ConfirmDialog } = useConfirmDialog();

  if (sourceType !== 'instagram' || !hasSource) return null;
  if (!canManage) return null;

  const handleDisconnect = async (): Promise<void> => {
    try {
      await disconnectInstagramDesk(channelId);
      toast.success('Instagram account disconnected. DM history is preserved.');
      clearChannelConnectedEmailCache(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect — please try again.');
      throw err;
    }
  };

  const handleReconnect = async (): Promise<void> => {
    const accountLabel = connectedLabel ? `@${connectedLabel}` : 'the connected Instagram account';
    const confirmed = await confirm({
      title: 'Reconnect Instagram account',
      description: `Make sure you are logged into ${accountLabel} on instagram.com before continuing. Instagram does not show an account picker — it will use whichever account is currently active in your browser.`,
      confirmLabel: 'Continue to Instagram',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;

    try {
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const authUrl = await reconnectInstagramDesk(channelId, isElectron ? 'electron' : 'web');
      if (isElectron && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(authUrl);
      } else {
        window.location.href = authUrl;
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to start reconnect — please try again.',
      );
      throw err;
    }
  };

  return (
    <>
      <DeskConnectionCard
        label='Connected Instagram account'
        value={connectedLabel}
        isConnected={isConnected}
        onDisconnect={handleDisconnect}
        onReconnect={handleReconnect}
        disconnectTitle='Disconnect Instagram integration'
        disconnectPrompt='Disconnect this Instagram account from the desk?'
        disconnectBullets={[
          'New Instagram DMs will stop creating tickets immediately.',
          'Your existing DM history on this desk is kept.',
          'You can reconnect with the same Instagram account later.',
        ]}
        trackCategory='instagram-desk-integration'
      />
      <ConfirmDialog />
    </>
  );
};
