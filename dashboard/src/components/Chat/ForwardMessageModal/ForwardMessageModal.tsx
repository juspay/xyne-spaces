import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input';
import Avatar from '../../ui/Avatar/Avatar';
import { Badge } from '../../ui/Badge';
import { Search, X, Hash, Lock } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useUserSearch, useUser, useUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { useChannelSearch, useAllChannels } from '../../../hooks/useChannels';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { MessageAttachment } from '../MessageAttachment/MessageAttachment';
import { formatRelativeTimestamp } from '../../../utils/dateUtils';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import {
  ChannelVisibility,
  ChannelScopeType,
  MessageType,
  parseForwardedMessageXml,
} from '@xyne/shared';
import * as Popover from '@radix-ui/react-popover';
import { channelService } from '../../../services/Chat/channelService';
import { useNavigate } from 'react-router-dom';
import { useZero } from '@rocicorp/zero/react';
import { v4 as uuidv4 } from 'uuid';
import { mutators } from '../../../zero/mutators';
import { InputBox } from '../../ui/InputBox';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import {
  ForwardMessageFormProps,
  ForwardTarget,
  SearchResultItem,
  SelectionMode,
} from './ForwardMessageModal.types';
import { toast } from 'sonner';
import { getDMParticipantIdsToFetch } from '../ChatDirectory/ChatDirectory.utils';

/**
 * ForwardMessageForm component allows users to forward a message to channels or users.
 * It provides search functionality for finding recipients and an optional message field.
 * Users can select either a single channel OR multiple users.
 *
 * This component should be rendered inside a Dialog.
 */
