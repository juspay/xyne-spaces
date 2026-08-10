import { ReactElement } from 'react';
import { GOOGLE_PLAY_REVIEWS_SOURCE_TYPE } from '@xyne/shared';
import { toast } from 'sonner';
import {
  disconnectSocialMediaDesk,
  reconnectSocialMediaDesk,
} from '../../../services/clients/socialMediaDeskApi';
import {
  clearChannelConnectedEmailCache,
  useChannelIntegrationInfo,
} from '../../../hooks/useChannelConnectedEmail';
import { DeskConnectionCard } from './DeskConnectionCard';

interface SocialMediaDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const SocialMediaDeskIntegrationCard = ({
  channelId,
  canManage,
}: SocialMediaDeskIntegrationCardProps): ReactElement | null => {
  const { isConnected, hasSource, sourceType, connectedLabel } =
    useChannelIntegrationInfo(channelId);

  if (sourceType !== GOOGLE_PLAY_REVIEWS_SOURCE_TYPE || !hasSource) {
    return null;
  }
  if (!canManage) return null;

  const handleDisconnect = async (): Promise<void> => {
    try {
      await disconnectSocialMediaDesk(channelId);
      clearChannelConnectedEmailCache(channelId);
      toast.success('Google Play apps disconnected. Existing tickets are preserved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to disconnect review source.');
      throw error;
    }
  };

  const handleReconnect = async (): Promise<void> => {
    try {
      await reconnectSocialMediaDesk(channelId);
      clearChannelConnectedEmailCache(channelId);
      toast.success('Google Play apps reconnected.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reconnect review source.');
      throw error;
    }
  };

  return (
    <DeskConnectionCard
      label='Connected Google Play apps'
      value={connectedLabel}
      isConnected={isConnected}
      onDisconnect={handleDisconnect}
      onReconnect={handleReconnect}
      disconnectTitle='Disconnect review integration'
      disconnectPrompt='Disconnect all Google Play apps from this desk?'
      disconnectBullets={[
        'New reviews will stop creating tickets.',
        'Replies from this desk will stop.',
        'Existing review tickets and analytics are kept.',
        'You can reconnect this source later.',
      ]}
      trackCategory='social-media-desk-integration'
    />
  );
};
