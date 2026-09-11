import { ReactElement, useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { toast } from 'sonner';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Check, Search, Lock, Hash, X, Sparkles, Clock, Inbox, Pencil } from 'lucide-react';
import { Popover } from '../ui/Popover/Popover';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import type { Channel } from '@xyne/shared';
import type { VisibleChannel } from '../../machines/stateMachine';
import { useRecapData } from '../../hooks/useRecapData';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useAuth } from '../../hooks/useAuth';
import type { ChannelListItemProps, RecapSettingsProps } from './RecapPanel.types';
import {
  useAllVisibleChannels,
  searchChannels,
  useUserChannelStatuses,
} from '../../hooks/useChannels';
import { stateMachineActor } from '../../machines/stateMachine';

const DISPLAY_LIMIT = 5;
const MAX_CUSTOM_PROMPT_LENGTH = 1000;

// Recap status indicator - shows based on lastRecapHadMessages from channelStats
const RecapStatusIndicator = ({
  isSelected,
  lastRecapHadMessages,
}: {
  isSelected: boolean;
  lastRecapHadMessages?: boolean | null | undefined;
}): ReactElement | null => {
  if (!isSelected) return null;

  const status =
    lastRecapHadMessages === true
      ? { icon: Sparkles, text: 'Recap Available', className: 'text-green-500' }
      : lastRecapHadMessages === false
        ? { icon: Inbox, text: 'No messages yet', className: 'text-gray-400' }
        : { icon: Clock, text: 'Pending', className: 'text-yellow-500' };

  const Icon = status.icon;
  return (
    <div className={`flex items-center gap-1 ${status.className}`}>
      <Icon size={12} />
      <span className='text-xs'>{status.text}</span>
    </div>
  );
};

