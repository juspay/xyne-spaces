import { ReactElement, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import useMeasure from '../../hooks/useMeasure';
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
import {
  X,
  FileText,
  Ticket,
  CornerDownRight,
  MessageCircle,
  File,
  Maximize2,
  LinkIcon,
  Workflow,
  ExternalLink,
  ArrowLeft,
  ClipboardCheck,
  Link2,
  Hash,
} from 'lucide-react';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import CompactActionsMenu, { ActionMenuItem } from '../ui/CompactActionsMenu';
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
import { WorkflowBubble } from './WorkflowBubble/WorkflowBubble';
import { MessageMetadata } from '../ui/MessageBubble/MessageBubble.utils';
import { FailedStatusIcon, SuccessStatusIcon } from '../../assets/icons/WorkflowIcons';
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
  const isActivityRightPanel = baseRoute === '/chat/activity' && !isMobile;

  const currentUser = useSelf();
  const shareableOrigin = useShareableOrigin();

  const outletContext = useOutletContext<{ onClose?: () => void } | null>();
  const resolvedOnClose = onClose ?? outletContext?.onClose;

  const channelId = propChannelId || paramChannelId;
  const conversationId = propConversationId || paramConversationId;
  const ticketId = propTicketId !== undefined ? propTicketId || undefined : paramTicketId;
  const messageLoadStartTimeRef = useRef<number | null>(null);

  // Measure thread-panel header row, title, and actions to dynamically detect overflow
  const headerRowRef = useRef<HTMLDivElement>(null);
  const headerTitleRef = useRef<HTMLDivElement>(null);
  const headerActionsRef = useRef<HTMLDivElement>(null);
  const { width: headerRowWidth } = useMeasure({ ref: headerRowRef, observeResize: true });
  const { width: headerTitleWidth } = useMeasure({ ref: headerTitleRef, observeResize: true });
  const { width: headerActionsWidth } = useMeasure({ ref: headerActionsRef, observeResize: true });
  const fullHeaderActionsWidthRef = useRef(0);
  const prevActionsElementRef = useRef<HTMLElement | null>(null);

  // Reset max when the underlying DOM element changes (view switch detected by useMeasure)
  if (headerActionsRef.current !== prevActionsElementRef.current) {
    prevActionsElementRef.current = headerActionsRef.current;
    fullHeaderActionsWidthRef.current = 0;
  }

  if (headerActionsWidth > fullHeaderActionsWidthRef.current) {
    fullHeaderActionsWidthRef.current = headerActionsWidth;
  }

  const headerPadding =
    headerRowWidth > 0 ? headerRowWidth - headerTitleWidth - headerActionsWidth : 0;
  const MIN_HEADER_TITLE_WIDTH = 150;
  const isHeaderCompact =
    headerRowWidth > 0 &&
    headerPadding > 0 &&
    headerRowWidth - fullHeaderActionsWidthRef.current - headerPadding < MIN_HEADER_TITLE_WIDTH;

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

  // Filter workflow messages
  const workflowMessages = useMemo(() => {
    if (!messages) return [];
    return messages
      .filter(msg => {
        const metadata = msg.metadata as {
          workflowId?: string;
          ticketId?: string;
          xyneId?: string;
        } | null;
        const isSystemMessage = msg.msgType === MessageType.SYSTEM;
        const isBotMessage = msg.msgType === MessageType.BOT;
        return (
          (isSystemMessage && metadata?.workflowId && metadata?.ticketId) ||
          (isBotMessage && metadata?.xyneId && metadata?.ticketId)
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [messages]);

  // Create workflow number map for messages in threadlist
  const workflowNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    if (workflowMessages.length <= 1) return map;

    // Sort by createdAt ascending (oldest first) to assign numbers
    const sortedWorkflows = [...workflowMessages].sort((a, b) => a.createdAt - b.createdAt);
    sortedWorkflows.forEach((msg, index) => {
      map.set(msg.messageId, index + 1); // 1-indexed
    });
    return map;
  }, [workflowMessages]);

  const latestWorkflowStatus = useMemo(() => {
    if (workflowMessages.length === 0) return null;
    const metadata = workflowMessages[0]?.metadata as MessageMetadata | null;
    return metadata?.workflowStatus || 'UNKNOWN';
  }, [workflowMessages]);

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
      { value: 'thread' as const, label: 'Messages', icon: <MessageCircle size={12} /> },
      { value: 'details' as const, label: 'Details', icon: <Ticket size={12} /> },
      { value: 'files' as const, label: 'Files', count: files.length, icon: <File size={12} /> },
      {
        value: 'workflows' as const,
        label: 'Workflows',
        status: latestWorkflowStatus,
        icon: <Workflow size={12} />,
      },
      ...(isFixTicket
        ? [{ value: 'rca' as const, label: 'RCA', icon: <ClipboardCheck size={12} /> }]
        : []),
    ];

    // Filter out Details tab when ticketId doesn't exist
    return !derivedTicketId ? allTabs.filter(tab => tab.value !== 'details') : allTabs;
  }, [files.length, latestWorkflowStatus, ticketId, derivedTicketId, isFixTicket]);

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
            <div className='w-full p-4 pb-0 bg-background'>
              <div className='border-b border-border'>
                <Tabs.List className='flex items-center justify-between'>
                  <div className='flex items-center'>
                    {/* Replies Tab */}
                    <Tabs.Trigger asChild value='replies'>
                      <button
                        className={cn(
                          'px-3 py-2 flex items-center justify-start gap-2 transition-all duration-100 cursor-pointer',
                          underTicketActiveTab === 'replies'
                            ? 'border-b-2 border-primary'
                            : 'border-b-2 border-transparent',
                        )}
                      >
                        <span
                          className={
                            underTicketActiveTab === 'replies'
                              ? 'text-primary'
                              : 'text-muted-foreground'
                          }
                        >
                          <CornerDownRight size={12} />
                        </span>
                        <span
                          className={`text-sm font-medium ${underTicketActiveTab === 'replies' ? 'text-primary' : 'text-muted-foreground'}`}
                        >
                          Messages
                        </span>
                      </button>
                    </Tabs.Trigger>

                    {/* Workflows Tab */}
                    <Tabs.Trigger asChild value='workflows'>
                      <button
                        className={cn(
                          'px-3 py-2 flex items-center justify-start gap-2 transition-all duration-100 cursor-pointer',
                          underTicketActiveTab === 'workflows'
                            ? 'border-b-2 border-primary'
                            : 'border-b-2 border-transparent',
                        )}
                      >
                        <span
                          className={
                            underTicketActiveTab === 'workflows'
                              ? 'text-primary'
                              : 'text-muted-foreground'
                          }
                        >
                          <Workflow size={12} />
                        </span>
                        <span
                          className={`text-sm font-medium ${underTicketActiveTab === 'workflows' ? 'text-primary' : 'text-muted-foreground'}`}
                        >
                          Workflows
                        </span>
                        {latestWorkflowStatus &&
                          (latestWorkflowStatus === 'FAILED' ? (
                            <FailedStatusIcon />
                          ) : latestWorkflowStatus === 'RUNNING' ||
                            latestWorkflowStatus === 'SUCCESS' ? (
                            <SuccessStatusIcon />
                          ) : null)}
                      </button>
                    </Tabs.Trigger>

                    {/* RCA Tab */}
                    {isFixTicket && (
                      <Tabs.Trigger asChild value='rca'>
                        <button
                          className={cn(
                            'px-3 py-2 flex items-center justify-start gap-2 transition-all duration-100 cursor-pointer',
                            underTicketActiveTab === 'rca'
                              ? 'border-b-2 border-primary'
                              : 'border-b-2 border-transparent',
                          )}
                        >
                          <span
                            className={
                              underTicketActiveTab === 'rca'
                                ? 'text-primary'
                                : 'text-muted-foreground'
                            }
                          >
                            <ClipboardCheck size={12} />
                          </span>
                          <span
                            className={`text-sm font-medium ${underTicketActiveTab === 'rca' ? 'text-primary' : 'text-muted-foreground'}`}
                          >
                            RCA
                          </span>
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
              workflowNumberMap={workflowNumberMap}
              enableCollapsing={previewCardMode}
              enableJumpFab={!previewCardMode}
              isMessagesLoaded={isMessagesLoaded}
              {...(disableAskAI !== undefined && { disableAskAI })}
              conversationParticipant={conversationParticipant}
            />

            {/* ChatInput at the bottom - only show if user is a member */}
            {isUserMember || channel?.isArchived ? (
              <div className='px-4 pb-4 bg-background'>
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

          {/* Workflows Tab Content */}
          <Tabs.Content
            value='workflows'
            className='flex-1 overflow-auto bg-background p-4 data-[state=inactive]:hidden'
          >
            {workflowMessages.length === 0 ? (
              <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                <FileText size={48} className='mb-2 text-muted-foreground' />
                <p>No workflows in this thread</p>
              </div>
            ) : (
              <div className='space-y-3'>
                {[...workflowMessages].reverse().map((msg, index) => {
                  const metadata = msg.metadata as MessageMetadata;

                  if (!metadata?.workflowName || !metadata?.ticketId) {
                    return null;
                  }

                  return (
                    <WorkflowBubble
                      key={msg.messageId}
                      workflowName={metadata.workflowName}
                      workflowStatus={metadata.workflowStatus}
                      createdAt={msg.createdAt}
                      ticketId={metadata.ticketId}
                      metadata={metadata}
                      workflowNumber={workflowMessages.length > 1 ? index + 1 : undefined}
                    />
                  );
                })}
              </div>
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

  const sharedMenuItems: ActionMenuItem[] = [
    {
      customContent: (
        <ConversationSubscription
          conversationId={derivedConversationId}
          {...(conversation && { conversation })}
          variant='dropdown'
          menuOpen
          className='px-2 py-1.5'
        />
      ),
      onSelect: () => {},
      preventClose: true,
      visible: !!derivedConversationId,
    },
    {
      icon: <Link2 className='w-4 h-4' />,
      label: 'Add context to thread',
      onSelect: handleAddContextClick,
      visible: !isMobile && !channel?.isArchived,
    },
    {
      icon: <XyneAIStar />,
      label: 'Ask AI',
      onSelect: () =>
        xyneAIActor.send({
          type: 'OPEN',
          channelId: derivedChannelId,
          threadInfo,
        }),
      visible: !isStandaloneWindow(),
    },
    {
      icon: <ExternalLink className='w-4 h-4' />,
      label: 'Open in new window',
      onSelect: openInNewWindow,
      visible: isElectronApp() && !isStandaloneWindow(),
    },
  ];

  const ticketCompactMenuItems: ActionMenuItem[] = [
    {
      icon: <Maximize2 className='w-4 h-4' />,
      label: 'Expand view',
      onSelect: openTicketDetailsExpandedView,
      visible: !isMobile,
    },
    ...sharedMenuItems,
    {
      icon: <LinkIcon className='w-4 h-4' />,
      label: 'Copy ticket link',
      onSelect: handleCopyTicketViewLink,
    },
  ];

  const regularCompactMenuItems: ActionMenuItem[] = [
    ...sharedMenuItems,
    {
      icon: <Ticket className='w-4 h-4' />,
      label: 'Create ticket',
      onSelect: handleCreateTicket,
      visible: !!channel?.projectId && !hasTicketInMessages && !channel?.isArchived,
      testId: 'thread-create-ticket-button',
    },
  ];

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
          <div className='flex gap-2 items-center justify-between w-full pt-4 px-4'>
            <div className='flex gap-2 items-center min-w-0'>
              <CornerDownRight className='size-4 flex-shrink-0' />
              <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0'>
                {isTicketThread && ticket ? ticket.title : 'Thread message'}
              </h3>
            </div>

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
          </div>
        )}
        {derivedTicketId && ticket && !simpleView && (
          <div
            ref={headerRowRef}
            className='flex justify-between items-center w-full px-4 py-2 gap-4'
          >
            <div ref={headerTitleRef} className='flex gap-2 items-center min-w-0 flex-1'>
              <CornerDownRight className='size-4 flex-shrink-0' />
              <span className='text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded flex-shrink-0'>
                {ticket.xyneId}
              </span>
              <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-foreground'>
                {ticket.title}
              </h3>
              {focusedChannelBreadcrumb}
            </div>
            <div ref={headerActionsRef} className='flex gap-x-2 shrink-0'>
              {!isHeaderCompact && derivedConversationId && (
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
              {!isHeaderCompact && !isMobile && (
                <Tooltip content='Expand View'>
                  <Button
                    className='p-2 border border-border rounded-lg h-8 w-8'
                    variant='ghost'
                    size='sm'
                    onClick={openTicketDetailsExpandedView}
                    aria-label='Open Maximize View'
                  >
                    <Maximize2 size={20} />
                  </Button>
                </Tooltip>
              )}
              {!isHeaderCompact && !isMobile && !channel?.isArchived && (
                <Tooltip content='Add context to thread'>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='p-2 border border-border rounded-lg h-8 w-8'
                    onClick={handleAddContextClick}
                    aria-label='Add context to thread'
                    data-track-category='THREAD_PANEL'
                    data-track-name='OPEN_CONTEXT_MENU'
                    data-track-metadata={JSON.stringify({ conversationId: derivedConversationId })}
                  >
                    <Link2 size={18} />
                  </Button>
                </Tooltip>
              )}
              {!isHeaderCompact && !isStandaloneWindow() && (
                <Tooltip content='Ask AI Conversation'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => {
                      xyneAIActor.send({
                        type: 'OPEN',
                        channelId: derivedChannelId,
                        threadInfo,
                      });
                    }}
                    className='flex items-center justify-between gap-2 border rounded-lg !p-2 transition-all duration-100 text-foreground bg-background border-[border]'
                  >
                    <XyneAIStar />
                  </Button>
                </Tooltip>
              )}
              {!isHeaderCompact && isElectronApp() && !isStandaloneWindow() && (
                <Tooltip content='Open in new window'>
                  <Button
                    className='p-2 border border-border rounded-lg h-8 w-8'
                    variant='ghost'
                    size='sm'
                    onClick={openInNewWindow}
                    aria-label='Open in new window'
                  >
                    <ExternalLink size={20} />
                  </Button>
                </Tooltip>
              )}
              {!isHeaderCompact && (
                <Tooltip content='Copy Ticket Link'>
                  <Button
                    className='p-2 border border-border rounded-lg h-8 w-8'
                    variant='ghost'
                    size='sm'
                    onClick={handleCopyTicketViewLink}
                    aria-label='Copy Ticket'
                  >
                    <LinkIcon size={20} />
                  </Button>
                </Tooltip>
              )}
              {isHeaderCompact && <CompactActionsMenu items={ticketCompactMenuItems} />}
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
              {!isThreadsRoute && (
                <Tooltip content='Close'>
                  <Button
                    onClick={resolvedOnClose ?? handleCloseTicketDetailsThread}
                    className='p-2 border border-border rounded-lg h-8 w-8'
                    variant='ghost'
                    size='sm'
                    aria-label='Close Thread Panel'
                  >
                    <X size={20} />
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
            <div className='w-full pb-0 '>
              <div className='relative flex justify-between w-full border-b border-border'>
                {/* Tabs List */}
                <div className='overflow-x-auto no-scrollbar'>
                  <Tabs.List className='flex items-center justify-start'>
                    {tabs.map(tab => (
                      <Tabs.Trigger asChild key={tab.value} value={tab.value}>
                        <button
                          className={cn(
                            'px-3 py-2 flex items-center justify-start gap-2 transition-all duration-100 cursor-pointer',
                            activeTab === tab.value
                              ? 'border-b-2 border-primary'
                              : 'border-b-2 border-transparent',
                          )}
                        >
                          {tab.icon && (
                            <span
                              className={`${activeTab === tab.value ? 'text-primary' : 'text-muted-foreground'}`}
                            >
                              {tab.icon}
                            </span>
                          )}
                          <span
                            className={`text-sm font-medium ${activeTab === tab.value ? 'text-primary' : 'text-muted-foreground'}`}
                          >
                            {tab.label}
                          </span>
                          {tab.count !== undefined && tab.count > 0 && (
                            <span className='text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full'>
                              {tab.count}
                            </span>
                          )}
                          {tab.status &&
                            (tab.status === 'FAILED' ? (
                              <FailedStatusIcon />
                            ) : tab.status === 'RUNNING' || tab.status === 'SUCCESS' ? (
                              <SuccessStatusIcon />
                            ) : null)}
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
                  <MessageCircle size={48} className='mb-2 opacity-40' />
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
                    workflowNumberMap={workflowNumberMap}
                    enableCollapsing={previewCardMode}
                    enableJumpFab={!previewCardMode}
                    isMessagesLoaded={isMessagesLoaded}
                    {...(disableAskAI !== undefined && { disableAskAI })}
                    conversationParticipant={conversationParticipant}
                  />

                  {/* ChatInput at the bottom - only show if user is a member */}
                  {isUserMember || channel?.isArchived ? (
                    <div className='px-4 pb-4 bg-background'>
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
              className='flex-1 bg-background overflow-auto data-[state=inactive]:hidden'
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

            {/* Workflows Tab Content*/}
            <Tabs.Content
              value='workflows'
              className='flex-1 overflow-auto bg-background p-4 data-[state=inactive]:hidden'
            >
              {workflowMessages.length === 0 ? (
                <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                  <FileText size={48} className='mb-2 text-muted-foreground' />
                  <p>No workflows in this thread</p>
                </div>
              ) : (
                <div className='space-y-3'>
                  {[...workflowMessages].reverse().map((msg, index) => {
                    const metadata = msg.metadata as MessageMetadata;

                    if (!metadata?.workflowName || !metadata?.ticketId) {
                      return null;
                    }

                    return (
                      <WorkflowBubble
                        key={msg.messageId}
                        workflowName={metadata.workflowName}
                        workflowStatus={metadata.workflowStatus}
                        createdAt={msg.createdAt}
                        ticketId={metadata.ticketId}
                        metadata={metadata}
                        workflowNumber={workflowMessages.length > 1 ? index + 1 : undefined}
                      />
                    );
                  })}
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          /* Regular Thread or Simple View */
          <>
            {/* Header with tabs for simpleView, or simple header for regular view */}
            {!hideHeader && (
              <div
                className={cn(
                  'flex items-start self-stretch bg-background border-b border-border',
                  isActivityRightPanel ? 'h-[107px]' : 'h-14',
                )}
              >
                <div ref={headerRowRef} className='h-14 p-4 flex items-center gap-2 w-full'>
                  {isStandaloneWindow() && (
                    <Tooltip content='Back to channel'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-100'
                        onClick={() => void navigate(`/newWindow/chat/dir/${derivedChannelId}`)}
                        aria-label='Back to channel'
                      >
                        <ArrowLeft size={18} />
                      </Button>
                    </Tooltip>
                  )}
                  {/* Thread indicator — shown when summarizing, or in focused mode so the
                      header reads like Slack's "↳ Thread #channel". */}
                  {!simpleView && (isThreadSummaryActive || isFocusedThread) && (
                    <CornerDownRight className='w-4 h-4 text-muted-foreground' />
                  )}

                  {simpleView ? (
                    /* Simple View: Header matching regular view style */
                    <>
                      <h3 className='flex-1 font-semibold text-foreground'>Thread</h3>

                      {/* Action Buttons */}
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
                        {/* Add Context Button */}
                        {!isMobile && !channel?.isArchived && (
                          <Tooltip content='Add context to thread'>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='p-2 border border-border rounded-lg h-8 w-8'
                              onClick={handleAddContextClick}
                              aria-label='Add context to thread'
                              data-track-category='THREAD_PANEL'
                              data-track-name='OPEN_CONTEXT_MENU'
                              data-track-metadata={JSON.stringify({
                                conversationId: derivedConversationId,
                              })}
                            >
                              <Link2 size={18} />
                            </Button>
                          </Tooltip>
                        )}
                        {/* Ask AI Button */}
                        {!isStandaloneWindow() && (
                          <Tooltip content='Ask AI Conversation'>
                            <Button
                              variant='outline'
                              onClick={() => {
                                xyneAIActor.send({
                                  type: 'OPEN',
                                  channelId: derivedChannelId,
                                  threadInfo,
                                });
                              }}
                              className='flex items-center justify-between gap-2 border rounded-lg !p-2 transition-all duration-100 text-primary bg-background border-border'
                            >
                              <XyneAIStar />
                            </Button>
                          </Tooltip>
                        )}
                        {isElectronApp() && !isStandaloneWindow() && (
                          <Tooltip content='Open in new window'>
                            <Button
                              className='p-2 border border-border rounded-lg h-8 w-8'
                              variant='ghost'
                              size='sm'
                              onClick={openInNewWindow}
                              aria-label='Open in new window'
                            >
                              <ExternalLink size={20} />
                            </Button>
                          </Tooltip>
                        )}

                        {/* Initiate Call Button */}
                        {derivedConversationId && !channel?.isArchived && (
                          <ThreadCallButton
                            onStartCall={handleInitiateCall}
                            onScheduleCall={() => setIsScheduleCallModalOpen(true)}
                            hasActiveCall={hasActiveCallForConversation}
                            callTooltip='Start call'
                            trackCategory='THREAD_PANEL'
                            trackName='INITIATE_CALL_FROM_THREAD'
                            trackMetadata={{
                              channelId: channel?.id,
                              conversationId: derivedConversationId,
                            }}
                          />
                        )}

                        {/* Create Ticket Button */}
                        {channel?.projectId &&
                          !hasTicketInMessages &&
                          !channel?.isArchived &&
                          (() => {
                            const buttonContent = (
                              <Button
                                variant='ghost'
                                className={cn(
                                  isMobile
                                    ? 'p-2 border border-border rounded-lg h-8 w-8'
                                    : 'px-3 py-1.5 text-foreground hover:text-foreground hover:bg-accent transition-colors duration-200 flex items-center gap-2 rounded-lg',
                                )}
                                size='sm'
                                onClick={handleCreateTicket}
                                data-testid='thread-create-ticket-button'
                                data-track-category='THREAD_PANEL'
                                data-track-name='CREATE_TICKET_FROM_THREAD'
                                data-track-metadata={JSON.stringify({
                                  channelId: channel?.id,
                                  projectId: channel?.projectId,
                                })}
                              >
                                <Ticket size={isMobile ? 20 : 18} />
                                {!isMobile && (
                                  <span className='text-sm font-medium'>Create Ticket</span>
                                )}
                              </Button>
                            );

                            return isMobile ? (
                              <Tooltip content='Create ticket'>{buttonContent}</Tooltip>
                            ) : (
                              buttonContent
                            );
                          })()}
                        {/* Close Button */}
                        {resolvedOnClose && (
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={resolvedOnClose}
                            aria-label='Close thread panel'
                          >
                            <X size={20} />
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    /* Regular View: Title and action buttons */
                    <>
                      <div ref={headerTitleRef} className='flex items-center gap-2 flex-1 min-w-0'>
                        <h3 className='font-semibold text-foreground whitespace-nowrap shrink-0'>
                          {isTicketThread && ticket ? ticket.title : 'Thread message'}
                        </h3>
                        {focusedChannelBreadcrumb}
                      </div>
                      <div ref={headerActionsRef} className='flex items-center gap-2 shrink-0'>
                        {!isHeaderCompact && (
                          <Tooltip content='Toggle notification subscription'>
                            <div className='p-2 border border-[border] rounded-lg h-8 w-8'>
                              <ConversationSubscription
                                conversationId={derivedConversationId}
                                {...(conversation && { conversation })}
                                variant='icon-only'
                                className='flex items-center justify-center'
                              />
                            </div>
                          </Tooltip>
                        )}

                        {/* Action Buttons */}
                        {!underTicketView && (
                          <div className='flex items-center gap-2 shrink-0'>
                            {/* Add Context Button */}
                            {!isHeaderCompact && !isMobile && !channel?.isArchived && (
                              <Tooltip content='Add context to thread'>
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  className='p-2 border border-[border] rounded-lg h-8 w-8'
                                  onClick={handleAddContextClick}
                                  aria-label='Add context to thread'
                                  data-track-category='THREAD_PANEL'
                                  data-track-name='OPEN_CONTEXT_MENU'
                                  data-track-metadata={JSON.stringify({
                                    conversationId: derivedConversationId,
                                  })}
                                >
                                  <Link2 size={18} />
                                </Button>
                              </Tooltip>
                            )}
                            {/* Ask AI Button */}
                            {!isHeaderCompact && !isStandaloneWindow() && (
                              <Tooltip content='Ask AI Conversation'>
                                <Button
                                  size='sm'
                                  variant='outline'
                                  onClick={(): void => {
                                    xyneAIActor.send({
                                      type: 'OPEN',
                                      channelId: derivedChannelId,
                                      threadInfo,
                                    });
                                  }}
                                  className='flex items-center justify-between gap-2 border rounded-lg !p-2 transition-all duration-100 text-foreground bg-background border-[border]'
                                >
                                  <XyneAIStar />
                                </Button>
                              </Tooltip>
                            )}
                            {!isHeaderCompact && isElectronApp() && !isStandaloneWindow() && (
                              <Tooltip content='Open in new window'>
                                <Button
                                  className='p-2 border border-[border] rounded-lg h-8 w-8'
                                  variant='ghost'
                                  size='sm'
                                  onClick={openInNewWindow}
                                  aria-label='Open in new window'
                                >
                                  <ExternalLink size={20} />
                                </Button>
                              </Tooltip>
                            )}
                            {isHeaderCompact && (
                              <CompactActionsMenu items={regularCompactMenuItems} />
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

                            {/* Create Ticket Button */}
                            {!isHeaderCompact &&
                              channel?.projectId &&
                              !hasTicketInMessages &&
                              !channel?.isArchived && (
                                <Tooltip content='Create ticket'>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='p-2 border border-[border] rounded-lg h-8 w-8'
                                    onClick={handleCreateTicket}
                                    data-testid='thread-create-ticket-button'
                                    data-track-category='THREAD_PANEL'
                                    data-track-name='CREATE_TICKET_FROM_THREAD'
                                    data-track-metadata={JSON.stringify({
                                      channelId: channel?.id,
                                      projectId: channel?.projectId,
                                    })}
                                  >
                                    <Ticket size={20} />
                                  </Button>
                                </Tooltip>
                              )}

                            {/* Close Button */}
                            {resolvedOnClose ? (
                              <Button
                                variant='ghost'
                                size='sm'
                                className='p-2 border border-[border] rounded-lg h-8 w-8'
                                onClick={resolvedOnClose}
                                aria-label='Close thread panel'
                              >
                                <X size={20} />
                              </Button>
                            ) : (
                              <Button
                                variant='ghost'
                                size='sm'
                                className='p-2 border border-[border] rounded-lg h-8 w-8'
                                onClick={handleCloseTicketDetailsThread}
                                aria-label='Close thread panel'
                                data-track-category='THREAD_PANEL'
                                data-track-name='CLOSE_THREAD_PANEL'
                                data-track-metadata={JSON.stringify({ conversationId })}
                              >
                                <X size={20} />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            {isMessagesLoaded && !conversation && !!derivedConversationId ? (
              <div className='flex flex-col items-center justify-center flex-1 text-muted-foreground'>
                <MessageCircle size={48} className='mb-2 opacity-40' />
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
                  workflowNumberMap={workflowNumberMap}
                  enableCollapsing={previewCardMode}
                  enableJumpFab={!previewCardMode}
                  isMessagesLoaded={isMessagesLoaded}
                  {...(disableAskAI !== undefined && { disableAskAI })}
                  conversationParticipant={conversationParticipant}
                  matchedMessageId={matchedMessageId ?? null}
                />

                {/* ChatInput at the bottom - only show if user is a member */}
                {isUserMember || channel?.isArchived ? (
                  <div className='px-4 pb-4 bg-background'>
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
