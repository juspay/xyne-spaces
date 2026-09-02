import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useRef,
  useImperativeHandle,
} from 'react';
import { withProfilerRef } from '../../../utils/withProfiler';
import { useZeroWithFallback as useZero } from '../../../hooks/useZeroWithFallback';
import { toast } from 'sonner';
import { useSummaryCache } from '../../../hooks/useSummaryQuery';

import { InputBox } from '../../ui/InputBox';
import { Button } from '../../ui/Button/Button';
import {
  type SdlcDiscussion,
  MessageType,
  ChannelScopeType,
  ChannelVisibility,
  Conversation,
  ChannelType,
  BaseTicketType,
  CommandAccessibility,
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
import { saveDraft, useDraft, useDraftFromDB } from '../../../hooks/useDraft';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import type { FocusPosition } from '@tiptap/react';
import type { MentionResult } from '@xyne/shared';
import { getSlashCommandArtifactDefinition } from '@xyne/shared';
import { sendMessage, type ConversationRef, type PendingAttachment } from '@xyne/shared/messages';
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
import { WifiOff, Wifi, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUpcomingDelayedMessage } from '../../../hooks/useUserDelayedMessages';
import { useThreadBroadcastMentions } from '../../../hooks/useThreadBroadcastMentions';
import { useSelector } from '@xstate/react';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { appsService } from '../../../services/Apps/appsService';
import type { AppShortcutWithApp } from '../../../services/Apps/appsService';
import { ShortcutPickerModal } from '../../Apps/ShortcutPickerModal/ShortcutPickerModal';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import type { CommandItem } from '../../ui/Selectors/Selectors.types';
import { setThreadLastRead } from '../../../machines/stateMachine';
import { BlockNoteEditor } from '@blocknote/core';
import { sanitizeHtmlString } from '../../../utils/sanitizer';
import type { TwinEditSession } from '../TwinReplyDraft/twinReplyDraftApi';
import {
  SLASH_COMMAND_ARTIFACT_COMMAND_ITEMS,
  buildSlashCommandArtifactMessage,
  detectSlashCommandArtifact,
  getSlashCommandArtifactBodyText,
  stripSlashCommandFromHtml,
} from '../SlashCommandArtifacts';
import { useSlashCommandArtifactSideEffects } from '../SlashCommandArtifactSideEffects';

const CHAT_MESSAGE_SENT_EVENT = 'xyne:chat-message-sent';

function draftTextToHtml(text: string): string {
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split('\n')
    .map(line => `<p>${line ? escape(line) : '<br>'}</p>`)
    .join('');
}

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
  threadParticipantIds?: ReadonlySet<string>;
  dockSlot?: React.ReactNode;
  twinEdit?: TwinEditSession | undefined;
  /** SDLC discussion binding: new channel conversations are linked to this owner. */
  sdlcDiscussion?: Omit<SdlcDiscussion, 'linkId'>;
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
      threadParticipantIds,
      dockSlot,
      twinEdit,
      sdlcDiscussion,
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
      if (hasAutoFocusedRef.current || isMobile || autoFocus === null) return;

      const rafId = requestAnimationFrame(() => {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.closest('[contenteditable="true"]')) return;
        hasAutoFocusedRef.current = true;
        inputBoxRef.current?.focus();
      });

      return () => cancelAnimationFrame(rafId);
    }, [isMobile, isXyneAIOpen]);

    const { allowThreadBroadcastMentions } = useThreadBroadcastMentions();
    const [channelSearchQuery, setChannelSearchQuery] = useState('');
    const channelResults = useChannelSearch(channelSearchQuery, 10);
    const conversationId = conversation?.conversationId;

    // A thread is one incident's workspace, so it holds at most one open artifact
    // of a given command. The channel root is unrestricted — it has no
    // conversation yet, so this can never match there.
    const { bannerItems: openArtifacts } = useSlashCommandArtifactSideEffects();
    const openArtifactCommandsInThread = useMemo(
      () =>
        new Set(
          conversationId
            ? openArtifacts
                .filter(artifact => artifact.conversationId === conversationId)
                .map(artifact => artifact.definition.command)
            : [],
        ),
      [conversationId, openArtifacts],
    );

    // Slash commands for this channel — filtered by context (thread vs chat)
    const [channelCommands, setChannelCommands] = useState<CommandItem[]>(
      SLASH_COMMAND_ARTIFACT_COMMAND_ITEMS,
    );
    // Registry command id of the artifact currently being drafted, if any.
    const [activeArtifactCommand, setActiveArtifactCommand] = useState<string | null>(null);
    // Global shortcuts for this channel
    const [globalShortcuts, setGlobalShortcuts] = useState<AppShortcutWithApp[]>([]);
    const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
    useEffect(() => {
      const isThread = !!conversation?.conversationId;
      const filter: { commandAccessibility?: CommandAccessibility } = isThread
        ? { commandAccessibility: CommandAccessibility.THREAD }
        : { commandAccessibility: CommandAccessibility.CHAT };
      appsService
        .getChannelCommands(channelId, filter)
        .then(cmds =>
          setChannelCommands([
            ...SLASH_COMMAND_ARTIFACT_COMMAND_ITEMS,
            ...cmds
              .filter(
                c =>
                  !SLASH_COMMAND_ARTIFACT_COMMAND_ITEMS.some(
                    artifact => artifact.name === c.commandName.toLowerCase(),
                  ),
              )
              .map(c => ({
                id: c.id,
                name: c.commandName,
                description: c.description,
                kind: 'app' as const,
              })),
          ]),
        )
        .catch(() => {
          setChannelCommands(SLASH_COMMAND_ARTIFACT_COMMAND_ITEMS);
        });
      // Fetch global shortcuts (not filtered by thread/chat)
      appsService
        .getChannelShortcuts(channelId, { type: 'GLOBAL' })
        .then(setGlobalShortcuts)
        .catch(() => undefined);
    }, [channelId, conversation?.conversationId]);

    // Hide, don't just reject: an artifact the user cannot post here should not
    // be offered. The send guards below still fire, because the command can also
    // be typed inline or left over in `activeArtifactCommand`.
    const availableCommands = useMemo(
      () =>
        openArtifactCommandsInThread.size === 0
          ? channelCommands
          : channelCommands.filter(
              command =>
                command.kind !== 'slash-command-artifact' ||
                !command.slashCommandArtifactCommand ||
                !openArtifactCommandsInThread.has(command.slashCommandArtifactCommand),
            ),
      [channelCommands, openArtifactCommandsInThread],
    );

    const handleCommandSelect = useCallback(
      async (command: CommandItem, text?: string) => {
        if (command.kind === 'slash-command-artifact' && command.slashCommandArtifactCommand) {
          setActiveArtifactCommand(command.slashCommandArtifactCommand);
          inputBoxRef.current?.focus();
          return;
        }
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
    // The first message in a channel creates a conversation client-side, but the
    // `conversationId` prop only updates once the view switches into that thread.
    // Agent-progress events are scoped to the new conversationId, so without this
    // the spinner/Stop button is dropped on the first run and only shows from the
    // second message onward. Remember the id we just created so the progress
    // indicator can subscribe to it immediately.
    const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
    useEffect(() => {
      setPendingConversationId(null);
      setActiveArtifactCommand(null);
    }, [channelId, conversationId]);
    const agentProgressConversationId = conversationId ?? pendingConversationId ?? undefined;
    const { handleTyping, stopTyping } = useTypingIndicator(currentSessionId);
    const [typingUsers, setTypingUsers] = useState<Array<{ userId: string; username: string }>>([]);
    const [alsoSendToChannel, setAlsoSendToChannel] = useState(false);
    const [isCreateTicketModalOpen, setIsCreateTicketModalOpen] = useState(false);
    const [ticketDescription, setTicketDescription] = useState('');
    const [recentScheduledFor, setRecentScheduledFor] = useState<number | null>(null);

    const {
      results: mentionResults,
      allUsers,
      searchMentions,
    } = useMentionSearch(channelId, threadParticipantIds, conversationId, {
      includeSpecialMentions: !conversationId || allowThreadBroadcastMentions,
    });
    const channel = useChannel(channelId);
    const isSupportChannel = channel?.type === ChannelType.SUPPORT;
    // SDLC channels are hidden from the chat directory, so "also send to
    // channel" has no destination a user could ever see — hide the toggle.
    const isSdlcChannel = channel?.type === ChannelType.SDLC;
    const upcomingScheduledInContext = useUpcomingDelayedMessage(channelId, conversationId ?? null);

    const bannerScheduledFor = upcomingScheduledInContext ?? recentScheduledFor;

    useEffect(() => {
      setRecentScheduledFor(null);
    }, [channelId, conversationId]);

    // Use all users for mention resolution.
    const allUsersForMentionResolution = React.useMemo((): MentionResult[] => {
      if (allUsers.length === 0) {
        return mentionResults;
      }
      const userIds = new Set(allUsers.map(u => u.id));
      const additionalUsers = mentionResults.filter(m => m.type === 'user' && !userIds.has(m.id));
      if (additionalUsers.length === 0) {
        return allUsers;
      }
      return [...allUsers, ...additionalUsers];
    }, [allUsers, mentionResults]);

    // Whether the agent-progress pill currently has content — lets InputBox flip
    // between the typing indicator and the agent pill when both are active.
    const [agentActive, setAgentActive] = useState(false);
    // Handle post-ticket creation cleanup (close modal, clear input)
    const handleTicketCreated = (): void => {
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
          msgType: MessageType;
          createdAt: Date;
        };
        type: string;
        timestamp: Date;
      }): void => {
        // Check if this is a SYSTEM message (typing, reactions, etc.)
        if (data.message.msgType === MessageType.SYSTEM) {
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
    // DB-backed draft (with already-uploaded attachments) for the channel
    // composer; used to carry attachments through the pending-message send.
    const channelDraftForSend = useDraftFromDB(channelId, conversationId ?? null);

    // Load draft for current channel on mount (only if not editing a message)
    const editorValue = React.useMemo(() => {
      if (isForwardedContent || initialContent) return initialContent;
      // Load draft for this channel if not editing
      if (!messageId && !initialContent) {
        return draft;
      }
      return undefined;
    }, [initialContent, messageId, draft]);

    const twinEditDraftIdRef = useRef<string | null>(null);
    const preTwinEditHtmlRef = useRef<string>('');
    useEffect(() => {
      const activeId = twinEdit?.draftId ?? null;
      if (activeId === twinEditDraftIdRef.current) return;
      const box = inputBoxRef.current;
      if (activeId) {
        preTwinEditHtmlRef.current = box?.getHtml?.() ?? '';
        box?.clearTextOnly();
        if (twinEdit?.message) box?.insertContent(draftTextToHtml(twinEdit.message));
        box?.focus();
      } else {
        box?.clearTextOnly();
        const restore = preTwinEditHtmlRef.current;
        if (restore) box?.insertContent(restore);
        preTwinEditHtmlRef.current = '';
      }
      twinEditDraftIdRef.current = activeId;
    }, [twinEdit?.draftId, twinEdit?.message]);

    const { displayName: channelName, avatarUserId } = useChannelDisplayName(
      channel,
      context.userID,
    );
    const isDM = channel && isDMChannel(channel.scopeType);
    const isOneToOneDM = channel?.scopeType === ChannelScopeType.DM;
    const dmUser = useUser(avatarUserId || '');
    const hasValidStatus =
      dmUser?.statusEmoji && (!dmUser.statusExpiryAt || !isStatusExpired(dmUser.statusExpiryAt));

    const dynamicName = isTestEnv ? '' : channelName;
    const defaultPlaceholder = !channelName
      ? 'Type a message...'
      : !dynamicName
        ? 'Send a message'
        : isDM
          ? `Send a message to ${dynamicName}`
          : `Send a message in #${dynamicName}`;

    const placeholderText = (
      <span className='flex items-center gap-1.5 whitespace-nowrap overflow-hidden'>
        <span>{placeholder || defaultPlaceholder}</span>
        {isOneToOneDM && hasValidStatus && dmUser?.statusEmoji && (
          <span className='inline-flex items-center gap-1 min-w-0'>
            <span className='shrink-0'>{renderEmoji(dmUser.statusEmoji)}</span>
            {dmUser.statusContent && (
              <span className='truncate opacity-80'>{dmUser.statusContent}</span>
            )}
          </span>
        )}
      </span>
    );

    const handleCreateCanvasFromComposer = useCallback(
      (initialContent?: string): void => {
        try {
          const sanitizedContent = sanitizeHtmlString(initialContent ?? '');
          const blocks = BlockNoteEditor.create().tryParseHTMLToBlocks(sanitizedContent);

          void navigate('/chat/canvas/new', {
            state: {
              mode: 'create-message',
              initialContent: blocks,
              channelId,
              ...(conversationId ? { conversationId } : {}),
            },
          });
        } catch {
          toast.error('Error', {
            description: 'Failed to convert the message to canvas format. Please try again.',
          });
        }
      },
      [channelId, conversationId, navigate],
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
          if (messageId || twinEdit) return;
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
      [lookupId, messageId, twinEdit],
    );

    const handleSendMessage = useCallback(
      (_plainText: string, html: string, files: File[]): void => {
        if (twinEdit) {
          if (isOffline) {
            toast.warning("You're offline", {
              description: 'You can send this reply once you reconnect.',
            });
            return;
          }
          const edited = _plainText.trim();
          if (!edited) return;
          twinEdit.onApprove(edited);
          return;
        }
        // Edits and thread replies still require a live connection. New
        // top-level channel messages are allowed offline: the pending-message
        // framework queues them and auto-retries on reconnect.
        if (isOffline && (messageId || conversationId)) {
          toast.warning("You're offline", {
            description: messageId
              ? "Edits can't be saved until you reconnect."
              : "Thread replies can't be sent until you reconnect.",
          });
          throw new Error('offline');
        }

        logger.info(Event.FRONTEND_ERROR, {
          type: 'migrated_console_info',
          message: String(
            `[AgentProgress] 📤 Message sent | conversationId: ${conversationId ?? currentSessionId} | hasFiles: ${!!(files && files.length > 0)}`,
          ),
        });

        // Editing an existing message never re-wraps it as an artifact.
        const artifactDraft = messageId
          ? null
          : detectSlashCommandArtifact(activeArtifactCommand, _plainText);
        if (artifactDraft && !getSlashCommandArtifactBodyText(artifactDraft, _plainText)) {
          toast.error(`Describe the ${artifactDraft.definition.bodyNoun} before sending`);
          throw new Error(`${artifactDraft.definition.command} body is required`);
        }
        if (artifactDraft && openArtifactCommandsInThread.has(artifactDraft.definition.command)) {
          toast.error(`A ${artifactDraft.definition.badge} is already open in this thread`, {
            description: 'Close it first, or declare this one in the channel instead.',
          });
          throw new Error(`${artifactDraft.definition.command} already open in this thread`);
        }

        const bodyHtml = processMessageForSending(
          artifactDraft?.typedInline
            ? stripSlashCommandFromHtml(artifactDraft.definition.command, html)
            : html,
          allUsersForMentionResolution,
        );
        const processedHtml = artifactDraft
          ? buildSlashCommandArtifactMessage(
              artifactDraft.definition.command,
              bodyHtml,
              `slash-command-${artifactDraft.definition.command}-${uuidv4()}`,
            )
          : bodyHtml;
        const hasFiles = files && files.length > 0;
        const hasThreadBroadcastMention =
          !!conversationId &&
          !messageId &&
          !isDM &&
          !allowThreadBroadcastMentions &&
          containsSpecialBroadcastMention(artifactDraft ? bodyHtml : processedHtml);

        if (hasThreadBroadcastMention) {
          toast.warning('Not allowed in threads', {
            description: '@channel and @here are disabled in thread replies.',
          });
        }

        // Zero normalizes every server mutation failure to { type: 'app' | 'zero', message }.
        // - 'zero' = protocol / connection / out-of-order error. The connection resets and
        //   Replicache's mutation recovery re-sends unacknowledged mutations, so the message is
        //   (or will be) persisted. Restoring the draft here duplicates it back into the editor.
        // - 'app'  = the mutator genuinely threw (validation/permission/etc). Zero rolls back the
        //   optimistic write, the message disappears, so restoring the draft is correct.
        // Only 'app' errors should restore; everything else is treated as transient.
        // NOTE: serverResult.error is a plain object (NOT an Error instance), so we branch on its
        // normalized `type` field rather than matching the message string.
        const isTransientError = (error: unknown): boolean => {
          return !!error && typeof error === 'object' && 'type' in error && error.type === 'zero';
        };

        // Handles client and server mutation rejection: restores draft + editor content on failure
        const handleMutationResult = (
          result: ReturnType<typeof zero.mutate>,
          onReject: () => void,
          onSuccess?: () => void,
          onServerSuccess?: () => void,
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
                return;
              }
              onServerSuccess?.();
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
          const restoredHtml = artifactDraft ? bodyHtml : processedHtml;
          saveDraft(lookupId, restoredHtml, '');
          inputBoxRef.current?.clearContent();
          inputBoxRef.current?.insertContent(restoredHtml);
          if (artifactDraft) setActiveArtifactCommand(artifactDraft.definition.command);
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
            if (artifactDraft) setActiveArtifactCommand(null);
            handleMutationResult(result, restoreDraft, undefined, undefined, {
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
          }
        } else {
          try {
            const messageCreatedAt = Date.now();
            const newConversationId = uuidv4();
            const newMessageId = uuidv4();
            // Scope the agent-progress spinner to this new conversation right away,
            // before the `conversationId` prop catches up (see pendingConversationId).
            setPendingConversationId(newConversationId);
            // Route top-level channel sends through the shared pending-message
            // framework. sendMessage writes a durable pending entry, fires
            // mutators.conversations.send when Zero is connected (and queues it
            // for auto-retry when it is not), and clears the entry once the
            // server confirms the write. Failed sends stay queued and surface a
            // retry/delete affordance instead of being restored to the composer.
            const channelRef: ConversationRef = { kind: 'channel', channelId };
            // Carry the composer's already-uploaded draft attachments through the
            // pending-message framework so they are stored on the durable pending
            // entry and promoted (DRAFT -> CHAT) via explicit attachmentIds — on the
            // immediate send and on any offline auto-retry. The mutator's legacy
            // draft-scan fallback cannot be relied on here because sendMessage
            // detaches the draft as part of queueing the message.
            const pendingAttachments: PendingAttachment[] = (
              channelDraftForSend?.attachments ?? []
            ).map(a => ({
              attachmentId: a.id,
              originalFilename: a.originalFilename,
              mimetype: a.mimetype,
              size: a.size,
              ...(a.width !== null && { width: a.width }),
              ...(a.height !== null && { height: a.height }),
            }));
            sendMessage(zero as Parameters<typeof sendMessage>[0], channelRef, {
              content: processedHtml,
              type: MessageType.USER,
              conversationId: newConversationId,
              messageId: newMessageId,
              timestamp: messageCreatedAt,
              ...(pendingAttachments.length > 0 && { attachments: pendingAttachments }),
              ...(sdlcDiscussion !== undefined && {
                sdlcDiscussion: { ...sdlcDiscussion, linkId: uuidv4() },
              }),
            });

            saveDraft(lookupId, '', '');
            if (artifactDraft) setActiveArtifactCommand(null);
            dispatchChatMessageSentEvent(channelId);

            logger.info(Event.MESSAGE_SENT, {
              channelId,
              isNewConversation: true,
              hasAttachments: hasFiles,
              attachmentCount: hasFiles ? files.length : 0,
              messageLength: processedHtml.length,
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
          }
        }
      },
      [
        zero,
        messageId,
        isDM,
        conversationId,
        channelId,
        onEditComplete,
        alsoSendToChannel,
        allUsersForMentionResolution,
        onMessageChange,
        isOffline,
        user?.id,
        context.workspaceId,
        allowThreadBroadcastMentions,
        twinEdit,
        channelDraftForSend,
        activeArtifactCommand,
        openArtifactCommandsInThread,
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
        const plainText = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
        const artifactDraft = detectSlashCommandArtifact(activeArtifactCommand, plainText);
        if (artifactDraft && !getSlashCommandArtifactBodyText(artifactDraft, plainText)) {
          toast.error(`Describe the ${artifactDraft.definition.bodyNoun} before scheduling`);
          return;
        }
        if (artifactDraft && openArtifactCommandsInThread.has(artifactDraft.definition.command)) {
          toast.error(`A ${artifactDraft.definition.badge} is already open in this thread`, {
            description: 'Close it first, or declare this one in the channel instead.',
          });
          return;
        }
        const bodyHtml = processMessageForSending(
          artifactDraft?.typedInline
            ? stripSlashCommandFromHtml(artifactDraft.definition.command, html)
            : html,
          allUsersForMentionResolution,
        );
        const processedHtml = artifactDraft
          ? buildSlashCommandArtifactMessage(
              artifactDraft.definition.command,
              bodyHtml,
              `slash-command-${artifactDraft.definition.command}-${uuidv4()}`,
            )
          : bodyHtml;
        const hasFiles = files.length > 0;
        const hasThreadBroadcastMention =
          !!conversationId &&
          !messageId &&
          !isDM &&
          !allowThreadBroadcastMentions &&
          containsSpecialBroadcastMention(artifactDraft ? bodyHtml : processedHtml);
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
          if (artifactDraft) setActiveArtifactCommand(null);
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
        messageId,
        isDM,
        allUsersForMentionResolution,
        lookupId,
        setRecentScheduledFor,
        allowThreadBroadcastMentions,
        activeArtifactCommand,
        openArtifactCommandsInThread,
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
            <AgentProgressIndicator
              sessionId={agentProgressConversationId ?? currentSessionId}
              conversationId={agentProgressConversationId}
            />
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
                <Button
                  variant='ghost'
                  type='button'
                  onClick={refreshConnection}
                  disabled={isReconnecting}
                  className={`ml-2 shrink-0 px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                    isReconnecting
                      ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 cursor-wait'
                      : 'text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900 hover:bg-amber-200 dark:hover:bg-amber-800'
                  }`}
                  trackId='reconnect_zero'
                  data-track-category='CHAT_INPUT'
                  data-track-name='RECONNECT_ZERO'
                >
                  {isReconnecting ? 'Reconnecting...' : 'Reconnect'}
                </Button>
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
              placeholder={
                getSlashCommandArtifactDefinition(activeArtifactCommand)?.composerPlaceholder ??
                placeholderText
              }
              typingUsers={typingUsers}
              showTypingIndicator={showTypingIndicator}
              hasAgentActivity={agentActive}
              agentSlot={
                <AgentProgressIndicator
                  sessionId={agentProgressConversationId ?? currentSessionId}
                  conversationId={agentProgressConversationId}
                  onActiveChange={setAgentActive}
                />
              }
              commandItems={availableCommands}
              onCommandSelect={handleCommandSelect}
              {...(activeArtifactCommand && {
                slashCommandArtifactCommand: activeArtifactCommand,
              })}
              {...(dynamicName && {
                slashCommandArtifactChannelLabel: isDM ? dynamicName : `#${dynamicName}`,
              })}
              onCancelSlashCommandArtifact={() => setActiveArtifactCommand(null)}
              {...(!twinEdit && editorValue !== undefined && { value: editorValue })}
              {...(messageId && onCancel && { onCancel: handleCancelEdit })}
              {...(conversationId && { conversationId })}
              className={className}
              dockSlot={dockSlot}
              features={{
                richText: true,
                commands: true,
                mentions: true,
                fileAttachments: !messageId,
                emojiPicker: true,
              }}
              blockedExtensions={[...BLOCKED_EXTENSIONS]}
              preserveThreadRoute={!!conversationId}
              {...(conversationId &&
                !messageId &&
                !isSdlcChannel && {
                  onAlsoSendToChannelChange: handleAlsoSendToChannelChange,
                  alsoSendToChannelChecked: alsoSendToChannel,
                  isDMThread: !!isDM,
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
                          logger.error(Event.FRONTEND_ERROR, {
                            type: 'migrated_console_error',
                            message: String('Failed to create support ticket:'),
                            error: error,
                          });
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
              onCreateCanvas={handleCreateCanvasFromComposer}
              hasTicket={hasTicket}
              sendDisabled={isOffline}
              onScheduleSend={handleScheduleSend}
              {...(globalShortcuts.length > 0 && {
                bottomLeftSlot: (
                  <>
                    <Tooltip content='Shortcuts' side='top'>
                      <button
                        type='button'
                        onClick={() => setShortcutModalOpen(true)}
                        className='p-1.5 rounded hover:bg-accent transition-all duration-200 ease-in-out'
                        aria-label='Open shortcuts'
                        data-track-category='chat-input'
                        data-track-name='open-global-shortcuts'
                      >
                        <Zap className='h-4 w-4 text-muted-foreground' />
                      </button>
                    </Tooltip>
                    {shortcutModalOpen && (
                      <ShortcutPickerModal
                        open={shortcutModalOpen}
                        onClose={() => setShortcutModalOpen(false)}
                        channelId={channelId}
                        conversationId={conversationId ?? null}
                        shortcuts={globalShortcuts}
                      />
                    )}
                  </>
                ),
              })}
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
