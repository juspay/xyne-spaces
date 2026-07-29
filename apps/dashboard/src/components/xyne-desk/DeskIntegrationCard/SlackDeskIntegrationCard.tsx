import { ReactElement } from 'react';
import { toast } from 'sonner';
import { disconnectSlackDesk } from '../../../services/clients/slackDeskApi';
import {
  useChannelIntegrationInfo,
  clearChannelConnectedEmailCache,
} from '../../../hooks/useChannelConnectedEmail';
import { DeskConnectionCard } from './DeskConnectionCard';

interface SlackDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const SlackDeskIntegrationCard = ({
  channelId,
  canManage,
}: SlackDeskIntegrationCardProps): ReactElement | null => {
  const { isConnected, hasSource, sourceType, connectedLabel } =
    useChannelIntegrationInfo(channelId);

  if (sourceType !== 'slack-desk' || !hasSource) return null;
  // Non-managers get no action UI; the server-side ACL is the authoritative gate.
  if (!canManage) return null;

  const handleDisconnect = async (): Promise<void> => {
    try {
      await disconnectSlackDesk(channelId);
      toast.success('Slack desk disconnected. Message history is preserved.');
      clearChannelConnectedEmailCache(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect — please try again.');
      throw err;
    }
  };

  return (
    <DeskConnectionCard
      label='Connected channel'
      value={connectedLabel}
      isConnected={isConnected}
      onDisconnect={handleDisconnect}
      disconnectTitle='Disconnect Slack integration'
      disconnectPrompt='Disconnect Slack from this desk?'
      disconnectBullets={[
        'New Slack messages will stop syncing immediately.',
        'Your existing message history on this desk is kept.',
      ]}
      trackCategory='slack-desk-integration'
    />
  );
};
