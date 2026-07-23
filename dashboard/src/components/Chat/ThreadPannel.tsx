import { ReactElement, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { activitySkipMarkAsReadThreadRef } from '../Activity/activitySkipMarkAsRead';
import {
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
  useOutletContext,
} from 'react-router-dom';
import { Button } from '../ui/Button';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useChannel, useGetChannelUserStatus } from '../../hooks/useChannels';
import { useRouteContext } from '../../hooks/useRouteContext';
import { usePlatform } from '../../hooks/usePlatform';
import { useIsInPanelWebview } from '../../hooks/useIsInPanelWebview';
import { X, FileText, ClipboardCheck, Hash } from 'lucide-react';
import {
  ArrowLeft,
  ArrowTurnDownRight,
  MaximizeTwoArrow,
  LinkHorizontal,
  ExternalLinkSquare,
  LinkSlant,
  MultipleCrossCancelDefault,
  ChatDefault,
  TicketToken,
  FolderDefault,
  ClipboardCheck as ClipboardCheckIcon,
  ThreeDotsMenuVertical,
} from '@xyne/icons';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import { ChatInput } from './ChatInput';
import ThreadList from './ThreadList/ThreadList';
import { useDragAndDropAreaRef } from '../../hooks/useDragAndDropAreaRef';
import { DragAndDropOverlay } from './DragAndDropOverlay';
import { ConversationSubscription } from './ConversationSubscription';
import { useChannelSubscription } from '../../hooks/useChannelSubscription';
import { insertDateSeparatorsForThreadMessages } from '../../utils/chatUtils';
import { QueryResultType } from '@rocicorp/zero';
import * as Tabs from '@radix-ui/react-tabs';
import { cn } from '../../utils/classNames';
import JoinChannel from './JoinChannel/JoinChannel';
import { BotBubble } from './BotBubble';
import { toast } from 'sonner';
import { TicketDetails } from '../Tickets/TicketDetails/TicketDetails';
import { FileBubble } from '../ui/FileBubble/FileBubble';
import { MessageType, ChannelScopeType, BaseTicketType } from '@xyne/shared';
import { RCAPanelView } from '../Tickets/RCAPanelView';
import Tooltip from '../ui/Tooltip';
import { mixpanelService } from '../../services/Analytics/mixpanelService';
import { EVENTS, EVENT_PROPERTIES } from '../../services/Analytics/mixpanel.types';
import { useScope } from '../../shortcuts';
import { useShareableOrigin } from '../../hooks/useShareableOrigin';
import GlobalCommandMenu from '../GlobalCommandMenu/GlobalCommandMenu';
import type { ContextItem } from './ThreadContextPanel/ThreadContextPanel.types';
import { isElectronApp, isStandaloneWindow, standaloneNavigate } from '../../utils/electronApp';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useZero } from '../../hooks/useZero';
import { logger, Event } from '../../utils/logger';
import { XyneAIStar } from '../icons/xyne-ai';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { getDraft } from '../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';
import { xyneAIActor, type ThreadInfo } from '../../machines/xyneAIMachine';
import { setThreadLastRead } from '../../machines/stateMachine';
import { useSelf, useUser } from '../../hooks/useUsers';
import { CallParticipantsSelectionModal } from '../Call/CallParticipantsSelectionModal';
import { ScheduleCallModal } from '../Call/ScheduleCallModal/ScheduleCallModal';
import { ThreadCallButton } from '../Call/ThreadCallButton/ThreadCallButton';
import { ConversationTabContext } from './ConversationTabContext';

type TabType = 'thread' | 'details' | 'files' | 'workflows' | 'rca';
type UnderTicketTabType = 'replies' | 'workflows' | 'rca';

interface ThreadMessagesProps {
  channelId?: string;
  conversationId?: string;
  ticketId?: string | null;
  onClose?: () => void;
  showHeader?: boolean;
  underTicketView?: boolean;
  simpleView?: boolean;
  hideHeader?: boolean;
  onSummaryClick?: () => void;
  threadMessages?: QueryResultType<typeof queries.conversationMessagesV2>;
  disableAskAI?: boolean;
  previewCardMode?: boolean;
  conversationParticipant?: { lastReadAt?: number | null };
  hideTabBar?: boolean;
  /** Scroll to and highlight this specific message on mount. Used by search screen sidebar to bypass URL-hash navigation. */
  matchedMessageId?: string | null;
  /** Show a clickable channel name badge next to the heading. Used by the search results sidebar. */
  showChannelLink?: boolean;
  /** Custom click handler for the channel name badge. Defaults to opening the thread in-channel. */
  onChannelLinkClick?: () => void;
}

