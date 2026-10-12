import { ReactElement, useState } from 'react';
import { Plug, Plus, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import {
  disconnectInstagramAccount,
  reconnectInstagramAccount,
  addInstagramAccount,
  disconnectFacebookPage,
  reconnectFacebookPage,
  addFacebookPage,
} from '../../../services/clients/socialMediaDeskApi';
import {
  useChannelIntegrationInfo,
  clearChannelConnectedEmailCache,
} from '../../../hooks/useChannelConnectedEmail';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { DeskConnectionCard } from './DeskConnectionCard';
import Button from '../../ui/Button';

type MetaProvider = 'instagram' | 'facebook';

const PROVIDERS = {
  instagram: {
    name: 'Instagram',
    account: 'Instagram account',
    accounts: 'Instagram accounts',
    accountSlug: 'instagram-account',
    handlePrefix: '@',
    history: 'DM history',
    stopBullet: 'New Instagram DMs will stop creating tickets immediately.',
    reconnectHint: (label: string) =>
      `Make sure you are logged into ${label} on instagram.com before continuing. Instagram will use whichever account is currently active in your browser.`,
    disconnect: disconnectInstagramAccount,
    reconnect: reconnectInstagramAccount,
    add: addInstagramAccount,
  },
  facebook: {
    name: 'Facebook',
    account: 'Facebook Page',
    accounts: 'Facebook Pages',
    accountSlug: 'facebook-page',
    handlePrefix: '',
    history: 'message history',
    stopBullet:
      'New Facebook messages, comments and mentions will stop creating tickets immediately.',
    reconnectHint: (label: string) =>
      `Make sure you are logged into the Facebook account that manages ${label}, and keep that Page selected when Facebook asks which Pages to share.`,
    disconnect: disconnectFacebookPage,
    reconnect: reconnectFacebookPage,
    add: addFacebookPage,
  },
} as const;

interface MetaDeskIntegrationCardProps {
  provider: MetaProvider;
  channelId: string;
  canManage: boolean;
}

export const MetaDeskIntegrationCard = ({
  provider,
  channelId,
  canManage,
}: MetaDeskIntegrationCardProps): ReactElement | null => {
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [accountAction, setAccountAction] = useState<string | null>(null);
  const { isConnected, hasSource, sourceType, connectedLabel, deskApps } =
    useChannelIntegrationInfo(channelId);
  const { confirm, ConfirmDialog } = useConfirmDialog();

  if (sourceType !== provider || !hasSource) return null;
  if (!canManage) return null;

  const p = PROVIDERS[provider];
  const trackCategory = `${provider}-desk-integration`;

  const handleDisconnectAll = async (): Promise<void> => {
    try {
      for (const account of deskApps) {
        await p.disconnect(channelId, account.id);
      }
      toast.success(`${p.accounts} disconnected. ${p.history} is preserved.`);
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
        const accountLabel = displayName ? `${p.handlePrefix}${displayName}` : `this ${p.account}`;
        const confirmed = await confirm({
          title: `Reconnect ${p.account}`,
          description: p.reconnectHint(accountLabel),
          confirmLabel: `Continue to ${p.name}`,
          cancelLabel: 'Cancel',
        });
        if (!confirmed) return;

        const isElectron = typeof window.electronAPI?.openExternal === 'function';
        const authUrl = await p.reconnect(channelId, sourceId, isElectron ? 'electron' : 'web');
        if (isElectron && window.electronAPI?.openExternal) {
          window.electronAPI.openExternal(authUrl);
        } else {
          window.location.href = authUrl;
        }
      } else {
        await p.disconnect(channelId, sourceId);
        clearChannelConnectedEmailCache(channelId);
        toast.success(`${p.account} disconnected.`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : `Failed to ${reconnect ? 'reconnect' : 'disconnect'} ${p.account}.`,
      );
    } finally {
      setAccountAction(null);
    }
  };

  const handleAddAccount = async (): Promise<void> => {
    setIsAddingAccount(true);
    try {
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const authUrl = await p.add(channelId, isElectron ? 'electron' : 'web');
      if (isElectron && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(authUrl);
      } else {
        window.location.href = authUrl;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to add ${p.account}.`);
    } finally {
      setIsAddingAccount(false);
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <DeskConnectionCard
        label={`Connected ${p.accounts}`}
        value={connectedLabel}
        isConnected={isConnected}
        onDisconnect={handleDisconnectAll}
        disconnectTitle={`Disconnect ${p.name} integration`}
        disconnectPrompt={`Disconnect all ${p.accounts} from this desk?`}
        disconnectBullets={[
          p.stopBullet,
          `Your existing ${p.history} on this desk is kept.`,
          `You can reconnect the same ${p.accounts} later.`,
        ]}
        trackCategory={trackCategory}
        provider={provider}
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
                      ? `${p.handlePrefix}${account.displayName}`
                      : (account.externalIdentifier ?? p.account)}
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
                    data-track-category={trackCategory}
                    data-track-name={`toggle-${p.accountSlug}-connection`}
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
            data-track-category={trackCategory}
            data-track-name={`add-${p.accountSlug}`}
          >
            <Plus size={14} />
            Add {p.account}
          </Button>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
};
