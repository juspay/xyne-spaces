import React, {
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useRef,
  useImperativeHandle,
} from 'react';
import { withProfilerRef } from '../../../utils/withProfiler';
import { useZeroWithFallback as useZero } from '../../../hooks/useZeroWithFallback';
import { toast } from 'sonner';
import { useSummaryCache } from '../../../hooks/useSummaryQuery';

import { InputBox } from '../../ui/InputBox';
import {
  MessageType,
  ChannelScopeType,
  ChannelVisibility,
  Conversation,
  ChannelType,
  BaseTicketType,
} from '@xyne/shared';
import { BLOCKED_EXTENSIONS } from '../../ui/utils/files';
import { useChannel, useChannelSearch } from '../../../hooks/useChannels';
import { v4 as uuidv4 } from 'uuid';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { useTypingIndicator } from '../../../hooks/useTypingIndicator';
import { AgentProgressIndicator } from './AgentProgressIndicator';
import { useAuth, useAuthContextValues } from '../../../hooks/useAuth';
import { websocketService } from '../../../services/clients/socketClient';
import { processMessageForSending, containsSpecialBroadcastMention } from './ChatInput.utils';
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
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { useUser } from '../../../hooks/useUsers';
import { isDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import { isStatusExpired } from '../../../utils/statusUtils';
import { logger, Event } from '../../../utils/logger';
import { useZeroOfflineState } from '@xyne/shared/hooks';
import { WifiOff, Wifi } from 'lucide-react';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUpcomingDelayedMessage } from '../../../hooks/useUserDelayedMessages';
import { useThreadBroadcastMentions } from '../../../hooks/useThreadBroadcastMentions';
import { useSelector } from '@xstate/react';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { appsService } from '../../../services/Apps/appsService';
import type { CommandItem } from '../../ui/Selectors/Selectors.types';
import { setThreadLastRead } from '../../../machines/stateMachine';

const CHAT_MESSAGE_SENT_EVENT = 'xyne:chat-message-sent';

function dispatchChatMessageSentEvent(channelId: string): void {
  window.dispatchEvent(new CustomEvent(CHAT_MESSAGE_SENT_EVENT, { detail: { channelId } }));
}

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

