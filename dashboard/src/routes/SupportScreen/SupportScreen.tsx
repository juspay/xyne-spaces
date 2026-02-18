import {
  Mail,
  MessageCircle,
  FileText,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  X,
  PanelRight,
  ReplyAll,
  ArrowUp,
  LayoutGrid,
  List,
  Store,
} from 'lucide-react';
import { ReactElement, useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '../../utils/classNames';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { QueryResultType } from '@rocicorp/zero';
import { RenderMessageWithHTML } from '../../components/Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import ThreadList from '../../components/Chat/ThreadList/ThreadList';
import { ChatInput } from '../../components/Chat/ChatInput/ChatInput';
import { useChannel, useGetChannelUserStatus, useEmailChannels } from '../../hooks/useChannels';
import { useChannelSubscription } from '../../hooks/useChannelSubscription';
import { useDragAndDropAreaRef } from '../../hooks/useDragAndDropAreaRef';
import { DragAndDropOverlay } from '../../components/Chat/DragAndDropOverlay';
import JoinChannel from '../../components/Chat/JoinChannel/JoinChannel';
import { mutators } from '../../zero/mutators';
import * as Tabs from '@radix-ui/react-tabs';
import { TicketDetails } from '../../components/Tickets/TicketDetails/TicketDetails';
import { apiInstance } from '../../services/clients/apiClient';
import MarkdownPreview from '@uiw/react-markdown-preview';
import { motion, AnimatePresence } from 'framer-motion';
import TextareaAutosize from 'react-textarea-autosize';
import { Button } from '../../components/ui/Button/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAuthContextValues } from '../../hooks/useAuth';
import { TicketListItem } from '../../components/Tickets/TicketListItem/TicketListItem';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
} from '@dnd-kit/core';
import { KanbanColumns } from '../../components/Tickets/KanbanColumns/KanbanColumns';
import { TicketCard } from '../../components/Tickets/TicketCard/TicketCard';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import {
  getStageColor,
  groupTicketsByStage,
  createTagsByTicketIdMap,
} from '../KanbanBoardScreen/KanbanBoardScreen.utils';
import type { Ticket } from '@xyne/shared';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import { Hash } from 'lucide-react';
import { useDraft } from '../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';

// Unified type for tickets from the supportTicketsFiltered query
type SupportTicket = QueryResultType<typeof queries.supportTicketsFiltered>[number];

// Type for Merchant from Merchant table
type Merchant = QueryResultType<typeof queries.getAllMerchants>[number];

const ALL_CHANNELS_ID = 'all';

const getMerchantInitial = (name: string): string => {
  return name.charAt(0).toUpperCase() || '?';
};

const getChannelInitial = (name: string): string => {
  return name.charAt(0).toUpperCase() || '#';
};

// Reusable icon component for dropdown options
const DropdownIcon = ({
  children,
  variant = 'channel',
}: {
  children: React.ReactNode;
  variant?: 'channel' | 'merchant';
}): ReactElement => (
  <div
    className={cn(
      'w-4 h-4 rounded-md flex items-center justify-center font-bold text-[10px]',
      variant === 'channel'
        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
    )}
  >
    {children}
  </div>
);

// Type definition for emails from the query
type Email = QueryResultType<typeof queries.getEmailsForTicket>[number];
// Cache interface for AI summary
interface SummaryCache {
  summary: string;
  emailHash: string;
}

// Generate hash from email IDs
const generateEmailHash = (emails: Email[]): string => {
  const emailIds = emails
    .map(email => email.id)
    .sort()
    .join(',');
  let hash = 0;
  for (let i = 0; i < emailIds.length; i++) {
    hash = emailIds.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash).toString(36);
};

