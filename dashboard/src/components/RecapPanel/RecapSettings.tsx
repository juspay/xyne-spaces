import { ReactElement, useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { toast } from 'sonner';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Check, Search, Lock, Hash, X } from 'lucide-react';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import type { Channel } from '@xyne/shared';
import { useRecapData } from '../../hooks/useRecapData';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useAuth } from '../../hooks/useAuth';
import type { ChannelListItemProps, RecapSettingsProps } from './RecapPanel.types';
import { useAllVisibleChannels, searchChannels } from '../../hooks/useChannels';

const DISPLAY_LIMIT = 5;

const ChannelListItem = ({
  channel,
  isSelected,
  onToggle,
  currentUserId,
}: ChannelListItemProps): ReactElement => {
  const { displayName } = useChannelDisplayName(channel, currentUserId || '');

  const getIcon = (): ReactElement => {
    return channel.visibility === ChannelVisibility.PRIVATE ? (
      <Lock size={14} className='text-muted-foreground flex-shrink-0' />
    ) : (
      <Hash size={14} className='text-muted-foreground flex-shrink-0' />
    );
  };

  return (
    <button
      type='button'
      className='flex items-center space-x-3 p-3 hover:bg-accent rounded-md cursor-pointer transition-colors w-full text-left'
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
        <span className='text-sm font-medium text-foreground truncate whitespace-nowrap'>
          {displayName}
        </span>
      </div>
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
  const [isExpanded, setIsExpanded] = useState(false);

  // Reset selectedIds and search query when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setIsExpanded(false);
      setSelectedIds(new Set(subscriptions.map(s => s.channelId)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Use fuse-based search when there's a query for better results
  const filteredChannels = useMemo(() => {
    if (!channels || channels.length === 0) return [];

    if (searchQuery.trim()) {
      return searchChannels(channels, searchQuery, channels.length);
    }

    return [...channels].sort((a: Channel, b: Channel) => {
      const aSelected = selectedIds.has(a.id);
      const bSelected = selectedIds.has(b.id);
      if (aSelected === bSelected) return a.name.localeCompare(b.name);
      return aSelected ? -1 : 1;
    });
  }, [channels, searchQuery, selectedIds]);

  const displayChannels = useMemo(() => {
    if (!filteredChannels || filteredChannels.length === 0) return [];
    if (searchQuery.trim()) return filteredChannels;
    if (isExpanded) return filteredChannels;
    return filteredChannels.slice(0, DISPLAY_LIMIT);
  }, [filteredChannels, searchQuery, isExpanded]);

  const hasMoreChannels = !searchQuery.trim() && filteredChannels.length > DISPLAY_LIMIT;
  const hiddenCount = filteredChannels.length - DISPLAY_LIMIT;

  const handleToggleChannel = useCallback((channelId: string): void => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(channelId)) {
        newSet.delete(channelId);
      } else {
        newSet.add(channelId);
      }
      return newSet;
    });
  }, []);

  const toggleExpanded = useCallback((): void => {
    setIsExpanded(prev => !prev);
  }, []);

  const handleSave = useCallback((): void => {
    const channelIds = Array.from(selectedIds);
    const timestamp = Date.now();

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
    setSelectedIds(new Set(selectedChannelIds));
    onClose();
  }, [onClose, selectedChannelIds]);

  const selectedCount = selectedIds.size;
  const hasExistingChannels = selectedChannelIds.length > 0;

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='w-full max-w-lg max-h-[80vh] bg-background rounded-xl shadow-2xl flex flex-col m-4 border border-border'>
        {/* Header */}
        <div className='p-4 border-b border-border flex items-center justify-between'>
          <h3 className='font-bold text-foreground text-xl'>Choose your channels</h3>
          <button
            onClick={handleCancel}
            className='p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-200'
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
          <p className='text-sm text-muted-foreground mb-4'>
            Select the channels you want to include in your daily AI recap summaries. You can change
            this anytime.
          </p>

          {/* Search Input */}
          <div className='relative mb-4'>
            <Search
              className='absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground'
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
              <div className='text-center text-muted-foreground py-8'>No channels available</div>
            ) : filteredChannels.length === 0 ? (
              <div className='text-center text-muted-foreground py-8'>
                No channels found matching &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className='space-y-1'>
                {displayChannels.map((channel: Channel) => (
                  <ChannelListItem
                    key={channel.id}
                    channel={channel}
                    isSelected={selectedIds.has(channel.id)}
                    onToggle={() => handleToggleChannel(channel.id)}
                    currentUserId={currentUser?.id}
                  />
                ))}
                {hasMoreChannels && (
                  <button
                    onClick={toggleExpanded}
                    className='w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md text-left transition-colors'
                    data-track-category='RECAP_SETTINGS'
                    data-track-name='TOGGLE_CHANNEL_EXPANSION'
                    data-track-metadata={JSON.stringify({ isExpanded })}
                  >
                    {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className='flex justify-end gap-3 p-4 border-t border-border bg-background rounded-b-xl'>
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