export const ForwardMessageForm: React.FC<ForwardMessageFormProps> = ({
  message,
  onCancel,
  onSuccess,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<ForwardTarget[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(true); // Open by default to show initial suggestions
  const [isInitialOpen, setIsInitialOpen] = useState(true); // Track if this is the initial modal open
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputBoxRef = useRef<InputBoxHandle>(null);
  const navigate = useNavigate();
  const zero = useZero();

  // Initialize form with useForm hook
  const form = useForm({
    defaultValues: {
      optionalMessageHtml: '',
      optionalMessageText: '',
    },
    onSubmit: async ({ value }) => {
      if (selectedTargets.length === 0) return;

      const firstTarget = selectedTargets[0];
      if (!firstTarget) return;

      if (firstTarget.type === 'channel') {
        // Forward to channel using mutator
        const conversationId = uuidv4();
        const messageId = uuidv4();
        const timestamp = Date.now();

        try {
          zero.mutate(
            mutators.conversations.forwardMessage({
              targetChannelId: firstTarget.id,
              originalMessageId: message.messageId,
              optionalMessage: value.optionalMessageText.trim()
                ? value.optionalMessageHtml
                : undefined,
              conversationId,
              messageId,
              timestamp,
              conversationParticipantId: uuidv4(),
            }),
          );

          // Show success message
          toast.success('Message forwarded', {
            description: `Message sent to #${firstTarget.name}`,
            duration: 3000,
          });

          // Reset form and close modal
          form.reset();
          setSelectedTargets([]);
          inputBoxRef.current?.clearContent();
          onSuccess?.();

          // Navigate to the channel
          void navigate(`/chat/dir/${firstTarget.id}`);
        } catch (error) {
          console.error('Failed to forward message via mutator:', error);
          toast.error('Failed to forward message', {
            description: `Please try again.`,
            duration: 3000,
          });
        }
        return;
      }

      // Forward to users - create DM with forwarded message
      const userIds = selectedTargets.map((t: ForwardTarget) => t.id);

      // Prepare forwarded message data
      const forwardedMessageData = {
        originalMessageId: message.messageId,
        optionalMessage: value.optionalMessageText.trim() ? value.optionalMessageHtml : undefined,
      };

      try {
        // Call the createDm API with forwarded message
        const response = await channelService.createDm({
          participantIds: userIds,
          forwardedMessage: forwardedMessageData,
        });

        // Show success message
        const targetNames = selectedTargets.map((t: ForwardTarget) => t.name).join(', ');
        toast.success('Message forwarded', {
          description: `Message sent to ${targetNames}`,
          duration: 3000,
        });

        // Reset form and close modal
        form.reset();
        setSelectedTargets([]);
        inputBoxRef.current?.clearContent();
        onSuccess?.();

        // Navigate to the DM channel
        void navigate(`/chat/dir/${response.id}`);
      } catch (error) {
        console.error('Failed to create DM with forwarded message:', error);
        toast.error('Failed to forward message', {
          description: 'Could not create direct message. Please try again.',
          duration: 3000,
        });
      }
    },
  });

  // Get current user and sender info
  const { user: currentUser } = useAuth();
  const sender = useUser(message.senderId);

  // Mention search for @ mentions in optional message
  const { results: mentionResults, searchMentions } = useMentionSearch();

  // Channel mention search for # mentions in optional message
  const [channelMentionQuery, setChannelMentionQuery] = useState('');
  const channelMentionResults = useChannelSearch(channelMentionQuery, 10);

  const channelMentionItems = useMemo(() => {
    if (!channelMentionResults || channelMentionResults.length === 0) return [];

    // Filter channels to only show DEFAULT scope (exclude DM, GROUP_DM, TICKET, DOCUMENT)
    return channelMentionResults
      .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
        ...(channel.description && { description: channel.description }),
        hasAccess: true,
      }));
  }, [channelMentionResults]);

  const handleChannelMentionSearch = (query: string): void => {
    setChannelMentionQuery(query);
  };

  // Check if this is a forwarded message being re-forwarded
  const isReForwarding = message.msgType === MessageType.FORWARDED;

  // Parse forwarded message XML content for re-forwarding
  const forwardedMessageData = useMemo(() => {
    if (isReForwarding) {
      return parseForwardedMessageXml(message.content);
    }
    return null;
  }, [isReForwarding, message.content]);

  // Check if we're using optionalText (affects both content and attachments display)
  const useOptionalText = isReForwarding && !!forwardedMessageData?.optionalText;

  // Compute the preview content for the modal
  // For forwarded messages: show optionalText as main content (if exists), otherwise show forwarded content
  const previewContent = useMemo(() => {
    if (forwardedMessageData) {
      if (useOptionalText) {
        return forwardedMessageData.optionalText;
      }
      return forwardedMessageData.content;
    }
    return message.content;
  }, [useOptionalText, forwardedMessageData, message.content]);

  // Search for users and channels
  const userResults = useUserSearch(searchValue, 5);
  const channelResults = useChannelSearch(searchValue, 5);
  const allChannels = useAllChannels();
  const allUsers = useUsers();

  // Get default suggestions for initial modal open (Users from DMs first, then channels)
  const defaultSuggestions: SearchResultItem[] = useMemo(() => {
    // Only compute if initial open and no search query
    if (!isInitialOpen || searchValue.trim().length > 0) return [];

    const suggestions: SearchResultItem[] = [];

    // Get recent 1:1 DMs (exclude Group DMs) sorted by lastActivityAt
    // Extract the OTHER user from each DM and add as type: 'user'
    const recentDMs = [...allChannels]
      .filter(channel => channel.scopeType === ChannelScopeType.DM)
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
      .slice(0, 5);

    // Add users from DMs first (as type: 'user' so they behave like search results)
    recentDMs.forEach(channel => {
      const participantIds = getDMParticipantIdsToFetch(channel, currentUser?.id || '');
      const otherUser = allUsers.find(user => participantIds.includes(user.id));

      if (otherUser && otherUser.id !== currentUser?.id) {
        suggestions.push({
          type: 'user',
          id: otherUser.id,
          name: otherUser.name,
          description: otherUser.email,
          user: otherUser,
        });
      }
    });

    // Get recent channels (DEFAULT scope) sorted by lastActivityAt
    const recentChannels = [...allChannels]
      .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
      .slice(0, 8 - suggestions.length); // Fill remaining slots

    // Add channels after users
    recentChannels.forEach(channel => {
      suggestions.push({
        type: 'channel',
        id: channel.id,
        name: channel.name,
        description: channel.description,
        channel,
      });
    });

    return suggestions;
  }, [allChannels, isInitialOpen, searchValue, allUsers, currentUser?.id]);

  // Determine current selection mode based on selected targets
  const selectionMode: SelectionMode = useMemo(() => {
    if (selectedTargets.length === 0) return 'none';
    const firstTarget = selectedTargets[0];
    if (firstTarget && firstTarget.type === 'channel') return 'channel';
    return 'users';
  }, [selectedTargets]);

  // Get IDs of already selected users to filter them out
  const selectedUserIds = useMemo(() => {
    return new Set(
      selectedTargets
        .filter((t: ForwardTarget) => t.type === 'user')
        .map((t: ForwardTarget) => t.id),
    );
  }, [selectedTargets]);

  // Combine and filter results based on selection mode
  const searchResults: SearchResultItem[] = useMemo(() => {
    // If channel is already selected, don't show any more results
    if (selectionMode === 'channel') {
      return [];
    }

    // Show default suggestions on initial modal open with no search query
    if (isInitialOpen && searchValue.trim().length === 0) {
      return defaultSuggestions;
    }

    const results: SearchResultItem[] = [];

    // If no selection yet, show both channels and users
    if (selectionMode === 'none') {
      // Add channels (only DEFAULT scope type channels, including current channel)
      channelResults
        .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
        .forEach(channel => {
          results.push({
            type: 'channel',
            id: channel.id,
            name: channel.name,
            description: channel.description,
            channel,
          });
        });
    }

    // Add users (filter out already selected users and current user)
    userResults
      .filter(user => !selectedUserIds.has(user.id) && user.id !== currentUser?.id)
      .forEach(user => {
        results.push({
          type: 'user',
          id: user.id,
          name: user.name,
          description: user.email,
          user,
        });
      });

    return results.slice(0, 10);
  }, [
    userResults,
    channelResults,
    selectionMode,
    selectedUserIds,
    currentUser?.id,
    isInitialOpen,
    searchValue,
    defaultSuggestions,
  ]);

  // Update dropdown visibility when search changes (but not during initial state)
  useEffect(() => {
    // Don't close popover during initial state - we want to show default suggestions
    if (isInitialOpen) return;

    const shouldShow = searchValue.trim().length > 0;
    setIsSearchOpen(shouldShow);
    if (!shouldShow) {
      setSelectedIndex(-1);
    }
  }, [searchValue, isInitialOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchValue(e.target.value);
    setIsSearchOpen(true);
    setSelectedIndex(-1);
    setIsInitialOpen(false); // User started typing, exit initial state
  };

  const handleSelectTarget = (item: SearchResultItem): void => {
    const newTarget: ForwardTarget = {
      type: item.type,
      id: item.id,
      name: item.name,
    };

    if (item.type === 'channel') {
      // Channel selection replaces everything - only one channel allowed
      setSelectedTargets([newTarget]);
    } else {
      // User selection - add to existing users
      setSelectedTargets((prev: ForwardTarget[]) => [...prev, newTarget]);
    }

    setSearchValue('');
    setIsSearchOpen(false);
    setSelectedIndex(-1);
    setIsInitialOpen(false); // User made a selection, exit initial state
    inputRef.current?.focus();
  };

  const handleRemoveTarget = (targetId: string): void => {
    setSelectedTargets((prev: ForwardTarget[]) =>
      prev.filter((t: ForwardTarget) => t.id !== targetId),
    );
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!isSearchOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsSearchOpen(true);
      return;
    }

    if (!isSearchOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && searchResults[selectedIndex]) {
          handleSelectTarget(searchResults[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsSearchOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const handleFocus = (): void => {
    if (searchValue.trim().length > 0) {
      setIsSearchOpen(true);
    }
  };

  const handleBlur = (): void => {
    setTimeout(() => {
      // Don't close during initial state - keep default suggestions visible
      if (!isInitialOpen) {
        setIsSearchOpen(false);
        setSelectedIndex(-1);
      }
    }, 200);
  };

  const getChannelIcon = (channelId: string): React.ReactNode => {
    const channel = allChannels.find(c => c.id === channelId);
    const isPrivate = channel?.visibility === ChannelVisibility.PRIVATE;
    return isPrivate ? <Lock className='w-4 h-4' /> : <Hash className='w-4 h-4' />;
  };

  return (
    <form
      data-id='forward-message-form'
      onSubmit={e => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {/* Header */}
      <div className='flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-200 dark:border-gray-700'>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>Forward message</h2>
        <button
          className='rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-2'
          onClick={onCancel}
        >
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </button>
      </div>

      <div className='px-6 py-4 space-y-4'>
        {/* Search for recipients */}
        <div>
          <label
            htmlFor='forward-search-input'
            className='block text-sm font-medium text-foreground mb-1.5'
          >
            Forward to
          </label>

          {/* Selected targets badges */}
          {selectedTargets.length > 0 && (
            <div className='flex flex-wrap gap-2 mb-2'>
              {selectedTargets.map((target: ForwardTarget) => (
                <Badge key={target.id} variant='primary' className='flex items-center gap-1.5 pr-1'>
                  {target.type === 'channel' ? (
                    <span className='flex items-center gap-1'>
                      {getChannelIcon(target.id)}
                      <span className='text-xs'>{target.name}</span>
                    </span>
                  ) : (
                    <span className='text-xs'>{target.name}</span>
                  )}
                  <button
                    type='button'
                    onClick={() => handleRemoveTarget(target.id)}
                    className='rounded-full p-0.5 transition-colors'
                    aria-label={`Remove ${target.name}`}
                  >
                    <X className='h-3 w-3' />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Search input - hide if channel is selected (only one channel allowed) */}
          {selectionMode !== 'channel' && (
            <Popover.Root open={isSearchOpen} onOpenChange={setIsSearchOpen}>
              <Popover.Anchor asChild>
                <div className='relative'>
                  <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10' />
                  <Input
                    id='forward-search-input'
                    name='off'
                    autoFocus={true} // eslint-disable-line jsx-a11y/no-autofocus
                    autoComplete='off'
                    autoCorrect='off'
                    autoCapitalize='off'
                    spellCheck={false}
                    data-form-type='other'
                    data-lpignore='true'
                    data-1p-ignore='true'
                    ref={inputRef}
                    type='text'
                    role='combobox'
                    aria-expanded={isSearchOpen}
                    aria-controls='forward-search-listbox'
                    aria-autocomplete='list'
                    aria-activedescendant={
                      selectedIndex >= 0 ? `forward-search-option-${selectedIndex}` : undefined
                    }
                    className='pl-10'
                    placeholder={
                      selectionMode === 'users'
                        ? 'Add more users...'
                        : 'Search channels or users...'
                    }
                    value={searchValue}
                    onChange={handleSearchChange}
                    onKeyDown={handleKeyDown}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                  />
                </div>
              </Popover.Anchor>

              <Popover.Portal>
                <Popover.Content
                  side='bottom'
                  align='start'
                  sideOffset={4}
                  className={cn(
                    'z-[9999] min-w-[var(--radix-popover-trigger-width)] max-h-[250px] overflow-y-auto',
                    'rounded-md border border-border bg-popover shadow-lg',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                    'data-[side=bottom]:slide-in-from-top-2',
                    'scroll-smooth',
                  )}
                  style={{ WebkitOverflowScrolling: 'touch' }}
                  onOpenAutoFocus={e => e.preventDefault()}
                  collisionPadding={8}
                  avoidCollisions={true}
                  onWheel={e => {
                    e.stopPropagation();
                  }}
                  onInteractOutside={() => {
                    setIsSearchOpen(false);
                    setSelectedIndex(-1);
                  }}
                >
                  {searchResults.length > 0 ? (
                    <ul ref={listRef} id='forward-search-listbox' role='listbox' className='py-1'>
                      {searchResults.map((item, index) => (
                        <li
                          key={`${item.type}-${item.id}`}
                          id={`forward-search-option-${index}`}
                          role='option'
                          aria-selected={index === selectedIndex}
                          className={cn(
                            'relative flex cursor-pointer select-none items-center gap-3 px-3 py-2 text-sm outline-none transition-colors',
                            index === selectedIndex
                              ? 'bg-accent text-accent-foreground'
                              : 'hover:bg-accent hover:text-accent-foreground',
                          )}
                          onClick={() => handleSelectTarget(item)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelectTarget(item);
                            }
                          }}
                          onMouseEnter={() => setSelectedIndex(index)}
                          tabIndex={-1}
                        >
                          {item.type === 'channel' ? (
                            <>
                              <div className='size-6 flex items-center justify-center shrink-0 bg-gray-100 dark:bg-gray-700 rounded'>
                                {item.channel?.visibility === ChannelVisibility.PRIVATE ? (
                                  <Lock className='w-3.5 h-3.5 text-gray-600 dark:text-gray-400' />
                                ) : (
                                  <Hash className='w-3.5 h-3.5 text-gray-600 dark:text-gray-400' />
                                )}
                              </div>
                              <div className='flex flex-col min-w-0 flex-1'>
                                <span className='font-medium truncate'>{item.name}</span>
                                {item.description && (
                                  <span className='text-xs text-muted-foreground truncate'>
                                    {item.description}
                                  </span>
                                )}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className='size-6 flex items-center justify-center shrink-0'>
                                <Avatar userId={item.id} size='sm' showActiveStatus={false} />
                              </div>
                              <div className='flex flex-col min-w-0 flex-1'>
                                <span className='font-medium truncate'>{item.name}</span>
                                {item.description && (
                                  <span className='text-xs text-muted-foreground truncate'>
                                    {item.description}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className='px-4 py-4 text-center text-sm text-muted-foreground'>
                      {searchValue.trim()
                        ? `No results found for "${searchValue}"`
                        : 'Start typing to search...'}
                    </div>
                  )}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}

          <p className='text-xs text-muted-foreground mt-1.5'>
            {selectionMode === 'channel'
              ? 'Message will be forwarded to the selected channel'
              : selectionMode === 'users'
                ? 'Add more users or forward to the selected users'
                : 'Select a channel or one or more users to forward this message'}
          </p>
        </div>

        {/* Optional message with InputBox */}
        <div>
          <label
            htmlFor='forward-message-optional'
            className='block text-sm font-medium text-foreground mb-1.5'
          >
            Add a message (optional)
          </label>
          <InputBox
            ref={inputBoxRef}
            id='forward-message-optional'
            placeholder='Add a note to the forwarded message...'
            onSendMessage={async () => {
              // No-op: Forward is handled by the Forward button
            }}
            onContentChange={(html: string, text: string) => {
              form.setFieldValue('optionalMessageHtml', html);
              form.setFieldValue('optionalMessageText', text);
            }}
            mentionItems={mentionResults}
            onMentionSearch={searchMentions}
            channelItems={channelMentionItems}
            onChannelSearch={handleChannelMentionSearch}
            features={{
              richText: true,
              mentions: true,
              commands: false,
              fileAttachments: false,
              emojiPicker: true,
            }}
            showTypingIndicator={false}
            disabled={form.state.isSubmitting}
            disableEnterToSend
            hideSendButton
          />
        </div>

        {/* Message preview */}
        <div>
          <span className='block text-sm font-medium text-foreground mb-1.5'>Message preview</span>
          <div className='bg-gray-50 dark:bg-gray-700 rounded-md p-3 border border-gray-200 dark:border-gray-600'>
            <div className='flex gap-3'>
              <div className='flex-shrink-0'>
                <Avatar userId={message.senderId} size='md' />
              </div>
              <div className='flex-1 min-w-0'>
                <div className='flex items-baseline gap-2 mb-1'>
                  <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                    {sender?.name || 'User'}
                  </h4>
                  <span className='text-xs text-gray-500 dark:text-gray-400'>
                    {formatRelativeTimestamp(message.createdAt)}
                  </span>
                </div>
                {previewContent && (
                  <div
                    className={`text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words overflow-hidden ${getEmojiFontSizeClass(previewContent)}`}
                  >
                    <RenderMessageWithHTML message={previewContent} />
                  </div>
                )}
                {/* Attachments - hide when using optionalText (it's either optionalText OR content with attachments) */}
                {!useOptionalText && message.attachments && message.attachments.length > 0 && (
                  <div className='mt-2'>
                    <div className='flex flex-wrap gap-2'>
                      {message.attachments.map(attachment => (
                        <div key={attachment.id} className='flex-shrink-0'>
                          <MessageAttachment attachment={attachment} compact />
                        </div>
                      ))}
                    </div>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                      {message.attachments.length}{' '}
                      {message.attachments.length === 1 ? 'attachment' : 'attachments'} will be
                      forwarded
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className='flex justify-end gap-3 pt-2'>
          <Button
            variant='secondary'
            type='button'
            onClick={onCancel}
            disabled={form.state.isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type='submit'
            loading={form.state.isSubmitting}
            disabled={selectedTargets.length === 0 || form.state.isSubmitting}
          >
            {form.state.isSubmitting ? 'Forwarding...' : 'Forward'}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default ForwardMessageForm;
