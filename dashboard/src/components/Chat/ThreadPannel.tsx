import { ReactElement, useMemo, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Button } from '../ui/Button';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useChannel, useGetChannelUserStatus } from '../../hooks/useChannels';
import { useRouteContext } from '../../hooks/useRouteContext';
import { usePlatform } from '../../hooks/usePlatform';
import {
  X,
  FileText,
  Ticket,
  Play,
  CornerDownRight,
  MessageCircle,
  File,
  Maximize2,
  LinkIcon,
  Workflow,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react';
import { ChatInput } from './ChatInput';
import ThreadList from './ThreadList/ThreadList';
import { useDragAndDropAreaRef } from '../../hooks/useDragAndDropAreaRef';
import { DragAndDropOverlay } from './DragAndDropOverlay';
import { useChannelSubscription } from '../../hooks/useChannelSubscription';
import { insertDateSeparatorsForThreadMessages } from '../../utils/chatUtils';
import * as Tabs from '@radix-ui/react-tabs';
import { cn } from '../../utils/classNames';
import JoinChannel from './JoinChannel/JoinChannel';
import WorkflowTriggerModal from '../Workflow/WorkflowTriggerModal';
import { BotBubble } from './BotBubble';
import { toast } from 'sonner';
import { TicketDetails } from '../Tickets/TicketDetails/TicketDetails';
import { FileBubble } from '../ui/FileBubble/FileBubble';
import { WorkflowBubble } from './WorkflowBubble/WorkflowBubble';
import { MessageMetadata } from '../ui/MessageBubble/MessageBubble.utils';
import { FailedStatusIcon, SuccessStatusIcon } from '../../assets/icons/WorkflowIcons';
import { MessageType, ChannelScopeType } from '@xyne/shared';
import Tooltip from '../ui/Tooltip';
import { mixpanelService } from '../../services/Analytics/mixpanelService';
import { EVENTS, EVENT_PROPERTIES } from '../../services/Analytics/mixpanel.types';
import { useScope } from '../../shortcuts';
import { SHAREABLE_ORIGIN } from '../../config';

import { isElectronApp, isStandaloneWindow, standaloneNavigate } from '../../utils/electronApp';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useZero } from '../../hooks/useZero';
import { logger, Event } from '../../utils/logger';
import { XyneAIStar } from '../icons/xyne-ai';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { useDraft } from '../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';
import { xyneAIActor, type ThreadInfo } from '../../machines/xyneAIMachine';
import { useUser } from '../../hooks/useUsers';

type TabType = 'thread' | 'details' | 'files' | 'workflows';
type UnderTicketTabType = 'replies' | 'workflows';

interface ThreadMessagesProps {
  channelId?: string;
  conversationId?: string;
  ticketId?: string;
  onClose?: () => void;
  showHeader?: boolean;
  underTicketView?: boolean;
  simpleView?: boolean;
  onSummaryClick?: () => void;
}