const ChannelListItem = ({
  channel,
  isSelected,
  onToggle,
  currentUserId,
  customPrompt,
  onCustomPromptChange,
}: ChannelListItemProps & {
  customPrompt: string;
  onCustomPromptChange: (prompt: string) => void;
}): ReactElement => {
  const { displayName } = useChannelDisplayName(channel, currentUserId || '');
  const channelStats = (channel as VisibleChannel).channelStats;
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  // Local draft for editing without affecting parent state until saved
  const [localDraft, setLocalDraft] = useState(customPrompt);

  // Sync local draft when popover opens or customPrompt changes externally
  useEffect(() => {
    if (isPopoverOpen) {
      setLocalDraft(customPrompt);
    }
  }, [isPopoverOpen, customPrompt]);

  const getIcon = (): ReactElement => {
    return channel.visibility === ChannelVisibility.PRIVATE ? (
      <Lock size={14} className='text-muted-foreground flex-shrink-0' />
    ) : (
      <Hash size={14} className='text-muted-foreground flex-shrink-0' />
    );
  };

  return (
    <div className='rounded-md'>
      <div className='flex items-center w-full'>
        {/* Clickable area for channel selection */}
        <div
          role='button'
          tabIndex={0}
          className='flex items-center space-x-3 p-3 hover:bg-accent rounded-md cursor-pointer transition-colors flex-1 text-left'
          onClick={onToggle}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
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

          {/* Recap Status Indicator */}
          <RecapStatusIndicator
            isSelected={isSelected}
            lastRecapHadMessages={channelStats?.lastRecapHadMessages}
          />
        </div>

        {/* Custom prompt icon with popover — outside the clickable area */}
        {isSelected && (
          <Popover
            trigger={
              <button
                type='button'
                className='p-3 rounded transition-colors flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent'
                title={customPrompt ? 'Edit custom recap prompt' : 'Add custom recap prompt'}
                data-track-category='RECAP_SETTINGS'
                data-track-name='OPEN_CUSTOM_PROMPT_POPOVER'
              >
                <Pencil size={14} className={customPrompt ? 'text-blue-500' : ''} />
              </button>
            }
            open={isPopoverOpen}
            onOpenChange={setIsPopoverOpen}
            side='left'
            align='end'
            sideOffset={8}
            className='p-0'
            onOpenAutoFocus={e => e.preventDefault()}
          >
            <div className='p-4 w-80'>
              <div className='flex items-center gap-2 mb-3'>
                <Sparkles size={14} className='text-blue-500 flex-shrink-0' />
                <span className='text-sm font-semibold text-foreground'>Custom Recap Prompt</span>
              </div>
              <textarea
                placeholder='e.g. "Focus on bugs and blockers. Highlight action items."'
                value={localDraft}
                onChange={e => setLocalDraft(e.target.value.slice(0, MAX_CUSTOM_PROMPT_LENGTH))}
                rows={3}
                className='w-full bg-muted/50 border border-input rounded-md px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none leading-relaxed'
                data-track-category='RECAP_SETTINGS'
                data-track-name='CUSTOM_PROMPT_INPUT'
              />
              <div className='flex justify-end mt-1'>
                <span
                  className={`text-xs ${localDraft.length >= MAX_CUSTOM_PROMPT_LENGTH ? 'text-red-500' : 'text-muted-foreground'}`}
                >
                  {localDraft.length}/{MAX_CUSTOM_PROMPT_LENGTH}
                </span>
              </div>
              <div className='flex items-center justify-between mt-3'>
                <p className='text-xs text-muted-foreground'>Guides your personalized recap.</p>
                <div className='flex gap-2'>
                  <button
                    type='button'
                    onClick={() => {
                      setLocalDraft('');
                      onCustomPromptChange('');
                    }}
                    className='px-2.5 py-1 text-xs rounded border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
                    data-track-category='RECAP_SETTINGS'
                    data-track-name='CLEAR_CUSTOM_PROMPT'
                  >
                    Clear
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      onCustomPromptChange(localDraft);
                      setIsPopoverOpen(false);
                    }}
                    className='px-2.5 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors font-medium'
                    data-track-category='RECAP_SETTINGS'
                    data-track-name='SAVE_CUSTOM_PROMPT'
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </Popover>
        )}
      </div>
    </div>
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

  // All user channel statuses to read existing custom prompts
  const allUserStatuses = useUserChannelStatuses();

  // Memoize selected channel IDs - only update when subscriptions actually change
  const selectedChannelIds = useMemo(() => subscriptions.map(s => s.channelId), [subscriptions]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Map of channelId → custom prompt (empty string = no custom prompt)
  const [customPrompts, setCustomPrompts] = useState<Map<string, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  // Reset selectedIds, custom prompts, and search query when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setIsExpanded(false);
      setSelectedIds(new Set(subscriptions.map(s => s.channelId)));
      // Load existing custom prompts from channel user statuses
      const promptMap = new Map<string, string>();
      if (allUserStatuses) {
        for (const status of allUserStatuses) {
          if (status.customRecapPrompt) {
            promptMap.set(status.channelId, status.customRecapPrompt);
          }
        }
      }
      setCustomPrompts(promptMap);
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

    // Save custom prompts for selected channels and update state machine
    for (const channelId of channelIds) {
      const prompt = customPrompts.get(channelId) ?? null;
      const trimmedPrompt = prompt && prompt.trim() ? prompt.trim() : null;
      zero.mutate(
        mutators.recap.setCustomRecapPrompt({
          channelId,
          prompt: trimmedPrompt,
          timestamp,
        }),
      );
      // Update state machine with the new custom prompt
      stateMachineActor.send({
        type: 'UPDATE_USER_CHANNEL_STATUS',
        channelId,
        updates: { customRecapPrompt: trimmedPrompt },
      });
    }
    // Clear custom prompts for deselected channels
    for (const channelId of Array.from(customPrompts.keys())) {
      if (!selectedIds.has(channelId)) {
        zero.mutate(
          mutators.recap.setCustomRecapPrompt({
            channelId,
            prompt: null,
            timestamp,
          }),
        );
        // Update state machine to clear the custom prompt
        stateMachineActor.send({
          type: 'UPDATE_USER_CHANNEL_STATUS',
          channelId,
          updates: { customRecapPrompt: null },
        });
      }
    }

    toast.success('Recap preferences saved', { duration: 2000 });
    onSaved?.();
    onClose();
  }, [selectedIds, customPrompts, onClose, zero, onSaved]);

  const handleCancel = useCallback((): void => {
    setSelectedIds(new Set(selectedChannelIds));
    // Reset custom prompts from existing statuses
    const promptMap = new Map<string, string>();
    if (allUserStatuses) {
      for (const status of allUserStatuses) {
        if (status.customRecapPrompt) {
          promptMap.set(status.channelId, status.customRecapPrompt);
        }
      }
    }
    setCustomPrompts(promptMap);
    onClose();
  }, [onClose, selectedChannelIds, allUserStatuses]);

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
                    customPrompt={customPrompts.get(channel.id) ?? ''}
                    onCustomPromptChange={(prompt: string) => {
                      setCustomPrompts(prev => {
                        const next = new Map(prev);
                        next.set(channel.id, prompt);
                        return next;
                      });
                    }}
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
            trackId='save_recap_subscriptions'
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
