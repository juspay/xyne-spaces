import { ReactElement } from 'react';
import { toast } from 'sonner';
import { disconnectAppDesk, reconnectAppDesk } from '../../../services/clients/appDeskApi';
import {
  useChannelIntegrationInfo,
  clearChannelConnectedEmailCache,
} from '../../../hooks/useChannelConnectedEmail';
import { DeskConnectionCard } from './DeskConnectionCard';

interface AppDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const AppDeskIntegrationCard = ({
  channelId,
  canManage,
}: AppDeskIntegrationCardProps): ReactElement | null => {
  const { isConnected, hasSource, sourceType, connectedLabel } =
    useChannelIntegrationInfo(channelId);

  if (sourceType !== 'app-desk' || !hasSource) return null;
  if (!canManage) return null;

  const handleDisconnect = async (): Promise<void> => {
    try {
      await disconnectAppDesk(channelId);
      toast.success('Xyne App disconnected. Conversation history is preserved.');
      clearChannelConnectedEmailCache(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect — please try again.');
      throw err;
    }
  };

  const handleReconnect = async (): Promise<void> => {
    try {
      await reconnectAppDesk(channelId);
      toast.success('Xyne App reconnected.');
      clearChannelConnectedEmailCache(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reconnect — please try again.');
      throw err;
    }
  };

  return (
    <DeskConnectionCard
      label='Connected app'
      value={connectedLabel}
      isConnected={isConnected}
      onDisconnect={handleDisconnect}
      onReconnect={handleReconnect}
      disconnectTitle='Disconnect Xyne App integration'
      disconnectPrompt='Disconnect the Xyne App from this desk?'
      disconnectBullets={[
        'New app messages will stop creating tickets immediately.',
        'Outbound replies will stop delivering to the app.',
        'Your existing conversation history on this desk is kept.',
        'You can reconnect the same app later.',
      ]}
      trackCategory='app-desk-integration'
    />
  );
};