export const ThreadMessages = ({
  channelId: propChannelId,
  conversationId: propConversationId,
  ticketId: propTicketId,
  onClose,
  showHeader = false,
  underTicketView = false,
  simpleView = false,
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
  const { baseRoute, buildChannelRoute } = useRouteContext();

  const channelId = propChannelId || paramChannelId;
  const conversationId = propConversationId || paramConversationId;
  const ticketId = propTicketId || paramTicketId;
  const messageLoadStartTimeRef = useRef<number | null>(null);

  // Track derived values from ticket
  const [derivedConversationId, setDerivedConversationId] = useState(conversationId || '');
  const [derivedChannelId, setDerivedChannelId] = useState(channelId || '');

  const [searchParams] = useSearchParams();
  const selectedTabParam = searchParams.get('selectedTab');
  const validTabs: TabType[] = ['thread', 'details', 'files', 'workflows'];
  const selectedTab: TabType = validTabs.includes(selectedTabParam as TabType)
    ? (selectedTabParam as TabType)
    : 'thread';

  const [conversation] = useCachedQuery(
    queries.getConversationById({
      conversationId: derivedConversationId || ' ',
    }),
    {
      enabled: !!derivedConversationId && !!derivedChannelId,
    },
  );

  // Extract ticketId from conversation metadata if not in URL params
  const ticketIdFromMetadata = useMemo(() => {
    if (!conversation?.initialMessage?.metadata) return undefined;
    const metadata = conversation.initialMessage?.metadata as { ticketId?: string };
    return metadata.ticketId;
  }, [conversation]);

  // Use ticketId from URL params OR from conversation metadata
  const derivedTicketId = ticketId || ticketIdFromMetadata || '';

  // Fetch ticket using derived ticketId
  const [ticket] = useCachedQuery(queries.ticketById({ ticketId: derivedTicketId }), {
    enabled: !!derivedTicketId,
  });

  // Update derived values when props/params change OR when ticket loads
  useEffect(() => {
    if (conversationId) {
      setDerivedConversationId(conversationId);
    } else if (ticket?.conversationId) {
      setDerivedConversationId(ticket.conversationId);
    }

    if (channelId) {
      setDerivedChannelId(channelId);
    } else if (ticket?.conversation?.channelId) {
      setDerivedChannelId(ticket.conversation.channelId);
    }
  }, [conversationId, channelId, ticket]);

  const [messages, messagesDetails] = useCachedQuery(
    queries.conversationMessages({
      conversationId: derivedConversationId,
    }),
    {
      enabled: !!derivedConversationId && !!derivedChannelId,
    },
  );

  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
  const channel = useChannel(derivedChannelId);

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

  // Navigation for thread summary
  const navigate = useNavigate();
  const location = useLocation();

  // Check if the route is /threads
  const isThreadsRoute = location.pathname.startsWith('/chat/dir/threads');

  // Check if thread summary is currently active
  const isThreadSummaryActive = location.hash.startsWith('#thread-summary');

  // Drag and drop functionality
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(derivedConversationId);

  useChannelSubscription(derivedChannelId, derivedConversationId ? [derivedConversationId] : []);
  useScope('thread', Boolean(derivedConversationId && derivedChannelId));

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

  const channelParticipation = useGetChannelUserStatus(derivedChannelId);
  const isUserMember = !!channelParticipation;

  const zero = useZero();
  const draft = useDraft(derivedChannelId, derivedConversationId);
  const draftRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    return () => {
      if (derivedConversationId) {
        void zero.mutate(
          mutators.activities.markThreadActivitiesAsRead({
            conversationId: derivedConversationId,
            draftMessage: draftRef.current || '',
            draftMessageId: uuidv4(),
            timestamp: Date.now(),
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

  // Create thread info for XyneAI context
  const initialMessage = conversation?.initialMessage;
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
  const [ticketAttachments] = useCachedQuery(
    queries.attachmentsByTicket({ ticketId: derivedTicketId }),
    {
      enabled: !!derivedTicketId,
    },
  );

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

  const latestWorkflowStatus = useMemo(() => {
    if (workflowMessages.length === 0) return null;
    const metadata = workflowMessages[0]?.metadata as MessageMetadata | null;
    return metadata?.workflowStatus || 'UNKNOWN';
  }, [workflowMessages]);

  // Build tabs array - exclude Details tab when ticketId is present
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
    ];

    // Filter out Details tab when ticketId doesn't exist
    return !derivedTicketId ? allTabs.filter(tab => tab.value !== 'details') : allTabs;
  }, [files.length, latestWorkflowStatus, ticketId, derivedTicketId]);

  const handleCreateTicket = (): void => {
    setIsCreateTicketModalOpen(true);
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
    const minimizedTicketViewRoute = `${SHAREABLE_ORIGIN}/chat/dir/${ticket.channelId}/${ticket.conversationId}/${ticket.id}?selectedTab=details`;
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
        className='flex-1 h-full flex flex-col bg-white rounded-lg overflow-hidden relative'
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
          <div className='w-full p-4 pb-0 bg-white'>
            <div className='border-b border-gray-200'>
              <Tabs.List className='flex items-center'>
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
              </Tabs.List>
            </div>
          </div>

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
            />

            {/* ChatInput at the bottom - only show if user is a member */}
            {isUserMember ? (
              <div className='px-4 pb-4 bg-white'>
                <ChatInput
                  ref={inputRef}
                  channelId={derivedChannelId}
                  conversation={conversation ?? undefined}
                  placeholder='Reply to this thread...'
                  hasTicket={hasTicketInMessages}
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
            className='flex-1 overflow-auto bg-white p-4 data-[state=inactive]:hidden'
          >
            {workflowMessages.length === 0 ? (
              <div className='flex flex-col items-center justify-center h-full text-gray-500'>
                <FileText size={48} className='mb-2 text-gray-400' />
                <p>No workflows in this thread</p>
              </div>
            ) : (
              <div className='space-y-3'>
                {workflowMessages.map(msg => {
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
                    />
                  );
                })}
              </div>
            )}
          </Tabs.Content>
        </Tabs.Root>
      </div>
    );
  }

  return (
    <div
      className='flex-1 h-full flex flex-col bg-white rounded-lg overflow-hidden relative'
      ref={dragAndDropAreaRef}
    >
      {/* Drag and Drop Overlay */}
      <DragAndDropOverlay isVisible={isDragging} />
      {showHeader && (
        <div className='flex gap-2 items-center w-full pt-4 px-4'>
          <CornerDownRight className='size-4 flex-shrink-0' />
          <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0'>
            {isTicketThread && ticket ? ticket.title : 'Thread message'}
          </h3>
        </div>
      )}
      {derivedTicketId && ticket && !simpleView && (
        <div className='flex justify-between items-center w-full px-4 py-2'>
          <div className='flex gap-2 items-center min-w-0'>
            <CornerDownRight className='size-4 flex-shrink-0' />
            <span className='text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded flex-shrink-0'>
              {ticket.xyneId}
            </span>
            <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0'>
              {ticket.title}
            </h3>
          </div>
          <div className='flex gap-x-2'>
            {!isMobile && (
              <Tooltip content='Expand View'>
                <Button
                  className='p-2 border border-[#E4E6E7] rounded-lg h-8 w-8'
                  variant='ghost'
                  size='sm'
                  onClick={openTicketDetailsExpandedView}
                  aria-label='Open Maximize View'
                >
                  <Maximize2 size={20} />
                </Button>
              </Tooltip>
            )}
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
                  className='flex items-center justify-between gap-2 border border-border rounded-lg !p-2 transition-all duration-100 text-primary bg-white border-gray-200'
                >
                  <XyneAIStar />
                </Button>
              </Tooltip>
            )}
            {isElectronApp() && !isStandaloneWindow() && (
              <Tooltip content='Open in new window'>
                <Button
                  className='p-2 border border-[#E4E6E7] rounded-lg h-8 w-8'
                  variant='ghost'
                  size='sm'
                  onClick={openInNewWindow}
                  aria-label='Open in new window'
                >
                  <ExternalLink size={20} />
                </Button>
              </Tooltip>
            )}
            <Tooltip content='Trigger Workflow'>
              <Button
                className='p-2 border border-[#E4E6E7] rounded-lg h-8 w-8'
                variant='ghost'
                size='sm'
                onClick={() => setIsWorkflowModalOpen(true)}
                aria-label='Trigger Workflow'
              >
                <Play size={20} />
              </Button>
            </Tooltip>
            <Tooltip content='Copy Ticket Link'>
              <Button
                className='p-2 border border-[#E4E6E7] rounded-lg h-8 w-8'
                variant='ghost'
                size='sm'
                onClick={handleCopyTicketViewLink}
                aria-label='Copy Ticket'
              >
                <LinkIcon size={20} />
              </Button>
            </Tooltip>
            <Tooltip content='Close'>
              <Button
                onClick={handleCloseTicketDetailsThread}
                className='p-2 border border-[#E4E6E7] rounded-lg h-8 w-8'
                variant='ghost'
                size='sm'
                aria-label='Close Thread Panel'
              >
                <X size={20} />
              </Button>
            </Tooltip>
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
            <div className='relative flex justify-between w-full border-b border-gray-200'>
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
                          <span className='text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full'>
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
                {isTicketThread &&
                  (onClose ? (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={onClose}
                      aria-label='Close thread panel'
                    >
                      <X size={20} />
                    </Button>
                  ) : (
                    <button
                      onClick={handleCloseTicketDetailsThread}
                      className='p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200'
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
            <ThreadList
              channelId={derivedChannelId || ''}
              conversationId={derivedConversationId || ''}
              threadMessages={messages}
              messagesWithSeparators={messagesWithSeparators}
              initialScrollOffset={0}
              isTicketThread={true}
              channelScopeType={channel?.scopeType}
              conversation={conversation}
            />

            {/* ChatInput at the bottom - only show if user is a member */}
            {isUserMember ? (
              <div className='px-4 pb-4 bg-white'>
                <ChatInput
                  ref={inputRef}
                  channelId={derivedChannelId}
                  conversation={conversation ?? undefined}
                  placeholder='Reply to this thread...'
                  hasTicket={hasTicketInMessages}
                />
              </div>
            ) : (
              <JoinChannel
                channelId={derivedChannelId}
                {...(channel?.name && { channelTitle: channel.name })}
              />
            )}
          </Tabs.Content>

          {/* Details Tab Content */}
          <Tabs.Content
            value='details'
            className='flex-1 bg-white overflow-auto data-[state=inactive]:hidden'
          >
            <TicketDetails ticketId={derivedTicketId} />
          </Tabs.Content>

          {/* Files Tab Content */}
          <Tabs.Content
            value='files'
            className='flex-1 overflow-auto bg-white p-4 data-[state=inactive]:hidden'
          >
            {files.length === 0 ? (
              <div className='flex flex-col items-center justify-center h-full text-gray-500'>
                <FileText size={48} className='mb-2 text-gray-400' />
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
            className='flex-1 overflow-auto bg-white p-4 data-[state=inactive]:hidden'
          >
            {workflowMessages.length === 0 ? (
              <div className='flex flex-col items-center justify-center h-full text-gray-500'>
                <FileText size={48} className='mb-2 text-gray-400' />
                <p>No workflows in this thread</p>
              </div>
            ) : (
              <div className='space-y-3'>
                {workflowMessages.map(msg => {
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
          {!isThreadsRoute && (
            <div
              className={cn(
                'p-4 flex items-center gap-2 self-stretch bg-white border-b border-gray-200 h-14',
              )}
            >
              {isStandaloneWindow() && (
                <Tooltip content='Back to channel'>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all duration-100'
                    onClick={() => void navigate(`/newWindow/chat/dir/${derivedChannelId}`)}
                    aria-label='Back to channel'
                  >
                    <ArrowLeft size={18} />
                  </Button>
                </Tooltip>
              )}
              {/* Show icon only when thread summary is active (non-simpleView) */}
              {!simpleView && isThreadSummaryActive && (
                <CornerDownRight className='w-4 h-4 text-gray-700' />
              )}

              {simpleView ? (
                /* Simple View: Header matching regular view style */
                <>
                  <h3 className='flex-1 font-semibold text-gray-900'>Thread</h3>

                  {/* Action Buttons */}
                  <div className='flex items-center gap-2'>
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
                          className='flex items-center justify-between gap-2 border border-border rounded-lg !p-2 transition-all duration-100 text-primary bg-white border-gray-200'
                        >
                          <XyneAIStar />
                        </Button>
                      </Tooltip>
                    )}
                    {isElectronApp() && !isStandaloneWindow() && (
                      <Tooltip content='Open in new window'>
                        <Button
                          className='p-2 border border-[#E4E6E7] rounded-lg h-8 w-8'
                          variant='ghost'
                          size='sm'
                          onClick={openInNewWindow}
                          aria-label='Open in new window'
                        >
                          <ExternalLink size={20} />
                        </Button>
                      </Tooltip>
                    )}

                    {/* Close Button */}
                    {onClose && (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={onClose}
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
                  <h3 className='flex-1 font-semibold text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis min-w-0'>
                    {isTicketThread && ticket ? ticket.title : 'Thread message'}
                  </h3>

                  {/* Action Buttons */}
                  {!underTicketView && (
                    <div className='flex items-center gap-2'>
                      {/* Ask AI Button */}
                      {!isStandaloneWindow() && (
                        <Tooltip content='Ask AI Conversation'>
                          <Button
                            variant='outline'
                            onClick={(): void => {
                              xyneAIActor.send({
                                type: 'OPEN',
                                channelId: derivedChannelId,
                                threadInfo,
                              });
                            }}
                            className='flex items-center justify-between gap-2 border border-border rounded-lg !p-2 transition-all duration-100 text-primary bg-white border-gray-200'
                          >
                            <XyneAIStar />
                          </Button>
                        </Tooltip>
                      )}
                      {isElectronApp() && !isStandaloneWindow() && (
                        <Tooltip content='Open in new window'>
                          <Button
                            className='p-2 border border-[#E4E6E7] rounded-lg h-8 w-8'
                            variant='ghost'
                            size='sm'
                            onClick={openInNewWindow}
                            aria-label='Open in new window'
                          >
                            <ExternalLink size={20} />
                          </Button>
                        </Tooltip>
                      )}

                      {/* Create Ticket Button */}
                      {channel?.projectId && !hasTicketInMessages && (
                        <Button
                          variant='ghost'
                          className='px-3 py-1.5 text-gray-700 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-200 flex items-center gap-2'
                          onClick={handleCreateTicket}
                          title='Create ticket'
                          data-testid='thread-create-ticket-button'
                          data-track-category='THREAD_PANEL'
                          data-track-name='CREATE_TICKET_FROM_THREAD'
                          data-track-metadata={JSON.stringify({
                            channelId: channel?.id,
                            projectId: channel?.projectId,
                          })}
                        >
                          <Ticket size={18} />
                          <span className='text-sm font-medium'>Create Ticket</span>
                        </Button>
                      )}

                      {/* Close Button */}
                      {onClose ? (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={onClose}
                          aria-label='Close thread panel'
                        >
                          <X size={20} />
                        </Button>
                      ) : (
                        <button
                          onClick={handleCloseTicketDetailsThread}
                          className='p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200'
                          aria-label='Close thread panel'
                          data-track-category='THREAD_PANEL'
                          data-track-name='CLOSE_THREAD_PANEL'
                          data-track-metadata={JSON.stringify({ conversationId })}
                        >
                          <X size={20} />
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <ThreadList
            channelId={derivedChannelId || ''}
            conversationId={derivedConversationId || ''}
            threadMessages={messages}
            initialScrollOffset={0}
            isTicketThread={false}
            channelScopeType={channel?.scopeType}
            conversation={conversation}
          />

          {/* ChatInput at the bottom - only show if user is a member */}
          {isUserMember ? (
            <div className='px-4 pb-4 bg-white'>
              <ChatInput
                ref={inputRef}
                channelId={derivedChannelId}
                conversation={conversation ?? undefined}
                placeholder='Reply to this thread...'
                hasTicket={hasTicketInMessages}
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
      {/* Workflow Trigger Modal */}
      {(isTicketThread || ticketId) && (
        <WorkflowTriggerModal
          isOpen={isWorkflowModalOpen}
          onClose={() => setIsWorkflowModalOpen(false)}
          ticketId={derivedTicketId}
        />
      )}
      {/* BotBubble for ticket creation - only show if channel has projectId */}
      {channel?.projectId && messages && messages.length > 0 && messages[0] && conversation && (
        <BotBubble
          messageId={messages[0].messageId}
          messageContent={messages[0].content}
          channelId={derivedChannelId}
          context='thread'
          conversation={conversation}
          isModalOpen={isCreateTicketModalOpen}
          onModalOpenChange={setIsCreateTicketModalOpen}
          onTicketCreated={handleTicketCreated}
        />
      )}
    </div>
  );
};

export default ThreadMessages;
