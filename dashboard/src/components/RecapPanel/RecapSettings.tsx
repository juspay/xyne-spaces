import { ReactElement, useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { toast } from 'sonner';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Check, Search, Lock, Hash, X, Loader2, Sparkles } from 'lucide-react';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import type { Channel } from '@xyne/shared';
import { useRecapData } from '../../hooks/useRecapData';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useAuth } from '../../hooks/useAuth';
import type { ChannelListItemProps, RecapSettingsProps } from './RecapPanel.types';
import { useAllVisibleChannels } from '../../hooks/useChannels';
import { useCheckChannelRecap, RecapStatus } from '../../hooks/useCheckChannelRecap';

interface ChannelListItemWithRecapProps extends ChannelListItemProps {
  isExistingSubscription: boolean;
  isCheckingRecap: boolean;
  recapStatus: RecapStatus;
}

const ChannelListItem = ({
  channel,
  isSelected,
  onToggle,
  currentUserId,
  isCheckingRecap,
  recapStatus,
}: ChannelListItemWithRecapProps): ReactElement => {
  const { displayName } = useChannelDisplayName(channel, currentUserId || '');

  const getIcon = (): ReactElement => {
    return channel.visibility === ChannelVisibility.PRIVATE ? (
      <Lock size={14} className='text-gray-500 flex-shrink-0' />
    ) : (
      <Hash size={14} className='text-gray-500 flex-shrink-0' />
    );
  };

  // Render recap status based on channel type and recap availability
  const renderRecapStatus = (): ReactElement | null => {
    if (!isSelected) return null;

    // Show checking state while loading
    if (isCheckingRecap) {
      return (
        <div className='flex items-center gap-1.5 text-xs text-gray-500'>
          <Loader2 size={12} className='animate-spin' />
          <span>Checking for Recap</span>
        </div>
      );
    }

    // Render based on recap status
    switch (recapStatus) {
      case 'available':
        return (
          <div className='flex items-center gap-1.5 text-xs text-green-600'>
            <Sparkles size={12} />
            <span>Recap available</span>
          </div>
        );
      case 'no_messages':
        return (
          <div className='flex items-center gap-1.5 text-xs text-gray-400'>
            <span>No messages</span>
          </div>
        );
      case 'pending':
        // No recap exists for yesterday - show "Pending" for all channels
        // We can't distinguish between "newly added" and "had no messages"
        // until the next recap cycle generates a recap
        return (
          <div className='flex items-center gap-1.5 text-xs text-yellow-600'>
            <span>Pending</span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <button
      type='button'
      className='flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-md cursor-pointer transition-colors w-full text-left'
      onClick={onToggle}
      data-track-category='RECAP_SETTINGS'
      data-track-name='TOGGLE_CHANNEL'
    >
      <div
        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
          isSelected
            ? 'bg-blue-500 border-blue-500 text-white'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        {isSelected && <Check size={14} />}
      </div>

      {/* Channel Icon and Name */}
      <div className='flex items-center space-x-2 flex-1 min-w-0 overflow-hidden'>
        {getIcon()}
        <span className='text-sm font-medium text-gray-900 truncate whitespace-nowrap'>
          {displayName}
        </span>
      </div>

      {/* Recap Status Indicator */}
      <div className='flex-shrink-0'>{renderRecapStatus()}</div>
    </button>
  );
};

const RecapSettings = ({ isOpen, onClose, onSaved }: RecapSettingsProps): ReactElement | null => {
  // Get channels where user is a participant and filter by scopeType DEFAULT
  const visibleChannels = useAllVisibleChannels();
  const channels = useMemo(
    () =>
      visibleChannels
        .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [visibleChannels],
  );
  const { subscriptions } = useRecapData();
  const { user: currentUser } = useAuth();
  const zero = useZero();

  // Memoize selected channel IDs - only update when subscriptions actually change
  const selectedChannelIds = useMemo(() => subscriptions.map(s => s.channelId), [subscriptions]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Track channels to check for recaps (both existing and newly added)
  const [channelsToCheck, setChannelsToCheck] = useState<Set<string>>(new Set());

  // Reset selectedIds and search query when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      // Only reset from subscriptions when opening - use subscriptions directly
      const existingChannelIds = subscriptions.map(s => s.channelId);
      setSelectedIds(new Set(existingChannelIds));
      // Check recaps for existing subscriptions on open
      setChannelsToCheck(new Set(existingChannelIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Check for existing recaps for newly added channels
  const { isChecking, recapDetailedStatusMap } = useCheckChannelRecap(
    Array.from(channelsToCheck),
    channelsToCheck.size > 0,
  );

  // When a channel is toggled, check if it's a new addition and trigger recap check
  const handleToggleChannelWithCheck = useCallback(
    (channelId: string): void => {
      const isCurrentlySelected = selectedIds.has(channelId);
      const isExistingSubscription = selectedChannelIds.includes(channelId);

      setSelectedIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(channelId)) {
          newSet.delete(channelId);
        } else {
          newSet.add(channelId);
        }
        return newSet;
      });

      // If selecting a new channel (not existing subscription), trigger recap check
      if (!isCurrentlySelected && !isExistingSubscription) {
        setChannelsToCheck(prev => {
          const newSet = new Set(prev);
          newSet.add(channelId);
          return newSet;
        });
      }
      // If deselecting a channel that was being checked, remove from check list
      if (isCurrentlySelected && channelsToCheck.has(channelId)) {
        setChannelsToCheck(prev => {
          const newSet = new Set(prev);
          newSet.delete(channelId);
          return newSet;
        });
      }
    },
    [selectedIds, selectedChannelIds, channelsToCheck],
  );

  // Filter and sort channels based on search query and selection
  const filteredChannels = useMemo(() => {
    if (!channels || channels.length === 0) return [];

    let result = channels;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((channel: { name: string }) =>
        channel.name.toLowerCase().includes(query),
      );
    }

    // Sort: subscribed channels first, then by name
    return [...result].sort((a: Channel, b: Channel) => {
      const aSelected = selectedIds.has(a.id);
      const bSelected = selectedIds.has(b.id);

      // If both are selected or both are not selected, sort by name
      if (aSelected === bSelected) {
        return a.name.localeCompare(b.name);
      }

      // Selected channels come first
      return aSelected ? -1 : 1;
    });
  }, [channels, searchQuery, selectedIds]);

  const handleSave = useCallback((): void => {
    const channelIds = Array.from(selectedIds);
    const timestamp = Date.now();

    // Use Zero mutator for real-time sync - instant and optimistic
    zero.mutate(
      mutators.recap.saveSubscriptions({
        channelIds,
        timestamp,
      }),
    );

    toast.success('Recap preferences saved', { duration: 2000 });
    onSaved?.();
    onClose();
  }, [selectedIds, onClose, zero, onSaved]);

  const handleCancel = useCallback((): void => {
    // Reset selection to original subscriptions
    setSelectedIds(new Set(selectedChannelIds));
    onClose();
  }, [onClose, selectedChannelIds]);

  const selectedCount = selectedIds.size;
  const hasExistingChannels = selectedChannelIds.length > 0;

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='w-full max-w-lg max-h-[80vh] bg-white rounded-xl shadow-2xl flex flex-col m-4'>
        {/* Header */}
        <div className='p-4 border-b flex items-center justify-between'>
          <h3 className='font-bold text-gray-900 text-xl'>Choose your channels</h3>
          <button
            onClick={handleCancel}
            className='p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200'
            aria-label='Close'
            title='Close'
            data-track-category='RECAP_SETTINGS'
            data-track-name='CLOSE_MODAL'
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-hidden p-6'>
          {/* Description */}
          <p className='text-sm text-gray-500 mb-4'>
            Select the channels you want to include in your daily AI recap summaries. You can change
            this anytime.
          </p>

          {/* Search Input */}
          <div className='relative mb-4'>
            <Search
              className='absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400'
              size={16}
            />
            <Input
              type='text'
              placeholder='Search channels...'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='pl-10'
              data-track-category='RECAP_SETTINGS'
              data-track-name='SEARCH_INPUT'
            />
          </div>

          <div className='max-h-[50vh] overflow-y-auto -mx-2'>
            {!channels || channels.length === 0 ? (
              <div className='text-center text-gray-500 py-8'>No channels available</div>
            ) : filteredChannels.length === 0 ? (
              <div className='text-center text-gray-500 py-8'>
                No channels found matching &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className='space-y-1'>
                {filteredChannels.map((channel: Channel) => {
                  const isExistingSubscription = selectedChannelIds.includes(channel.id);
                  const recapStatus = recapDetailedStatusMap.get(channel.id) ?? null;
                  return (
                    <ChannelListItem
                      key={channel.id}
                      channel={channel}
                      isSelected={selectedIds.has(channel.id)}
                      onToggle={() => handleToggleChannelWithCheck(channel.id)}
                      currentUserId={currentUser?.id}
                      isExistingSubscription={isExistingSubscription}
                      isCheckingRecap={isChecking && channelsToCheck.has(channel.id)}
                      recapStatus={recapStatus}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className='flex justify-end gap-3 p-4 border-t bg-white'>
          <Button
            variant='ghost'
            onClick={handleCancel}
            data-track-category='RECAP_SETTINGS'
            data-track-name='CANCEL_SELECTION'
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            data-track-category='RECAP_SETTINGS'
            data-track-name='SAVE_SUBSCRIPTIONS'
          >
            {hasExistingChannels
              ? 'Save Changes'
              : selectedCount === 0
                ? 'Skip'
                : `Add ${selectedCount} Channel${selectedCount !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RecapSettings;