// Get cached summary from localStorage
const getCachedSummary = (ticketId: string): SummaryCache | null => {
  try {
    const cached = localStorage.getItem(`ai-summary-${ticketId}`);
    if (cached) {
      return JSON.parse(cached) as SummaryCache;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error reading cached summary:', error);
  }
  return null;
};

// Save summary to localStorage
const saveCachedSummary = (ticketId: string, summary: string, emailHash: string): void => {
  try {
    const cache: SummaryCache = { summary, emailHash };
    localStorage.setItem(`ai-summary-${ticketId}`, JSON.stringify(cache));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error saving cached summary:', error);
  }
};

type TabType = 'messages' | 'details';

type ViewMode = 'kanban' | 'list';

const SupportScreen = (): ReactElement => {
  const { ticketId } = useParams<{ ticketId?: string }>();
  const navigate = useNavigate();
  const zero = useZero();
  const { userID } = useAuthContextValues();
  const [showMyTicketsOnly, setShowMyTicketsOnly] = useState(false);
  const [selectedMerchantMid, setSelectedMerchantMid] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(() => {
    const saved = localStorage.getItem('support-selected-channel');
    return saved || null;
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('support-view-mode');
    return (saved as ViewMode) || 'kanban';
  });

  useEffect(() => {
    localStorage.setItem('support-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (selectedChannelId) {
      localStorage.setItem('support-selected-channel', selectedChannelId);
    } else {
      localStorage.removeItem('support-selected-channel');
    }
  }, [selectedChannelId]);

  // Fetch EMAIL channels using hook (from state machine, already loaded)
  const emailChannels = useEmailChannels();

  // Unified query: filters by EMAIL channels, optional channelId, and optional merchant
  const [supportTickets] = useCachedQuery(
    queries.supportTicketsFiltered({
      channelId:
        selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID ? selectedChannelId : undefined,
      merchantMid: selectedMerchantMid ?? undefined,
    }),
  );

  // Fetch all merchants from Merchant table for dropdown
  const [merchants] = useCachedQuery(queries.getAllMerchants());

  // Build merchant options from Merchant table
  const merchantOptions = useMemo<SelectorOption[]>(() => {
    const options: SelectorOption[] = [];

    const merchantsList = Array.isArray(merchants) ? merchants : [];

    merchantsList.forEach((merchant: Merchant) => {
      options.push({
        value: merchant.mid,
        label: merchant.mid,
        icon: <DropdownIcon variant='merchant'>{getMerchantInitial(merchant.mid)}</DropdownIcon>,
      });
    });

    return options;
  }, [merchants]);

  // Email channels are already sorted by the useEmailChannels hook
  const sortedEmailChannels = emailChannels;

  // Build channel options from pre-sorted EMAIL channels
  const channelOptions = useMemo<SelectorOption[]>(() => {
    const options: SelectorOption[] = [];

    options.push({
      value: ALL_CHANNELS_ID,
      label: 'All Channels',
      icon: (
        <DropdownIcon variant='channel'>
          <Hash size={10} />
        </DropdownIcon>
      ),
    });

    sortedEmailChannels.forEach(channel => {
      const channelName = channel.name?.trim() || 'Unnamed Channel';
      options.push({
        value: channel.id,
        label: channelName,
        icon: <DropdownIcon variant='channel'>{getChannelInitial(channelName)}</DropdownIcon>,
      });
    });

    return options;
  }, [sortedEmailChannels]);

  // The unified query already handles filtering, just apply user filter
  const displayedTickets = useMemo(() => {
    const tickets = supportTickets ?? [];
    if (showMyTicketsOnly) {
      return tickets.filter(ticket => ticket.assignedTo === userID);
    }
    return tickets;
  }, [supportTickets, showMyTicketsOnly, userID]);

  const [localTickets, setLocalTickets] = useState<Ticket[]>([]);
  const stageColumns = useMemo(
    () => [
      { id: 'backlog', name: 'Backlog', color: getStageColor('backlog') },
      { id: 'to_do', name: 'To Do', color: getStageColor('todo') },
      { id: 'in_progress', name: 'In Progress', color: getStageColor('in_progress') },
      { id: 'review', name: 'Review', color: getStageColor('review') },
      { id: 'done', name: 'Done', color: getStageColor('done') },
    ],
    [],
  );

  useEffect(() => {
    if (displayedTickets) {
      setLocalTickets(displayedTickets as Ticket[]);
    }
  }, [displayedTickets]);

  const ticketsByStage = useMemo(
    () => groupTicketsByStage(localTickets, stageColumns),
    [localTickets, stageColumns],
  );

  const tagsByTicketId = useMemo(() => createTagsByTicketIdMap([]), []);

  const { activeTicket, handleDragStart, handleDragEnd } = useDragAndDrop({
    localTickets,
    setLocalTickets,
    zero,
    stages: stageColumns,
    mode: 'stage',
  });

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const handleTicketClick = useCallback(
    (ticket: Ticket) => {
      const ticketData = ticket as SupportTicket;
      void navigate(`/support/${ticketData.xyneId}`, {
        state: {
          conversationId: ticketData.conversationId,
          title: ticketData.title,
          ticketId: ticketData.id,
        },
      });
    },
    [navigate],
  );

  return (
    <div className='h-full flex flex-col relative md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)] bg-white'>
      <PanelGroup
        key={`support-panel-${viewMode}-${ticketId ? 'detail' : 'list'}`}
        direction='horizontal'
        className='flex-1 overflow-hidden'
      >
        {!(viewMode === 'kanban' && ticketId) && (
          <Panel defaultSize={ticketId ? 40 : 100} minSize={25} maxSize={ticketId ? 60 : 100}>
            <div className='h-full flex flex-col'>
              <div className='flex-shrink-0 h-14 px-4 border-b border-gray-200 flex items-center justify-between'>
                <div className='flex items-center gap-2 font-semibold min-w-0 flex-1'>
                  <span className='shrink-0'>
                    <Mail size={16} />
                  </span>
                  <span className='truncate'>Xyne Desk</span>
                </div>
                <div className='flex items-center gap-2'>
                  {/* Channel Dropdown (ExternalSources via EMAIL channels) */}
                  <EntitySelector
                    options={channelOptions}
                    selectedValue={selectedChannelId}
                    onSelect={setSelectedChannelId}
                    placeholder='Channels'
                    searchPlaceholder='Search channel...'
                    showClearButton={selectedChannelId !== null}
                    inputClassName='rounded-[10px] border border-gray-200 hover:bg-gray-50 px-3 py-1.5 h-8 text-sm font-medium whitespace-nowrap [&>svg:last-child]:rotate-90'
                    inputIcon={<Hash className='w-3 h-3 text-gray-500' />}
                    showIndicator={true}
                    width='auto'
                  />
                  {/* Merchant Dropdown */}
                  <EntitySelector
                    options={merchantOptions}
                    selectedValue={selectedMerchantMid}
                    onSelect={setSelectedMerchantMid}
                    placeholder='Merchants'
                    searchPlaceholder='Search merchant...'
                    showClearButton={selectedMerchantMid !== null}
                    inputClassName='rounded-[10px] border border-gray-200 hover:bg-gray-50 px-3 py-1.5 h-8 text-sm font-medium whitespace-nowrap [&>svg:last-child]:rotate-90'
                    inputIcon={<Store className='w-3 h-3 text-gray-500' />}
                    showIndicator={true}
                    width='auto'
                  />
                  <button
                    onClick={() => setShowMyTicketsOnly(!showMyTicketsOnly)}
                    className={cn(
                      'text-sm font-medium transition-colors px-2 py-1 rounded whitespace-nowrap',
                      showMyTicketsOnly
                        ? 'text-primary  bg-gray-200'
                        : 'text-gray-600 hover:text-gray-900',
                    )}
                  >
                    My Tickets
                  </button>
                  {/* View Toggle */}
                  <div className='flex items-center border border-gray-200 rounded-lg overflow-hidden'>
                    <button
                      onClick={() => setViewMode('kanban')}
                      className={cn(
                        'p-1.5 transition-colors',
                        viewMode === 'kanban'
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                      )}
                      title='Kanban View'
                    >
                      <LayoutGrid size={16} />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={cn(
                        'p-1.5 transition-colors',
                        viewMode === 'list'
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                      )}
                      title='List View'
                    >
                      <List size={16} />
                    </button>
                  </div>
                  {ticketId && (
                    <Button size='sm' variant='ghost' onClick={() => void navigate(`/support`)}>
                      <PanelRight size={16} />
                    </Button>
                  )}
                </div>
              </div>
              <div className='h-full flex-1 min-h-0 overflow-y-auto no-scrollbar'>
                {viewMode === 'kanban' ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  >
                    <KanbanColumns
                      stages={stageColumns}
                      ticketsByStage={ticketsByStage}
                      tagsByTicketId={tagsByTicketId}
                      onTicketClick={handleTicketClick}
                      containerClassName='h-full'
                    />
                    <DragOverlay>
                      {activeTicket ? (
                        <TicketCard ticket={activeTicket} isCompact={true} onClick={() => {}} />
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                ) : (
                  (displayedTickets || []).map(ticket => {
                    return (
                      <TicketListItem
                        key={ticket.id}
                        ticket={ticket}
                        showExtraFields={true}
                        onClick={() => {
                          void navigate(`/support/${ticket.xyneId}`, {
                            state: {
                              conversationId: ticket.conversationId,
                              title: ticket.title,
                              ticketId: ticket.id,
                            },
                          });
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>
          </Panel>
        )}
        {ticketId && (
          <>
            {viewMode !== 'kanban' && (
              <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                <div id='panel-resize-divider' className='w-[1px] h-full bg-gray-200'></div>
              </PanelResizeHandle>
            )}
            <Panel defaultSize={viewMode === 'kanban' ? 100 : 60} minSize={40}>
              <div className='h-full overflow-hidden'>
                <SupportTicketDetail />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
};

const SupportTicketDetail = (): ReactElement => {
  const { ticketId: ticketIdParam } = useParams<{ ticketId?: string }>();
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const location = useLocation();
  const routerState = location.state as {
    conversationId?: string | null;
    title?: string | null;
    ticketId?: string | null;
  };
  const conversationId = routerState?.conversationId;
  const title = routerState?.title;
  const ticketId = routerState?.ticketId;
  const [emails] = useCachedQuery(
    queries.getEmailsForTicket({ conversationId: conversationId || '' }),
  );

  // Fetch conversation to get channelId
  const [conversation] = useCachedQuery(
    queries.getConversationById({
      conversationId: conversationId || ' ',
    }),
    {
      enabled: !!conversationId,
    },
  );

  const channelId = conversation?.channelId || '';

  // Fetch messages for the conversation
  const [messages] = useCachedQuery(
    queries.conversationMessages({
      conversationId: conversationId || '',
    }),
    {
      enabled: !!conversationId && !!channelId,
    },
  );

  // Get channel info and user status
  const channel = useChannel(channelId);
  const channelParticipation = useGetChannelUserStatus(channelId);
  const isUserMember = !!channelParticipation;

  // Subscribe to channel for real-time updates
  useChannelSubscription(channelId, conversationId ? [conversationId] : []);

  const draft = useDraft(conversationId || '');

  // Drag and drop functionality
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(conversationId || '');

  // Mark thread activities as read when component unmounts
  const zero = useZero();
  useEffect(() => {
    return (): void => {
      if (conversationId) {
        void zero.mutate(
          mutators.activities.markThreadActivitiesAsRead({
            conversationId,
            timestamp: Date.now(),
            draftMessage: draft?.html || '',
            draftMessageId: uuidv4(),
          }),
        );
      }
    };
  }, [conversationId, zero]);

  // Check if any message has a ticketId in metadata
  const hasTicketInMessages = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    return messages.some(msg => {
      const metadata = msg.metadata as { ticketId?: string } | null;
      return metadata?.ticketId !== undefined;
    });
  }, [messages]);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('messages');

  // AI Summary state
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);
  const [summaryError, setSummaryError] = useState<boolean>(false);

  // Load cached summary and reset state when conversation or ticket changes
  useEffect(() => {
    setAiSummary(null);
    setIsGeneratingSummary(false);
    setIsSummaryCollapsed(false);
    setSummaryError(false);

    // Try to load cached summary for this ticket
    if (ticketId && emails && emails.length > 0) {
      const currentEmailHash = generateEmailHash(emails);
      const cached = getCachedSummary(ticketId);
      if (cached && cached.emailHash === currentEmailHash) {
        setAiSummary(cached.summary);
      }
    }
  }, [conversationId, ticketId, emails]);

  // Generate summary function (can be called manually or automatically)
  const generateSummary = useCallback(
    async (forceRegenerate = false): Promise<void> => {
      if (!emails || emails.length === 0 || isGeneratingSummary) {
        return;
      }

      if (!ticketId) {
        return;
      }

      // Check cache first (unless forcing regenerate)
      if (!forceRegenerate) {
        const currentEmailHash = generateEmailHash(emails);
        const cached = getCachedSummary(ticketId);

        if (cached && cached.emailHash === currentEmailHash) {
          // Use cached summary if hash matches
          setAiSummary(cached.summary);
          setSummaryError(false);
          return;
        }
      }

      if (forceRegenerate) {
        setSummaryError(false);
      }

      setIsGeneratingSummary(true);
      try {
        // Sort emails by createdAt (oldest first)
        const sortedEmails = [...emails].sort((a, b) => {
          const aTime = a.createdAt || 0;
          const bTime = b.createdAt || 0;
          return aTime - bTime;
        });

        // Format emails into a prompt
        const emailThread = sortedEmails
          .map((email, index) => {
            const date = email.createdAt
              ? new Date(email.createdAt).toLocaleString()
              : 'Unknown date';
            return `Email ${index + 1} (${date}):
From: ${email.from || 'Unknown'}
To: ${(email.to || []).join(', ')}
${email.cc && email.cc.length > 0 ? `CC: ${email.cc.join(', ')}\n` : ''}Subject: ${email.subject || 'No subject'}
Body:
${email.body || 'No content'}

---`;
          })
          .join('\n\n');

        const systemPrompt = `You are an AI assistant specialized in summarizing email conversations. 
            Analyze the email thread and create a very concise summary in markdown format.

            Requirements:
            - Use exactly 3 bullet points
            - Do NOT use links in headers or anywhere else
            - Be extremely concise and brief
            - Focus on essential information only
            - Keep it formal and professional
            - If mentioning a user name, underline it using <u>user name</u> format

            Keep the entire summary under 100 words with exactly 3 bullet points.`;

        const prompt = `Please summarize the following email conversation:\n\n${emailThread}`;

        const response = await apiInstance.post<{ data: string }>('/agents/ai', {
          prompt,
          systemPrompt,
        });

        if (response.data?.data && typeof response.data.data === 'string') {
          const summary = response.data.data;
          const currentEmailHash = generateEmailHash(emails);
          setAiSummary(summary);
          setSummaryError(false);
          // Cache the summary with current email hash
          saveCachedSummary(ticketId, summary, currentEmailHash);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error generating AI summary:', error);
        setSummaryError(true);
      } finally {
        setIsGeneratingSummary(false);
      }
    },
    [emails, ticketId, isGeneratingSummary],
  );

  // Generate email summary when emails are available
  useEffect(() => {
    // Don't regenerate if summary already exists
    if (aiSummary) {
      return;
    }
    // Don't retry if there are no emails
    if (!emails || emails.length === 0) {
      return;
    }
    // Don't retry if there was an error (only retry on manual regenerate)
    if (summaryError) {
      return;
    }
    // Don't retry if already generating
    if (isGeneratingSummary) {
      return;
    }
    void generateSummary(false);
  }, [emails, ticketId, aiSummary, generateSummary, summaryError, isGeneratingSummary]);

  if (!ticketIdParam) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-lg font-semibold text-gray-500'>Ticket not found</div>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col overflow-hidden'>
      <PanelGroup
        direction='horizontal'
        className='flex-1 overflow-hidden'
        autoSaveId='support-ticket-detail'
      >
        <Panel defaultSize={50} minSize={30} maxSize={70}>
          <div className='h-full flex flex-col overflow-hidden relative'>
            <div className='w-full px-6 py-5 flex items-center justify-between flex-shrink-0'>
              <div className='flex items-center gap-2 min-w-0'>
                <span className='bg-gray-200 py-[3px] px-3 flex items-center justify-center text-xs text-gray-700 rounded-xl font-mono min-w-0 whitespace-nowrap overflow-hidden text-ellipsis shrink-0'>
                  {ticketIdParam}
                </span>
                <span className='font-semibold text-gray-900 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis'>
                  {title || 'Untitled Ticket'}
                </span>
              </div>
              {!isRightPanelOpen && (
                <div className='text-sm '>
                  <Button size='sm' variant='ghost' onClick={() => setIsRightPanelOpen(true)}>
                    Open Thread
                  </Button>
                </div>
              )}
            </div>
            <div className='flex-1 overflow-y-auto no-scrollbar px-6 py-4'>
              {!summaryError && (
                <div className='mb-6'>
                  <div className='bg-[#FAFAFA] rounded-lg p-4 space-y-2 border border-border'>
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-1.5'>
                        <AIICIcon />
                        <span className='text-sm text-gray-600'>AI Summary</span>
                        {isGeneratingSummary && (
                          <span className='text-sm text-gray-400 ml-1'>Generating summary...</span>
                        )}
                      </div>
                      <div className='flex items-center gap-1'>
                        {aiSummary && !isGeneratingSummary && (
                          <button
                            onClick={() => void generateSummary(true)}
                            className='p-1 hover:bg-gray-200 rounded transition-colors'
                            aria-label='Regenerate summary'
                            title='Regenerate summary'
                          >
                            <RefreshCw size={16} className='text-gray-600' />
                          </button>
                        )}
                        {(aiSummary || isGeneratingSummary) && (
                          <button
                            onClick={() => setIsSummaryCollapsed(!isSummaryCollapsed)}
                            className='p-1 hover:bg-gray-200 rounded transition-colors'
                            aria-label={isSummaryCollapsed ? 'Expand summary' : 'Collapse summary'}
                          >
                            {isSummaryCollapsed ? (
                              <ChevronDown size={16} className='text-gray-600' />
                            ) : (
                              <ChevronUp size={16} className='text-gray-600' />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    <AnimatePresence initial={false}>
                      {!isSummaryCollapsed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeInOut' }}
                          style={{ overflow: 'hidden' }}
                        >
                          {isGeneratingSummary ? (
                            <div className='text-sm text-gray-700 pt-3 space-y-2'>
                              <Skeleton className='h-4 w-full' />
                              <Skeleton className='h-4 w-5/6' />
                              <Skeleton className='h-4 w-full' />
                              <Skeleton className='h-4 w-4/5' />
                              <Skeleton className='h-4 w-full' />
                              <Skeleton className='h-4 w-3/4' />
                            </div>
                          ) : aiSummary ? (
                            <div className='text-sm text-gray-700 pt-3'>
                              <style>{`
                                .markdown-preview-summary h1 a,
                                .markdown-preview-summary h2 a,
                                .markdown-preview-summary h3 a,
                                .markdown-preview-summary h4 a,
                                .markdown-preview-summary h5 a,
                                .markdown-preview-summary h6 a {
                                  pointer-events: none;
                                  cursor: default;
                                  text-decoration: none;
                                  color: inherit;
                                }
                                .markdown-preview-summary ul,
                                .markdown-preview-summary ol {
                                  list-style: disc;
                                  padding-left: 1.5rem;
                                  margin: 0.5rem 0;
                                }
                                .markdown-preview-summary li {
                                  display: list-item;
                                  list-style-type: disc;
                                  margin: 0.25rem 0;
                                }
                                .markdown-preview-summary ol {
                                  list-style-type: decimal;
                                }
                                .markdown-preview-summary ol li {
                                  list-style-type: decimal;
                                }
                                .markdown-preview-summary u {
                                  text-decoration: underline;
                                }
                              `}</style>
                              <MarkdownPreview
                                source={aiSummary}
                                style={{
                                  backgroundColor: 'transparent',
                                  color: 'inherit',
                                  fontSize: '14px',
                                }}
                                className='markdown-preview-summary'
                                data-color-mode='light'
                              />
                            </div>
                          ) : (
                            <div className='text-sm text-gray-600'>
                              {emails && emails.length > 0
                                ? 'AI Summary will be displayed here once available.'
                                : 'No emails available to summarize.'}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
              {emails && emails.length > 0 && (
                <div className='mb-6'>
                  <EmailThread emails={emails} />
                </div>
              )}
            </div>
            <div className='sticky bottom-0 w-full flex-shrink-0'>
              <EmailComposer conversationId={conversationId} />
            </div>
          </div>
        </Panel>
        {isRightPanelOpen && (
          <>
            {' '}
            <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
              <div className='w-[1px] h-full bg-gray-200'></div>
            </PanelResizeHandle>
            <Panel defaultSize={50} minSize={30} maxSize={70}>
              <div
                className='h-full flex flex-col overflow-hidden relative'
                ref={dragAndDropAreaRef}
              >
                <DragAndDropOverlay isVisible={isDragging} />
                {conversationId && channelId ? (
                  <Tabs.Root
                    value={activeTab}
                    onValueChange={value => setActiveTab(value as TabType)}
                    className='flex-1 flex flex-col h-full overflow-hidden'
                  >
                    {/* Tabs Header */}
                    <div className='w-full p-4 pb-0 bg-white flex-shrink-0'>
                      <div className='border-b border-gray-200 flex items-center justify-between'>
                        <Tabs.List className='flex items-center justify-start'>
                          <Tabs.Trigger asChild value='messages'>
                            <button
                              className={cn(
                                'px-3 py-2 flex items-center justify-start gap-2 transition-all duration-100 cursor-pointer',
                                activeTab === 'messages'
                                  ? 'border-b-2 border-primary'
                                  : 'border-b-2 border-transparent',
                              )}
                            >
                              <span
                                className={`${activeTab === 'messages' ? 'text-primary' : 'text-muted-foreground'}`}
                              >
                                <MessageCircle size={12} />
                              </span>
                              <span
                                className={`text-sm font-medium ${activeTab === 'messages' ? 'text-primary' : 'text-muted-foreground'}`}
                              >
                                Messages
                              </span>
                            </button>
                          </Tabs.Trigger>
                          <Tabs.Trigger asChild value='details'>
                            <button
                              className={cn(
                                'px-3 py-2 flex items-center justify-start gap-2 transition-all duration-100 cursor-pointer',
                                activeTab === 'details'
                                  ? 'border-b-2 border-primary'
                                  : 'border-b-2 border-transparent',
                              )}
                            >
                              <span
                                className={`${activeTab === 'details' ? 'text-primary' : 'text-muted-foreground'}`}
                              >
                                <FileText size={12} />
                              </span>
                              <span
                                className={`text-sm font-medium ${activeTab === 'details' ? 'text-primary' : 'text-muted-foreground'}`}
                              >
                                Details
                              </span>
                            </button>
                          </Tabs.Trigger>
                        </Tabs.List>
                        <button
                          onClick={() => setIsRightPanelOpen(false)}
                          className='p-1.5 hover:bg-gray-100 rounded transition-colors flex items-center justify-center'
                          aria-label='Close panel'
                          title='Close panel'
                        >
                          <X size={16} className='text-gray-600' />
                        </button>
                      </div>
                    </div>

                    {/* Messages Tab Content */}
                    <Tabs.Content
                      value='messages'
                      className='flex-1 flex flex-col h-full overflow-hidden data-[state=inactive]:hidden'
                    >
                      <ThreadList
                        channelId={channelId}
                        conversationId={conversationId}
                        threadMessages={messages}
                        initialScrollOffset={0}
                        isTicketThread={false}
                        conversation={conversation}
                        channelScopeType={channel?.scopeType}
                      />
                      {isUserMember ? (
                        <div className='px-4 pb-4 bg-white flex-shrink-0'>
                          <ChatInput
                            ref={inputRef}
                            channelId={channelId}
                            conversation={conversation ?? undefined}
                            placeholder='Reply to this thread...'
                            hasTicket={hasTicketInMessages}
                          />
                        </div>
                      ) : (
                        <JoinChannel
                          channelId={channelId}
                          {...(channel?.name && { channelTitle: channel.name })}
                        />
                      )}
                    </Tabs.Content>

                    {/* Details Tab Content */}
                    <Tabs.Content
                      value='details'
                      className='flex-1 overflow-auto data-[state=inactive]:hidden'
                    >
                      {ticketId ? (
                        <TicketDetails ticketId={ticketId} />
                      ) : (
                        <div className='flex flex-col items-center justify-center h-full text-gray-500 p-4'>
                          <FileText size={48} className='mb-2 text-gray-400' />
                          <p>Ticket ID not found</p>
                        </div>
                      )}
                    </Tabs.Content>
                  </Tabs.Root>
                ) : (
                  <div className='h-full flex items-center justify-center'>
                    <div className='text-lg font-semibold text-gray-500'>No conversation found</div>
                  </div>
                )}
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
};

const formatEmailDate = (timestamp: number | null | undefined): string => {
  if (!timestamp) return 'Unknown date';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  // If less than 24 hours, show relative time
  if (diffHours < 24) {
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    if (diffMinutes < 1) {
      return 'Just now';
    }
    if (diffMinutes < 60) {
      return `${diffMinutes} ${diffMinutes === 1 ? 'min' : 'mins'} ago`;
    }
    const hours = Math.floor(diffHours);
    return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ago`;
  }

  // For times more than 24 hours, show date and time
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${months[date.getMonth()]} ${date.getDate()}, ${displayHours}:${displayMinutes} ${ampm}`;
};

const EmailThread = ({ emails }: { emails: Email[] }): ReactElement => {
  const [isExpanded, setIsExpanded] = useState(false);
  const COLLAPSE_THRESHOLD = 3;

  // Sort emails by createdAt timestamp (oldest first)
  const sortedEmails = useMemo(() => {
    return [...emails].sort((a, b) => {
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return aTime - bTime;
    });
  }, [emails]);

  if (sortedEmails.length <= COLLAPSE_THRESHOLD) {
    // Show all emails if there are 3 or fewer
    return (
      <div className='divide-y divide-gray-200'>
        {sortedEmails.map(email => (
          <EmailThreadItem key={email.id} email={email} />
        ))}
      </div>
    );
  }

  const firstEmail = sortedEmails[0]!;
  const lastEmail = sortedEmails[sortedEmails.length - 1]!;
  const middleEmails = sortedEmails.slice(1, -1);
  const collapsedCount = middleEmails.length;

  if (isExpanded) {
    // Show all emails when expanded
    return (
      <div className='divide-y divide-gray-200'>
        {sortedEmails.map(email => (
          <EmailThreadItem key={email.id} email={email} />
        ))}
      </div>
    );
  }

  // Show first, collapsed pill, and last when collapsed
  return (
    <div className='divide-y divide-gray-200 relative'>
      <EmailThreadItem email={firstEmail} />
      <div className='py-3 flex items-center justify-center'>
        <button
          onClick={() => setIsExpanded(true)}
          className='px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors cursor-pointer'
        >
          {collapsedCount} {collapsedCount === 1 ? 'more message' : 'more messages'}
        </button>
      </div>
      <EmailThreadItem email={lastEmail} />
    </div>
  );
};

const EmailThreadItem = ({ email }: { email: Email }): ReactElement => {
  const fromName = email.from || 'Unknown';
  const toList = email.to || [];
  const ccList = email.cc || [];
  const avatarChar = fromName.charAt(0).toUpperCase();

  return (
    <div className='w-full py-8 flex items-start justify-start gap-4'>
      <div className=''>
        <div className='size-7 flex items-center justify-center rounded-sm bg-indigo-600 text-white mt-1'>
          {avatarChar}
        </div>
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-start justify-between mb-2'>
          <div className='flex-1'>
            <div className='flex items-center gap-2 mb-1'>
              <span className='text-sm font-semibold text-gray-900'>{fromName}</span>
            </div>
            <div className='text-xs text-gray-500 mb-2'>
              <div>To: {toList.join(', ')}</div>
              {ccList.length > 0 && <div>CC: {ccList.join(', ')}</div>}
            </div>
          </div>
          <div className='text-xs text-gray-500 flex-shrink-0 ml-4'>
            {formatEmailDate(email.createdAt)}
          </div>
        </div>
        <div className='text-sm text-gray-700 leading-relaxed'>
          {email.body ? (
            <div className='jp-message-html'>
              <RenderMessageWithHTML message={email.body} />
            </div>
          ) : (
            <span className='text-gray-400 italic'>No content</span>
          )}
        </div>
      </div>
    </div>
  );
};

const AIICIcon = (): ReactElement => {
  return (
    <svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'>
      <g filter='url(#filter0_ii_7065_3552)'>
        <path
          d='M7.27143 15.2409C7.26996 12.6631 6.89499 11.1104 6.00967 10.1694C5.13445 9.23917 3.58587 8.72653 0.726533 8.72653C0.325075 8.72653 0.000340076 8.40138 0 8C0 7.59833 0.324865 7.27143 0.726533 7.27143C3.5859 7.27143 5.13445 6.75882 6.00967 5.82854C6.89478 4.88743 7.27 3.33479 7.27143 0.757059C7.27144 0.747035 7.27144 0.736583 7.27143 0.726533C7.27166 0.325027 7.59849 0 8 0C8.40122 0.000339949 8.7263 0.325237 8.72653 0.726533C8.72654 0.737114 8.72654 0.748536 8.72653 0.759094C8.72813 3.33547 9.10364 4.8876 9.9883 5.82854C10.8634 6.75873 12.4126 7.27134 15.2714 7.27143C15.6731 7.27143 16 7.59833 16 8C15.9997 8.40138 15.6729 8.72653 15.2714 8.72653C12.4126 8.72662 10.8634 9.23923 9.9883 10.1694C9.10321 11.1105 8.72801 12.6634 8.72653 15.2409C8.72653 15.251 8.72653 15.2633 8.72653 15.2735C8.72585 15.6744 8.40094 15.9997 8 16C7.59877 16 7.27212 15.6746 7.27143 15.2735C7.27144 15.2633 7.27144 15.251 7.27143 15.2409Z'
          fill='white'
        />
        <path
          d='M7.27143 15.2409C7.26996 12.6631 6.89499 11.1104 6.00967 10.1694C5.13445 9.23917 3.58587 8.72653 0.726533 8.72653C0.325075 8.72653 0.000340076 8.40138 0 8C0 7.59833 0.324865 7.27143 0.726533 7.27143C3.5859 7.27143 5.13445 6.75882 6.00967 5.82854C6.89478 4.88743 7.27 3.33479 7.27143 0.757059C7.27144 0.747035 7.27144 0.736583 7.27143 0.726533C7.27166 0.325027 7.59849 0 8 0C8.40122 0.000339949 8.7263 0.325237 8.72653 0.726533C8.72654 0.737114 8.72654 0.748536 8.72653 0.759094C8.72813 3.33547 9.10364 4.8876 9.9883 5.82854C10.8634 6.75873 12.4126 7.27134 15.2714 7.27143C15.6731 7.27143 16 7.59833 16 8C15.9997 8.40138 15.6729 8.72653 15.2714 8.72653C12.4126 8.72662 10.8634 9.23923 9.9883 10.1694C9.10321 11.1105 8.72801 12.6634 8.72653 15.2409C8.72653 15.251 8.72653 15.2633 8.72653 15.2735C8.72585 15.6744 8.40094 15.9997 8 16C7.59877 16 7.27212 15.6746 7.27143 15.2735C7.27144 15.2633 7.27144 15.251 7.27143 15.2409Z'
          fill='#FF4E4F'
        />
      </g>
      <defs>
        <filter
          id='filter0_ii_7065_3552'
          x='0'
          y='0'
          width='16'
          height='16.742'
          filterUnits='userSpaceOnUse'
          colorInterpolationFilters='sRGB'
        >
          <feFlood floodOpacity='0' result='BackgroundImageFix' />
          <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
          <feColorMatrix
            in='SourceAlpha'
            type='matrix'
            values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
            result='hardAlpha'
          />
          <feOffset dy='0.371012' />
          <feGaussianBlur stdDeviation='0.363228' />
          <feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
          <feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0' />
          <feBlend mode='normal' in2='shape' result='effect1_innerShadow_7065_3552' />
          <feColorMatrix
            in='SourceAlpha'
            type='matrix'
            values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
            result='hardAlpha'
          />
          <feOffset dy='0.742025' />
          <feGaussianBlur stdDeviation='1.21076' />
          <feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
          <feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0' />
          <feBlend
            mode='normal'
            in2='effect1_innerShadow_7065_3552'
            result='effect2_innerShadow_7065_3552'
          />
        </filter>
      </defs>
    </svg>
  );
};

const EmailComposer = ({
  conversationId,
}: {
  conversationId?: string | null | undefined;
}): ReactElement => {
  const [drafts] = useCachedQuery(
    queries.getDraftForConversation({ conversationId: conversationId || '' }),
  );
  const [emailContent, setEmailContent] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);

  const stripHtml = (html: string): string => {
    if (!html) return '';
    if (typeof document === 'undefined') return html;

    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  };

  useEffect(() => {
    const draft = drafts?.[0];
    if (draft?.draftContent) {
      const textContent = stripHtml(draft.draftContent);
      setEmailContent(textContent);
    } else {
      setEmailContent('');
    }
  }, [drafts, conversationId]);

  const handleSendEmail = async (): Promise<void> => {
    if (!emailContent.trim() || !conversationId || isSending) {
      return;
    }
    setIsSending(true);
    try {
      await apiInstance.post(`/email/${conversationId}/reply`, {
        body: emailContent,
        type: 'REPLY_ALL',
      });
      setEmailContent('');
    } catch (error) {
      console.warn('Failed to send email:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className='w-full p-4'>
      <div
        className={`border border-border rounded-xl relative ${isSending ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <div className='px-4 h-8 flex items-center justify-start gap-2 pt-2'>
          <ReplyAll size={16} className={`${isSending ? 'text-gray-400' : 'text-gray-900'}`} />
          <span
            className={`text-sm tracking-tight font-medium ${isSending ? 'text-gray-400' : 'text-gray-900'}`}
          >
            {isSending ? 'Sending...' : 'Reply to all'}
          </span>
        </div>
        <TextareaAutosize
          minRows={3}
          maxRows={4}
          placeholder='Compose email...'
          value={emailContent}
          onChange={e => setEmailContent(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              if (emailContent.trim() && conversationId && !isSending) {
                void handleSendEmail();
              }
            }
          }}
          className='w-full px-4 py-2 rounded-lg focus:outline-none focus:border-transparent text-sm'
          disabled={isSending}
        />
        <div className='px-4 flex items-center justify-end gap-2 pb-2 pt-1'>
          <button
            className='size-7 flex items-center justify-center rounded-full bg-[#788187] text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
            onClick={() => void handleSendEmail()}
            disabled={!emailContent.trim() || !conversationId || isSending}
            aria-label='Send email'
          >
            {isSending ? (
              <RefreshCw size={16} className='text-white animate-spin' />
            ) : (
              <ArrowUp size={16} className='text-white' />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

SupportScreen.displayName = 'SupportScreen';

export default SupportScreen;
