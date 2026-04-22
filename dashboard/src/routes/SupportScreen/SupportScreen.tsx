import {
  MessageCircle,
  FileText,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  RefreshCw,
  X,
  PanelRight,
  ReplyAll,
  ArrowLeft,
  ArrowUp,
  ChevronsDownUp,
  ChevronsUpDown,
  LayoutGrid,
  List,
  Split,
  Paperclip,
  Settings,
  PenLine,
  Minimize2,
  Trash2,
  Plus,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { EmailType } from '@xyne/shared';
import React, { ReactElement, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '../../utils/classNames';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { QueryResultType } from '@rocicorp/zero';
import { RenderMessageWithHTML } from '../../components/Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import ThreadList from '../../components/Chat/ThreadList/ThreadList';
import { ChatInput } from '../../components/Chat/ChatInput/ChatInput';
import { useChannel, useGetChannelUserStatus, useEmailChannels } from '../../hooks/useChannels';
import { useUsers } from '../../hooks/useUsers';
import { useChannelSubscription } from '../../hooks/useChannelSubscription';
import { useDragAndDropAreaRef } from '../../hooks/useDragAndDropAreaRef';
import { DragAndDropOverlay } from '../../components/Chat/DragAndDropOverlay';
import JoinChannel from '../../components/Chat/JoinChannel/JoinChannel';
import { mutators } from '../../zero/mutators';
import * as Tabs from '@radix-ui/react-tabs';
import { TicketDetails } from '../../components/Tickets/TicketDetails/TicketDetails';
import { apiInstance } from '../../services/clients/apiClient';
import TextareaAutosize from 'react-textarea-autosize';
import { Button } from '../../components/ui/Button/Button';
import { useAuthContextValues } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import { TicketListView } from '../../components/Tickets/TicketListView';
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
import { getDraft } from '../../hooks/useDraft';
import { useShortcut } from '../../shortcuts';
import { v4 as uuidv4 } from 'uuid';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { AssigneePicker } from '../../components/Tickets/TicketListView/AssigneePicker';
import { StagePicker } from '../../components/Tickets/TicketListView/StagePicker';
import { PriorityPicker } from '../../components/Tickets/TicketListView/PriorityPicker';
import ChannelsSidebar from '../../components/ChannelsSidebar/ChannelsSidebar';
import { EmailTagWithAvatar } from '../../components/xyne-desk/EmailTagWithAvatar/EmailTagWithAvatar';
import { useEmailDraft, useEmailDraftOperations } from '../../hooks/useEmailDraft';
import { AttachmentPreview } from '../../components/ui/files/AttachmentPreview';
import { MediaViewer } from '../../components/ui/files';
import { SignatureEditor } from '../../components/xyne-desk/SignatureEditor/SignatureEditor';
import AddChannelForm from '../../components/Chat/AddChannelForm/AddChannelForm';
import { API_BASE_URL } from '../../config';
import Dialog from '../../components/ui/Dialog';
import { useMutation } from '@tanstack/react-query';
import XyneAISidebar from '../../components/Chat/XyneAISidebar/XyneAISidebar';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { DraftCard } from '../../components/xyne-desk/DraftCard/DraftCard';
import { RefineInput } from '../../components/xyne-desk/RefineInput/RefineInput';
import { useDeskAIDraft } from '../../hooks/useDeskAIDraft';
import { channelService, CreateChannelFormData } from '../../services/Chat/channelService';

// Unified type for tickets from the supportTicketsFiltered query
type SupportTicket = QueryResultType<typeof queries.supportTicketsFiltered>[number];

const ALL_CHANNELS_ID = 'all';

// Type definition for emails from the query
type EmailAttachment = {
  url: string;
  originalFilename: string;
};

type Email = QueryResultType<typeof queries.getEmailsForTicket>[number] & {
  attachments?: EmailAttachment[];
};

// API response type for email demerge endpoint
interface DemergeEmailResponse {
  success: boolean;
  newTicket: {
    ticketId: string;
    xyneId: string;
    conversationId: string;
  };
}
type TabType = 'messages' | 'details';

type ViewMode = 'kanban' | 'list';

const SupportScreen = (): ReactElement => {
  const { ticketId } = useParams<{ ticketId?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const zero = useZero();
  const { userID } = useAuthContextValues();
  const { isMobile } = usePlatform();
  const [showMyTicketsOnly, setShowMyTicketsOnly] = useState(false);
  // Channel selection is sourced from URL (?channel=...) with localStorage fallback for restore.
  const selectedChannelId =
    searchParams.get('channel') ?? localStorage.getItem('support-selected-channel');
  const setSelectedChannelId = useCallback(
    (next: string | null): void => {
      setSearchParams(
        prev => {
          const p = new URLSearchParams(prev);
          if (next) p.set('channel', next);
          else p.delete('channel');
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('support-sidebar-open');
    return saved ? saved === 'true' : true;
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('support-view-mode');
    return (saved as ViewMode) || 'kanban';
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(
    () =>
      searchParams.get('settings') === 'open' || searchParams.get('openSettings') === 'signatures',
  );
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);

  // Handle email channel connection results from OAuth redirect
  useEffect(() => {
    const emailError = searchParams.get('emailError');
    const emailConnected = searchParams.get('emailConnected');

    if (emailConnected === 'true') {
      const channelId = searchParams.get('channelId');
      if (channelId) {
        setSelectedChannelId(channelId);
      }
      toast.success('Email channel connected successfully');
      searchParams.delete('emailConnected');
      searchParams.delete('channelId');
      searchParams.delete('provider');
      setSearchParams(searchParams, { replace: true });
    } else if (emailError) {
      toast.error(emailError);
      searchParams.delete('emailError');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  // Sync panel open/close with the URL so back button works correctly
  useEffect(() => {
    const isOpen =
      searchParams.get('settings') === 'open' || searchParams.get('openSettings') === 'signatures';
    setIsSettingsOpen(isOpen);
    // Clean up the openSettings param (used by "Add signature" deep-link)
    if (searchParams.get('openSettings') === 'signatures') {
      void navigate('/support?settings=open', { replace: true });
    }
  }, [searchParams, navigate]);

  // Handle OAuth redirect back from Google/Microsoft with emailConnected flag
  useEffect(() => {
    if (searchParams.get('emailConnected') === 'true') {
      const provider = searchParams.get('provider') ?? 'Email';
      toast.success(
        `${provider.charAt(0).toUpperCase() + provider.slice(1)} channel connected successfully`,
      );
      setSearchParams(
        prev => {
          const p = new URLSearchParams(prev);
          p.delete('emailConnected');
          p.delete('provider');
          return p;
        },
        { replace: true },
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem('support-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('support-sidebar-open', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  useEffect(() => {
    if (selectedChannelId) {
      localStorage.setItem('support-selected-channel', selectedChannelId);
    } else {
      localStorage.removeItem('support-selected-channel');
    }
  }, [selectedChannelId]);

  // Fetch EMAIL channels using hook (from state machine, already loaded)
  const emailChannels = useEmailChannels();

  // Unified query: filters by EMAIL channels, optional channelId, and optional merchant.
  // Only needed for Kanban view; list view uses paginated supportTicketsPage via TicketListView.
  const [supportTickets] = useCachedQuery(
    queries.supportTicketsFiltered({
      channelId:
        selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID ? selectedChannelId : undefined,
    }),
    { enabled: viewMode === 'kanban' },
  );

  // Email channels are already sorted by the useEmailChannels hook
  const sortedEmailChannels = emailChannels;
  const selectedChannelName =
    sortedEmailChannels.find(c => c.id === selectedChannelId)?.name?.trim() || 'Xyne Desk';

  // Auto-select first channel when channels load and none is selected
  useEffect(() => {
    if (sortedEmailChannels.length > 0 && !selectedChannelId) {
      setSelectedChannelId(sortedEmailChannels[0]!.id);
    }
  }, [sortedEmailChannels, selectedChannelId]);

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

  // Mutation for creating email channel
  const createChannelMutation = useMutation({
    mutationFn: async (data: CreateChannelFormData & { channelType?: 'EMAIL' | undefined }) => {
      const { channelType, ...formData } = data;
      const response = await channelService.createChannel(formData, channelType || 'EMAIL');
      return response;
    },
    onSuccess: () => {
      setShowCreateChannelModal(false);
      toast.success('Channel created successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to create channel', {
        description: error.message || 'Please try again',
      });
    },
  });

  const handleCreateEmailChannel = (
    data: CreateChannelFormData & {
      connector?: 'google' | 'microsoft' | null;
      channelType?: 'EMAIL' | undefined;
    },
  ) => {
    const { connector, ...rest } = data;

    if (connector === 'microsoft') {
      const params = new URLSearchParams({
        name: rest.name,
        projectId: rest.projectId,
        visibility: rest.visibility,
      });
      if (rest.description) {
        params.set('description', rest.description);
      }
      window.location.href = `${API_BASE_URL}/integrations/microsoft/connect?${params.toString()}`;
      return;
    }

    if (connector === 'google') {
      const params = new URLSearchParams({
        name: rest.name,
        projectId: rest.projectId,
        visibility: rest.visibility,
      });
      if (rest.description) {
        params.set('description', rest.description);
      }
      window.location.href = `${API_BASE_URL}/integrations/google/connect?${params.toString()}`;
      return;
    }

    createChannelMutation.mutate(rest);
  };

  const handleTicketClick = useCallback(
    (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => {
      const isCmdClick = 'metaKey' in e && (e.metaKey || e.ctrlKey);
      const ticketData = ticket as SupportTicket;
      const ticketUrl = `/support/${ticketData.xyneId}`;

      // Only open in new tab on desktop when Cmd/Ctrl+Click is pressed
      if (!isMobile && isCmdClick) {
        const urlWithParams = `${ticketUrl}?conversationId=${ticketData.conversationId ?? ''}&title=${encodeURIComponent(ticketData.title ?? '')}&ticketId=${ticketData.id ?? ''}`;
        window.open(urlWithParams, '_blank');
        return;
      }

      void navigate(ticketUrl, {
        state: {
          conversationId: ticketData.conversationId,
          title: ticketData.title,
          ticketId: ticketData.id,
        },
      });
    },
    [navigate, isMobile],
  );

  return (
    <div className='h-full flex flex-col relative bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <PanelGroup
        direction='horizontal'
        className='flex-1 overflow-hidden'
        autoSaveId='support-panel-layout'
      >
        {isSidebarOpen && !isSettingsOpen && !ticketId && (
          <>
            <Panel defaultSize={16} minSize={12} maxSize={25} id='sidebar' order={1}>
              <ChannelsSidebar
                channels={sortedEmailChannels}
                selectedChannelId={selectedChannelId}
                onSelectChannel={setSelectedChannelId}
                onCollapse={() => setIsSidebarOpen(false)}
                headerAction={
                  <button
                    onClick={() => setShowCreateChannelModal(true)}
                    className='p-2 hover:bg-muted rounded-md transition-colors'
                    aria-label='Create channel'
                    title='Create channel'
                    data-track-category='Support'
                    data-track-name='CreateChannelOpen'
                  >
                    <Plus className='size-4 text-muted-foreground' />
                  </button>
                }
              />
            </Panel>
            <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
              <div className='w-[1px] h-full bg-border'></div>
            </PanelResizeHandle>
          </>
        )}
        {!ticketId && (
          <Panel defaultSize={84} minSize={75} order={2}>
            <div className='h-full flex flex-col'>
              <div className='flex-shrink-0 h-14 px-4 border-b border-border flex items-center justify-between'>
                <div className='flex items-center gap-2 font-semibold min-w-0 flex-1'>
                  {!isSidebarOpen && (
                    <button
                      onClick={() => setIsSidebarOpen(true)}
                      className='p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors mr-1'
                      title='Open Channels'
                      data-track-category='Support'
                      data-track-name='OpenChannelsSidebar'
                    >
                      <ChevronRight size={16} />
                    </button>
                  )}
                  <span className='truncate'>{selectedChannelName}</span>
                </div>
                <div className='flex items-center gap-2'>
                  <button
                    onClick={() => setShowMyTicketsOnly(!showMyTicketsOnly)}
                    className={cn(
                      'text-sm font-medium transition-colors px-2 py-1 rounded whitespace-nowrap',
                      showMyTicketsOnly
                        ? 'text-primary  bg-border'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    data-track-category='Support'
                    data-track-name='ToggleMyTickets'
                    data-track-metadata={JSON.stringify({ showMyTicketsOnly: !showMyTicketsOnly })}
                  >
                    My Tickets
                  </button>
                  {/* View Toggle */}
                  <div className='flex items-center border border-border rounded-lg overflow-hidden'>
                    <button
                      onClick={() => setViewMode('kanban')}
                      className={cn(
                        'p-1.5 transition-colors',
                        viewMode === 'kanban'
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                      )}
                      title='Kanban View'
                      data-track-category='Support'
                      data-track-name='SetKanbanView'
                    >
                      <LayoutGrid size={16} />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={cn(
                        'p-1.5 transition-colors',
                        viewMode === 'list'
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                      )}
                      title='List View'
                      data-track-category='Support'
                      data-track-name='SetListView'
                    >
                      <List size={16} />
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      if (isSettingsOpen) {
                        void navigate(-1);
                      } else {
                        void navigate('/support?settings=open');
                      }
                    }}
                    className={cn(
                      'p-1.5 rounded transition-colors',
                      isSettingsOpen
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                    )}
                    title='Inbox settings'
                    data-track-category='Support'
                    data-track-name='ToggleInboxSettings'
                  >
                    <Settings size={16} />
                  </button>
                  {ticketId && (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => void navigate(`/support`)}
                      data-track-category='Support'
                      data-track-name='CloseTicketPanel'
                    >
                      <PanelRight size={16} />
                    </Button>
                  )}
                </div>
              </div>
              {isSettingsOpen && (
                <div className='absolute inset-0 z-10 bg-background flex flex-col overflow-y-auto'>
                  <div className='flex-shrink-0 h-14 px-4 border-b border-border flex items-center justify-between'>
                    <span className='text-sm font-semibold text-foreground'>Inbox Settings</span>
                    <button
                      onClick={() => void navigate(-1)}
                      className='p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors'
                      data-track-category='inbox-settings'
                      data-track-name='close-inbox-settings'
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className='p-4'>
                    <SignatureEditor />
                  </div>
                </div>
              )}
              <div className='h-full flex-1 min-h-0 overflow-y-auto no-scrollbar'>
                {viewMode === 'kanban' ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={event => void handleDragEnd(event)}
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
                        <TicketCard
                          ticket={activeTicket}
                          isCompact={true}
                          onClick={() => {}}
                          data-track-category='Support'
                          data-track-name='DragOverlayTicketClick'
                          data-track-metadata={JSON.stringify({ ticketId: activeTicket?.id })}
                        />
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                ) : (
                  <TicketListView
                    filter={{
                      channelId:
                        selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID
                          ? selectedChannelId
                          : undefined,
                      assignedTo: showMyTicketsOnly ? userID : undefined,
                    }}
                    showExtraFields={true}
                    activeTicketId={ticketId}
                    onTicketClick={ticket => {
                      void navigate(`/support/${ticket.xyneId}`, {
                        state: {
                          conversationId: ticket.conversationId,
                          title: ticket.title,
                          ticketId: ticket.id,
                        },
                      });
                    }}
                  />
                )}
              </div>
            </div>
          </Panel>
        )}
        {ticketId && (
          <Panel defaultSize={100} minSize={100} order={3}>
            <div className='h-full overflow-hidden'>
              <SupportTicketDetail />
            </div>
          </Panel>
        )}
      </PanelGroup>

      {/* Create Channel Modal */}
      <Dialog
        open={showCreateChannelModal}
        onOpenChange={setShowCreateChannelModal}
        title='Create Email Channel'
      >
        <div className='p-4'>
          <AddChannelForm
            title='Create Email Channel'
            hideVisibility={false}
            requireConnector={true}
            onSubmit={data => handleCreateEmailChannel(data)}
            onCancel={() => setShowCreateChannelModal(false)}
            loading={createChannelMutation.isPending}
          />
        </div>
      </Dialog>
    </div>
  );
};

const TicketMetaRow = ({
  ticket,
}: {
  ticket:
    | {
        id: string;
        priority?: string | null;
        stageName?: string | null;
        assignedTo?: string | null;
      }
    | undefined
    | null;
}): ReactElement | null => {
  const resolvedAssigneeId = ticket?.assignedTo?.replace(/^(user:|group:)/, '') || '';
  const assignee = useUser(resolvedAssigneeId);
  if (!ticket) return null;
  const stage = ticket.stageName || 'To Do';
  const assigneeName = resolvedAssigneeId
    ? assignee
      ? getUserDisplayName(assignee)
      : '…'
    : 'Unassigned';
  return (
    <div className='flex items-center gap-2 flex-wrap min-h-[24px]'>
      <PriorityPicker ticketId={ticket.id} priority={ticket.priority} />
      <StagePicker ticketId={ticket.id} stageName={ticket.stageName} stageLabel={stage} />
      <AssigneePicker ticketId={ticket.id} assignedTo={ticket.assignedTo} label={assigneeName} />
    </div>
  );
};

const SupportTicketDetail = (): ReactElement => {
  const { ticketId: ticketIdParam } = useParams<{ ticketId?: string }>();
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState<boolean>(false);

  // Sync with xyneAIActor: when sidebar's own X button sends CLOSE, close our panel too
  useEffect(() => {
    const subscription = xyneAIActor.subscribe(snapshot => {
      if (snapshot.context.xyneAIState === 'closed' && isAIPanelOpen) {
        setIsAIPanelOpen(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [isAIPanelOpen]);
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const routerState = location.state as {
    conversationId?: string | null;
    title?: string | null;
    ticketId?: string | null;
  };
  // Fall back to query params when state is not available (e.g., Cmd+Click new tab)
  const stateConversationId = routerState?.conversationId ?? searchParams.get('conversationId');
  const stateTitle = routerState?.title ?? searchParams.get('title');
  const ticketId = routerState?.ticketId ?? searchParams.get('ticketId');

  // Single consolidated fetch: the ticket row with `.related('emails')` gives us emails,
  // channelId (scalar on ticket), conversationId, and everything else we need — replaces
  // getEmailsForTicket + getConversationById. Use id when we have it (from list navigation
  // state), otherwise fall back to xyneId lookup (direct URL loads).
  const [ticketById] = useCachedQuery(queries.supportTicketRow({ id: ticketId || '' }), {
    enabled: !!ticketId,
  });
  const [ticketByXyneId] = useCachedQuery(
    queries.supportTicketByXyneId({ xyneId: ticketIdParam || '' }),
    { enabled: !ticketId && !!ticketIdParam },
  );
  const ticket = ticketById ?? ticketByXyneId;
  const emails = useMemo(() => (ticket?.emails as Email[] | undefined) ?? [], [ticket?.emails]);
  const emailCollapseState = useEmailCollapseState(emails);
  const channelId = ticket?.channelId || '';
  const conversationId = ticket?.conversationId ?? stateConversationId;
  const title = ticket?.title ?? stateTitle;
  const conversation = ticket?.conversation;

  // Prev / next cursor queries — each returns at most 1 adjacent ticket in the
  // EMAIL-channel scope ordered by createdAt desc. Served from IVM when cached,
  // otherwise a tiny server fetch.
  const cursorStart =
    ticket?.id && typeof ticket.createdAt === 'number'
      ? { id: ticket.id, createdAt: ticket.createdAt }
      : null;
  const [nextPage] = useCachedQuery(
    queries.supportTicketsPage({
      channelId,
      limit: 1,
      start: cursorStart,
      dir: 'forward',
    }),
    { enabled: !!cursorStart },
  );
  const [prevPage] = useCachedQuery(
    queries.supportTicketsPage({
      channelId,
      limit: 1,
      start: cursorStart,
      dir: 'backward',
    }),
    { enabled: !!cursorStart },
  );
  const nextTicket = nextPage?.[0];
  const prevTicket = prevPage?.[0];

  const goToTicket = (t: {
    id: string;
    xyneId?: string | null;
    conversationId: string;
    title: string;
  }): void => {
    if (!t.xyneId) return;
    void navigate(`/support/${t.xyneId}`, {
      state: {
        conversationId: t.conversationId,
        title: t.title,
        ticketId: t.id,
      },
    });
  };

  // Keyboard shortcuts: j = next, k = previous, e = toggle collapse/expand all.
  useShortcut(
    'j',
    () => {
      if (nextTicket) goToTicket(nextTicket);
    },
    {
      scope: 'global',
      description: 'Next ticket',
      category: 'Support',
      enabled: !!nextTicket,
    },
  );
  useShortcut(
    'k',
    () => {
      if (prevTicket) goToTicket(prevTicket);
    },
    {
      scope: 'global',
      description: 'Previous ticket',
      category: 'Support',
      enabled: !!prevTicket,
    },
  );
  useShortcut(
    'e',
    () => {
      if (emailCollapseState.canToggleAll) emailCollapseState.toggleAll();
    },
    {
      scope: 'global',
      description: 'Collapse / expand all emails',
      category: 'Support',
      enabled: emailCollapseState.canToggleAll,
    },
  );
  useShortcut('r', () => setComposerOpen(true), {
    scope: 'global',
    description: 'Reply',
    category: 'Support',
    enabled: !composerOpen,
  });
  useShortcut('a', () => setComposerOpen(true), {
    scope: 'global',
    description: 'Reply all',
    category: 'Support',
    enabled: !composerOpen,
  });

  // Fetch messages for the conversation
  const [messages] = useCachedQuery(
    queries.conversationMessagesV2({
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

  // Drag and drop functionality
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(conversationId || '');

  // Mark thread activities as read when component unmounts
  const zero = useZero();
  useEffect(() => {
    return (): void => {
      if (conversationId) {
        const draft = getDraft(channelId, conversationId);
        void zero.mutate(
          mutators.activities.markThreadActivitiesAsRead({
            conversationId,
            timestamp: Date.now(),
            draftMessage: draft || '',
            draftMessageId: uuidv4(),
          }),
        );
      }
    };
  }, [conversationId]);

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

  if (!ticketIdParam) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-lg font-semibold text-muted-foreground'>Ticket not found</div>
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
            <div className='w-full px-6 py-5 flex items-start justify-between flex-shrink-0 gap-4'>
              <div className='flex items-start gap-2 min-w-0 flex-1'>
                <button
                  type='button'
                  onClick={() => void navigate('/support')}
                  className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 mt-0.5'
                  aria-label='Back to ticket list'
                  data-track-category='Support'
                  data-track-name='BackToList'
                >
                  <ArrowLeft size={18} />
                </button>
                <div className='flex flex-col min-w-0 flex-1 gap-3'>
                  <div className='flex items-center gap-2 min-w-0'>
                    <span className='bg-border py-[3px] px-3 flex items-center justify-center text-xs text-foreground rounded-md font-mono shrink-0 whitespace-nowrap'>
                      {ticketIdParam}
                    </span>
                    <span className='font-semibold text-foreground min-w-0 whitespace-nowrap overflow-hidden text-ellipsis'>
                      {title || 'Untitled Ticket'}
                    </span>
                  </div>
                  <TicketMetaRow ticket={ticket} />
                </div>
              </div>
              <div className='flex items-center gap-2 flex-shrink-0'>
                <div className='flex items-center gap-1'>
                  <button
                    type='button'
                    onClick={() => prevTicket && goToTicket(prevTicket)}
                    disabled={!prevTicket}
                    title='Previous ticket'
                    className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                    data-track-category='Support'
                    data-track-name='PrevTicket'
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type='button'
                    onClick={() => nextTicket && goToTicket(nextTicket)}
                    disabled={!nextTicket}
                    title='Next ticket'
                    className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                    data-track-category='Support'
                    data-track-name='NextTicket'
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
                {emailCollapseState.canToggleAll && (
                  <button
                    type='button'
                    onClick={emailCollapseState.toggleAll}
                    title={emailCollapseState.anyExpanded ? 'Collapse all' : 'Expand all'}
                    className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                    data-track-category='Support'
                    data-track-name={
                      emailCollapseState.anyExpanded ? 'CollapseAllEmails' : 'ExpandAllEmails'
                    }
                  >
                    {emailCollapseState.anyExpanded ? (
                      <ChevronsDownUp size={16} />
                    ) : (
                      <ChevronsUpDown size={16} />
                    )}
                  </button>
                )}
                {!isRightPanelOpen && (
                  <div className='text-sm '>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setIsRightPanelOpen(true)}
                      data-track-category='Support'
                      data-track-name='OpenThreadPanel'
                    >
                      Open Thread
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className='flex-1 overflow-y-auto no-scrollbar px-6 py-4'>
              {emails && emails.length > 0 && (
                <div className='mb-6'>
                  <EmailThread collapseState={emailCollapseState} />
                </div>
              )}
            </div>
            <div className='sticky bottom-0 w-full flex-shrink-0 bg-background border-t border-border'>
              {composerOpen ? (
                <EmailComposer
                  conversationId={conversationId}
                  onClose={() => setComposerOpen(false)}
                  isAIPanelOpen={isAIPanelOpen}
                  onToggleAIPanel={() => setIsAIPanelOpen(prev => !prev)}
                  channelId={channelId}
                />
              ) : (
                <div className='px-6 py-3 flex items-center gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setComposerOpen(true)}
                    data-track-category='Support'
                    data-track-name='OpenReplyComposer'
                  >
                    <ArrowUp size={14} className='rotate-[-90deg] mr-1' />
                    Reply
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setComposerOpen(true)}
                    data-track-category='Support'
                    data-track-name='OpenReplyAllComposer'
                  >
                    <ReplyAll size={14} className='mr-1' />
                    Reply all
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Panel>
        {isRightPanelOpen && (
          <>
            {' '}
            <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
              <div className='w-[1px] h-full bg-border'></div>
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
                    <div className='w-full p-4 pb-0 bg-background flex-shrink-0'>
                      <div className='border-b border-border flex items-center justify-between'>
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
                          className='p-1.5 hover:bg-muted rounded transition-colors flex items-center justify-center'
                          aria-label='Close panel'
                          title='Close panel'
                          data-track-category='Support'
                          data-track-name='CloseRightPanel'
                        >
                          <X size={16} className='text-muted-foreground' />
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
                        <div className='px-4 pb-4 bg-background flex-shrink-0'>
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
                        <div className='flex flex-col items-center justify-center h-full text-muted-foreground p-4'>
                          <FileText size={48} className='mb-2 text-muted-foreground' />
                          <p>Ticket ID not found</p>
                        </div>
                      )}
                    </Tabs.Content>
                  </Tabs.Root>
                ) : (
                  <div className='h-full flex items-center justify-center'>
                    <div className='text-lg font-semibold text-muted-foreground'>
                      No conversation found
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          </>
        )}
        {isAIPanelOpen && (
          <>
            <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
              <div className='w-[1px] h-full bg-border'></div>
            </PanelResizeHandle>
            <Panel defaultSize={33} minSize={25} maxSize={50}>
              <div className='max-w-[830px] h-full relative'>
                {conversationId && channelId && (
                  <XyneAISidebar
                    key={conversationId}
                    channelId={channelId}
                    threadInfo={{
                      conversationId,
                      previewText: title || 'Ticket conversation',
                    }}
                    startFreshChat={false}
                  />
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

interface EmailCollapseState {
  collapsedIds: Set<string>;
  toggleOne: (id: string) => void;
  toggleAll: () => void;
  canToggleAll: boolean;
  anyExpanded: boolean;
  lastEmailId: string | undefined;
  sortedEmails: Email[];
}

const useEmailCollapseState = (emails: Email[]): EmailCollapseState => {
  const sortedEmails = useMemo(() => {
    return [...emails].sort((a, b) => {
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return aTime - bTime;
    });
  }, [emails]);

  const lastEmailId = sortedEmails[sortedEmails.length - 1]?.id;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    if (sortedEmails.length <= 1) return new Set();
    return new Set(sortedEmails.slice(0, -1).map(e => e.id));
  });

  const emailIdsKey = useMemo(() => sortedEmails.map(e => e.id).join('|'), [sortedEmails]);
  useEffect(() => {
    if (sortedEmails.length <= 1) {
      setCollapsedIds(new Set());
      return;
    }
    setCollapsedIds(new Set(sortedEmails.slice(0, -1).map(e => e.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailIdsKey]);

  const collapsibleEmails = sortedEmails.slice(0, -1);
  const anyExpanded = collapsibleEmails.some(e => !collapsedIds.has(e.id));
  const canToggleAll = sortedEmails.length > 1;

  const toggleOne = (id: string): void => {
    if (id === lastEmailId) return;
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (): void => {
    if (anyExpanded) {
      setCollapsedIds(new Set(collapsibleEmails.map(e => e.id)));
    } else {
      setCollapsedIds(new Set());
    }
  };

  return {
    collapsedIds,
    toggleOne,
    toggleAll,
    canToggleAll,
    anyExpanded,
    lastEmailId,
    sortedEmails,
  };
};

const EmailThread = ({ collapseState }: { collapseState: EmailCollapseState }): ReactElement => {
  const { sortedEmails, collapsedIds, toggleOne, lastEmailId } = collapseState;
  return (
    <div className='divide-y divide-gray-200 relative'>
      {sortedEmails.map(email => (
        <EmailThreadItem
          key={email.id}
          email={email}
          firstEmail={sortedEmails[0]!}
          isCollapsed={collapsedIds.has(email.id)}
          canCollapse={email.id !== lastEmailId}
          onToggleCollapse={() => toggleOne(email.id)}
        />
      ))}
    </div>
  );
};

const parseFromField = (raw: string): { name: string; email: string | null } => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { name: 'Unknown', email: null };
  const match = trimmed.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1]!.trim(), email: match[2]!.trim() };
  }
  const emailOnly = trimmed.match(/^<?([^\s<>@]+@[^\s<>]+)>?$/);
  if (emailOnly) {
    return { name: emailOnly[1]!.split('@')[0] ?? emailOnly[1]!, email: emailOnly[1]! };
  }
  return { name: trimmed, email: null };
};

const EmailThreadItem = ({
  email,
  firstEmail,
  isCollapsed = false,
  canCollapse = true,
  onToggleCollapse,
}: {
  email: Email;
  firstEmail: Email;
  isCollapsed?: boolean;
  canCollapse?: boolean;
  onToggleCollapse?: () => void;
}): ReactElement => {
  const { name: fromName, email: fromEmail } = parseFromField(email.from || '');
  const toList = email.to || [];
  const ccList = email.cc || [];
  const avatarChar = fromName.charAt(0).toUpperCase();
  const navigate = useNavigate();
  const [isDemerging, setIsDemerging] = useState(false);

  const handleDemerge = async (): Promise<void> => {
    if (isDemerging) return;
    setIsDemerging(true);

    // Show loading toast
    const toastId = toast.loading('Demerging email...', {
      description: 'Creating new ticket from this email',
    });

    try {
      const response = await apiInstance.post<DemergeEmailResponse>('/email/demerge', {
        emailId: email.id,
      });

      if (response.data?.success && response.data.newTicket) {
        // Show success toast
        toast.success('Demerge Successful', {
          id: toastId,
          description: `Created new ticket ${response.data.newTicket.xyneId}`,
        });

        // Navigate to the new ticket
        void navigate(`/support/${response.data.newTicket.xyneId}`, {
          state: {
            conversationId: response.data.newTicket.conversationId,
            title: email.subject,
            ticketId: response.data.newTicket.ticketId,
          },
        });
      }
    } catch {
      // Error handling without console
      toast.error('Demerge Failed', {
        id: toastId,
        description: 'Operation failed. Please try again.',
      });
    } finally {
      setIsDemerging(false);
    }
  };

  const headerClickable = canCollapse && !!onToggleCollapse;
  const preview = (email.body || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return (
    <div className='w-full flex items-start justify-start gap-4 py-3'>
      <div className=''>
        <div className='size-7 flex items-center justify-center rounded-sm bg-indigo-600 text-white mt-1'>
          {avatarChar}
        </div>
      </div>
      <div className='flex-1 min-w-0'>
        <div
          className={cn(
            'flex items-start justify-between',
            !isCollapsed && 'mb-2',
            headerClickable && 'cursor-pointer',
          )}
          data-track-category='Support'
          data-track-name={isCollapsed ? 'ExpandEmail' : 'CollapseEmail'}
          onClick={headerClickable ? onToggleCollapse : undefined}
          role={headerClickable ? 'button' : undefined}
          tabIndex={headerClickable ? 0 : undefined}
          onKeyDown={
            headerClickable
              ? e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleCollapse?.();
                  }
                }
              : undefined
          }
        >
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2 mb-1 flex-wrap'>
              <span className='text-sm font-semibold text-foreground'>{fromName}</span>
              {fromEmail && (
                <span className='text-xs text-muted-foreground truncate'>&lt;{fromEmail}&gt;</span>
              )}
              {email.type === EmailType.DEFAULT &&
                email.externalThreadId === email.externalMessageId &&
                email.id !== firstEmail.id && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      void handleDemerge();
                    }}
                    disabled={isDemerging}
                    className='flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                    title='Demerge this email to a new ticket'
                    data-track-category='SUPPORT'
                    data-track-name='DemergeEmail'
                    data-track-metadata={JSON.stringify({
                      emailId: email.id,
                      conversationId: email.conversationId,
                    })}
                  >
                    <Split size={12} />
                    {isDemerging ? 'Demerging...' : 'Demerge'}
                  </button>
                )}
            </div>
            {isCollapsed ? (
              <div className='text-xs text-muted-foreground truncate'>{preview}</div>
            ) : (
              <div className='text-xs text-muted-foreground mb-2'>
                <div>To: {toList.join(', ')}</div>
                {ccList.length > 0 && <div>CC: {ccList.join(', ')}</div>}
              </div>
            )}
          </div>
          <div className='text-xs text-muted-foreground flex-shrink-0 ml-4 whitespace-nowrap'>
            {formatEmailDate(email.createdAt)}
          </div>
        </div>
        {!isCollapsed && (
          <div className='text-sm text-foreground leading-relaxed'>
            {email.body ? (
              <div className='jp-message-html'>
                <RenderMessageWithHTML message={email.body} />
              </div>
            ) : (
              <span className='text-muted-foreground italic'>No content</span>
            )}
          </div>
        )}
        {/* Attachments */}
        {!isCollapsed && email.attachments && email.attachments.length > 0 && (
          <div className='mt-3 flex flex-wrap gap-2'>
            {email.attachments.map((attachment, idx) => (
              <a
                key={idx}
                href={attachment.url}
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-border rounded-lg text-xs text-foreground transition-colors'
                title={attachment.originalFilename}
              >
                <Paperclip size={14} className='text-muted-foreground' />
                <span className='max-w-[150px] truncate'>{attachment.originalFilename}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const stripHtml = (html: string): string => {
  if (!html) return '';
  if (typeof document === 'undefined') return html;

  const tmp = document.createElement('DIV');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
};

const EmailComposer = ({
  conversationId,
  onClose,
  isAIPanelOpen,
  onToggleAIPanel,
  channelId,
}: {
  conversationId?: string | null | undefined;
  onClose?: () => void;
  isAIPanelOpen?: boolean;
  onToggleAIPanel?: () => void;
  channelId?: string;
}): ReactElement => {
  const [emails] = useCachedQuery(
    queries.getEmailsForTicket({ conversationId: conversationId || '' }),
  );
  // Use email draft hooks
  const draftContent = useEmailDraft(conversationId);
  const { saveDraft, deleteDraft, draftId } = useEmailDraftOperations(conversationId);

  // AI draft hook
  const aiDraft = useDeskAIDraft({
    channelId: channelId || '',
    conversationId: conversationId || '',
  });
  const [emailContent, setEmailContent] = useState<string>('');

  // Persist the AI draft exactly once, on the streaming → finished transition.
  // Two problems this avoids:
  //  - writing during streaming (would hammer Zero on every chunk)
  //  - re-firing whenever `saveDraft`'s identity flips. The underlying Zero
  //    live query (`getDraftForConversation`) re-emits on every upsert, which
  //    rebuilds the `saveDraft` callback, which re-triggers this effect —
  //    a self-sustaining save loop that saturates the Zero socket.
  const saveDraftRef = useRef(saveDraft);
  useEffect(() => {
    saveDraftRef.current = saveDraft;
  }, [saveDraft]);
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    const justFinished = wasStreamingRef.current && !aiDraft.isStreaming;
    wasStreamingRef.current = aiDraft.isStreaming;
    if (!justFinished || !aiDraft.isDraftActive) return;
    const content = aiDraft.draftContent?.trim();
    if (content) saveDraftRef.current(aiDraft.draftContent);
  }, [aiDraft.isStreaming, aiDraft.isDraftActive, aiDraft.draftContent]);
  const [hasAcceptedDraft, setHasAcceptedDraft] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const users = useUsers();
  const [signatures] = useCachedQuery(queries.userEmailSignatures());
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null | undefined>(
    undefined,
  );
  const composerNavigate = useNavigate();
  const signatureAutoAppend = localStorage.getItem('signature-auto-append-enabled') !== 'false';

  useEffect(() => {
    if (
      signatures &&
      signatures.length > 0 &&
      signatureAutoAppend &&
      selectedSignatureId === undefined
    ) {
      const defaultSig = signatures.find(s => s.isDefault);
      setSelectedSignatureId(defaultSig?.id ?? signatures[0]?.id ?? null);
    }
  }, [signatures, signatureAutoAppend, selectedSignatureId]);

  // Attachment state
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Reset all composer state when switching conversations
  useEffect(() => {
    setAttachments([]);
    setPreviewFile(null);
    setIsPreviewOpen(false);
  }, [conversationId]);

  // Initialize email content from draft
  useEffect(() => {
    if (draftContent) {
      const textContent = stripHtml(draftContent);
      setEmailContent(textContent);
    } else {
      setEmailContent('');
    }
  }, [draftContent, conversationId]);

  const toInputRef = React.useRef<HTMLInputElement>(null);
  const [toInputValue, setToInputValue] = useState<string>('');

  // Recipient state
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [bccEmails, setBccEmails] = useState<string[]>([]);
  const [showCc, setShowCc] = useState<boolean>(false);
  const [showBcc, setShowBcc] = useState<boolean>(false);

  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Initialize recipients from latest email
  useEffect(() => {
    if (emails && emails.length > 0) {
      const sortedEmailsAsc = [...emails].sort((a, b) => {
        const aTime = a.createdAt || 0;
        const bTime = b.createdAt || 0;
        return aTime - bTime;
      });
      const initialEmail = sortedEmailsAsc[0];

      const sortedEmailsDesc = [...emails].sort((a, b) => {
        const aTime = a.createdAt || 0;
        const bTime = b.createdAt || 0;
        return bTime - aTime;
      });
      const latestEmail = sortedEmailsDesc[0];

      if (latestEmail && initialEmail) {
        // Backend sends FROM this address, so we should not include it in TO recipients
        const fromEmailAddress = (initialEmail.to && initialEmail.to[0])?.toLowerCase() || '';

        const allRecipients = new Set<string>();
        if (latestEmail.from) allRecipients.add(latestEmail.from);
        if (latestEmail.to) latestEmail.to.forEach(email => allRecipients.add(email));

        const filteredRecipients = Array.from(allRecipients).filter(
          email => email.toLowerCase() !== fromEmailAddress,
        );

        setToEmails(filteredRecipients);
        setCcEmails(latestEmail.cc || []);
        setBccEmails(latestEmail.bcc || []);

        setIsExpanded(false);
        setShowCc(false);
        setShowBcc(false);
      }
    }
  }, [emails, conversationId]);

  // Upload attachments to Zoho to get attachmentIds for email
  const uploadAttachments = async (files: File[]): Promise<string[]> => {
    if (files.length === 0 || !conversationId) return [];

    setIsUploadingAttachments(true);
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));

      const response = await apiInstance.post<{ attachmentIds: string[] }>(
        `/email/${conversationId}/upload-attachments`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      );

      return response.data?.attachmentIds || [];
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload attachments');
      throw error;
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const handleSendEmail = async (): Promise<void> => {
    if (!emailContent.trim() || !conversationId || isSending || toEmails.length === 0) {
      return;
    }
    setIsSending(true);
    try {
      let attachmentIds: string[] = [];

      // Upload attachments if any
      if (attachments.length > 0) {
        attachmentIds = await uploadAttachments(attachments);
      }

      const activeSig = selectedSignatureId
        ? signatures?.find(s => s.id === selectedSignatureId)
        : null;
      const bodyHtml = activeSig
        ? `<p>${emailContent.trim().replace(/\n/g, '<br>')}</p><br>--<br>${activeSig.content}`
        : emailContent;
      await apiInstance.post(`/email/${conversationId}/reply`, {
        body: bodyHtml,
        type: 'REPLY_ALL',
        to: toEmails,
        cc: ccEmails,
        bcc: bccEmails,
        ...(attachmentIds.length > 0 && { attachmentIds }),
      });

      // Clear state after successful send
      setEmailContent('');
      deleteDraft();
      setAttachments([]);
    } catch (error) {
      console.warn('Failed to send email:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setAttachments(prev => [...prev, ...files]);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleRemoveAttachment = (index: number): void => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handlePreviewAttachment = (file: File): void => {
    setPreviewFile(file);
    setIsPreviewOpen(true);
  };

  const handleToKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') {
      e.preventDefault();
      const email = toInputValue.trim().replace(',', '');
      if (email && email.includes('@') && !toEmails.includes(email)) {
        setToEmails([...toEmails, email]);
        setToInputValue('');
      }
    } else if (e.key === 'Backspace' && !toInputValue && toEmails.length > 0) {
      setToEmails(toEmails.slice(0, -1));
    }
  };

  const handleToBlur = (): void => {
    const email = toInputValue.trim().replace(',', '');
    if (email && email.includes('@') && !toEmails.includes(email)) {
      setToEmails([...toEmails, email]);
      setToInputValue('');
    }
  };

  const collapsedDisplay = useMemo(() => {
    const MAX_VISIBLE = 2;
    const allUniqueEmails = Array.from(new Set([...toEmails, ...ccEmails, ...bccEmails]));
    const visibleEmails = allUniqueEmails.slice(0, MAX_VISIBLE);
    const remainingCount = allUniqueEmails.length - MAX_VISIBLE;
    return { visibleEmails, remainingCount: remainingCount > 0 ? remainingCount : 0 };
  }, [toEmails, ccEmails, bccEmails]);

  // Input refs for Cc and Bcc
  const ccInputRef = React.useRef<HTMLInputElement>(null);
  const bccInputRef = React.useRef<HTMLInputElement>(null);
  const [ccInputValue, setCcInputValue] = useState<string>('');
  const [bccInputValue, setBccInputValue] = useState<string>('');

  const handleCcKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') {
      e.preventDefault();
      const email = ccInputValue.trim().replace(',', '');
      if (email && email.includes('@') && !ccEmails.includes(email)) {
        setCcEmails([...ccEmails, email]);
        setCcInputValue('');
      }
    } else if (e.key === 'Backspace' && !ccInputValue && ccEmails.length > 0) {
      setCcEmails(ccEmails.slice(0, -1));
    }
  };

  const handleBccKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') {
      e.preventDefault();
      const email = bccInputValue.trim().replace(',', '');
      if (email && email.includes('@') && !bccEmails.includes(email)) {
        setBccEmails([...bccEmails, email]);
        setBccInputValue('');
      }
    } else if (e.key === 'Backspace' && !bccInputValue && bccEmails.length > 0) {
      setBccEmails(bccEmails.slice(0, -1));
    }
  };

  // Handle expand - auto-show Cc/Bcc if they have emails
  const handleExpand = (): void => {
    setIsExpanded(true);
    if (ccEmails.length > 0) {
      setShowCc(true);
    }
    if (bccEmails.length > 0) {
      setShowBcc(true);
    }
  };

  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onClose) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const target = e.target as Node | null;
      if (target && composerRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
        if (emailContent) saveDraft(emailContent);
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose, emailContent, saveDraft]);

  return (
    <div className='w-full p-4' ref={composerRef}>
      <div
        className={`border border-border rounded-xl relative ${isSending ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <div className='px-4 pt-3'>
          {!isExpanded ? (
            <button
              type='button'
              className='w-full flex items-center gap-2 cursor-pointer text-left py-1'
              onClick={handleExpand}
              data-track-category='SUPPORT'
              data-track-name='ExpandReplyComposer'
              data-track-metadata={JSON.stringify({
                toCount: toEmails.length,
                ccCount: ccEmails.length,
                bccCount: bccEmails.length,
                conversationId,
                draftEmailId: draftId,
              })}
            >
              <ReplyAll size={16} className='text-foreground flex-shrink-0' />
              <span className='text-sm text-foreground font-medium'>Reply to</span>
              <div className='flex items-center gap-1.5 flex-wrap flex-1'>
                {collapsedDisplay.visibleEmails.map(email => (
                  <span key={email} className='text-sm text-foreground'>
                    &lt;{email}&gt;
                  </span>
                ))}
                {collapsedDisplay.remainingCount > 0 && (
                  <span className='text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded hover:bg-border'>
                    {collapsedDisplay.remainingCount} more
                  </span>
                )}
              </div>
            </button>
          ) : (
            <>
              <div className='flex items-start gap-2'>
                <button
                  type='button'
                  onClick={() => setIsExpanded(false)}
                  className='flex-shrink-0 p-0.5 hover:bg-muted rounded transition-colors mt-0.5'
                  title='Collapse'
                  data-track-category='SUPPORT'
                  data-track-name='CollapseReplyComposer'
                  data-track-metadata={JSON.stringify({
                    toEmails: toEmails,
                    ccEmails: ccEmails,
                    bccEmails: bccEmails,
                    conversationId,
                    draftEmailId: draftId,
                  })}
                >
                  <ReplyAll size={16} className='text-muted-foreground' />
                </button>
                <span className='text-sm text-foreground font-medium flex-shrink-0 mt-1'>To</span>

                <div
                  className='flex-1 flex flex-wrap items-center gap-1.5 cursor-text min-h-[28px]'
                  onClick={() => toInputRef.current?.focus()}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toInputRef.current?.focus();
                    }
                  }}
                  role='button'
                  tabIndex={0}
                  data-track-category='SUPPORT'
                  data-track-name='FocusToField'
                  data-track-metadata={JSON.stringify({
                    toEmails: toEmails,
                    ccEmails: ccEmails,
                    bccEmails: bccEmails,
                    conversationId,
                    draftEmailId: draftId,
                  })}
                >
                  {toEmails.map(email => (
                    <EmailTagWithAvatar
                      key={email}
                      email={email}
                      onRemove={() => setToEmails(toEmails.filter(e => e !== email))}
                      disabled={isSending}
                      users={users}
                    />
                  ))}
                  <input
                    ref={toInputRef}
                    type='text'
                    value={toInputValue}
                    onChange={e => setToInputValue(e.target.value)}
                    onKeyDown={handleToKeyDown}
                    onBlur={handleToBlur}
                    placeholder={toEmails.length === 0 ? 'Add recipients...' : ''}
                    className='flex-1 min-w-[80px] text-sm py-1 outline-none bg-transparent'
                    disabled={isSending}
                    data-track-category='SUPPORT'
                    data-track-name='EditToField'
                    data-track-metadata={JSON.stringify({
                      toEmails: toEmails,
                      ccEmails: ccEmails,
                      bccEmails: bccEmails,
                      conversationId,
                      draftEmailId: draftId,
                    })}
                  />
                </div>

                {/* Cc/Bcc buttons on the right - Gmail style */}
                <div className='flex items-center gap-1 flex-shrink-0 mt-0.5'>
                  {!showCc && (
                    <button
                      onClick={() => setShowCc(true)}
                      className='text-sm text-muted-foreground hover:text-foreground px-1 transition-colors'
                      data-track-category='SUPPORT'
                      data-track-name='ShowCcField'
                      data-track-metadata={JSON.stringify({
                        ccMails: ccEmails,
                        bccCount: bccEmails.length,
                        conversationId,
                        draftEmailId: draftId,
                      })}
                    >
                      Cc
                    </button>
                  )}
                  {!showBcc && (
                    <button
                      onClick={() => setShowBcc(true)}
                      className='text-sm text-muted-foreground hover:text-foreground px-1 transition-colors'
                      data-track-category='SUPPORT'
                      data-track-name='ShowBccField'
                      data-track-metadata={JSON.stringify({
                        ccCount: ccEmails.length,
                        bccEmails: bccEmails,
                        conversationId,
                        draftEmailId: draftId,
                      })}
                    >
                      Bcc
                    </button>
                  )}
                </div>
              </div>

              {showCc && (
                <div className='flex items-start gap-2 mt-1'>
                  <div className='w-[20px] flex-shrink-0' />
                  <span className='text-sm text-foreground font-medium flex-shrink-0 mt-1'>Cc</span>
                  <div
                    className='flex-1 flex flex-wrap items-center gap-1.5 min-h-[28px] cursor-text'
                    onClick={() => ccInputRef.current?.focus()}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        ccInputRef.current?.focus();
                      }
                    }}
                    role='button'
                    tabIndex={0}
                    data-track-category='SUPPORT'
                    data-track-name='FocusCcField'
                    data-track-metadata={JSON.stringify({
                      ccCount: ccEmails.length,
                      bccCount: bccEmails.length,
                      conversationId,
                      draftEmailId: draftId,
                    })}
                  >
                    {ccEmails.map(email => (
                      <EmailTagWithAvatar
                        key={email}
                        email={email}
                        onRemove={() => setCcEmails(ccEmails.filter(e => e !== email))}
                        disabled={isSending}
                        users={users}
                      />
                    ))}
                    <input
                      ref={ccInputRef}
                      type='text'
                      value={ccInputValue}
                      onChange={e => setCcInputValue(e.target.value)}
                      onKeyDown={handleCcKeyDown}
                      onBlur={() => {
                        const email = ccInputValue.trim().replace(',', '');
                        if (email && email.includes('@') && !ccEmails.includes(email)) {
                          setCcEmails([...ccEmails, email]);
                          setCcInputValue('');
                        }
                      }}
                      placeholder={ccEmails.length === 0 ? 'Add recipients...' : ''}
                      className='flex-1 min-w-[80px] text-sm py-1 outline-none bg-transparent'
                      disabled={isSending}
                      data-track-category='SUPPORT'
                      data-track-name='EditCcField'
                      data-track-metadata={JSON.stringify({
                        ccEmails: ccEmails,
                        bccCount: bccEmails.length,
                        conversationId,
                        draftEmailId: draftId,
                      })}
                    />
                  </div>
                </div>
              )}

              {showBcc && (
                <div className='flex items-start gap-2 mt-1'>
                  <div className='w-[20px] flex-shrink-0' />
                  <span className='text-sm text-foreground font-medium flex-shrink-0 mt-1'>
                    Bcc
                  </span>
                  <div
                    className='flex-1 flex flex-wrap items-center gap-1.5 min-h-[28px] cursor-text'
                    onClick={() => bccInputRef.current?.focus()}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        bccInputRef.current?.focus();
                      }
                    }}
                    role='button'
                    tabIndex={0}
                    data-track-category='SUPPORT'
                    data-track-name='FocusBccField'
                    data-track-metadata={JSON.stringify({
                      bccCount: bccEmails,
                      conversationId,
                      draftEmailId: draftId,
                    })}
                  >
                    {bccEmails.map(email => (
                      <EmailTagWithAvatar
                        key={email}
                        email={email}
                        onRemove={() => setBccEmails(bccEmails.filter(e => e !== email))}
                        disabled={isSending}
                        users={users}
                      />
                    ))}
                    <input
                      ref={bccInputRef}
                      type='text'
                      value={bccInputValue}
                      onChange={e => setBccInputValue(e.target.value)}
                      onKeyDown={handleBccKeyDown}
                      onBlur={() => {
                        const email = bccInputValue.trim().replace(',', '');
                        if (email && email.includes('@') && !bccEmails.includes(email)) {
                          setBccEmails([...bccEmails, email]);
                          setBccInputValue('');
                        }
                      }}
                      placeholder={bccEmails.length === 0 ? 'Add recipients...' : ''}
                      data-track-category='SUPPORT'
                      data-track-name='EditBccField'
                      data-track-metadata={JSON.stringify({
                        bccEmails: bccEmails,
                        conversationId,
                        draftEmailId: draftId,
                      })}
                      className='flex-1 min-w-[80px] text-sm py-1 outline-none bg-transparent'
                      disabled={isSending}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {aiDraft.isDraftActive ? (
          <DraftCard
            draftContent={aiDraft.draftContent}
            isStreaming={aiDraft.isStreaming}
            onAccept={() => {
              const content = aiDraft.acceptDraft();
              setEmailContent(content);
              setHasAcceptedDraft(true);
            }}
            onReject={() => {
              aiDraft.rejectDraft();
              setEmailContent('');
              deleteDraft();
            }}
            onRefine={(instruction: string) => aiDraft.refineDraft(instruction)}
          />
        ) : (
          <TextareaAutosize
            minRows={5}
            maxRows={20}
            placeholder='Compose email...'
            value={emailContent}
            onChange={e => setEmailContent(e.target.value)}
            onBlur={() => saveDraft(emailContent)}
            className='w-full px-4 py-3 focus:outline-none text-sm resize-none'
            disabled={isSending}
          />
        )}

        {/* Attachments section */}
        {attachments.length > 0 && (
          <div className='px-4 pb-3'>
            <div className='flex flex-wrap gap-2'>
              {attachments.map((file, index) => (
                <AttachmentPreview
                  key={`${file.name}-${file.size}-${index}`}
                  file={file}
                  onRemove={() => handleRemoveAttachment(index)}
                  onPreview={() => handlePreviewAttachment(file)}
                  isUploading={isUploadingAttachments && index === attachments.length - 1}
                />
              ))}
            </div>
          </div>
        )}

        {selectedSignatureId && (
          <div className='px-4 pb-3'>
            <div className='border-t border-border pt-2'>
              <p className='text-xs text-muted-foreground mb-1'>--</p>
              <div
                className='text-sm text-muted-foreground prose prose-sm max-w-none'
                dangerouslySetInnerHTML={{
                  __html: signatures?.find(s => s.id === selectedSignatureId)?.content ?? '',
                }}
              />
            </div>
          </div>
        )}

        <div className='px-4 py-3 flex items-center justify-between border-t border-border'>
          <div className='flex items-center gap-2'>
            {/* Attachment button */}
            <div>
              <input
                ref={fileInputRef}
                type='file'
                multiple
                className='hidden'
                onChange={handleFileSelect}
                disabled={isSending || isUploadingAttachments}
              />
              <button
                type='button'
                onClick={() => fileInputRef.current?.click()}
                disabled={isSending || isUploadingAttachments}
                className='p-2 hover:bg-muted rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                title='Attach files'
                aria-label='Attach files'
                data-track-category='SUPPORT'
                data-track-name='AddEmailAttachment'
                data-track-metadata={JSON.stringify({
                  conversationId,
                  attachmentCount: attachments.length,
                })}
              >
                <Paperclip size={18} className='text-muted-foreground' />
              </button>
            </div>

            {/* Signature selector */}
            {signatures.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className='flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors'
                    title={
                      selectedSignatureId
                        ? (signatures.find(s => s.id === selectedSignatureId)?.name ?? 'Signature')
                        : 'No signature'
                    }
                    data-track-category='email-compose'
                    data-track-name='select-signature'
                  >
                    <PenLine size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' side='top'>
                  <DropdownMenuItem
                    onClick={() => void composerNavigate('/support?openSettings=signatures')}
                    className='text-xs text-muted-foreground'
                  >
                    Manage signatures
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setSelectedSignatureId(null)}
                    className={!selectedSignatureId ? 'font-medium' : ''}
                  >
                    No signature
                  </DropdownMenuItem>
                  {signatures.map(sig => (
                    <DropdownMenuItem
                      key={sig.id}
                      onClick={() => setSelectedSignatureId(sig.id)}
                      className={selectedSignatureId === sig.id ? 'font-medium' : ''}
                    >
                      {sig.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                type='button'
                onClick={() => void composerNavigate('/support?openSettings=signatures')}
                className='flex items-center gap-1 text-xs text-[#6276be] hover:text-[#4f62a8] transition-colors'
                data-track-category='email-compose'
                data-track-name='add-signature'
              >
                + Add signature
              </button>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {/* Ask AI button */}
            {onToggleAIPanel && (
              <button
                type='button'
                onClick={onToggleAIPanel}
                className={cn(
                  'size-8 flex items-center justify-center rounded-full transition-colors',
                  isAIPanelOpen
                    ? 'bg-violet-100 text-violet-600'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                title='Ask AI'
                aria-label='Toggle Ask AI panel'
                data-track-category='Support'
                data-track-name='ToggleAIPanel'
              >
                <Sparkles size={16} />
              </button>
            )}

            {/* Draft button */}
            <button
              type='button'
              onClick={() => {
                aiDraft.triggerDraft(emails as Email[]);
              }}
              disabled={aiDraft.isStreaming || !emails?.length}
              className='flex items-center gap-1 px-2.5 h-8 rounded-full text-sm text-muted-foreground hover:bg-violet-50 hover:text-violet-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
              title='Generate AI draft reply'
              aria-label='Draft reply with AI'
              data-track-category='Support'
              data-track-name='TriggerAIDraft'
            >
              <Wand2 size={14} />
              <span className='text-xs font-medium'>Draft</span>
            </button>

            {/* Inline refine after draft accepted */}
            {hasAcceptedDraft && emailContent && (
              <div className='w-48'>
                <RefineInput
                  onSubmit={(instruction: string) => {
                    aiDraft.refineDraft(instruction);
                    setHasAcceptedDraft(false);
                  }}
                  disabled={aiDraft.isStreaming}
                  placeholder='Refine draft...'
                />
              </div>
            )}

            {onClose && (
              <>
                <button
                  className='size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                  onClick={() => {
                    if (emailContent) saveDraft(emailContent);
                    onClose();
                  }}
                  disabled={isSending}
                  aria-label='Minimize reply'
                  title='Minimize (keeps draft)'
                  data-track-category='Support'
                  data-track-name='MinimizeReplyComposer'
                >
                  <Minimize2 size={16} />
                </button>
                <button
                  className='size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors'
                  onClick={() => {
                    deleteDraft();
                    setEmailContent('');
                    setAttachments([]);
                    onClose();
                  }}
                  disabled={isSending}
                  aria-label='Discard reply'
                  title='Discard draft'
                  data-track-category='Support'
                  data-track-name='DiscardReplyComposer'
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
            <button
              className='size-8 flex items-center justify-center rounded-full bg-muted-foreground text-background hover:bg-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              onClick={() => void handleSendEmail()}
              disabled={
                !emailContent.trim() || !conversationId || isSending || toEmails.length === 0
              }
              aria-label='Send email'
              data-track-category='Support'
              data-track-name='SendEmailReply'
              data-track-metadata={JSON.stringify({
                conversationId,
                attachmentCount: attachments.length,
              })}
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

      {/* Media viewer for attachment preview */}
      {previewFile && (
        <MediaViewer
          file={previewFile}
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            setPreviewFile(null);
          }}
        />
      )}
    </div>
  );
};

SupportScreen.displayName = 'SupportScreen';

export default SupportScreen;