const ChatInputInner = forwardRef<InputBoxHandle, ChatInputProps>(
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
    const navigate = useNavigate();
    const { user } = useAuth();
    const canCreateTicket = useCanCreateTicket();
    const { isOffline, showOfflineBanner, isReconnecting, isReconnected, refreshConnection } =
      useZeroOfflineState();

    // Summary cache invalidation - clear cache when messages change
    const { onMessageChange } = useSummaryCache();

    const inputBoxRef = useRef<InputBoxHandle>(null);
    const hasAutoFocusedRef = useRef(false);

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
    const isMobile = window.innerWidth < 500;
    const isXyneAIOpen = useSelector(xyneAIActor, state => state.matches('open'));

    // TipTap requires editor.commands.focus(), not DOM .focus().
    // Skips if already focused by TipTap's autofocus or usePageAutoFocus.
    // Also skips when autoFocus is null (keyboard navigation via ?nofocus=1).
    useEffect(() => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- autoFocus intentionally not in deps; read once on mount
      if (hasAutoFocusedRef.current || isMobile || isXyneAIOpen || autoFocus === null) return;
      hasAutoFocusedRef.current = true;

      const rafId = requestAnimationFrame(() => {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.closest('[contenteditable="true"]')) return;
        inputBoxRef.current?.focus();
      });

      return () => cancelAnimationFrame(rafId);
    }, [isMobile, isXyneAIOpen]);

    const { allowThreadBroadcastMentions } = useThreadBroadcastMentions();
    const {
      results: mentionResults,
      allUsers,
      searchMentions,
    } = useMentionSearch(channelId, {
      includeSpecialMentions: !conversation?.conversationId || allowThreadBroadcastMentions,
    });
    const [channelSearchQuery, setChannelSearchQuery] = useState('');
    const channelResults = useChannelSearch(channelSearchQuery, 10);
    const conversationId = conversation?.conversationId;

    // Slash commands for this channel — filtered by context (thread vs chat)
    const [channelCommands, setChannelCommands] = useState<CommandItem[]>([]);
    useEffect(() => {
      const isThread = !!conversation?.conversationId;
      const filter = isThread ? { isForThread: true } : { isForChat: true };
      appsService
        .getChannelCommands(channelId, filter)
        .then(cmds =>
          setChannelCommands(
            cmds.map(c => ({ id: c.id, name: c.commandName, description: c.description })),
          ),
        )
        .catch(() => {
          // silently ignore — channel may simply have no apps
        });
    }, [channelId, conversation?.conversationId]);

    const handleCommandSelect = useCallback(
      async (command: CommandItem, text?: string) => {
        try {
          await appsService.executeCommandAction(
            channelId,
            command.name,
            conversationId ?? null,
            text,
          );
        } catch {
          // Error notice is shown as a private system message in chat (only visible to the user)
        }
      },
      [channelId, conversationId],
    );

    const currentSessionId = conversationId ?? channelId;
    const { handleTyping, stopTyping } = useTypingIndicator(currentSessionId);
    const [typingUsers, setTypingUsers] = useState<Array<{ userId: string; username: string }>>([]);
    const [alsoSendToChannel, setAlsoSendToChannel] = useState(false);
    const [isCreateTicketModalOpen, setIsCreateTicketModalOpen] = useState(false);
    const [ticketDescription, setTicketDescription] = useState('');
    const [recentScheduledFor, setRecentScheduledFor] = useState<number | null>(null);
    const channel = useChannel(channelId);
    const isSupportChannel = channel?.type === ChannelType.SUPPORT;
    const upcomingScheduledInContext = useUpcomingDelayedMessage(channelId, conversationId ?? null);

    const bannerScheduledFor = upcomingScheduledInContext ?? recentScheduledFor;

    useEffect(() => {
      setRecentScheduledFor(null);
    }, [channelId, conversationId]);

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
      // Load draft for this channel if not editing
      if (!messageId && !initialContent) {
        return draft;
      }
      return undefined;
    }, [initialContent, messageId, draft]);

    const { displayName: channelName, avatarUserId } = useChannelDisplayName(
      channel,
      context.userID,
    );
    const isDM = channel && isDMChannel(channel.scopeType);
    const dmUser = useUser(avatarUserId || '');
    const hasValidStatus =
      dmUser?.statusEmoji && (!dmUser.statusExpiryAt || !isStatusExpired(dmUser.statusExpiryAt));

    const placeholderText = (
      <span className='flex items-center gap-1.5 whitespace-nowrap overflow-hidden'>
        <span>
          {placeholder ||
            (channelName ? `Message ${isTestEnv ? '' : channelName}`.trim() : 'Type a message...')}
        </span>
        {isDM && hasValidStatus && dmUser?.statusEmoji && (
          <span className='inline-flex items-center gap-1 min-w-0'>
            <span className='shrink-0'>{renderEmoji(dmUser.statusEmoji)}</span>
            {dmUser.statusContent && (
              <span className='truncate opacity-80'>{dmUser.statusContent}</span>
            )}
          </span>
        )}
      </span>
    );

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
        if (isOffline) {
          toast.warning("You're offline", {
            description: messageId
              ? "Edits can't be saved until you reconnect."
              : 'Your message has been saved as a draft. It will be ready to send when you reconnect.',
          });
          throw new Error('offline');
        }

        const processedHtml = processMessageForSending(html, allUsersForMentionResolution);
        const hasFiles = files && files.length > 0;
        const hasThreadBroadcastMention =
          !!conversationId &&
          !allowThreadBroadcastMentions &&
          containsSpecialBroadcastMention(processedHtml);

        if (hasThreadBroadcastMention) {
          toast.warning('Not allowed in threads', {
            description: '@channel and @here are disabled in thread replies.',
          });
        }
        const scopeType =
          channel?.scopeType && channel.scopeType !== ChannelScopeType.DEFAULT
            ? channel.scopeType
            : 'Channel';

        // Determines if an error is transient (Replicache will retry/recover).
        // oooMutation (out-of-order mutation) is a server-stream sequencing error
        // that causes a connection reset; Replicache's mutation recovery will
        // re-send unacknowledged mutations. Restoring the draft in this case
        // leads to a duplicate message experience because the original mutation
        // was processed before the disconnect.
        const isTransientError = (error: unknown): boolean => {
          const msg = error instanceof Error ? error.message : String(error);
          const isTransient = msg.includes('sent mutation ID') && msg.includes('but expected');
          return isTransient;
        };

        // Handles client and server mutation rejection: restores draft + editor content on failure
        const handleMutationResult = (
          result: ReturnType<typeof zero.mutate>,
          onReject: () => void,
          onSuccess?: () => void,
          logMeta?: Record<string, unknown>,
        ) => {
          result.client
            .then(clientResult => {
              if (clientResult.type === 'error') {
                onReject();
                if (logMeta) {
                  logger.error(Event.MESSAGE_SEND_FAILED, {
                    ...logMeta,
                    error: 'Client mutation rejected',
                  });
                }
                return;
              }
              onSuccess?.();
            })
            .catch(() => {
              onReject();
              if (logMeta) {
                logger.error(Event.MESSAGE_SEND_FAILED, {
                  ...logMeta,
                  error: 'Client mutation promise rejected',
                });
              }
            });

          result.server
            .then(serverResult => {
              if (serverResult.type === 'error') {
                if (isTransientError(serverResult.error)) {
                  // Transient error — Replicache will retry, do NOT restore draft
                  return;
                }
                onReject();
                if (logMeta) {
                  logger.error(Event.MESSAGE_SEND_FAILED, {
                    ...logMeta,
                    error: serverResult.error.message,
                    errorType: serverResult.error.type,
                    stage: 'server',
                  });
                }
              }
            })
            .catch(error => {
              if (isTransientError(error)) {
                return;
              }
              onReject();
              if (logMeta) {
                logger.error(Event.MESSAGE_SEND_FAILED, {
                  ...logMeta,
                  error: 'Server mutation promise rejected',
                  stage: 'server',
                });
              }
            });
        };

        // Restores draft content back to both the state machine and the editor
        const restoreDraft = () => {
          saveDraft(lookupId, processedHtml, '');
          inputBoxRef.current?.clearContent();
          inputBoxRef.current?.insertContent(processedHtml);
          toast.error('Failed to send message', {
            description: 'Message restored as draft. Please try again.',
          });
        };

        if (messageId) {
          // When editing a message, ignore alsoSendToChannel state to prevent metadata corruption
          const result = zero.mutate(
            mutators.messages.update({
              messageId,
              content: processedHtml,
            }),
          );
          handleMutationResult(
            result,
            () => {
              toast.error('Failed to edit message', {
                description: 'Please try again.',
              });
            },
            () => {
              if (conversationId) {
                onMessageChange(conversationId, channelId);
              }
              onEditComplete?.();
            },
          );
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
            const result = zero.mutate(
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
            saveDraft(lookupId, '', '');
            handleMutationResult(result, restoreDraft, undefined, {
              channelId,
              conversationId,
              isReply: true,
            });
            // Sender has implicitly read up to their own message
            setThreadLastRead(conversationId, messageCreatedAt);

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

            mixpanelService.track(EVENTS.MESSAGE_SEND_FAILED, {
              errorCode: 'CONVERSATION_SEND_ERROR',
              scopeType,
              errorReason: errorMessage,
            });
          }
        } else {
          try {
            const messageCreatedAt = Date.now();
            const newConversationId = uuidv4();
            const newMessageId = uuidv4();
            const result = zero.mutate(
              mutators.conversations.send({
                channelId,
                content: processedHtml,
                type: MessageType.USER,
                conversationId: newConversationId,
                messageId: newMessageId,
                timestamp: messageCreatedAt,
              }),
            );

            saveDraft(lookupId, '', '');
            handleMutationResult(
              result,
              restoreDraft,
              () => {
                dispatchChatMessageSentEvent(channelId);
              },
              {
                channelId,
                isNewConversation: true,
              },
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

            mixpanelService.track(EVENTS.MESSAGE_SEND_FAILED, {
              errorCode: 'CHANNEL_SEND_ERROR',
              scopeType,
              errorReason: errorMessage,
            });
          }
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
        isOffline,
        allowThreadBroadcastMentions,
      ],
    );

    const handleCancelEdit = (): void => {
      onCancel?.();
    };

    const handleScheduleSend = useCallback(
      (scheduledFor: number, html: string, files: File[]): void => {
        if (!user) {
          toast.error('You must be logged in to schedule messages');
          return;
        }
        const processedHtml = processMessageForSending(html, allUsersForMentionResolution);
        const hasFiles = files.length > 0;
        const hasThreadBroadcastMention =
          !!conversationId &&
          !allowThreadBroadcastMentions &&
          containsSpecialBroadcastMention(processedHtml);
        if (hasThreadBroadcastMention) {
          toast.warning('Not allowed in threads', {
            description: '@channel and @here are disabled in thread replies.',
          });
        }
        if (!processedHtml.trim() && !hasFiles) {
          toast.error('Cannot schedule an empty message');
          return;
        }
        const id = uuidv4();
        const now = Date.now();
        try {
          zero.mutate(
            mutators.delayedMessages.create({
              id,
              channelId,
              ...(conversationId ? { conversationId } : {}),
              content: processedHtml,
              scheduledFor,
              timestamp: now,
            }),
          );
          // Clear draft after scheduling
          saveDraft(lookupId, '', '');
          toast.success('Message scheduled', {
            description: `Will be sent at ${new Date(scheduledFor).toLocaleString()}`,
          });
          setRecentScheduledFor(scheduledFor);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Please try again.';
          toast.error('Failed to schedule message', { description: errorMessage });
        }
      },
      [
        zero,
        user,
        channelId,
        conversationId,
        allUsersForMentionResolution,
        lookupId,
        setRecentScheduledFor,
        allowThreadBroadcastMentions,
      ],
    );

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
          <>
            <AgentProgressIndicator sessionId={currentSessionId} />
            {showOfflineBanner && (
              <div className='px-3 py-1.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between mx-3 mb-1'>
                <div className='flex items-center gap-1.5'>
                  <WifiOff className='w-3 h-3 shrink-0' />
                  <span>
                    {messageId
                      ? "You're offline. Edits can't be saved until you reconnect."
                      : "You're offline. Messages will be saved as drafts until you reconnect."}
                  </span>
                </div>
                <button
                  type='button'
                  onClick={refreshConnection}
                  disabled={isReconnecting}
                  className={`ml-2 shrink-0 px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                    isReconnecting
                      ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 cursor-wait'
                      : 'text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900 hover:bg-amber-200 dark:hover:bg-amber-800'
                  }`}
                  data-track-category='CHAT_INPUT'
                  data-track-name='RECONNECT_ZERO'
                >
                  {isReconnecting ? 'Reconnecting...' : 'Reconnect'}
                </button>
              </div>
            )}
            {isReconnected && (
              <div className='px-3 py-1.5 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5 mx-3 mb-1'>
                <Wifi className='w-3 h-3 shrink-0' />
                <span>Connected</span>
              </div>
            )}
            {bannerScheduledFor !== null && (
              <div className='mx-3 mb-2 mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground animate-in slide-in-from-bottom-2 duration-200'>
                <Clock size={14} className='flex-shrink-0 text-muted-foreground' />
                <span className='min-w-0'>
                  Your message will be sent at {format(new Date(bannerScheduledFor), 'h:mm a')} on{' '}
                  {format(new Date(bannerScheduledFor), 'MMM d')}.{' '}
                  <button
                    type='button'
                    onClick={() => void navigate('/chat/scheduled')}
                    className='font-semibold text-primary hover:underline'
                    data-track-category='chat-input'
                    data-track-name='open-delayed-messages-from-banner'
                  >
                    See all scheduled messages
                  </button>
                </span>
              </div>
            )}
            <InputBox
              id={currentSessionId}
              channelId={channelId}
              autoFocus={isMobile || isXyneAIOpen ? false : autoFocus} // eslint-disable-line jsx-a11y/no-autofocus
              ref={inputBoxRef}
              key={`inputBox-${channelId}-${conversationId}`}
              mentionItems={mentionResults}
              voiceMentionItems={allUsersForMentionResolution}
              onMentionSearch={handleMentionSearch}
              channelItems={channelItems}
              onChannelSearch={handleChannelSearch}
              onSendMessage={handleSendMessage}
              onContentChange={handleContentChange}
              onTyping={handleTyping}
              placeholder={placeholderText}
              typingUsers={typingUsers}
              showTypingIndicator={showTypingIndicator}
              commandItems={channelCommands}
              onCommandSelect={handleCommandSelect}
              {...(editorValue !== undefined && { value: editorValue })}
              {...(messageId && onCancel && { onCancel: handleCancelEdit })}
              {...(conversationId && { conversationId })}
              className={className}
              features={{
                richText: true,
                commands: true,
                mentions: true,
                fileAttachments: !messageId,
                emojiPicker: true,
              }}
              blockedExtensions={[...BLOCKED_EXTENSIONS]}
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
              sendDisabled={isOffline}
              onScheduleSend={handleScheduleSend}
            />
          </>
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

ChatInputInner.displayName = 'ChatInput';

export const ChatInput = withProfilerRef<ChatInputProps, InputBoxHandle>(
  ChatInputInner,
  'ChatInput',
);
