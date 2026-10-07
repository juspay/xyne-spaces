import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Hash, Plus, Unplug } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { DisconnectConfirmDialog } from '../DisconnectConfirmDialog';
import {
  SlackDeskTriggerMode,
  connectSlackToDesk,
  disconnectSlackDesk,
  listAvailableSlackChannels,
  listDeskSlackChannels,
  updateSlackDeskTriggerMode,
} from '../../../services/clients/slackDeskApi';

interface ConnectedSlackSectionProps {
  channelId: string;
  canManage: boolean;
}

export const ConnectedSlackSection: React.FC<ConnectedSlackSectionProps> = ({
  channelId,
  canManage,
}) => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  // Confirmed, not instant: Slack is push-only, so messages sent while off are lost.
  const [pendingDisconnect, setPendingDisconnect] = useState<string | null>(null);

  const connectedKey = ['desk-slack-channels', channelId];
  const { data, isLoading, isError } = useQuery({
    queryKey: connectedKey,
    queryFn: () => listDeskSlackChannels(channelId),
    enabled: canManage,
  });
  const connected = data?.slackChannels;
  const triggerMode = data?.triggerMode ?? SlackDeskTriggerMode.ALL_MESSAGES;

  // Same endpoint as the create-desk picker; 503s when the workspace source isn't seeded.
  const { data: available, isError: pickerUnavailable } = useQuery({
    queryKey: ['slack-desk-channels'],
    queryFn: listAvailableSlackChannels,
    enabled: canManage,
    retry: false,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: connectedKey });
    // alreadyConnected on the picker changes with every bind/unbind.
    void queryClient.invalidateQueries({ queryKey: ['slack-desk-channels'] });
  };

  const onError = (err: unknown, fallback: string): void => {
    toast.error(err instanceof Error ? err.message : fallback);
  };

  const connectMutation = useMutation({
    mutationFn: (slackChannelId: string) => connectSlackToDesk(channelId, slackChannelId),
    onSuccess: () => {
      setSelected('');
      toast.success('Slack channel connected to this desk.');
      refresh();
    },
    onError: err => onError(err, 'Failed to connect Slack channel — please try again.'),
  });

  const disconnectMutation = useMutation({
    mutationFn: (slackChannelId: string) => disconnectSlackDesk(channelId, slackChannelId),
    onSuccess: () => {
      setPendingDisconnect(null);
      toast.success('Slack channel disconnected.');
      refresh();
    },
    onError: err => onError(err, 'Failed to disconnect Slack channel — please try again.'),
  });

  const triggerModeMutation = useMutation({
    mutationFn: (mode: SlackDeskTriggerMode) => updateSlackDeskTriggerMode(channelId, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectedKey });
    },
    onError: err => onError(err, 'Failed to update ticket trigger — please try again.'),
  });

  // The binding stores only the Slack channel id, so names come from the picker list.
  const nameById = new Map((available ?? []).map(c => [c.id, c.name]));
  const label = (id: string | null): string => (id ? `#${nameById.get(id) ?? id}` : 'Unknown');
  // alreadyConnected is workspace-wide, so it already covers this desk's own bindings.
  const connectable = (available ?? []).filter(c => !c.alreadyConnected);

  // Backend restricts these routes to desk managers, so hide the section for everyone else.
  if (!canManage) return null;

  return (
    <div className='flex flex-col gap-[16px]'>
      <div className='flex flex-col gap-[4px]'>
        <div className='text-desk-label'>Connected Slack channels</div>
        <div className='text-desk-helper w-full max-w-[500px]'>
          Messages in these Slack channels create tickets on this desk, and replies post back into
          the Slack thread. Other sources on this desk are unaffected.
        </div>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 py-3 text-sm text-muted-foreground'>
          <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
          Loading Slack channels...
        </div>
      ) : isError ? (
        <p className='text-[12px] leading-[120%] text-red-500'>
          Couldn&apos;t load Slack channels for this desk.
        </p>
      ) : !connected?.length ? (
        <p className='text-[13px] leading-[18px] text-desk-helper'>
          No Slack channels connected to this desk yet.
        </p>
      ) : (
        <div className='flex w-full max-w-[480px] max-h-[240px] overflow-y-auto flex-col gap-[6px] rounded-[14px] border border-border bg-background p-[6px] shadow-sm'>
          {connected.map(slack => (
            <div
              key={slack.sourceId}
              className='group flex h-[32px] items-center justify-between rounded-[10px] px-[10px] py-[8px] transition-colors hover:bg-muted/60'
            >
              <div className='flex min-w-0 items-center gap-2'>
                <Hash size={16} className='shrink-0 text-muted-foreground' />
                <span className='truncate text-desk-label'>{label(slack.slackChannelId)}</span>
              </div>
              {slack.slackChannelId && (
                <button
                  type='button'
                  onClick={() => setPendingDisconnect(slack.slackChannelId)}
                  disabled={disconnectMutation.isPending}
                  className='flex shrink-0 items-center gap-1 text-[13px] font-medium leading-[120%] tracking-[-0.1px] text-desk-muted transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50'
                  data-track-category='DeskSettings'
                  data-track-name='DisconnectDeskSlackChannel'
                >
                  <Unplug size={14} className='shrink-0' />
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isLoading && !isError && !!connected?.length && (
        <div className='flex w-full max-w-[480px] items-start justify-between gap-3 rounded-[14px] border border-border bg-background p-[12px] shadow-sm'>
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
            data-track-category='DeskSettings'
            data-track-name='ToggleDeskSlackMentionOnly'
          />
        </div>
      )}

      {!isLoading && !isError && !pickerUnavailable && connectable.length > 0 && (
        <div className='flex w-full max-w-[480px] items-center gap-2'>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Select a Slack channel' />
            </SelectTrigger>
            <SelectContent>
              {connectable.map(slack => (
                <SelectItem key={slack.id} value={slack.id}>
                  #{slack.name}
                  {slack.is_private && (
                    <span className='ml-2 text-xs text-muted-foreground'>private</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type='button'
            onClick={() => selected && connectMutation.mutate(selected)}
            disabled={!selected || connectMutation.isPending}
            className='inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-desk-label text-foreground shadow-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50'
            data-track-category='DeskSettings'
            data-track-name='ConnectDeskSlackChannel'
          >
            <Plus size={14} />
            <span>{connectMutation.isPending ? 'Connecting…' : 'Connect'}</span>
          </button>
        </div>
      )}

      <DisconnectConfirmDialog
        open={!!pendingDisconnect}
        onOpenChange={open => !open && setPendingDisconnect(null)}
        title='Disconnect Slack channel from this desk'
        prompt={`Disconnect ${label(pendingDisconnect)} from this desk?`}
        bullets={[
          'New Slack messages will stop creating tickets immediately.',
          'Other Slack channels and sources on this desk are unaffected.',
          'Existing tickets are kept, but anything sent while disconnected is lost — reconnecting does not backfill it.',
        ]}
        isPending={disconnectMutation.isPending}
        onConfirm={() => pendingDisconnect && disconnectMutation.mutate(pendingDisconnect)}
        trackCategory='DeskSettings'
      />
    </div>
  );
};
