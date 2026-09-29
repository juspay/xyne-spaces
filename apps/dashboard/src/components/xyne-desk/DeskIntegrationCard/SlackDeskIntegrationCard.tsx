import { ReactElement } from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SlackDeskTriggerMode,
  disconnectSlackDesk,
  listDeskSlackChannels,
  updateSlackDeskTriggerMode,
} from '../../../services/clients/slackDeskApi';
import {
  useChannelIntegrationInfo,
  clearChannelConnectedEmailCache,
} from '../../../hooks/useChannelConnectedEmail';
import { DeskConnectionCard } from './DeskConnectionCard';
import { Switch } from '../../ui/Switch';

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
  const queryClient = useQueryClient();

  const triggerModeKey = ['desk-slack-channels', channelId];
  const { data } = useQuery({
    queryKey: triggerModeKey,
    queryFn: () => listDeskSlackChannels(channelId),
    enabled: canManage && isConnected && sourceType === 'slack-desk',
  });
  const triggerModeMutation = useMutation({
    mutationFn: (mode: SlackDeskTriggerMode) => updateSlackDeskTriggerMode(channelId, mode),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: triggerModeKey }),
    onError: err =>
      toast.error(
        err instanceof Error ? err.message : 'Failed to update ticket trigger — please try again.',
      ),
  });

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

  const triggerMode = data?.triggerMode ?? SlackDeskTriggerMode.ALL_MESSAGES;

  return (
    <div className='flex flex-col gap-[12px]'>
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
        provider='slack'
      />

      {isConnected && (
        <div className='flex items-start justify-between gap-3 rounded-[14px] border border-border bg-background p-[12px] shadow-sm'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-desk-label'>Only create tickets when @-mentioned</div>
            <div className='text-[12px] leading-[16px] text-desk-helper'>
              Off: every Slack message becomes a ticket. On: only a message that tags the bot does —
              anywhere in a thread. Tagging it mid-thread pulls the whole thread in as one ticket
              instead of starting mid-conversation.
            </div>
          </div>
          <Switch
            variant='desk'
            checked={triggerMode === SlackDeskTriggerMode.MENTION_ONLY}
            disabled={triggerModeMutation.isPending}
            aria-label='Only create tickets when @-mentioned'
            onCheckedChange={checked =>
              triggerModeMutation.mutate(
                checked ? SlackDeskTriggerMode.MENTION_ONLY : SlackDeskTriggerMode.ALL_MESSAGES,
              )
            }
            data-track-category='slack-desk-integration'
            data-track-name='ToggleDeskSlackMentionOnly'
          />
        </div>
      )}
    </div>
  );
};
