import { ReactElement, useState } from 'react';
import { Plug, Plus, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import {
  disconnectInstagramAccount,
  reconnectInstagramAccount,
  addInstagramAccount,
} from '../../../services/clients/socialMediaDeskApi';
import {
  useChannelIntegrationInfo,
  clearChannelConnectedEmailCache,
} from '../../../hooks/useChannelConnectedEmail';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { DeskConnectionCard } from './DeskConnectionCard';
import Button from '../../ui/Button';

interface InstagramDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const InstagramDeskIntegrationCard = ({
  channelId,
  canManage,
}: InstagramDeskIntegrationCardProps): ReactElement | null => {
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [accountAction, setAccountAction] = useState<string | null>(null);
  const { isConnected, hasSource, sourceType, connectedLabel, deskApps } =
    useChannelIntegrationInfo(channelId);
  const { confirm, ConfirmDialog } = useConfirmDialog();

  if (sourceType !== 'instagram' || !hasSource) return null;
  if (!canManage) return null;

  const handleDisconnectAll = async (): Promise<void> => {
    try {
      for (const account of deskApps) {
        await disconnectInstagramAccount(channelId, account.id);
      }
      toast.success('Instagram accounts disconnected. DM history is preserved.');
      clearChannelConnectedEmailCache(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect — please try again.');
      throw err;
    }
  };

  const handleAccountAction = async (
    sourceId: string,
    displayName: string | null,
    reconnect: boolean,
  ): Promise<void> => {
    const key = `${reconnect ? 'reconnect' : 'disconnect'}:${sourceId}`;
    setAccountAction(key);
    try {
      if (reconnect) {
        const accountLabel = displayName ? `@${displayName}` : 'this Instagram account';
        const confirmed = await confirm({
          title: 'Reconnect Instagram account',
          description: `Make sure you are logged into ${accountLabel} on instagram.com before continuing. Instagram will use whichever account is currently active in your browser.`,
          confirmLabel: 'Continue to Instagram',
          cancelLabel: 'Cancel',
        });
        if (!confirmed) return;

        const isElectron = typeof window.electronAPI?.openExternal === 'function';
        const authUrl = await reconnectInstagramAccount(
          channelId,
          sourceId,
          isElectron ? 'electron' : 'web',
        );
        if (isElectron && window.electronAPI?.openExternal) {
          window.electronAPI.openExternal(authUrl);
        } else {
          window.location.href = authUrl;
        }
      } else {
        await disconnectInstagramAccount(channelId, sourceId);
        clearChannelConnectedEmailCache(channelId);
        toast.success('Instagram account disconnected.');
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : `Failed to ${reconnect ? 'reconnect' : 'disconnect'} Instagram account.`,
      );
    } finally {
      setAccountAction(null);
    }
  };

  const handleAddAccount = async (): Promise<void> => {
    setIsAddingAccount(true);
    try {
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const authUrl = await addInstagramAccount(channelId, isElectron ? 'electron' : 'web');
      if (isElectron && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(authUrl);
      } else {
        window.location.href = authUrl;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add Instagram account.');
    } finally {
      setIsAddingAccount(false);
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <DeskConnectionCard
        label='Connected Instagram accounts'
        value={connectedLabel}
        isConnected={isConnected}
        onDisconnect={handleDisconnectAll}
        disconnectTitle='Disconnect Instagram integration'
        disconnectPrompt='Disconnect all Instagram accounts from this desk?'
        disconnectBullets={[
          'New Instagram DMs will stop creating tickets immediately.',
          'Your existing DM history on this desk is kept.',
          'You can reconnect the same Instagram accounts later.',
        ]}
        trackCategory='instagram-desk-integration'
        provider='instagram'
      />

      {deskApps.length > 0 && (
        <div className='flex flex-col gap-2'>
          {deskApps.map(account => {
            const connectionAction = `${account.isActive ? 'disconnect' : 'reconnect'}:${account.id}`;
            return (
              <div
                key={account.id}
                className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3'
              >
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium text-foreground'>
                    {account.displayName
                      ? `@${account.displayName}`
                      : (account.externalIdentifier ?? 'Instagram account')}
                  </p>
                  <p className='truncate text-xs text-muted-foreground'>
                    {account.isActive ? 'Connected' : 'Disconnected'}
                  </p>
                </div>
                <div className='shrink-0'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    loading={accountAction === connectionAction}
                    disabled={accountAction !== null}
                    onClick={() =>
                      void handleAccountAction(account.id, account.displayName, !account.isActive)
                    }
                    data-track-category='instagram-desk-integration'
                    data-track-name='toggle-instagram-account-connection'
                  >
                    {account.isActive ? <Unplug size={14} /> : <Plug size={14} />}
                    {account.isActive ? 'Disconnect' : 'Reconnect'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isConnected && (
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            loading={isAddingAccount}
            onClick={() => void handleAddAccount()}
            data-track-category='instagram-desk-integration'
            data-track-name='add-instagram-account'
          >
            <Plus size={14} />
            Add Instagram account
          </Button>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
};
