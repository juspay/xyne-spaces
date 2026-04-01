import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { Badge } from '../../ui/Badge';
import { X, Hash, Lock } from 'lucide-react';
import { useUserSearch, useUser, useUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import {
  useChannelSearch,
  useAllChannels,
  useAllVisibleChannels,
} from '../../../hooks/useChannels';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { MessageAttachment } from '../MessageAttachment/MessageAttachment';
import { formatRelativeTimestamp } from '../../../utils/dateUtils';
import HuddleIcon from '../../icons/HuddleIcon';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import {
  ChannelVisibility,
  ChannelScopeType,
  MessageType,
  parseForwardedMessageXml,
} from '@xyne/shared';
import { channelService } from '../../../services/Chat/channelService';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../../hooks/useZero';
import { v4 as uuidv4 } from 'uuid';
import { mutators } from '../../../zero/mutators';
import { InputBox } from '../../ui/InputBox';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { ForwardMessageFormProps, ForwardTarget, SelectionMode } from './ForwardMessageModal.types';
import { toast } from 'sonner';
import { getDMParticipantIdsToFetch } from '../ChatDirectory/ChatDirectory.utils';
import { Combobox } from '../../ui/Combobox/Combobox';
import { DropdownListItemType } from '../../ui/Combobox/Combobox.types';
import { usePlatform } from '../../../hooks/usePlatform';
import { VisibleChannel } from '../../../machines/stateMachine';

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
  const { isMobile } = usePlatform();
  const [selectedTargets, setSelectedTargets] = useState<ForwardTarget[]>([]);
  const [isInitialOpen, setIsInitialOpen] = useState(!isMobile); // Don't show initial suggestions on mobile
  const [comboboxOpen, setComboboxOpen] = useState(!isMobile); // Don't auto-open dropdown on mobile
  const comboboxInputRef = useRef<HTMLInputElement>(null);
  const inputBoxRef = useRef<InputBoxHandle>(null);
  const navigate = useNavigate();
  const zero = useZero();

  // Auto-focus combobox input on modal open
  useEffect(() => {
    comboboxInputRef.current?.focus();
  }, []);

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

  const allVisibleChannels = useAllVisibleChannels();
  const allChannels = useAllChannels().map(
    c => allVisibleChannels.find(vc => vc.id === c.id) || ({ ...c } as VisibleChannel),
  ); // Merge visible channel data with all channels
  const allUsers = useUsers();

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

  const handleRemoveTarget = (targetId: string): void => {
    setSelectedTargets((prev: ForwardTarget[]) =>
      prev.filter((t: ForwardTarget) => t.id !== targetId),
    );
    setInputValue('');
    setTimeout(() => comboboxInputRef.current?.focus(), 0);
  };

  const meta = (message.metadata || {}) as Record<string, unknown>;
  const contentStr = typeof message.content === 'string' ? message.content : '';

  const isCallMessage =
    message.msgType === MessageType.SYSTEM &&
    (meta['isCallMessage'] === true ||
      meta['callId'] !== undefined ||
      /started a call|Call ended|joined the call/i.test(contentStr));

  const getChannelIcon = (channelId: string): React.ReactNode => {
    const channel = allChannels.find(c => c.id === channelId);
    const isPrivate = channel?.visibility === ChannelVisibility.PRIVATE;
    return isPrivate ? <Lock className='w-4 h-4' /> : <Hash className='w-4 h-4' />;
  };

  const [inputValue, setInputValue] = useState<string>('');
  const trimmedInputValue = inputValue.trim();
  const usersSuggestions = useUserSearch(trimmedInputValue, 5);
  const channelsSuggestions = useChannelSearch(trimmedInputValue, 5);
  const dropdownListItems = useMemo(() => {
    // Show default suggestions on initial modal open with empty input
    if (!inputValue.trim()) {
      if (isInitialOpen) {
        const defaults: DropdownListItemType[] = [];

        // Recent 1:1 DMs sorted by lastActivityAt (up to 5)
        const recentDMs = [...allChannels]
          .filter(channel => channel.scopeType === ChannelScopeType.DM)
          .sort(
            (a, b) => (b.channelStats?.lastActivityAt || 0) - (a.channelStats?.lastActivityAt || 0),
          )
          .slice(0, 5);

        recentDMs.forEach(channel => {
          const participantIds = getDMParticipantIdsToFetch(channel, currentUser?.id || '');
          const otherUser = allUsers.find(user => participantIds.includes(user.id));

          if (otherUser && otherUser.id !== currentUser?.id) {
            defaults.push({
              leftSlot: <Avatar userId={otherUser.id} size='sm' />,
              label: getUserDisplayName(otherUser),
              description: otherUser.email,
              value: otherUser.id,
            });
          }
        });

        // Recent DEFAULT channels sorted by lastActivityAt (up to 5)
        const recentChannels = [...allChannels]
          .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
          .sort(
            (a, b) => (b.channelStats?.lastActivityAt || 0) - (a.channelStats?.lastActivityAt || 0),
          )
          .slice(0, 5);

        recentChannels.forEach(channel => {
          defaults.push({
            leftSlot:
              channel.visibility === ChannelVisibility.PUBLIC ? (
                <Hash className='w-3.5 h-3.5 text-muted-foreground' />
              ) : (
                <Lock className='w-3.5 h-3.5 text-muted-foreground' />
              ),
            label: channel.name,
            value: channel.id,
          });
        });

        return defaults;
      }
      return [];
    }

    const suggestedUsers: DropdownListItemType[] = usersSuggestions
      .filter(currUser => currentUser?.id !== currUser.id && !selectedUserIds.has(currUser.id))
      .map(currUser => ({
        leftSlot: <Avatar userId={currUser.id} size='sm' />,
        label: getUserDisplayName(currUser),
        description: currUser.email,
        value: currUser.id,
      }));

    const suggestedChannels: DropdownListItemType[] = channelsSuggestions
      .filter(currChannel => currChannel.scopeType === ChannelScopeType.DEFAULT)
      .map(currChannel => ({
        leftSlot:
          currChannel.visibility === ChannelVisibility.PUBLIC ? (
            <Hash className='w-3.5 h-3.5 text-muted-foreground' />
          ) : (
            <Lock className='w-3.5 h-3.5 text-muted-foreground' />
          ),
        label: currChannel.name,
        value: currChannel.id,
      }));

    if (selectionMode === 'none') {
      return [...suggestedUsers, ...suggestedChannels];
    } else if (selectionMode === 'channel') {
      return suggestedChannels;
    }
    return suggestedUsers;
  }, [
    inputValue,
    selectedUserIds,
    isInitialOpen,
    usersSuggestions,
    channelsSuggestions,
    selectionMode,
  ]);

  const onInputValueChangeHandler = (queryString: string) => {
    setInputValue(queryString);
    if (queryString.trim().length > 0 && isInitialOpen) {
      setIsInitialOpen(false);
    }
  };

  const onValueChangeHandler = (selectedValue: string | null) => {
    if (!selectedValue) return;

    // Check if the selected value is a user
    const selectedUser = allUsers.find(u => u.id === selectedValue);
    if (selectedUser) {
      const newTarget: ForwardTarget = {
        type: 'user',
        id: selectedUser.id,
        name: getUserDisplayName(selectedUser),
      };
      setSelectedTargets((prev: ForwardTarget[]) => [...prev, newTarget]);
      setInputValue('');
      setIsInitialOpen(false);
      comboboxInputRef.current?.focus();
      return;
    }

    // Check if the selected value is a channel
    const selectedChannel = allChannels.find(c => c.id === selectedValue);
    if (selectedChannel) {
      const newTarget: ForwardTarget = {
        type: 'channel',
        id: selectedChannel.id,
        name: selectedChannel.name,
      };
      setSelectedTargets([newTarget]);
      setInputValue('');
      setIsInitialOpen(false);
      return;
    }
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
      <div className='flex items-center justify-between px-6 pt-6 pb-4 border-b border-border'>
        <h2 className='text-lg font-semibold text-foreground'>Forward message</h2>
        <button
          type='button'
          className='rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-2'
          onClick={onCancel}
          data-track-category='FORWARD_MESSAGE_MODAL'
          data-track-name='CLOSE_FORWARD_MODAL'
        >
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </button>
      </div>

      <div className='px-6 py-4 space-y-2'>
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
                  data-track-category='FORWARD_MESSAGE_MODAL'
                  data-track-name='REMOVE_FORWARD_TARGET'
                  data-track-metadata={JSON.stringify({
                    targetId: target.id,
                    targetName: target.name,
                  })}
                >
                  <X className='h-3 w-3' />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {selectionMode !== 'channel' && (
          <Combobox
            ref={comboboxInputRef}
            label='Forward to'
            onInputValueChange={onInputValueChangeHandler}
            onValueChange={onValueChangeHandler}
            queryString={inputValue}
            placeholder={
              selectionMode === 'users' ? 'Add more users...' : 'Search channels or users...'
            }
            items={dropdownListItems}
            value={null}
            hintText='Select a channel or one or more users to forward this message'
            onBlur={() => setIsInitialOpen(false)}
            open={comboboxOpen}
            onOpenChange={setComboboxOpen}
            autoHighlight={true}
          />
        )}
        {selectionMode === 'channel' && (
          <p className='text-xs text-muted-foreground mt-1.5'>
            Message will be forwarded to the selected channel
          </p>
        )}
      </div>
      <div className='px-6 py-4 space-y-4'>
        {/* Optional message with InputBox */}
        <div
          onKeyDownCapture={e => {
            if (e.key === 'Enter' && !e.shiftKey && selectedTargets.length > 0) {
              if (inputBoxRef.current?.isSuggestionOpen()) return;
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }
          }}
        >
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
            onSendMessage={() => {
              // Handled by the wrapper div's onKeyDown
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
            hideSendButton
          />
        </div>

        {/* Message preview */}
        <div>
          <span className='block text-sm font-medium text-foreground mb-1.5'>Message preview</span>
          <div className='bg-muted rounded-md p-3 border border-border max-h-[200px] overflow-y-auto'>
            <div className='flex gap-3'>
              <div className='flex-shrink-0'>
                {isCallMessage ? (
                  <div className='w-10 h-10 rounded-md flex items-center justify-center bg-accent'>
                    <HuddleIcon color='#4b5563' size={20} />
                  </div>
                ) : (
                  <Avatar userId={message.senderId} size='md' />
                )}
              </div>
              <div className='flex-1 min-w-0'>
                <div className='flex items-baseline gap-2 mb-1'>
                  <h4 className='text-sm font-semibold text-foreground'>
                    {isCallMessage ? 'Xyne Call' : sender?.name || 'User'}
                  </h4>
                  <span className='text-xs text-muted-foreground'>
                    {formatRelativeTimestamp(message.createdAt)}
                  </span>
                </div>
                {previewContent && (
                  <div
                    className={`text-foreground whitespace-pre-wrap break-words ${getEmojiFontSizeClass(previewContent)}`}
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
                    <p className='text-xs text-muted-foreground mt-1'>
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
            data-track-category='FORWARD_MESSAGE_MODAL'
            data-track-name='CANCEL_FORWARD'
          >
            Cancel
          </Button>
          <Button
            type='submit'
            loading={form.state.isSubmitting}
            disabled={selectedTargets.length === 0 || form.state.isSubmitting}
            data-track-category='FORWARD_MESSAGE_MODAL'
            data-track-name='FORWARD_MESSAGE'
            data-track-metadata={JSON.stringify({ targetCount: selectedTargets })}
          >
            {form.state.isSubmitting ? 'Forwarding...' : 'Forward'}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default ForwardMessageForm;
