import type { ReactElement } from 'react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ArrowUp, X, Lock, Globe } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { toast } from 'sonner';
import { ChannelScopeType } from '@xyne/shared';
import { StopIcon } from './StopIcon';
import { useAllVisibleChannels, searchChannels } from '../../../../hooks/useChannels';
import type { Channel } from '../../../../machines/stateMachine';
import { ChannelMentionExtension, channelMentionPluginKey } from '../../../ui/TipTapExtensions';
import { MentionSelector } from '../../../ui/Selectors';
import type { MentionResult } from '../../../ui/Selectors/Selectors.types';
import { usePlatform } from '../../../../hooks/usePlatform';

// Hash icon component
const HashIcon = ({ className = '' }: { className?: string }): ReactElement => (
  <img src='/svgs/icons/hash.svg' alt='#' className={className} width={16} height={16} />
);

interface XyneAIInputBoxProps {
  channelId?: string | null;
  channelName?: string;
  channelDescription?: string;
  scopeType?: string;
  showChannelTag?: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onSelectedChannelsChange?: (channelIds: string[]) => void;
  isStreaming?: boolean;
  onAbort?: () => void;
  webSearchEnabled?: boolean;
  webSearchAccessible?: boolean;
  onWebSearchToggle?: () => void;
}

interface SelectedChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export const XyneAIInputBox = ({
  channelId,
  channelName,
  scopeType,
  inputValue,
  onInputChange,
  onSubmit,
  onSelectedChannelsChange,
  isStreaming = false,
  onAbort,
  webSearchEnabled = false,
  webSearchAccessible = false,
  onWebSearchToggle,
}: XyneAIInputBoxProps): ReactElement => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasInitializedDefaultChannel = useRef(false);
  const { isMobile } = usePlatform();

  // Get all visible channels and filter out DMs
  const allChannels = useAllVisibleChannels();
  const nonDMChannels = useMemo(() => {
    return allChannels.filter(
      channel =>
        channel.scopeType !== ChannelScopeType.DM &&
        channel.scopeType !== ChannelScopeType.GROUP_DM,
    );
  }, [allChannels]);

  // Initialize with current channel as default pill (if exists and not DM)
  const [selectedChannels, setSelectedChannels] = useState<SelectedChannel[]>(() => {
    // Don't add default pill for DMs or if no channelId
    if (!channelId || !channelName || scopeType === 'DM' || scopeType === 'GROUP_DM') {
      return [];
    }

    // Try to find the channel to get correct isPrivate value
    const currentChannel = allChannels.find(ch => ch.id === channelId);

    return [
      {
        id: channelId,
        name: channelName,
        isPrivate: currentChannel ? String(currentChannel.visibility) === 'PRIVATE' : false,
      },
    ];
  });

  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownTriggeredBy, setDropdownTriggeredBy] = useState<'button' | 'text'>('button');

  // Filter channels based on search query (exclude DMs)
  const filteredChannels = useMemo(() => {
    if (!channelSearchQuery.trim()) {
      return nonDMChannels.slice(0, 10);
    }
    return searchChannels(nonDMChannels, channelSearchQuery, 10);
  }, [nonDMChannels, channelSearchQuery]);

  // TipTap editor setup
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: {
          HTMLAttributes: {
            class: 'm-0 leading-6',
          },
        },
      }),
      Placeholder.configure({
        placeholder: 'Ask Xyne AI',
      }),
      ChannelMentionExtension,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      onInputChange(text);
    },
    editorProps: {
      attributes: {
        class: 'tiptap chat-input-editor prose prose-sm focus:outline-none',
        style: 'min-height: 20px; max-height: 140px; overflow-y: auto;',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          const channelMentionState = channelMentionPluginKey.getState(view.state);

          // If channel mention menu is open, let it handle the Enter key
          if (channelMentionState?.isOpen && channelMentionState.items.length > 0) {
            return false;
          }

          // Prevent submission if already streaming or input is empty
          const text = view.state.doc.textContent.trim();
          if (isStreaming || !text) {
            event.preventDefault();
            return true;
          }

          // Otherwise, submit the message
          event.preventDefault();
          onSubmit();
          return true;
        }

        return false;
      },
    },
  });

  // Update the default channel's isPrivate status when channel data loads (only once)
  useEffect(() => {
    if (
      !hasInitializedDefaultChannel.current &&
      channelId &&
      channelName &&
      allChannels.length > 0
    ) {
      const currentChannel = allChannels.find(ch => ch.id === channelId);
      if (currentChannel && selectedChannels.length > 0 && selectedChannels[0]?.id === channelId) {
        setSelectedChannels(prev => {
          if (prev.length === 0 || prev[0]?.id !== channelId) return prev;
          return [
            {
              ...prev[0],
              isPrivate: String(currentChannel.visibility) === 'PRIVATE',
            },
            ...prev.slice(1),
          ];
        });
        hasInitializedDefaultChannel.current = true;
      }
    }
  }, [channelId, channelName, allChannels, selectedChannels]);

  // Notify parent component when selected channels change
  useEffect(() => {
    const channelIds = selectedChannels.map(ch => ch.id);
    onSelectedChannelsChange?.(channelIds);
  }, [selectedChannels, onSelectedChannelsChange]);

  // Sync inputValue changes from parent to editor
  useEffect(() => {
    if (editor && !editor.isFocused) {
      const currentText = editor.getText();
      if (currentText !== inputValue) {
        editor.commands.setContent(inputValue);
      }
    }
  }, [inputValue, editor]);

  // Clear editor content when inputValue is empty (after submit)
  useEffect(() => {
    if (inputValue === '' && editor) {
      editor.commands.setContent('');
    }
  }, [inputValue, editor]);

  // Convert channels to MentionResult format for MentionSelector (exclude DMs)
  const channelMentionItems: MentionResult[] = useMemo(() => {
    return nonDMChannels.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: 'channel' as const,
      isPrivate: String(channel.visibility) === 'PRIVATE',
      ...(channel.description && { description: channel.description }),
    }));
  }, [nonDMChannels]);

  // Handle channel mention search
  const handleChannelMentionSearch = useCallback((query: string) => {
    setChannelSearchQuery(query);
  }, []);

  // Handle channel mention selection from TipTap selector
  const handleChannelMentionSelect = useCallback(
    (mention: MentionResult) => {
      if (mention.type !== 'channel') return;

      // Check if channel is already selected
      if (selectedChannels.some(ch => ch.id === mention.id)) {
        toast.info('This channel is already added to context', { duration: 2000 });
        return;
      }

      // Check if maximum limit of 5 channels is reached
      if (selectedChannels.length >= 5) {
        toast.error('Maximum 5 channels can be selected', { duration: 2000 });
        return;
      }

      // Add channel to selected channels pills
      const newChannel: SelectedChannel = {
        id: mention.id,
        name: mention.name,
        isPrivate: mention.isPrivate ?? false,
      };
      setSelectedChannels([...selectedChannels, newChannel]);
    },
    [selectedChannels],
  );

  // Handle removing a selected channel pill
  const handleRemoveChannel = (channelIdToRemove: string): void => {
    setSelectedChannels(selectedChannels.filter(ch => ch.id !== channelIdToRemove));
  };

  // Handle "/" button click
  const handleSlashButtonClick = (): void => {
    setShowChannelDropdown(true);
    setChannelSearchQuery('');
    setHighlightedIndex(0);
    setDropdownTriggeredBy('button');
    // Focus on the search input when dropdown opens
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  };

  // Handle search input in dropdown
  const handleDropdownSearchChange = (value: string): void => {
    setChannelSearchQuery(value);
    setHighlightedIndex(0);
  };

  // Handle selecting channel from dropdown (via button or search)
  const handleDropdownChannelSelect = (channel: Channel): void => {
    // Check if channel is already selected
    if (selectedChannels.some(ch => ch.id === channel.id)) {
      toast.info('This channel is already added to context', { duration: 2000 });
      setShowChannelDropdown(false);
      setChannelSearchQuery('');
      return;
    }

    // Check if maximum limit of 5 channels is reached
    if (selectedChannels.length >= 5) {
      toast.error('Maximum 5 channels can be selected', { duration: 2000 });
      setShowChannelDropdown(false);
      setChannelSearchQuery('');
      return;
    }

    // Add channel to selected channels pills
    const newChannel: SelectedChannel = {
      id: channel.id,
      name: channel.name,
      isPrivate: String(channel.visibility) === 'PRIVATE',
    };
    setSelectedChannels([...selectedChannels, newChannel]);

    setShowChannelDropdown(false);
    setChannelSearchQuery('');
  };

  // Handle keyboard navigation in dropdown search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => (prev < filteredChannels.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredChannels[highlightedIndex]) {
          handleDropdownChannelSelect(filteredChannels[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowChannelDropdown(false);
        setChannelSearchQuery('');
        break;
      default:
        break;
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (showChannelDropdown && dropdownRef.current) {
      const highlightedElement = dropdownRef.current.querySelector(
        `[data-index="${highlightedIndex}"]`,
      );
      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          block: 'nearest',
        });
      }
    }
  }, [highlightedIndex, showChannelDropdown]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowChannelDropdown(false);
        setChannelSearchQuery('');
      }
    };

    if (showChannelDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return (): void => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [showChannelDropdown]);

  return (
    <div className={`px-4 ${isMobile ? '' : 'mb-4'} relative`}>
      {/* MentionSelector for "#" trigger in editor */}
      <MentionSelector
        editor={editor}
        mentionItems={channelMentionItems}
        triggerChar='#'
        {...(handleChannelMentionSearch && { onMentionSearch: handleChannelMentionSearch })}
        {...(handleChannelMentionSelect && { onMentionSelect: handleChannelMentionSelect })}
      />

      <div
        className={`bg-card border border-input focus-within:border-ring ${isMobile ? 'rounded-[26px]' : 'rounded-2xl'} py-2 px-2 flex flex-col gap-3 transition-colors relative`}
      >
        {/* "/" Button and Channel Pills Row */}
        <div className='flex items-center gap-2 overflow-x-auto scrollbar-hide flex-nowrap'>
          {/* "/" Button to open channel selector */}
          <button
            type='button'
            onClick={handleSlashButtonClick}
            className={`flex h-7 py-1 px-2 justify-center items-center gap-2 ${isMobile ? 'rounded-full' : 'rounded-lg'} border border-[#E4E6E7] hover:bg-[#E8EAED] transition-all duration-200 ease-in-out flex-shrink-0`}
            aria-label='Select channels'
            title='Select channels'
          >
            <span className='text-gray-600 font-semibold text-sm'>#</span>
          </button>

          {/* Channel Pills */}
          {selectedChannels.map(channel => (
            <div
              key={channel.id}
              className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-[#E4E6E7] flex-shrink-0`}
            >
              <div className='flex items-center gap-1'>
                <div className='flex-shrink-0'>
                  {channel.isPrivate ? (
                    <Lock className='h-3.5 w-3.5 text-gray-600' />
                  ) : (
                    <HashIcon />
                  )}
                </div>
                <span className="text-[#181B1D] font-['Inter'] text-sm font-[450] whitespace-nowrap">
                  {channel.name}
                </span>
              </div>
              {/* Show X button for all channels */}
              <button
                onClick={() => handleRemoveChannel(channel.id)}
                className='hover:bg-blue-200 rounded p-0.5 transition-colors flex-shrink-0'
                aria-label={`Remove ${channel.name}`}
              >
                <X className='w-3 h-3' />
              </button>
            </div>
          ))}
        </div>

        {/* Input Area */}
        <div className='relative'>
          {/* Text Input */}
          <EditorContent
            editor={editor}
            className="bg-transparent outline-none text-foreground p-2 pr-12 placeholder:text-muted-foreground text-sm font-['Inter']"
          />
        </div>

        {/* Bottom buttons - Web Search and Submit */}
        <div className='flex items-center justify-between gap-2 px-2'>
          <div className='flex items-center gap-2'>
            {/* Web Search Toggle Button */}
            {onWebSearchToggle && (
              <button
                type='button'
                onClick={() => {
                  if (webSearchAccessible) {
                    onWebSearchToggle();
                  }
                }}
                disabled={!webSearchAccessible}
                className={`p-1.5 rounded-lg transition-colors ${
                  webSearchEnabled
                    ? 'bg-[#E6F4EA] text-[#1E8E3E] hover:bg-[#D8EBE2]'
                    : 'hover:bg-gray-100 text-gray-600'
                } ${!webSearchAccessible ? 'opacity-50 cursor-not-allowed' : ''}`}
                aria-label={
                  webSearchAccessible
                    ? webSearchEnabled
                      ? 'Disable web search'
                      : 'Enable web search'
                    : 'Web search not available'
                }
                title={
                  webSearchAccessible
                    ? webSearchEnabled
                      ? 'Web search enabled'
                      : 'Enable web search'
                    : "You don't have access to web search."
                }
              >
                <Globe className='w-4 h-4' />
              </button>
            )}
          </div>

          {/* Submit/Stop button */}
          <button
            onClick={isStreaming ? onAbort : onSubmit}
            disabled={!isStreaming && !inputValue.trim()}
            className={`absolute ${isMobile ? 'bottom-[5px]' : 'bottom-2'} right-2 p-2 rounded-full transition-colors ${
              isStreaming
                ? 'bg-[#FF4F4F] text-white hover:bg-[#E64545]'
                : inputValue.trim()
                  ? 'bg-[#FF4F4F] text-white hover:bg-[#E64545]'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isStreaming ? <StopIcon className='w-2.5 h-2.5' /> : <ArrowUp className='w-4 h-4' />}
          </button>
        </div>
      </div>

      {/* Channel Dropdown when triggered by button click */}
      {showChannelDropdown && dropdownTriggeredBy === 'button' && (
        <div
          ref={dropdownRef}
          className='absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden'
        >
          {/* Search Input */}
          <div className='p-2 border-b border-gray-200 bg-gray-50'>
            <input
              ref={searchInputRef}
              type='text'
              value={channelSearchQuery}
              onChange={e => handleDropdownSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder='Search...'
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-['Inter']"
            />
          </div>

          {/* Channel List */}
          <div className='max-h-64 overflow-y-auto'>
            {filteredChannels.length > 0 ? (
              <div className='py-1'>
                {filteredChannels.map((channel, index) => (
                  <button
                    key={channel.id}
                    data-index={index}
                    onClick={() => handleDropdownChannelSelect(channel)}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-100 transition-colors flex items-center gap-2 ${
                      index === highlightedIndex ? 'bg-gray-100' : ''
                    }`}
                  >
                    <div className='flex-shrink-0'>
                      {String(channel.visibility) === 'PRIVATE' ? (
                        <Lock className='h-3.5 w-3.5 text-gray-600' />
                      ) : (
                        <HashIcon />
                      )}
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className="text-sm font-medium text-gray-900 font-['Inter'] truncate">
                        {channel.name}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className='px-3 py-6 text-center text-sm text-gray-500'>No channels found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