export const ThreadMessages = ({
  channelId: propChannelId,
  conversationId: propConversationId,
  ticketId: propTicketId,
  onClose,
  showHeader = false,
  underTicketView = false,
  simpleView = false,
  hideHeader = false,
  threadMessages: propThreadMessages,
  disableAskAI,
  previewCardMode = false,
  conversationParticipant: propConversationParticipant,
  hideTabBar = false,
  matchedMessageId,
  showChannelLink = false,
  onChannelLinkClick,
}: ThreadMessagesProps = {}): ReactElement => {
  const {
    channelId: paramChannelId,
    conversationId: paramConversationId,
    ticketId: paramTicketId,
  } = useParams<{
    channelId?: string;
    conversationId?: string;
    ticketId?: string;
  }>();

  const { isMobile } = usePlatform();
  const isInPanelWebview = useIsInPanelWebview();
  const { baseRoute, buildChannelRoute } = useRouteContext();

  const currentUser = useSelf();
  const shareableOrigin = useShareableOrigin();

  const outletContext = useOutletContext<{ onClose?: () => void } | null>();
  const resolvedOnClose = onClose ?? outletContext?.onClose;

  const channelId = propChannelId || paramChannelId;
  const conversationId = propConversationId || paramConversationId;
  const ticketId = propTicketId !== undefined ? propTicketId || undefined : paramTicketId;
  const messageLoadStartTimeRef = useRef<number | null>(null);

  // Track derived values from ticket
  const [derivedConversationId, setDerivedConversationId] = useState(conversationId || '');
  const [derivedChannelId, setDerivedChannelId] = useState(channelId || '');

  const [searchParams] = useSearchParams();
  const selectedTabParam = searchParams.get('selectedTab');
  const validTabs: TabType[] = ['thread', 'details', 'files', 'workflows', 'rca'];
  const selectedTab: TabType = validTabs.includes(selectedTabParam as TabType)
    ? (selectedTabParam as TabType)
    : 'thread';

  const isFocusedThread = searchParams.get('focusThread') === '1';
  const skipInputAutoFocus = searchParams.get('nofocus') === '1';

  const participationStatus = useGetChannelUserStatus(derivedChannelId);
  const isMember = !!participationStatus;

  // Single enriched query: replaces getConversationById + ticketById + conversationMessagesV2
  // (4 pipelines → 1 pipeline, 178ms → 44ms hydration)
  const threadConversationQuery = useMemo(
    () =>
      queries.threadConversation({
        conversationId: derivedConversationId || ' ',
        ...(derivedChannelId ? { channelId: derivedChannelId, isMember } : {}),
      }),
    [derivedConversationId, derivedChannelId, isMember],
  );
  const [conversation, conversationDetails] = useCachedQuery(threadConversationQuery, {
    enabled: !!derivedConversationId,
  });

  // Participant comes from the combined threadConversation query or from prop (batch fetch in UserThreads)
  const conversationParticipant = useMemo(() => {
    const source =
      propConversationParticipant !== undefined
        ? propConversationParticipant
        : conversation?.participants;

    if (!source) {
      return { lastReadAt: 0 };
    }

    if (source.lastReadAt === null || source.lastReadAt === undefined) {
      return { ...source, lastReadAt: 0 };
    }

    return source;
  }, [propConversationParticipant, conversation?.participants]);

  const ticket = conversation?.ticket ?? null;
  const derivedTicketId = ticketId || conversation?.ticketId || '';

  // Update derived values when props/params change OR when conversation loads
  useEffect(() => {
    if (conversationId) {
      setDerivedConversationId(conversationId);
    } else if (conversation?.conversationId) {
      setDerivedConversationId(conversation.conversationId);
    }

    if (channelId) {
      setDerivedChannelId(channelId);
    } else if (conversation?.channelId) {
      setDerivedChannelId(conversation.channelId);
    }
  }, [conversationId, channelId, conversation]);

  // Messages come from the enriched conversation query; initialMessage = messages[0]
  // Spread to mutable array since ThreadList expects mutable type
  const queriedMessages = useMemo(
    () => (conversation?.messages ? [...conversation.messages] : undefined),
    [conversation?.messages],
  );
  const queryDetails = conversationDetails;

  // Use pre-fetched messages if provided, otherwise use queried
  const messages = useMemo(
    () => propThreadMessages ?? queriedMessages ?? [],
    [propThreadMessages, queriedMessages],
  );
  const messagesDetails = propThreadMessages ? { type: 'complete' as const } : queryDetails;
  const isMessagesLoaded = messagesDetails.type === 'complete' || messagesDetails.type === 'error';

  const threadParticipantIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      if (m.senderId) set.add(m.senderId);
    }
    return set;
  }, [messages]);
  const [isScheduleCallModalOpen, setIsScheduleCallModalOpen] = useState(false);
  const channel = useChannel(derivedChannelId);
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, currentUser?.id ?? '');
  const isDmThread =
    channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM;

  // Tab state - default to 'details' when opening from a ticket card
  const [activeTab, setActiveTab] = useState<TabType>(selectedTab);

  // Sync activeTab with URL query param when it changes
  useEffect(() => {
    setActiveTab(selectedTab);
  }, [selectedTab]);

  // Tab state for underTicketView mode
  const [underTicketActiveTab, setUnderTicketActiveTab] = useState<UnderTicketTabType>('replies');

  // Create ticket modal state
  const [isCreateTicketModalOpen, setIsCreateTicketModalOpen] = useState(false);

  // Context selection state
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  const handleAddContextClick = (): void => {
    logger.info(Event.THREAD_CONTEXT_BUTTON_CLICKED, {
      conversationId: derivedConversationId,
      userId: currentUser?.id,
    });
    setIsContextMenuOpen(true);
  };

  const handleContextItemToggle = (item: ContextItem): void => {
    setContextItems(prev =>
      prev.some(c => c.id === item.id) ? prev.filter(c => c.id !== item.id) : [...prev, item],
    );
  };

  const buildContextMessage = (): string => {
    const typeLabels: Record<string, string> = {
      channel: 'Channels',
      conversation: 'Messages',
      ticket: 'Tickets',
      attachment: 'Attachments',
      user: 'Users',
    };

    const groups = new Map<string, ContextItem[]>();
    for (const item of contextItems) {
      const list = groups.get(item.type) ?? [];
      list.push(item);
      groups.set(item.type, list);
    }

    const parts: string[] = ['<strong>Relevant Contexts:</strong>'];
    for (const [type, items] of groups) {
      const label = typeLabels[type] ?? type;
      const links = items
        .map(
          (item, i) => `&nbsp;&nbsp;&nbsp;&nbsp;${i + 1}. <a href="${item.url}">${item.title}</a>`,
        )
        .join('<br>');
      parts.push(`<strong>${label}:</strong><br>${links}`);
    }

    return parts.join('<br>');
  };
  // Call participants modal state
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);

  // Navigation for thread summary
  const navigate = useNavigate();
  const location = useLocation();

  // Check if the route is /threads (with optional workspace prefix)
  const isThreadsRoute = location.pathname.endsWith('/chat/dir/threads');

  // Check if thread summary is currently active
  const isThreadSummaryActive = location.hash.startsWith('#thread-summary');

  // Drag and drop functionality
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(derivedConversationId);

  useChannelSubscription(derivedChannelId, derivedConversationId ? [derivedConversationId] : []);
  useScope('thread', Boolean(derivedConversationId && derivedChannelId));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skipInputAutoFocus intentionally not in deps; the param can be stripped from the URL without re-firing
    if (previewCardMode || isMobile || skipInputAutoFocus || !derivedConversationId) return;

    const rafId = requestAnimationFrame(() => {
      const activeEl = document.activeElement;
      if (activeEl && activeEl.closest('input, textarea, [contenteditable="true"]')) return;
      inputRef.current?.focus();
    });

    return () => cancelAnimationFrame(rafId);
  }, [derivedConversationId, isMobile, previewCardMode]);

  const trackMessageLoadedPerformance = (startTime: number, messageType: string) => {
    const scopeType =
      channel?.scopeType && channel.scopeType !== ChannelScopeType.DEFAULT
        ? channel.scopeType
        : 'Channel';

    const timeTakenMs = Date.now() - startTime;

    mixpanelService.track(EVENTS.PERFORMANCE_METRIC, {
      type: messageType,
      timeTakenMs,
      channelLength: messages?.length || 0,
      scopeType,
      isInThread: true,
    });
  };

  // Track thread message loading performance
  useEffect(() => {
    if (messagesDetails.type === 'unknown') {
      messageLoadStartTimeRef.current = Date.now();
    } else if (messagesDetails.type === 'complete') {
      if (messageLoadStartTimeRef.current !== null) {
        trackMessageLoadedPerformance(
          messageLoadStartTimeRef.current,
          EVENT_PROPERTIES.PERFORMANCE_METRIC_TYPES.MESSAGES_LOADED,
        );

        const duration = Date.now() - messageLoadStartTimeRef.current;
        logger.info(Event.THREAD_MESSAGES_LOADED, {
          source: 'ThreadPannel',
          message: 'Thread messages loaded',
          durationMs: duration,
          url: window.location.href,
        });

        safeRecordMetric(() => {
          dataLoadDuration.record(duration, {
            source: 'ThreadPannel',
            event: Event.THREAD_MESSAGES_LOADED,
            platform: logger.platformName,
          });
        });

        messageLoadStartTimeRef.current = null;
      }
    } else if (messagesDetails.type === 'error') {
      if (messageLoadStartTimeRef.current !== null) {
        trackMessageLoadedPerformance(
          messageLoadStartTimeRef.current,
          EVENT_PROPERTIES.PERFORMANCE_METRIC_TYPES.MESSAGES_LOAD_FAILED,
        );

        const duration = Date.now() - messageLoadStartTimeRef.current;
        logger.info(Event.THREAD_MESSAGES_LOADED, {
          source: 'ThreadPannel',
          message: 'Thread messages load failed',
          durationMs: duration,
          url: window.location.href,
        });

        safeRecordMetric(() => {
          dataLoadDuration.record(duration, {
            source: 'ThreadPannel',
            event: Event.THREAD_MESSAGES_LOADED,
            platform: logger.platformName,
          });
        });

        messageLoadStartTimeRef.current = null;
      }
    } else {
      messageLoadStartTimeRef.current = null;
    }
  }, [messagesDetails.type, derivedConversationId, messages]);

  const isUserMember = isMember;

  const zero = useZero();

  // Own skipMarkAsRead ref for thread — independent of channel's skipMarkAsRead in ConversationPanelV2
  const skipMarkAsReadThreadRef = useRef(false);
  const setSkipMarkAsReadThread = useCallback((skip: boolean) => {
    skipMarkAsReadThreadRef.current = skip;
  }, []);

  const conversationTabContextValue = useMemo(
    () => ({
      setActiveTab: (): void => {},
      setSkipMarkAsRead: setSkipMarkAsReadThread,
      skipMarkAsReadRef: skipMarkAsReadThreadRef,
    }),
    [setSkipMarkAsReadThread],
  );

  useEffect(() => {
    return () => {
      if (skipMarkAsReadThreadRef?.current || activitySkipMarkAsReadThreadRef.current) {
        skipMarkAsReadThreadRef.current = false;
        activitySkipMarkAsReadThreadRef.current = false;
        return;
      }
      if (derivedConversationId) {
        const draft = getDraft(derivedChannelId, derivedConversationId);
        void zero.mutate(
          mutators.activities.markThreadActivitiesAsReadV2({
            conversationId: derivedConversationId,
            draftMessage: draft || '',
            draftMessageId: uuidv4(),
            timestamp: Date.now(),
            participantId: uuidv4(),
          }),
        );
      }
    };
  }, [derivedConversationId]);

  // Check if this is a ticket thread
  const isTicketThread = useMemo(() => {
    if (!conversation?.metadata) return false;
    const metadata = conversation.metadata as { ticketId?: string };
    return metadata.ticketId !== undefined;
  }, [conversation]);

  const handleContextConfirm = (): void => {
    if (contextItems.length === 0 || !derivedConversationId) return;
    const content = buildContextMessage();
    logger.info(Event.THREAD_CONTEXT_SUBMITTED, {
      conversationId: derivedConversationId,
      itemCount: contextItems.length,
      types: [...new Set(contextItems.map(i => i.type))],
      userId: currentUser?.id,
    });
    const ts = Date.now();
    void zero.mutate(
      mutators.messages.send({
        conversationId: derivedConversationId,
        content,
        type: MessageType.USER,
        showInChannel: false,
        timestamp: ts,
        messageId: uuidv4(),
      }),
    );
    // Sender has implicitly read up to their own message
    setThreadLastRead(derivedConversationId, ts);
    setContextItems([]);
    setIsContextMenuOpen(false);
  };

  const hasActiveCallForConversation = useMemo(() => {
    return !!conversation?.callId;
  }, [conversation?.callId]);

  // Create thread info for XyneAI context
  const initialMessage = conversation?.messages?.[0] ?? null;
  const initialMessageSender = useUser(initialMessage?.senderId || '');
  const threadInfo: ThreadInfo | null = useMemo(() => {
    if (!derivedConversationId || !initialMessage) return null;

    const senderName: string = String(initialMessageSender?.name || 'Unknown');
    const contentStr: string =
      typeof initialMessage.content === 'string' ? initialMessage.content : '';
    const previewText: string = contentStr.slice(0, 100);

    return {
      conversationId: derivedConversationId,
      senderName,
      previewText,
    };
  }, [derivedConversationId, initialMessage, initialMessageSender]);

  // Check if any message has a ticketId in metadata
  const hasTicketInMessages = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    return messages.some(msg => {
      const metadata = msg.metadata as { ticketId?: string } | null;
      return metadata?.ticketId !== undefined;
    });
  }, [messages]);

  // Prepare messages with date separators for ticket threads
  const messagesWithSeparators = useMemo(() => {
    if (isTicketThread || ticketId) {
      return insertDateSeparatorsForThreadMessages(messages);
    }
    return undefined;
  }, [messages, isTicketThread, ticketId]);

  // Fetch ticket attachments if this is a ticket thread
  // Memoized query request — same per-render AST/hash churn as threadConversationQuery.
  const ticketAttachmentsQuery = useMemo(
    () => queries.attachmentsByTicket({ ticketId: derivedTicketId }),
    [derivedTicketId],
  );
  const [ticketAttachments] = useCachedQuery(ticketAttachmentsQuery, {
    enabled: !!derivedTicketId,
  });

  // Get all attachments with their parent messages
  // For tickets, use ticket attachments. For regular conversations, use message attachments
  const files = useMemo(() => {
    // If this is a ticket, use ticket attachments
    if (derivedTicketId && ticketAttachments) {
      return ticketAttachments.map(att => ({
        attachment: att,
        message: null, // Ticket attachments don't have an associated message
      }));
    }

    // Otherwise, use message attachments (for regular conversations)
    if (!messages) return [];
    return messages
      .flatMap(msg => {
        if (!msg.hasAttachment || !msg.attachments || msg.attachments.length === 0) {
          return [];
        }
        return msg.attachments.map(att => ({
          message: msg,
          attachment: att,
        }));
      })
      .filter(item => !!item.attachment);
  }, [messages, derivedTicketId, ticketAttachments]);

  // Build tabs array - exclude Details tab when ticketId is present
  const isFixTicket = ticket?.ticketType === BaseTicketType.Fix;

  // Support URL-driven tab selection for the compact side panel mode as well.
  useEffect(() => {
    if (!underTicketView) return;

    if (selectedTab === 'rca' && isFixTicket) {
      setUnderTicketActiveTab('rca');
      return;
    }
    if (selectedTab === 'workflows') {
      setUnderTicketActiveTab('workflows');
      return;
    }
    setUnderTicketActiveTab('replies');
  }, [underTicketView, selectedTab, isFixTicket]);

  const tabs = useMemo(() => {
    const allTabs = [
      { value: 'thread' as const, label: 'Messages', icon: <ChatDefault size={14} /> },
      { value: 'details' as const, label: 'Details', icon: <TicketToken size={14} /> },
      {
        value: 'files' as const,
        label: 'Files',
        count: files.length,
        icon: <FolderDefault size={14} />,
      },
      ...(isFixTicket
        ? [{ value: 'rca' as const, label: 'RCA', icon: <ClipboardCheckIcon size={14} /> }]
        : []),
    ];

    // Filter out Details tab when ticketId doesn't exist
    return !derivedTicketId ? allTabs.filter(tab => tab.value !== 'details') : allTabs;
  }, [files.length, ticketId, derivedTicketId, isFixTicket]);

  const handleCreateTicket = (): void => {
    setIsCreateTicketModalOpen(true);
  };

  const handleInitiateCall = (): void => {
    setShowParticipantsModal(true);
  };

  const handleTicketCreated = (): void => {
    toast.success('Success', {
      description: 'Ticket created successfully',
      duration: 3000,
    });
  };

  const handleCloseTicketDetailsThread = (): void => {
    if (isStandaloneWindow()) {
      window.close();
      return;
    }

    const navState = location.state as {
      fromMyTickets?: boolean;
      fromActivity?: boolean;
      fromTable?: boolean;
      returnToUrl?: string;
      activeTab?: string;
    } | null;

    // Check if user came from activity, tickets table, tickets tab, or has a return URL
    const fromActivity = navState?.fromActivity || location.pathname.startsWith('/chat/activity/');
    const fromTable = navState?.fromTable;
    const isFromTickets =
      location.search.includes('tab=tickets') && location.search.includes('ticketId');
    const returnToUrl = navState?.returnToUrl;

    if (isMobile) {
      if (returnToUrl) {
        // Use the return URL if provided
        void navigate(returnToUrl, { replace: true });
      } else if (fromActivity) {
        // Navigate back to activity tab
        void navigate('/chat/activity', { replace: true });
      } else if (fromTable || isFromTickets) {
        // Navigate to tickets tab if coming from tickets/table
        void navigate(buildChannelRoute(derivedChannelId, { tab: 'tickets' }), {
          replace: true,
        });
      } else {
        // Navigate to channel (messages tab)
        void navigate(`${baseRoute}/${derivedChannelId}`, { replace: true });
      }
    } else {
      // Navigate to channel (messages tab)
      void navigate(`${baseRoute}/${derivedChannelId}`, { replace: isMobile });
    }
  };

  // From a focused thread, load the full channel (with this thread still open).
  // Drops focusThread but preserves the origin/messageId hash so the channel list
  // anchors to the right message.
  const handleOpenInChannel = (): void => {
    const params = new URLSearchParams(location.search);
    params.delete('focusThread');
    const qs = params.toString();
    void navigate(
      `${baseRoute}/${derivedChannelId}/${derivedConversationId}${qs ? `?${qs}` : ''}${location.hash}`,
    );
  };

  const showBreadcrumb = (isFocusedThread || showChannelLink) && !isStandaloneWindow() && !!channel;
  const focusedChannelBreadcrumb = showBreadcrumb ? (
    <Tooltip content={`Open ${isDmThread ? '' : '#'}${channelDisplayName}`}>
      <button
        type='button'
        onClick={onChannelLinkClick ?? handleOpenInChannel}
        aria-label={`Open ${channelDisplayName}`}
        data-track-category='THREAD_PANEL'
        data-track-name='OPEN_IN_CHANNEL_FROM_FOCUS'
        className='group/chan flex shrink-0 items-center gap-1 max-w-[180px] rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
      >
        {!isDmThread && (
          <Hash className='size-3.5 shrink-0 opacity-60 transition-opacity group-hover/chan:opacity-100' />
        )}
        <span className='truncate text-sm font-medium group-hover/chan:underline'>
          {channelDisplayName}
        </span>
      </button>
    </Tooltip>
  ) : null;

  const openTicketDetailsExpandedView = (): void => {
    if (!ticket) return;

    standaloneNavigate(
      navigate,
      buildChannelRoute(ticket.channelId, {
        tab: 'tickets',
        ticketId: ticket.id,
        conversationId: ticket.conversationId,
      }),
      { state: { activeTab } },
    );
  };
  const openInNewWindow = (): void => {
    const newWindow = window.open(
      `/newWindow/chat/dir/${derivedChannelId}/${derivedConversationId}`,
      '_blank',
    );
    if (!newWindow) {
      console.warn('Failed to open new window - popup may be blocked');
    } else {
      newWindow.focus();
    }
  };

  const handleCopyTicketId = () => {
    if (!ticket?.xyneId) return;
    void navigator.clipboard.writeText(ticket.xyneId);
    toast.success('Copied', {
      description: 'Ticket ID copied to clipboard',
      duration: 2000,
    });
  };

  const handleCopyTicketViewLink = () => {
    if (!ticket) return;

    // Use shareable origin from environment variable
    const minimizedTicketViewRoute = `${shareableOrigin}/chat/dir/${ticket.channelId}/${ticket.conversationId}/${ticket.id}?selectedTab=details`;
    void navigator.clipboard.writeText(minimizedTicketViewRoute);
    toast.success('Link copied', {
      description: 'Ticket link copied to clipboard',
      duration: 3000,
    });
  };

  // Early return for underTicketView mode - separate tab-based UI with Replies and Workflows
  if (underTicketView) {
    return (
      <div
        className={`flex-1 h-full flex flex-col bg-background overflow-hidden relative ${
          isInPanelWebview ? '' : 'rounded-lg'
        }`}
        ref={dragAndDropAreaRef}
      >
        {/* Drag and Drop Overlay */}
        <DragAndDropOverlay isVisible={isDragging} />
        <Tabs.Root
          value={underTicketActiveTab}
          onValueChange={value => setUnderTicketActiveTab(value as UnderTicketTabType)}
          className='flex-1 flex flex-col h-full overflow-hidden'
        >
          {/* Tab Header */}
          {!hideTabBar && (
            <div className='w-full pl-2 pr-3 py-3 bg-background'>
              <div>
                <Tabs.List className='flex items-center justify-between'>
                  <div className='flex items-center gap-0.5 px-0.5'>
                    {/* Replies Tab */}
                    <Tabs.Trigger asChild value='replies'>
                      <button
                        className={cn(
                          'flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors duration-100 cursor-pointer',
                          underTicketActiveTab === 'replies'
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                        )}
                      >
                        <span className='shrink-0'>
                          <ChatDefault size={14} />
                        </span>
                        <span className='text-sm font-medium tracking-[-0.28px]'>Messages</span>
                      </button>
                    </Tabs.Trigger>

                    {/* RCA Tab */}
                    {isFixTicket && (
                      <Tabs.Trigger asChild value='rca'>
                        <button
                          className={cn(
                            'flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors duration-100 cursor-pointer',
                            underTicketActiveTab === 'rca'
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                          )}
                        >
                          <span className='shrink-0'>
                            <ClipboardCheckIcon size={14} />
                          </span>
                          <span className='text-sm font-medium tracking-[-0.28px]'>RCA</span>
                        </button>
                      </Tabs.Trigger>
                    )}
                  </div>
                  <div className='flex items-center gap-2'>
                    {/* Subscription Button */}
                    {derivedConversationId && (
                      <Tooltip content='Toggle notification subscription'>
                        <div className='p-2 border border-border rounded-lg h-8 w-8'>
                          <ConversationSubscription
                            conversationId={derivedConversationId}
                            {...(conversation && { conversation })}
                            variant='icon-only'
                            className='flex items-center justify-center'
                          />
                        </div>
                      </Tooltip>
                    )}
                    {/* Initiate Call Button */}
                    {derivedConversationId && (
                      <ThreadCallButton
                        onStartCall={handleInitiateCall}
                        onScheduleCall={() => setIsScheduleCallModalOpen(true)}
                        hasActiveCall={hasActiveCallForConversation}
                        trackCategory='THREAD_PANEL'
                        trackName='INITIATE_CALL_FROM_THREAD'
                        trackMetadata={{
                          channelId: channel?.id,
                          conversationId: derivedConversationId,
                        }}
                      />
                    )}
                  </div>
                </Tabs.List>
              </div>
            </div>
          )}

          {/* Replies Tab Content */}
          <Tabs.Content
            value='replies'
            className='flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden'
          >
            <ThreadList
              channelId={derivedChannelId || ''}
              conversationId={derivedConversationId || ''}
              threadMessages={messages}
              initialScrollOffset={0}
              isTicketThread={false}
              channelScopeType={channel?.scopeType}
              conversation={conversation}
              enableCollapsing={previewCardMode}
              enableJumpFab={!previewCardMode}
              isMessagesLoaded={isMessagesLoaded}
              {...(disableAskAI !== undefined && { disableAskAI })}
              conversationParticipant={conversationParticipant}
            />

            {/* ChatInput at the bottom - only show if user is a member */}
            {isUserMember || channel?.isArchived ? (
              <div className='px-3 pb-3 bg-background'>
                <ChatInput
                  ref={inputRef}
                  channelId={derivedChannelId}
                  conversation={conversation ?? undefined}
                  placeholder='Reply to this thread...'
                  hasTicket={hasTicketInMessages}
                  threadParticipantIds={threadParticipantIds}
                />
              </div>
            ) : (
              <JoinChannel
                channelId={derivedChannelId}
                {...(channel?.name && { channelTitle: channel.name })}
              />
            )}
          </Tabs.Content>

          {/* RCA Tab Content */}
          {isFixTicket && (
            <Tabs.Content
              value='rca'
              className='flex-1 overflow-hidden bg-background data-[state=inactive]:hidden'
            >
              {derivedTicketId ? (
                <RCAPanelView ticketId={derivedTicketId} />
              ) : (
                <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                  <ClipboardCheck size={48} className='mb-2 text-muted-foreground' />
                  <p>Ticket ID not found</p>
                </div>
              )}
            </Tabs.Content>
          )}
        </Tabs.Root>
        {/* Call Participants Selection Modal */}
        {derivedConversationId && (
          <CallParticipantsSelectionModal
            isOpen={showParticipantsModal}
            onClose={() => setShowParticipantsModal(false)}
            channelId={derivedChannelId}
            conversationId={derivedConversationId}
          />
        )}
      </div>
    );
  }

  return (
    <ConversationTabContext.Provider value={conversationTabContextValue}>
      <div
        className={`flex-1 h-full flex flex-col bg-background overflow-hidden relative ${
          isInPanelWebview ? '' : 'rounded-lg'
        }`}
        ref={dragAndDropAreaRef}
      >
        {/* Drag and Drop Overlay */}
        <DragAndDropOverlay isVisible={isDragging} />
        {showHeader && (
          <div className='flex gap-2 items-center justify-between w-full pl-2 pr-3 pt-3'>
            <div className='flex gap-2 items-center min-w-0'>
              <ArrowTurnDownRight size={16} className='flex-shrink-0' />
              <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0'>
                {isTicketThread && ticket ? ticket.title : 'Thread message'}
              </h3>
            </div>

            {derivedConversationId && (
              <Tooltip content='Toggle notification subscription'>
                <ConversationSubscription
                  conversationId={derivedConversationId}
                  {...(conversation && { conversation })}
                  variant='icon-only'
                  className='h-7 w-7 rounded-lg flex items-center justify-center transition-colors hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50'
                />
              </Tooltip>
            )}
          </div>
        )}
        {derivedTicketId && ticket && !simpleView && (
          <div className='flex justify-between items-center w-full pl-2 pr-3 pt-3 gap-4'>
            <div className='flex gap-2 items-center min-w-0 flex-1'>
              <Tooltip content='Copy ticket ID'>
                <button
                  type='button'
                  onClick={handleCopyTicketId}
                  aria-label={`Copy ticket ID ${ticket.xyneId}`}
                  data-track-category='THREAD_PANEL'
                  data-track-name='COPY_TICKET_ID'
                  className='text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/70 px-2 py-0.5 rounded flex-shrink-0 cursor-pointer select-text transition-colors'
                >
                  {ticket.xyneId}
                </button>
              </Tooltip>
              <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-foreground'>
                {ticket.title}
              </h3>
              {focusedChannelBreadcrumb}
            </div>
            <div className='flex gap-x-2 shrink-0'>
              {/* Ask AI */}
              {!isStandaloneWindow() && (
                <Tooltip content='Ask AI Conversation'>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => {
                      xyneAIActor.send({
                        type: 'OPEN',
                        channelId: derivedChannelId,
                        threadInfo,
                      });
                    }}
                    className='h-7 w-7 rounded-lg'
                  >
                    <XyneAIStar />
                  </Button>
                </Tooltip>
              )}
              {/* Initiate Call Button */}
              {derivedConversationId && (
                <ThreadCallButton
                  onStartCall={handleInitiateCall}
                  onScheduleCall={() => setIsScheduleCallModalOpen(true)}
                  hasActiveCall={hasActiveCallForConversation}
                  trackCategory='THREAD_PANEL'
                  trackName='INITIATE_CALL_FROM_THREAD'
                  trackMetadata={{ channelId: channel?.id, conversationId: derivedConversationId }}
                />
              )}
              {/* Overflow menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className='flex items-center justify-center p-[8px] rounded-[8px] size-[28px] hover:bg-accent transition-colors text-foreground shrink-0'
                    title='More'
                    data-testid='thread-more-options-button'
                  >
                    <ThreeDotsMenuVertical size={16} className='opacity-60' />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  onCloseAutoFocus={e => e.preventDefault()}
                  className='min-w-[180px]'
                >
                  {derivedConversationId && (
                    <DropdownMenuItem className='p-0' onSelect={e => e.preventDefault()}>
                      <ConversationSubscription
                        conversationId={derivedConversationId}
                        {...(conversation && { conversation })}
                        variant='dropdown'
                        menuOpen
                        className='px-2 py-1.5'
                      />
                    </DropdownMenuItem>
                  )}
                  {!isMobile && (
                    <DropdownMenuItem className='gap-2' onClick={openTicketDetailsExpandedView}>
                      <MaximizeTwoArrow size={16} className='shrink-0' />
                      <span className='flex-1'>Expand view</span>
                    </DropdownMenuItem>
                  )}
                  {!isMobile && !channel?.isArchived && (
                    <DropdownMenuItem
                      className='gap-2'
                      onClick={handleAddContextClick}
                      data-track-category='THREAD_PANEL'
                      data-track-name='OPEN_CONTEXT_MENU'
                      data-track-metadata={JSON.stringify({
                        conversationId: derivedConversationId,
                      })}
                    >
                      <LinkHorizontal size={16} className='shrink-0' />
                      <span className='flex-1'>Add context to thread</span>
                    </DropdownMenuItem>
                  )}
                  {isElectronApp() && !isStandaloneWindow() && (
                    <DropdownMenuItem className='gap-2' onClick={openInNewWindow}>
                      <ExternalLinkSquare size={16} className='shrink-0' />
                      <span className='flex-1'>Open in new window</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem className='gap-2' onClick={handleCopyTicketViewLink}>
                    <LinkSlant size={16} className='shrink-0' />
                    <span className='flex-1'>Copy ticket link</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {!isThreadsRoute && (
                <Tooltip content='Close'>
                  <Button
                    onClick={resolvedOnClose ?? handleCloseTicketDetailsThread}
                    className='h-7 w-7 rounded-lg'
                    variant='ghost'
                    size='sm'
                    aria-label='Close Thread Panel'
                  >
                    <MultipleCrossCancelDefault size={16} />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        )}
        {/* Ticket Thread with Tabs - only when NOT simpleView */}
        {!simpleView && derivedTicketId ? (
          /* Ticket Thread: Header with Tabs */
          <Tabs.Root
            value={activeTab}
            onValueChange={value => setActiveTab(value as TabType)}
            className='flex-1 flex flex-col h-full overflow-hidden'
          >
            {/* Header with title, close button, and tabs */}
            <div className='w-full pl-2 pr-3 pt-3 pb-3'>
              <div className='relative flex justify-between w-full'>
                {/* Tabs List */}
                <div className='overflow-x-auto no-scrollbar'>
                  <Tabs.List className='flex items-center justify-start gap-0.5 px-0.5'>
                    {tabs.map(tab => (
                      <Tabs.Trigger asChild key={tab.value} value={tab.value}>
                        <button
                          className={cn(
                            'flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors duration-100 cursor-pointer',
                            activeTab === tab.value
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                          )}
                        >
                          {tab.icon && <span className='shrink-0'>{tab.icon}</span>}
                          <span className='text-sm font-medium tracking-[-0.28px]'>
                            {tab.label}
                          </span>
                          {tab.count !== undefined && tab.count > 0 && (
                            <span className='text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full'>
                              {tab.count}
                            </span>
                          )}
                        </button>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </div>
                {/* Action Buttons */}
                <div className='flex items-center justify-end gap-1'>
                  {/* Close Button */}
                  {!isThreadsRoute &&
                    isTicketThread &&
                    (resolvedOnClose ? (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={resolvedOnClose}
                        aria-label='Close thread panel'
                      >
                        <X size={20} />
                      </Button>
                    ) : (
                      <button
                        onClick={handleCloseTicketDetailsThread}
                        className='p-1 rounded-md text-muted-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200'
                        aria-label='Close thread panel'
                        data-track-category='THREAD_PANEL'
                        data-track-name='CLOSE_THREAD_PANEL'
                        data-track-metadata={JSON.stringify({ conversationId })}
                      >
                        <X size={20} />
                      </button>
                    ))}
                </div>
              </div>
            </div>

            {/* Thread Tab Content */}
            <Tabs.Content
              value='thread'
              className='flex-1 flex flex-col h-full overflow-hidden data-[state=inactive]:hidden'
            >
              {isMessagesLoaded && !conversation && !!derivedConversationId ? (
                <div className='flex flex-col items-center justify-center flex-1 text-muted-foreground'>
                  <ChatDefault size={48} className='mb-2 opacity-40' />
                  <p className='text-sm'>No thread messages</p>
                </div>
              ) : (
                <>
                  <ThreadList
                    channelId={derivedChannelId || ''}
                    conversationId={derivedConversationId || ''}
                    threadMessages={messages}
                    messagesWithSeparators={messagesWithSeparators}
                    initialScrollOffset={0}
                    isTicketThread={true}
                    channelScopeType={channel?.scopeType}
                    conversation={conversation}
                    enableCollapsing={previewCardMode}
                    enableJumpFab={!previewCardMode}
                    isMessagesLoaded={isMessagesLoaded}
                    {...(disableAskAI !== undefined && { disableAskAI })}
                    conversationParticipant={conversationParticipant}
                  />

                  {/* ChatInput at the bottom - only show if user is a member */}
                  {isUserMember || channel?.isArchived ? (
                    <div className='px-3 pb-3 bg-background'>
                      <ChatInput
                        ref={inputRef}
                        channelId={derivedChannelId}
                        conversation={conversation ?? undefined}
                        placeholder='Reply to this thread...'
                        hasTicket={hasTicketInMessages}
                        threadParticipantIds={threadParticipantIds}
                      />
                    </div>
                  ) : (
                    <JoinChannel
                      channelId={derivedChannelId}
                      {...(channel?.name && { channelTitle: channel.name })}
                    />
                  )}
                </>
              )}
            </Tabs.Content>

            {/* Details Tab Content */}
            <Tabs.Content
              value='details'
              className='flex-1 min-h-0 bg-background overflow-hidden data-[state=inactive]:hidden'
            >
              <TicketDetails ticketId={derivedTicketId} onFillRCA={() => setActiveTab('rca')} />
            </Tabs.Content>

            {/* RCA Tab Content */}
            {isFixTicket && (
              <Tabs.Content
                value='rca'
                className='flex-1 overflow-hidden bg-background data-[state=inactive]:hidden'
              >
                <RCAPanelView ticketId={derivedTicketId} />
              </Tabs.Content>
            )}

            {/* Files Tab Content */}
            <Tabs.Content
              value='files'
              className='flex-1 overflow-auto bg-background p-4 data-[state=inactive]:hidden'
            >
              {files.length === 0 ? (
                <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                  <FileText size={48} className='mb-2 text-muted-foreground' />
                  <p>No files in this thread</p>
                </div>
              ) : (
                <div className='space-y-3'>
                  {files.map((file, idx) => (
                    <FileBubble
                      key={`${file.attachment.id}-${idx}`}
                      createdBy={file.attachment.createdBy}
                      createdAt={file.attachment.createdAt}
                      attachment={file.attachment}
                    />
                  ))}
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          /* Regular Thread or Simple View */
          <>
            {/* Header with tabs for simpleView, or simple header for regular view */}
            {!hideHeader && (
              <div className='flex justify-between items-center w-full pl-2 pr-3 pt-3 gap-4'>
                {/* Title */}
                <div className='flex items-center gap-2 min-w-0 flex-1'>
                  {isStandaloneWindow() && (
                    <Tooltip content='Back to channel'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 w-7 rounded-lg text-muted-foreground shrink-0'
                        onClick={() => void navigate(`/newWindow/chat/dir/${derivedChannelId}`)}
                        aria-label='Back to channel'
                      >
                        <ArrowLeft size={16} />
                      </Button>
                    </Tooltip>
                  )}
                  {/* Thread indicator — shown when summarizing, or in focused mode so the
                      header reads like Slack's "↳ Thread #channel". */}
                  {!simpleView && (isThreadSummaryActive || isFocusedThread) && (
                    <ArrowTurnDownRight size={16} className='text-muted-foreground shrink-0' />
                  )}
                  <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-foreground'>
                    {simpleView
                      ? 'Thread'
                      : isTicketThread && ticket
                        ? ticket.title
                        : 'Thread message'}
                  </h3>
                  {!simpleView && focusedChannelBreadcrumb}
                </div>

                {/* Actions */}
                <div className='flex items-center gap-1 shrink-0'>
                  {/* Ask AI */}
                  {!isStandaloneWindow() && (
                    <Tooltip content='Ask AI Conversation'>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => {
                          xyneAIActor.send({
                            type: 'OPEN',
                            channelId: derivedChannelId,
                            threadInfo,
                          });
                        }}
                        className='h-7 w-7 rounded-lg'
                      >
                        <XyneAIStar />
                      </Button>
                    </Tooltip>
                  )}

                  {/* Initiate Call Button */}
                  {derivedConversationId && !channel?.isArchived && (
                    <ThreadCallButton
                      onStartCall={handleInitiateCall}
                      onScheduleCall={() => setIsScheduleCallModalOpen(true)}
                      hasActiveCall={hasActiveCallForConversation}
                      trackCategory='THREAD_PANEL'
                      trackName='INITIATE_CALL_FROM_THREAD'
                      trackMetadata={{
                        channelId: channel?.id,
                        conversationId: derivedConversationId,
                      }}
                    />
                  )}

                  {/* Overflow menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className='flex items-center justify-center p-[8px] rounded-[8px] size-[28px] hover:bg-accent transition-colors text-foreground shrink-0'
                        title='More'
                        data-testid='thread-more-options-button'
                      >
                        <ThreeDotsMenuVertical size={16} className='opacity-60' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='end'
                      onCloseAutoFocus={e => e.preventDefault()}
                      className='min-w-[180px]'
                    >
                      {derivedConversationId && (
                        <DropdownMenuItem className='p-0' onSelect={e => e.preventDefault()}>
                          <ConversationSubscription
                            conversationId={derivedConversationId}
                            {...(conversation && { conversation })}
                            variant='dropdown'
                            menuOpen
                            className='px-2 py-1.5'
                          />
                        </DropdownMenuItem>
                      )}
                      {!isMobile && !channel?.isArchived && (
                        <DropdownMenuItem
                          className='gap-2'
                          onClick={handleAddContextClick}
                          data-track-category='THREAD_PANEL'
                          data-track-name='OPEN_CONTEXT_MENU'
                          data-track-metadata={JSON.stringify({
                            conversationId: derivedConversationId,
                          })}
                        >
                          <LinkHorizontal size={16} className='shrink-0' />
                          <span className='flex-1'>Add context to thread</span>
                        </DropdownMenuItem>
                      )}
                      {isElectronApp() && !isStandaloneWindow() && (
                        <DropdownMenuItem className='gap-2' onClick={openInNewWindow}>
                          <ExternalLinkSquare size={16} className='shrink-0' />
                          <span className='flex-1'>Open in new window</span>
                        </DropdownMenuItem>
                      )}
                      {channel?.projectId && !hasTicketInMessages && !channel?.isArchived && (
                        <DropdownMenuItem
                          className='gap-2'
                          onClick={handleCreateTicket}
                          data-testid='thread-create-ticket-button'
                          data-track-category='THREAD_PANEL'
                          data-track-name='CREATE_TICKET_FROM_THREAD'
                          data-track-metadata={JSON.stringify({
                            channelId: channel?.id,
                            projectId: channel?.projectId,
                          })}
                        >
                          <TicketToken size={16} className='shrink-0' />
                          <span className='flex-1'>Create ticket</span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Close Button */}
                  {(!simpleView || resolvedOnClose) && (
                    <Tooltip content='Close'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 w-7 rounded-lg'
                        onClick={resolvedOnClose ?? handleCloseTicketDetailsThread}
                        aria-label='Close thread panel'
                        data-track-category='THREAD_PANEL'
                        data-track-name='CLOSE_THREAD_PANEL'
                        data-track-metadata={JSON.stringify({ conversationId })}
                      >
                        <MultipleCrossCancelDefault size={16} />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </div>
            )}
            {isMessagesLoaded && !conversation && !!derivedConversationId ? (
              <div className='flex flex-col items-center justify-center flex-1 text-muted-foreground'>
                <ChatDefault size={48} className='mb-2 opacity-40' />
                <p className='text-sm'>No thread messages</p>
              </div>
            ) : (
              <>
                <ThreadList
                  channelId={derivedChannelId || ''}
                  conversationId={derivedConversationId || ''}
                  threadMessages={messages}
                  initialScrollOffset={0}
                  isTicketThread={false}
                  channelScopeType={channel?.scopeType}
                  conversation={conversation}
                  enableCollapsing={previewCardMode}
                  enableJumpFab={!previewCardMode}
                  isMessagesLoaded={isMessagesLoaded}
                  {...(disableAskAI !== undefined && { disableAskAI })}
                  conversationParticipant={conversationParticipant}
                  matchedMessageId={matchedMessageId ?? null}
                />

                {/* ChatInput at the bottom - only show if user is a member */}
                {isUserMember || channel?.isArchived ? (
                  <div className='px-3 pb-3 bg-background'>
                    <ChatInput
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus={previewCardMode || skipInputAutoFocus ? null : 'end'}
                      ref={inputRef}
                      channelId={derivedChannelId}
                      conversation={conversation ?? undefined}
                      placeholder='Reply to this thread...'
                      hasTicket={hasTicketInMessages}
                      threadParticipantIds={threadParticipantIds}
                    />
                  </div>
                ) : (
                  <JoinChannel
                    channelId={derivedChannelId}
                    {...(channel?.name && { channelTitle: channel.name })}
                  />
                )}
              </>
            )}
          </>
        )}
        {/* Context Search Menu */}
        {setIsContextMenuOpen && (
          <GlobalCommandMenu
            open={isContextMenuOpen}
            onOpenChange={setIsContextMenuOpen}
            contextSelectionMode
            contextItems={contextItems}
            onContextItemToggle={handleContextItemToggle}
            onContextSelectionConfirm={handleContextConfirm}
          />
        )}

        {/* Schedule Call Modal */}
        <ScheduleCallModal
          isOpen={isScheduleCallModalOpen}
          onClose={() => setIsScheduleCallModalOpen(false)}
          {...(derivedChannelId ? { channelId: derivedChannelId } : {})}
          {...(derivedConversationId ? { conversationId: derivedConversationId } : {})}
        />
        {/* BotBubble for ticket creation - only show if channel has projectId */}
        {channel?.projectId && messages && messages.length > 0 && messages[0] && conversation && (
          <BotBubble
            messageId={messages[0].messageId}
            messageContent={messages[0].content}
            channelId={derivedChannelId}
            context='thread'
            conversation={conversation}
            isModalOpen={isCreateTicketModalOpen}
            renderTicketCard={false}
            onModalOpenChange={setIsCreateTicketModalOpen}
            onTicketCreated={handleTicketCreated}
          />
        )}

        {/* Call Participants Selection Modal */}
        {derivedConversationId && (
          <CallParticipantsSelectionModal
            isOpen={showParticipantsModal}
            onClose={() => setShowParticipantsModal(false)}
            channelId={derivedChannelId}
            conversationId={derivedConversationId}
          />
        )}
      </div>
    </ConversationTabContext.Provider>
  );
};

export default ThreadMessages;
