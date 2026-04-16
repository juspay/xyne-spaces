import React, {
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useRef,
  useImperativeHandle,
} from 'react';
import { useZeroWithFallback as useZero } from '../../../hooks/useZeroWithFallback';
import { toast } from 'sonner';
import { useSummaryCache } from '../../../hooks/useSummaryQuery';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { InputBox } from '../../ui/InputBox';
import {
  MessageType,
  ChannelScopeType,
  ChannelVisibility,
  Conversation,
  ChannelType,
  BaseTicketType,
} from '@xyne/shared';
import { ALLOWED_FILE_TYPES } from '../../ui/utils/files';
import { queries } from '../../../zero/queries';
import { useChannel, useChannelSearch } from '../../../hooks/useChannels';
import { v4 as uuidv4 } from 'uuid';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { useTypingIndicator } from '../../../hooks/useTypingIndicator';
import { useAuth, useAuthContextValues } from '../../../hooks/useAuth';
import { websocketService } from '../../../services/clients/socketClient';
import { processMessageForSending } from './ChatInput.utils';
import { saveDraft, useDraft } from '../../../hooks/useDraft';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';
import type { FocusPosition } from '@tiptap/react';
import { createWorkflow, CreateWorkflowRequest } from '../../../services/Workflow/workflowService';
import { MentionResult } from '../../ui/Selectors/Selectors.types';
import { useCanCreateTicket } from '../../../hooks/usePermissions';
import { mutators } from '../../../zero/mutators';
import { useShortcutById } from '../../../shortcuts';
import { isTestEnv } from '../../../config';
import { createTicket, CreateTicketRequest } from '../../../services/ticketService';
import { useUser } from '../../../hooks/useUsers';
import { isDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import { isStatusExpired } from '../../../utils/statusUtils';
import { logger, Event } from '../../../utils/logger';

// Type for typing indicator system message content
interface TypingUpdatedContent {
  type: 'typing_updated';
  data: {
    sessionId: string;
    typingUsers: Array<{ userId: string; userName: string }>;
  };
}

interface ChatInputProps {
  autoFocus?: FocusPosition;
  channelId: string;
  conversation?: Conversation | undefined;
  messageId?: string;
  placeholder?: string;
  className?: string;
  onStartDM?: (userId: string) => void;
  initialContent?: string;
  onEditComplete?: () => void;
  onCancel?: () => void;
  currentUserId?: string;
  showTypingIndicator?: boolean;
  hasTicket?: boolean;
  isForwardedContent?: boolean;
}

export const ChatInput = forwardRef<InputBoxHandle, ChatInputProps>(
  (
    {
      autoFocus = null,
      channelId,
      conversation,
      messageId,
      placeholder,
      className = '',
      initialContent,
      currentUserId,
      showTypingIndicator = true,
      onEditComplete,
      onCancel,
      hasTicket = false,
      isForwardedContent = false,
    },
    ref,
  ) => {
    const zero = useZero();
    const { user } = useAuth();
    const canCreateTicket = useCanCreateTicket();

    // Summary cache invalidation - clear cache when messages change
    const { onMessageChange } = useSummaryCache();

    const inputBoxRef = useRef<InputBoxHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        addFiles: (files: File[]) => inputBoxRef.current?.addFiles(files),
        clearContent: () => inputBoxRef.current?.clearContent(),
        clearTextOnly: () => inputBoxRef.current?.clearTextOnly(),
        insertContent: (content: string) => inputBoxRef.current?.insertContent(content),
        isSuggestionOpen: () => inputBoxRef.current?.isSuggestionOpen() ?? false,
        focus: () => inputBoxRef.current?.focus(),
      }),
      [],
    );

    const context = useAuthContextValues();
    const { results: mentionResults, allUsers, searchMentions } = useMentionSearch(channelId);
    const [channelSearchQuery, setChannelSearchQuery] = useState('');
    const channelResults = useChannelSearch(channelSearchQuery, 10);
    const conversationId = conversation?.conversationId;

    const currentSessionId = conversationId ?? channelId;
    const { handleTyping, stopTyping } = useTypingIndicator(currentSessionId);
    const [typingUsers, setTypingUsers] = useState<Array<{ userId: string; username: string }>>([]);
    const [alsoSendToChannel, setAlsoSendToChannel] = useState(false);
    const [isCreateTicketModalOpen, setIsCreateTicketModalOpen] = useState(false);
    const [ticketDescription, setTicketDescription] = useState('');
    const [messagesData] = useCachedQuery(
      queries.conversationMessagesV2({ conversationId: conversationId || '' }),
      { enabled: !!conversationId },
    );
    const channel = useChannel(channelId);
    const isSupportChannel = channel?.type === ChannelType.SUPPORT;

    // Use all users for mention resolution
    const allUsersForMentionResolution = React.useMemo((): MentionResult[] => {
      if (allUsers.length === 0) {
        return mentionResults;
      }
      const userIds = new Set(allUsers.map(u => u.id));
      const additionalUsers = mentionResults.filter(m => m.type === 'user' && !userIds.has(m.id));
      return [...allUsers, ...additionalUsers];
    }, [allUsers, mentionResults]);
    // UPDATED: Handle post-ticket creation logic (Workflows & Cleanup only)
    const handleTicketCreated = (ticket: {
      id: string;
      conversationId?: string;
      createdBy?: string;
      assignedTo?: string;
      workflowType?: string;
      xyneId?: string;
    }): void => {
      // Workflow selection
      const workflowType: string | undefined = ticket.workflowType;

      // Only trigger workflow if one is selected
      if (workflowType) {
        // Base workflow data
        const workflowData: CreateWorkflowRequest = {
          title: `Ticket: ${ticketDescription.slice(0, 50)}${ticketDescription.length > 50 ? '...' : ''}`,
          workflowType,
          description: ticketDescription,
          ticketId: ticket.id,
          ...(ticket.conversationId && { conversationId: ticket.conversationId }),
          ...(ticket.xyneId && { xyneId: ticket.xyneId }),
        };

        // Add BUG_WORKFLOW specific required fields
        if (workflowType === 'BUG_WORKFLOW') {
          const bugWorkflowData = {
            ...workflowData,
            bugId: ticket.id,
            severity: 'medium', // Default severity
            reportedBy: ticket.createdBy || 'unknown',
            assignedTo: ticket.assignedTo || ticket.createdBy || 'unknown',
          };

          void createWorkflow(bugWorkflowData);
        } else {
          void createWorkflow(workflowData);
        }
      }

      // Close the modal after workflow is triggered
      setIsCreateTicketModalOpen(false);
      setTicketDescription('');

      // Clear only the text, not attachments (they've been transferred to the ticket)
      inputBoxRef.current?.clearTextOnly();
    };

    useEffect(() => {
      // Handler for session_activity events (typing indicators)
      const handleTypingEvent = (data: {
        sessionId: string;
        message: {
          messageId: string;
          conversationId: string;
          senderId: string;
          senderName: string;
          content: string;
          msgType: string;
          createdAt: Date;
        };
        type: string;
        timestamp: Date;
      }): void => {
        // Check if this is a SYSTEM message (typing, reactions, etc.)
        if (data.message.msgType === 'SYSTEM') {
          try {
            const content = JSON.parse(data.message.content) as TypingUpdatedContent;

            // Handle typing indicator
            if (content.type === 'typing_updated') {
              if (content.data?.sessionId !== currentSessionId) {
                return;
              }
              const typingUsers: Array<{ userId: string; userName: string }> =
                content?.data?.typingUsers || [];

              // Filter out current user
              const currentUserIdToFilter = currentUserId || user?.id;

              const others = typingUsers.filter(
                (u: { userId: string; userName: string }) => u.userId !== currentUserIdToFilter,
              );

              const mappedUsers = others.map(u => ({
                userId: u.userId,
                username: u.userName, // Backend userName → Frontend username
              }));

              setTypingUsers(mappedUsers);
            }
          } catch {
            // Ignore errors
          }
        }
      };

      // Add event listeners
      if (currentSessionId) {
        websocketService.on('session_activity', handleTypingEvent);
      }

      return (): void => {
        // Cleanup event listeners
        if (currentSessionId) {
          websocketService.removeListener('session_activity', handleTypingEvent);
          stopTyping();
        }
        setTypingUsers([]);
      };
    }, [currentSessionId, currentUserId, user?.id, stopTyping, onCancel]);

    useShortcutById(
      'composer.cancelEdit',
      () => {
        if (onCancel) onCancel();
      },
      {
        enabled: Boolean(onCancel),
      },
    );

    // Subscribe to draft from state machine
    const lookupId = conversationId ?? channelId;
    const draft = useDraft(channelId, conversationId ?? null);

    // Load draft for current channel on mount (only if not editing a message)
    const editorValue = React.useMemo(() => {
      if (isForwardedContent || initialContent) return initialContent;
      if (messageId && messagesData) {
        const message = messagesData.find(m => m.messageId === messageId);
        return message?.content;
      }
      // Load draft for this channel if not editing
      if (!messageId && !initialContent) {
        return draft;
      }
      return undefined;
    }, [initialContent, messageId, messagesData, draft]);

    const { displayName: channelName, avatarUserId } = useChannelDisplayName(
      channel,
      context.userID,
    );
    const isDM = channel && isDMChannel(channel.scopeType);
    const dmUser = useUser(avatarUserId || '');
    const hasValidStatus =
      dmUser?.statusEmoji && (!dmUser.statusExpiryAt || !isStatusExpired(dmUser.statusExpiryAt));

    const placeholderText =
      placeholder ||
      (channelName
        ? `Message ${isTestEnv ? '' : channelName}${
            isDM && hasValidStatus
              ? ` ${dmUser.statusEmoji}${dmUser.statusContent ? ` ${dmUser.statusContent}` : ''}`
              : ''
          }`.trim()
        : 'Type a message...');

    const handleMentionSearch = useCallback(
      (query: string) => {
        searchMentions(query);
      },
      [searchMentions],
    );

    const handleChannelSearch = useCallback((query: string) => {
      setChannelSearchQuery(query);
    }, []);

    const channelItems = React.useMemo(() => {
      if (!channelResults || channelResults.length === 0) return [];

      // Filter channels to only show DEFAULT scope (exclude DM, GROUP_DM, TICKET, DOCUMENT)
      const items = channelResults
        .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
        .map(channel => {
          return {
            id: channel.id,
            name: channel.name,
            isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
            ...(channel.description && { description: channel.description }),
            hasAccess: true,
          };
        });

      return items;
    }, [channelResults]);

    const handleAlsoSendToChannelChange = useCallback((checked: boolean): void => {
      setAlsoSendToChannel(checked);
    }, []);

    // Track current editor content (both HTML and plain text)
    const handleContentChange = useCallback(
      (html: string, text: string): void => {
        try {
          const processedHtml = processMessageForSending(html, allUsersForMentionResolution);
          // Do not save drafts while editing a message
          if (messageId) return;
          // Save or remove draft
          if (text.trim()) {
            saveDraft(lookupId, processedHtml, text);
          } else {
            saveDraft(lookupId, '', '');
          }
        } catch {
          // Unable to save draft
        }
      },
      [lookupId, messageId],
    );

    const handleSendMessage = useCallback(
      (_plainText: string, html: string, files: File[]): void => {
        const processedHtml = processMessageForSending(html, allUsersForMentionResolution);
        const hasFiles = files && files.length > 0;
        const scopeType =
          channel?.scopeType && channel.scopeType !== ChannelScopeType.DEFAULT
            ? channel.scopeType
            : 'Channel';

        if (messageId) {
          // When editing a message, ignore alsoSendToChannel state to prevent metadata corruption
          zero.mutate(
            mutators.messages.update({
              messageId,
              content: processedHtml,
            }),
          );
          // Invalidate summary cache when message is edited
          if (conversationId) {
            onMessageChange(conversationId, channelId);
          }
          onEditComplete?.();
          logger.info(Event.MESSAGE_SENT, {
            channelId,
            conversationId,
            isEdit: true,
            messageLength: processedHtml.length,
          });
          mixpanelService.track(EVENTS.INITIATE_ACTION, {
            type: EVENT_PROPERTIES.ACTION_TYPES.EDIT,
          });
        } else if (conversationId) {
          try {
            const messageCreatedAt = Date.now();
            const newMessageId = uuidv4();
            zero.mutate(
              mutators.messages.send({
                conversationId,
                content: processedHtml,
                type: MessageType.USER,
                showInChannel: alsoSendToChannel,
                timestamp: messageCreatedAt,
                messageId: newMessageId,
                ...(alsoSendToChannel && { childConversationId: uuidv4() }),
              }),
            );

            logger.info(Event.MESSAGE_SENT, {
              channelId,
              conversationId,
              isReply: true,
              hasAttachments: hasFiles,
              attachmentCount: hasFiles ? files.length : 0,
              messageLength: processedHtml.length,
            });

            mixpanelService.track(EVENTS.INITIATE_ACTION, {
              type: EVENT_PROPERTIES.ACTION_TYPES.THREAD_REPLY,
              scopeType,
              hasAttachments: hasFiles,
            });
            setAlsoSendToChannel(false);
            // Invalidate summary cache when reply is sent
            onMessageChange(conversationId, channelId);
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Please try again.';
            toast.error('Failed to send message', {
              description: errorMessage,
            });

            logger.error(Event.MESSAGE_SEND_FAILED, {
              channelId,
              conversationId,
              isReply: true,
              error: errorMessage,
            });

            // Track message send failure with categorized error reason
            mixpanelService.track(EVENTS.MESSAGE_SEND_FAILED, {
              errorCode: 'CONVERSATION_SEND_ERROR',
              scopeType,
              errorReason: errorMessage,
            });
          }
          // Clear draft after sending
          saveDraft(lookupId, '', '');
        } else {
          try {
            const messageCreatedAt = Date.now();
            const newConversationId = uuidv4();
            const newMessageId = uuidv4();
            zero.mutate(
              mutators.conversations.send({
                channelId,
                content: processedHtml,
                type: MessageType.USER,
                conversationId: newConversationId,
                messageId: newMessageId,
                timestamp: messageCreatedAt,
              }),
            );

            logger.info(Event.MESSAGE_SENT, {
              channelId,
              isNewConversation: true,
              hasAttachments: hasFiles,
              attachmentCount: hasFiles ? files.length : 0,
              messageLength: processedHtml.length,
            });

            mixpanelService.track(EVENTS.INITIATE_ACTION, {
              type: EVENT_PROPERTIES.ACTION_TYPES.DIRECT_MESSAGE,
              scopeType,
              hasAttachments: hasFiles,
            });
            // Invalidate channel summary cache when new conversation is created
            // Note: We only invalidate channel summaries, not thread (no conversationId yet)
            onMessageChange('', channelId);
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Please try again.';

            toast.error('Failed to send message', {
              description: errorMessage,
            });

            logger.error(Event.MESSAGE_SEND_FAILED, {
              channelId,
              isNewConversation: true,
              error: errorMessage,
            });

            // Track message send failure with categorized error reason
            mixpanelService.track(EVENTS.MESSAGE_SEND_FAILED, {
              errorCode: 'CHANNEL_SEND_ERROR',
              scopeType,
              errorReason: errorMessage,
            });
          }
          // Clear draft after sending
          saveDraft(lookupId, '', '');
        }
      },
      [
        zero,
        messageId,
        conversationId,
        channelId,
        onEditComplete,
        alsoSendToChannel,
        allUsersForMentionResolution,
        onMessageChange,
      ],
    );

    const handleCancelEdit = (): void => {
      onCancel?.();
    };

    const isMobile = window.innerWidth < 500;

    return (
      <>
        {channel?.isArchived ? (
          <div className='px-4 py-3 bg-muted border-t border-border'>
            <p className='text-sm text-status-pending text-center'>
              {conversationId
                ? 'You are viewing a thread from an archived channel'
                : `You are viewing #${channel.name}, an archived channel`}
            </p>
          </div>
        ) : (
          <InputBox
            id={currentSessionId}
            channelId={channelId}
            autoFocus={isMobile ? false : autoFocus} // eslint-disable-line jsx-a11y/no-autofocus
            ref={inputBoxRef}
            key={`inputBox-${channelId}-${conversationId}`}
            mentionItems={mentionResults}
            onMentionSearch={handleMentionSearch}
            channelItems={channelItems}
            onChannelSearch={handleChannelSearch}
            onSendMessage={handleSendMessage}
            onContentChange={handleContentChange}
            onTyping={handleTyping}
            placeholder={placeholderText}
            typingUsers={typingUsers}
            showTypingIndicator={showTypingIndicator}
            {...(editorValue !== undefined && { value: editorValue })}
            {...(messageId && onCancel && { onCancel: handleCancelEdit })}
            {...(conversationId && { conversationId })}
            className={className}
            features={{
              richText: true,
              commands: true,
              mentions: true,
              fileAttachments: true,
              emojiPicker: true,
            }}
            allowedFileTypes={[...ALLOWED_FILE_TYPES]}
            {...(conversationId &&
              !messageId && {
                onAlsoSendToChannelChange: handleAlsoSendToChannelChange,
                alsoSendToChannelChecked: alsoSendToChannel,
              })}
            {...(channel?.scopeType === ChannelScopeType.DEFAULT &&
              canCreateTicket &&
              !conversationId && {
                onCreateTicket: (description: string | undefined) => {
                  void (async () => {
                    if (isSupportChannel && user) {
                      const messageContent = description || 'Support request';
                      try {
                        // Backend handles everything: ticket creation, bot message, workflow trigger
                        const ticketPayload: CreateTicketRequest = {
                          title: messageContent,
                          description: messageContent,
                          channelId: channelId,
                          projectId: (channel.projectId as string | null) || '',
                          createdBy: user.id,
                          updatedBy: user.id,
                          ticketType: BaseTicketType.Support,
                          ...(conversationId && { sourceConversationId: conversationId }),
                        };

                        await createTicket(ticketPayload);

                        inputBoxRef.current?.clearContent();
                        toast.success('Support Ticket Created', {
                          description:
                            'Your support request has been submitted and picked up by AI.',
                        });
                      } catch (error) {
                        console.error('Failed to create support ticket:', error);
                        toast.error('Failed to create ticket', {
                          description: 'Please try again or contact support.',
                        });
                      }
                    } else {
                      setTicketDescription(description || '');
                      setIsCreateTicketModalOpen(true);
                    }
                  })();
                },
              })}
            onTranscriptSelect={(content: string) => {
              inputBoxRef.current?.insertContent(content);
            }}
            hasTicket={hasTicket}
          />
        )}
        {channel && isCreateTicketModalOpen ? (
          <CreateTicketModal
            isOpen={isCreateTicketModalOpen}
            onClose={() => {
              setIsCreateTicketModalOpen(false);
              setTicketDescription('');
            }}
            channelId={channelId}
            projectId={(channel.projectId as string | null) || ''}
            initialDescription={ticketDescription}
            sourceConversation={conversation ?? undefined}
            onTicketCreated={handleTicketCreated}
          />
        ) : null}
      </>
    );
  },
);

ChatInput.displayName = 'ChatInput';
