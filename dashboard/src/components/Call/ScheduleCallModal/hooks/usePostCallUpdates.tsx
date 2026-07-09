import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Lock } from 'lucide-react';
import { ChannelVisibility } from '@xyne/shared';
import type { DropdownListItemType } from '../../../ui/Combobox/Combobox.types';

interface PostCallUpdatesChannel {
  id: string;
  name: string;
  visibility: ChannelVisibility;
}

interface UsePostCallUpdatesParams {
  channels: PostCallUpdatesChannel[];
  participantCount: number;
}

export function usePostCallUpdates({ channels, participantCount }: UsePostCallUpdatesParams) {
  const [postCallUpdates, setPostCallUpdates] = useState(false);
  const [updateChannelId, setUpdateChannelId] = useState<string | null>(null);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const channelInputRef = useRef<HTMLInputElement>(null);

  const updateChannelError = postCallUpdates && !updateChannelId;
  const showPostCallUpdates = participantCount > 0 || postCallUpdates;

  const channelComboboxItems = useMemo((): DropdownListItemType[] => {
    const q = channelSearchQuery.toLowerCase();
    return channels
      .filter(c => c.name.toLowerCase().includes(q))
      .map(c => ({
        value: c.id,
        label: c.name,
        leftSlot:
          c.visibility === ChannelVisibility.PRIVATE ? (
            <Lock className='size-3.5 text-gray-600' strokeWidth={2.3} />
          ) : (
            <Hash className='size-3.5 text-gray-600' strokeWidth={2.3} />
          ),
      }));
  }, [channels, channelSearchQuery]);

  const selectedChannelItem = useMemo((): DropdownListItemType | null => {
    if (!updateChannelId) return null;
    const channel = channels.find(c => c.id === updateChannelId);
    if (!channel) return null;
    return {
      value: channel.id,
      label: channel.name,
      leftSlot:
        channel.visibility === ChannelVisibility.PRIVATE ? (
          <Lock className='size-3.5 text-gray-600' strokeWidth={2.3} />
        ) : (
          <Hash className='size-3.5 text-gray-600' strokeWidth={2.3} />
        ),
    };
  }, [updateChannelId, channels]);

  const resetPostCallUpdates = useCallback((): void => {
    setPostCallUpdates(false);
    setUpdateChannelId(null);
    setChannelSearchQuery('');
    setChannelPickerOpen(false);
  }, []);

  useEffect(() => {
    if (!showPostCallUpdates && postCallUpdates) {
      resetPostCallUpdates();
    }
  }, [showPostCallUpdates, postCallUpdates, resetPostCallUpdates]);

  return {
    channelComboboxItems,
    channelInputRef,
    channelPickerOpen,
    channelSearchQuery,
    postCallUpdates,
    resetPostCallUpdates,
    selectedChannelItem,
    setChannelPickerOpen,
    setChannelSearchQuery,
    setPostCallUpdates,
    setUpdateChannelId,
    showPostCallUpdates,
    updateChannelError,
    updateChannelId,
  };
}
