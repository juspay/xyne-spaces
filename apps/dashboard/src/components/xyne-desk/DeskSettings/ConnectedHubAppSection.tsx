import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Hash, Plus, Waypoints, X } from 'lucide-react';
import { SearchableMultiSelect } from '../../ui/SearchableMultiSelect/SearchableMultiSelect';
import { DisconnectConfirmDialog } from '../DisconnectConfirmDialog';
import {
  addHubChannel,
  getHubDesk,
  listHubChannels,
  removeHubChannel,
  type HubChannel,
} from '../../../services/clients/hubDeskApi';

interface ConnectedHubAppSectionProps {
  channelId: string;
  canManage: boolean;
}

/** HUB desks: the app this desk is for, and which of its channels feed the desk. */
export const ConnectedHubAppSection: React.FC<ConnectedHubAppSectionProps> = ({
  channelId,
  canManage,
}) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-desk', channelId],
    queryFn: () => getHubDesk(channelId),
    enabled: canManage,
  });

  // The endpoints are for the desk owner or a channel admin only.
  if (!canManage) return null;

  return (
    <div className='flex flex-col gap-[24px]'>
      <div className='flex flex-col gap-[16px]'>
        <div className='flex flex-col gap-[4px]'>
          <div className='text-desk-label'>App</div>
          <div className='text-desk-helper w-full max-w-[500px]'>
            New threads in the channels added below become tickets here. The conversation stays in
            its channel, so only that channel&apos;s members can open it.
          </div>
        </div>
        {isLoading ? (
          <div className='flex items-center gap-2 py-3 text-sm text-muted-foreground'>
            <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
            Loading app...
          </div>
        ) : isError ? (
          <p className='text-[12px] leading-[120%] text-red-500'>
            Failed to load the app. Please try again.
          </p>
        ) : !data?.app ? (
          <p className='text-[13px] leading-[18px] text-desk-helper'>
            This desk is no longer linked to an app.
          </p>
        ) : (
          <div className='flex h-[32px] w-full max-w-[480px] items-center gap-2 rounded-[10px] border border-border bg-background px-[10px]'>
            <Waypoints className='h-4 w-4 shrink-0 text-muted-foreground' />
            <span className='truncate text-[13px] text-foreground'>{data.app.name}</span>
          </div>
        )}
      </div>
      {data?.app && <HubChannelsSection channelId={channelId} />}
    </div>
  );
};

/** The app's channels feeding this desk: add from the ones it created, or remove. */
const HubChannelsSection: React.FC<{ channelId: string }> = ({ channelId }) => {
  const queryClient = useQueryClient();
  const queryKey = ['hub-desk-channels', channelId];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<HubChannel | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => listHubChannels(channelId),
  });

  const addMutation = useMutation({
    mutationFn: (sourceChannelId: string) => addHubChannel(channelId, sourceChannelId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: () => toast.error('Failed to add the channel. Please try again.'),
  });

  const removeMutation = useMutation({
    mutationFn: (sourceChannelId: string) => removeHubChannel(channelId, sourceChannelId),
    onSuccess: () => {
      setPendingRemove(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => toast.error('Failed to remove the channel. Please try again.'),
  });

  return (
    <div className='flex flex-col gap-[16px]'>
      <div className='flex flex-col gap-[4px]'>
        <div className='text-desk-label'>Channels</div>
        <div className='text-desk-helper w-full max-w-[500px]'>
          New threads in these channels become tickets here. Pick from the channels this app
          created; a channel can be on one desk at a time.
        </div>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 py-3 text-sm text-muted-foreground'>
          <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
          Loading channels...
        </div>
      ) : isError ? (
        <p className='text-[12px] leading-[120%] text-red-500'>
          Failed to load the channels. Please try again.
        </p>
      ) : (
        <div className='flex w-full max-w-[500px] flex-wrap items-center gap-[6px]'>
          {data?.added.map(channel => (
            <div
              key={channel.id}
              className='inline-flex shrink-0 items-center gap-[4px] whitespace-nowrap rounded-[6px] bg-desk-accent-subtle py-[2px] pl-[6px] pr-[4px]'
            >
              <Hash size={13} className='shrink-0 text-desk-accent-foreground' />
              <span className='max-w-[220px] truncate text-[13px] font-medium leading-[18px] tracking-[-0.2px] text-desk-accent-foreground'>
                {channel.name}
              </span>
              <button
                type='button'
                onClick={() => setPendingRemove(channel)}
                className='text-desk-accent-foreground hover:text-foreground'
                data-track-category='DeskSettings'
                data-track-name='HUB_REMOVE_CHANNEL'
                aria-label={`Remove ${channel.name}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {!!data?.available.length && (
            <SearchableMultiSelect
              options={data.available.map(channel => ({
                value: channel.id,
                label: channel.name,
                icon: <Hash size={13} className='shrink-0 text-muted-foreground' />,
              }))}
              selectedValues={[]}
              onSelectedValuesChange={next => next.forEach(id => addMutation.mutate(id))}
              isOpen={pickerOpen}
              onOpenChange={setPickerOpen}
              searchPlaceholder='Search channels...'
              searchAriaLabel='Search channels'
              listAriaLabel='Channels'
              emptyMessage='No matching channels'
              align='start'
              trackCategory='DeskSettings'
              trackName='HUB_ADD_CHANNEL'
              trigger={
                <button
                  type='button'
                  className='inline-flex h-[28px] items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-desk-label text-foreground shadow-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50'
                  disabled={addMutation.isPending}
                  data-track-category='DeskSettings'
                  data-track-name='HUB_OPEN_ADD_CHANNEL'
                >
                  <Plus size={14} />
                  <span>Add channel</span>
                </button>
              }
            />
          )}
          {!data?.added.length && !data?.available.length && (
            <div className='text-desk-helper'>
              This app hasn&apos;t created any channels yet. Ones it creates show up here.
            </div>
          )}
        </div>
      )}

      <DisconnectConfirmDialog
        open={!!pendingRemove}
        onOpenChange={open => !open && setPendingRemove(null)}
        title='Remove channel from this desk'
        prompt={`Remove #${pendingRemove?.name ?? 'this channel'} from this desk?`}
        bullets={[
          'New threads in this channel will stop creating tickets.',
          'Tickets already created stay on this desk.',
          'You can add the channel again later.',
        ]}
        isPending={removeMutation.isPending}
        onConfirm={() => pendingRemove && removeMutation.mutate(pendingRemove.id)}
        trackCategory='DeskSettings'
      />
    </div>
  );
};
