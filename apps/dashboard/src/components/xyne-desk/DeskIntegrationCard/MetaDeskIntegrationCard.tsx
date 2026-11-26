import { ReactElement } from 'react';
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
import { oauthPlatform, openOAuthUrl } from '../../../utils/oauthRedirect';
import { MultiAccountDeskCard } from './MultiAccountDeskCard';

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
  const { isConnected, hasSource, sourceType, deskApps } = useChannelIntegrationInfo(channelId);
  const { confirm, ConfirmDialog } = useConfirmDialog();

  if (sourceType !== provider || !hasSource || !canManage) {
    return null;
  }
  const p = PROVIDERS[provider];

  return (
    <MultiAccountDeskCard
      trackCategory={`${provider}-desk-integration`}
      provider={provider}
      accounts={deskApps}
      isConnected={isConnected}
      noun={{ one: p.account, many: p.accounts }}
      handlePrefix={p.handlePrefix}
      accountSlug={p.accountSlug}
      disconnectAll={{
        title: `Disconnect ${p.name} integration`,
        bullets: [
          p.stopBullet,
          `Your existing ${p.history} on this desk is kept.`,
          `You can reconnect the same ${p.accounts} later.`,
        ],
        successMessage: `${p.accounts} disconnected. ${p.history} is preserved.`,
      }}
      disconnect={sourceId => p.disconnect(channelId, sourceId)}
      onReconnect={async (account, label) => {
        const confirmed = await confirm({
          title: `Reconnect ${p.account}`,
          description: p.reconnectHint(account.displayName ? label : `this ${p.account}`),
          confirmLabel: `Continue to ${p.name}`,
          cancelLabel: 'Cancel',
        });
        if (!confirmed) {
          return;
        }
        openOAuthUrl(await p.reconnect(channelId, account.id, oauthPlatform()));
      }}
      onAdd={async () => openOAuthUrl(await p.add(channelId, oauthPlatform()))}
      onChanged={() => clearChannelConnectedEmailCache(channelId)}
    >
      <ConfirmDialog />
    </MultiAccountDeskCard>
  );
};
