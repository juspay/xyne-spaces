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
  // Split,  // DISABLED: used by commented-out demerge-email button
  Paperclip,
  Link as LinkIcon,
  Settings,
  Signature,
  Minimize2,
  Trash2,
  Plus,
  Wand2,
  Sparkles,
  Loader2,
  Users2,
  Lock,
  Hash,
  Inbox,
} from 'lucide-react';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import Tooltip from '../../components/ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { ChannelVisibility } from '@xyne/shared';
import React, { ReactElement, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '../../utils/classNames';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { QueryResultType } from '@rocicorp/zero';
import ThreadList from '../../components/Chat/ThreadList/ThreadList';
import { ChatInput } from '../../components/Chat/ChatInput/ChatInput';
import {
  useChannel,
  useGetChannelUserStatus,
  useEmailChannels,
  useUserChannelStatuses,
} from '../../hooks/useChannels';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import { useRefetchExternalSource } from '../../hooks/useRefetchExternalSource';
import { useUsers } from '../../hooks/useUsers';
import * as Popover from '@radix-ui/react-popover';
import { UserSubmenu } from '../../components/Tickets/TicketFilters/Submenus/UserSubmenu/UserSubmenu';
import { PrioritySubmenu } from '../../components/Tickets/TicketFilters/Submenus/PrioritySubmenu/PrioritySubmenu';
import { StagesSubmenu } from '../../components/Tickets/TicketFilters/Submenus/StagesSubmenu/StagesSubmenu';
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
import Badge from '../../components/ui/Badge';
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
import { TicketPriority } from '@xyne/shared';
import type { Ticket } from '@xyne/shared';
import { getDraft } from '../../hooks/useDraft';
import { useShortcut } from '../../shortcuts';
import { v4 as uuidv4 } from 'uuid';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { AssigneePicker } from '../../components/Tickets/TicketListView/AssigneePicker';
import { StagePicker } from '../../components/Tickets/TicketListView/StagePicker';
import { PriorityPicker } from '../../components/Tickets/TicketListView/PriorityPicker';
import { EmailTagWithAvatar } from '../../components/xyne-desk/EmailTagWithAvatar/EmailTagWithAvatar';
import { EmailBodyRenderer } from '../../components/xyne-desk/EmailBody/EmailBodyRenderer';
import { EmailThreadHeader } from '../../components/xyne-desk/EmailBody/EmailThreadHeader';
import { useEmailDraft, useEmailDraftOperations } from '../../hooks/useEmailDraft';
import { useMarkEmailRead } from '../../hooks/useMarkEmailRead';
import { AttachmentPreview } from '../../components/ui/files/AttachmentPreview';
import { MediaViewer } from '../../components/ui/files';
import { formatFileSize } from '../../components/ui/utils/files';
import { createPreviewUrl, downloadFile } from '../../services/clients/fileFetchService';
import { attachmentViewerActor, type AttachmentRef } from '../../machines/attachmentViewerMachine';
import { SignatureEditor } from '../../components/xyne-desk/SignatureEditor/SignatureEditor';
import { InboxAssigneeSettings } from '../../components/xyne-desk/InboxAssigneeSettings/InboxAssigneeSettings';
import { useEmailChannelPreference } from '../../hooks/useEmailChannelPreference';
import AddChannelForm from '../../components/Chat/AddChannelForm/AddChannelForm';
import Info, { ChannelTab } from '../../components/Chat/Info/Info';
import { useVisibleChannel } from '../../hooks/useChannels';
import { API_BASE_URL, SHAREABLE_ORIGIN } from '../../config';
import Dialog from '../../components/ui/Dialog';
import { useMutation } from '@tanstack/react-query';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useSelector } from '@xstate/react';
import { useAskAiTicketContext } from '../../hooks/useAskAiTicketContext';
import { DraftCard } from '../../components/xyne-desk/DraftCard/DraftCard';
import { RefineInput } from '../../components/xyne-desk/RefineInput/RefineInput';
import { useDeskAIDraft } from '../../hooks/useDeskAIDraft';
import { channelService, CreateChannelFormData } from '../../services/Chat/channelService';
import { summarizeEmailThread } from '../../services/summarizeService';
import { markdownToHtml } from '../../utils/clipboardUtils';
import { CallParticipantsSelectionModal } from '../../components/Call/CallParticipantsSelectionModal';
import { ScheduleCallModal } from '../../components/Call/ScheduleCallModal/ScheduleCallModal';
import { ThreadCallButton } from '../../components/Call/ThreadCallButton/ThreadCallButton';

// Unified type for tickets from the supportTicketsFiltered query
type SupportTicket = QueryResultType<typeof queries.supportTicketsFilteredV2>[number];

const toStageColumn = (stage: { id: string; name: string; sequenceNumber?: number }) => ({
  id: stage.id,
  name: stage.name,
  color: getStageColor(stage.name.toLowerCase().replace(/\s+/g, '_')),
  ...(stage.sequenceNumber !== undefined && { sequenceNumber: stage.sequenceNumber }),
});

const ChannelInfoModal = ({
  channelId,
  isOpen,
  defaultTab,
  onClose,
}: {
  channelId: string;
  isOpen: boolean;
  defaultTab: ChannelTab;
  onClose: () => void;
}): ReactElement | null => {
  const channel = useVisibleChannel(channelId);
  if (!channel) return null;
  return (
    <Dialog
      className='max-w-[496px] rounded-2xl overflow-hidden'
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <Info channel={channel} defaultTab={defaultTab} onClose={onClose} />
    </Dialog>
  );
};

const ALL_CHANNELS_ID = 'all';

// Email attachment limits — kept in sync with backend/src/routes/email.ts
const MAX_EMAIL_ATTACHMENT_FILES = 10;
const MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB per file

type Email = NonNullable<
  NonNullable<QueryResultType<typeof queries.supportTicketRowV2>>['emails']
>[number];

/**
 * Image thumbnail: authenticated blob fetch via `createPreviewUrl` (same path
 * MessageAttachment uses for chat images), rendered as an object URL.
 */
const EmailImageThumbnail = ({
  attachmentId,
  filename,
}: {
  attachmentId: string;
  filename: string;
}): ReactElement => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    void (async (): Promise<void> => {
      try {
        const blob = await createPreviewUrl(attachmentId);
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        /* fall through — loading placeholder stays */
      }
    })();
    return (): void => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId]);

  if (!url) {
    return (
      <div className='h-28 w-28 flex items-center justify-center animate-pulse bg-muted'>
        <Paperclip size={20} className='text-muted-foreground' />
      </div>
    );
  }
  return <img src={url} alt={filename} className='h-28 w-28 object-cover' />;
};

/**
 * Renders attachment previews for a single email. Only mounted by the parent
 * when `email.hasAttachment` is true, so emails without files skip the
 * attachments round-trip entirely (Zero caches subsequent mounts).
 *
 * Image clicks open the shared `attachmentViewerActor` — same gallery/viewer
 * the chat MessageAttachment uses (zoom, pan, next/prev). Non-image clicks
 * download the file via the standard `downloadFile` helper.
 */
const EmailAttachmentsRow = ({
  attachments: rows,
  conversationId,
  channelId,
}: {
  attachments: NonNullable<Email['attachments']>;
  conversationId?: string;
  channelId?: string;
}): ReactElement | null => {
  if (!rows || rows.length === 0) return null;

  const images: AttachmentRef[] = rows
    .filter(r => typeof r.mimetype === 'string' && r.mimetype.startsWith('image/'))
    .map(r => ({
      attachmentId: r.id,
      fileName: r.originalFilename,
      fileUrl: `/attachments/${r.id}/download`,
      mimeType: r.mimetype,
      fileSize: r.size ?? 0,
      ...(conversationId && { conversationId }),
      ...(channelId && { channelId }),
    }));

  const openImageGallery = (attachmentId: string): void => {
    const startIndex = images.findIndex(i => i.attachmentId === attachmentId);
    attachmentViewerActor.send({
      type: 'OPEN',
      attachments: images,
      ...(startIndex >= 0 && { startIndex }),
    });
  };

  return (
    <div className='mt-3 flex flex-wrap gap-2'>
      {rows.map(att => {
        const isImage = typeof att.mimetype === 'string' && att.mimetype.startsWith('image/');
        const sizeLabel = att.size ? formatFileSize(att.size) : '';

        if (isImage) {
          return (
            <button
              key={att.id}
              type='button'
              onClick={() => openImageGallery(att.id)}
              title={att.originalFilename}
              data-track-category='Support'
              data-track-name='OpenEmailAttachmentImage'
              className='group relative block rounded-lg overflow-hidden border border-border bg-muted hover:border-foreground/40 transition-colors'
            >
              <EmailImageThumbnail attachmentId={att.id} filename={att.originalFilename} />
              <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity truncate text-left'>
                {att.originalFilename}
              </div>
            </button>
          );
        }

        return (
          <button
            key={att.id}
            type='button'
            onClick={() => {
              void downloadFile(att.id, att.originalFilename).catch(() => undefined);
            }}
            title={att.originalFilename}
            data-track-category='Support'
            data-track-name='DownloadEmailAttachment'
            className='flex items-center gap-2 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs text-foreground transition-colors min-w-0 max-w-[260px]'
          >
            <Paperclip size={14} className='text-muted-foreground shrink-0' />
            <span className='flex flex-col min-w-0 text-left'>
              <span className='truncate font-medium'>{att.originalFilename}</span>
              {sizeLabel && <span className='text-[10px] text-muted-foreground'>{sizeLabel}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// API response type for email demerge endpoint
// DISABLED: demerge-email feature commented out — kept for easy re-enable.

// interface DemergeEmailResponse {
//   success: boolean;
//   newTicket: {
//     ticketId: string;
//     xyneId: string;
//     conversationId: string;
//   };
// }
type TabType = 'messages' | 'details';

type ViewMode = 'kanban' | 'list';

const SupportScreen = (): ReactElement => {
  const { channelId: channelIdParam, ticketId } = useParams<{
    channelId?: string;
    ticketId?: string;
  }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const zero = useZero();
  const { userID } = useAuthContextValues();
  const { isMobile } = usePlatform();
  const [showMyTicketsOnly, setShowMyTicketsOnly] = useState(false);
  // Channel selection is sourced strictly from the URL path (/support/:channelId).
  // A bare /support visit renders the empty state prompting the user to pick one.
  const selectedChannelId = channelIdParam ?? null;

  // Fetch email channel preference for assignee user group and boardId
  const emailChannelPreference = useEmailChannelPreference(selectedChannelId);

  // Fetch stages for the board configured in email channel preference
  const boardId = emailChannelPreference?.boardId;
  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: boardId || '' }), {
    enabled: !!boardId,
  });

  const setSelectedChannelId = useCallback(
    (next: string | null): void => {
      // Preserve non-routing query params (settings, openSettings, etc.).
      const qs = searchParams.toString();
      const path = next ? `/support/${next}` : '/support';
      void navigate(qs ? `${path}?${qs}` : path, { replace: true });
    },
    [navigate, searchParams],
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('support-sidebar-open');
    return saved ? saved === 'true' : true;
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('support-view-mode');
    return (saved as ViewMode) || 'list';
  });
  const [selectedPriorities, setSelectedPriorities] = useState<TicketPriority[]>([]);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [assigneeFilterOpen, setAssigneeFilterOpen] = useState(false);
  const [priorityFilterOpen, setPriorityFilterOpen] = useState(false);
  const [stageFilterOpen, setStageFilterOpen] = useState(false);

  // Build the filter args once — reused by both the kanban query and the list view.
  // "My Tickets" toggle is the assignee fallback when the explicit assignee filter is empty.
  const ticketFilter = useMemo(
    () => ({
      assignedTo:
        selectedAssignees.length > 0 ? selectedAssignees : showMyTicketsOnly ? [userID] : undefined,
      priority: selectedPriorities.length > 0 ? selectedPriorities : undefined,
      stageName: selectedStages.length > 0 ? selectedStages : undefined,
    }),
    [selectedAssignees, selectedPriorities, selectedStages, showMyTicketsOnly, userID],
  );

  const hasActiveFilters =
    showMyTicketsOnly ||
    selectedPriorities.length > 0 ||
    selectedStages.length > 0 ||
    selectedAssignees.length > 0;

  const clearAllFilters = useCallback(() => {
    setShowMyTicketsOnly(false);
    setSelectedPriorities([]);
    setSelectedStages([]);
    setSelectedAssignees([]);
  }, []);

  const [isSettingsOpen, setIsSettingsOpen] = useState(
    () =>
      searchParams.get('settings') === 'open' || searchParams.get('openSettings') === 'signatures',
  );
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [infoDefaultTab, setInfoDefaultTab] = useState<ChannelTab>('about');

  // Reset stage filter when channel changes (different channels may have different stages)
  useEffect(() => {
    setSelectedStages([]);
  }, [selectedChannelId]);

  useEffect(() => {
    const emailError = searchParams.get('emailError');
    const emailConnected = searchParams.get('emailConnected');
    const channelFromCallback = searchParams.get('channel');

    if (emailConnected === 'true') {
      const provider = searchParams.get('provider') ?? 'Email';
      toast.success(
        `${provider.charAt(0).toUpperCase() + provider.slice(1)} channel connected successfully`,
      );
      if (channelFromCallback) {
        void navigate(`/support/${channelFromCallback}`, { replace: true });
      } else {
        setSearchParams(
          prev => {
            const p = new URLSearchParams(prev);
            p.delete('emailConnected');
            p.delete('provider');
            p.delete('channel');
            return p;
          },
          { replace: true },
        );
      }
    } else if (emailError) {
      toast.error(emailError);
      if (channelFromCallback) {
        void navigate(`/support/${channelFromCallback}`, { replace: true });
      } else {
        setSearchParams(
          prev => {
            const p = new URLSearchParams(prev);
            p.delete('emailError');
            p.delete('channel');
            return p;
          },
          { replace: true },
        );
      }
    }
  }, [searchParams, setSearchParams, navigate]);

  // Sync panel open/close with the URL so back button works correctly
  useEffect(() => {
    const isOpen =
      searchParams.get('settings') === 'open' || searchParams.get('openSettings') === 'signatures';
    setIsSettingsOpen(isOpen);
    // Clean up the openSettings param (used by "Add signature" deep-link)
    if (searchParams.get('openSettings') === 'signatures') {
      const base = selectedChannelId ? `/support/${selectedChannelId}` : '/support';
      void navigate(`${base}?settings=open`, { replace: true });
    }
  }, [searchParams, navigate, selectedChannelId]);

  useEffect(() => {
    localStorage.setItem('support-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('support-sidebar-open', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  // Fetch EMAIL channels using hook (from state machine, already loaded)
  const emailChannels = useEmailChannels();

  // Unified query: channel-scoped tickets. Only needed for Kanban view; list
  // view uses paginated supportTicketsPage via TicketListView.
  const kanbanChannelUserStatus = useGetChannelUserStatus(selectedChannelId ?? '');
  const kanbanIsMember = !!kanbanChannelUserStatus;
  const [supportTickets] = useCachedQuery(
    queries.supportTicketsFilteredV2({
      channelId: selectedChannelId ?? '',
      isMember: kanbanIsMember,
      ...ticketFilter,
    }),
    { enabled: viewMode === 'kanban' && !!selectedChannelId },
  );

  // Email channels are already sorted by the useEmailChannels hook
  const sortedEmailChannels = emailChannels;
  const userChannelStatuses = useUserChannelStatuses();
  const unreadCounts = useAllUnreadCount();
  // Both star and joined state live on channel_user_status (per-user). A row
  // in that list for a given channelId means the user has joined the channel;
  // isStarred narrows that further.
  const { starredChannelIds, joinedChannelIds } = useMemo(() => {
    const starred = new Set<string>();
    const joined = new Set<string>();
    for (const status of userChannelStatuses) {
      joined.add(status.channelId);
      if (status.isStarred) starred.add(status.channelId);
    }
    return { starredChannelIds: starred, joinedChannelIds: joined };
  }, [userChannelStatuses]);
  const { starredEmailChannels, joinedEmailChannels, notJoinedEmailChannels } = useMemo(() => {
    const starred: typeof sortedEmailChannels = [];
    const joined: typeof sortedEmailChannels = [];
    const notJoined: typeof sortedEmailChannels = [];
    for (const c of sortedEmailChannels) {
      if (starredChannelIds.has(c.id)) starred.push(c);
      else if (joinedChannelIds.has(c.id)) joined.push(c);
      else notJoined.push(c);
    }
    return {
      starredEmailChannels: starred,
      joinedEmailChannels: joined,
      notJoinedEmailChannels: notJoined,
    };
  }, [sortedEmailChannels, starredChannelIds, joinedChannelIds]);
  // Used to gate member-only affordances (My Tickets toggle, refetch, settings)
  // and to flip the body to a Join-channel CTA when the user is on a public
  // channel they haven't joined yet.
  const isSelectedChannelJoined = !!selectedChannelId && joinedChannelIds.has(selectedChannelId);
  // A selected channelId that doesn't appear in useEmailChannels() means the
  // channel either doesn't exist or is a private channel the user isn't in —
  // in both cases we show a "Channel not found" message instead of the Join
  // CTA (there is nothing to join).
  const isSelectedChannelKnown =
    !!selectedChannelId && sortedEmailChannels.some(c => c.id === selectedChannelId);
  const selectedChannelName =
    sortedEmailChannels.find(c => c.id === selectedChannelId)?.name?.trim() || 'Xyne Desk';

  // Manual refetch — shown when a specific email channel is selected.
  // SupportScreen already filters to EMAIL channels; the hook owns its own
  // toasts and the 400 / 403 / generic-error branches.
  const refetchChannelId =
    selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID ? selectedChannelId : undefined;
  const { refetch: handleRefetch, isPending: isRefetching } =
    useRefetchExternalSource(refetchChannelId);
  const canRefetch = !!refetchChannelId;

  // Get full selected channel for member count and other stats
  const selectedChannelFull = useVisibleChannel(selectedChannelId ?? '');

  // Filters are now applied server-side via the supportTicketsFilteredV2 query
  const displayedTickets = supportTickets;

  const [localTickets, setLocalTickets] = useState<Ticket[]>([]);

  // Stages fetched dynamically from the board configured in EmailChannelPreference.
  // Empty if no board is configured — dropdown and kanban will show no stages.
  const stageColumns = useMemo(() => stages?.map(toStageColumn) ?? [], [stages]);

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
      assigneeUserGroupId?: string;
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
      if (rest.assigneeUserGroupId) {
        params.set('assigneeUserGroupId', rest.assigneeUserGroupId);
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
      if (rest.assigneeUserGroupId) {
        params.set('assigneeUserGroupId', rest.assigneeUserGroupId);
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
      const ticketUrl = `/support/${ticketData.channelId}/${ticketData.xyneId}`;

      // Only open in new tab on desktop when Cmd/Ctrl+Click is pressed
      if (!isMobile && isCmdClick) {
        window.open(ticketUrl, '_blank');
        return;
      }

      // Pass ticket details via router state for an instant first paint;
      // SupportTicketDetail also falls back to a fetch by xyneId when state
      // is absent (direct URL load / refresh).
      void navigate(ticketUrl, {
        state: {
          conversationId: ticketData.conversationId,
          ticketId: ticketData.id,
        },
      });
    },
    [navigate, isMobile],
  );

  const renderChannelRow = (c: (typeof sortedEmailChannels)[number]): ReactElement => {
    const isActive = selectedChannelId === c.id;
    const isPrivate = c.visibility === ChannelVisibility.PRIVATE;
    const unreadCount = unreadCounts[c.id] ?? 0;
    return (
      <div
        key={c.id}
        role='button'
        tabIndex={0}
        className={cn(
          'flex items-center gap-1.5 h-8 rounded-md px-1.5 cursor-pointer transition-colors',
          isActive
            ? 'text-sidebar-primary-foreground font-medium bg-sidebar-item-active'
            : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover',
        )}
        onClick={() => setSelectedChannelId(c.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedChannelId(c.id);
          }
        }}
        data-track-category='Support'
        data-track-name='SelectEmailChannel'
      >
        <span className='flex items-center flex-shrink-0'>
          {isPrivate ? (
            <Lock size={12} className={isActive ? 'text-[#1D1E1F]' : 'text-[#464C53]'} />
          ) : (
            <Hash size={12} className={isActive ? 'text-[#1D1E1F]' : 'text-[#464C53]'} />
          )}
        </span>
        <span
          className={cn(
            'text-sm flex-1 truncate min-w-0',
            unreadCount > 0 && !isActive && 'font-semibold text-sidebar-primary-foreground',
          )}
        >
          {c.name?.trim() || 'Unnamed Channel'}
        </span>
        {unreadCount > 0 && (
          <Badge className='font-mono h-[18px] bg-sidebar-badge-accent px-1.5 text-sidebar-badge-accent-foreground'>
            {unreadCount > 9 ? '9+' : unreadCount}
          </Badge>
        )}
      </div>
    );
  };

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
              <div className='h-full flex flex-col bg-sidebar outline-none'>
                {/* Header */}
                <div className='flex-shrink-0 h-14 sticky top-0 z-50 bg-sidebar border-b border-border flex items-center'>
                  <div className='px-4 flex items-center justify-between w-full'>
                    <h2 className='text-foreground font-inter text-base font-semibold leading-normal'>
                      Desks
                    </h2>
                    <div className='flex items-center gap-1'>
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
                      <button
                        onClick={() => setIsSidebarOpen(false)}
                        className='p-2 hover:bg-muted rounded-md transition-colors'
                        aria-label='Collapse sidebar'
                        title='Collapse sidebar'
                        data-track-category='Support'
                        data-track-name='CollapseChannelsSidebar'
                      >
                        <ChevronDown className='size-4 text-muted-foreground' />
                      </button>
                    </div>
                  </div>
                </div>
                {/* Scrollable channel list */}
                <div className='flex-1 overflow-y-auto px-3 py-4'>
                  {sortedEmailChannels.length === 0 ? (
                    <div className='flex flex-col items-center justify-center h-32 text-muted-foreground text-sm px-4 text-center'>
                      No channels available
                    </div>
                  ) : (
                    <div className='flex flex-col gap-4'>
                      {starredEmailChannels.length > 0 && (
                        <div>
                          <div className='px-1.5 mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                            Starred
                          </div>
                          <div className='space-y-0.5'>
                            {starredEmailChannels.map(c => renderChannelRow(c))}
                          </div>
                        </div>
                      )}
                      {joinedEmailChannels.length > 0 && (
                        <div>
                          <div className='px-1.5 mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                            Joined
                          </div>
                          <div className='space-y-0.5'>
                            {joinedEmailChannels.map(c => renderChannelRow(c))}
                          </div>
                        </div>
                      )}
                      {notJoinedEmailChannels.length > 0 && (
                        <div>
                          <div className='px-1.5 mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                            Not joined
                          </div>
                          <div className='space-y-0.5'>
                            {notJoinedEmailChannels.map(c => renderChannelRow(c))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
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
                  {selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID ? (
                    <button
                      onClick={() => {
                        setInfoDefaultTab('about');
                        setIsInfoOpen(true);
                      }}
                      className='text-base font-semibold hover:underline tracking-[-0.17px] flex items-center gap-1 truncate'
                      data-track-category='Support'
                      data-track-name='OpenChannelInfo'
                    >
                      {selectedChannelName}
                    </button>
                  ) : (
                    <span className='truncate'>{selectedChannelName}</span>
                  )}
                </div>
                <div className='flex items-center gap-2'>
                  {isSelectedChannelJoined && (
                    <>
                      <button
                        onClick={() => setShowMyTicketsOnly(!showMyTicketsOnly)}
                        className={cn(
                          'inline-flex items-center h-8 px-3 py-2 text-sm font-medium whitespace-nowrap rounded-md border border-input shadow-xs transition-[color,box-shadow] outline-none',
                          showMyTicketsOnly
                            ? 'text-primary bg-border'
                            : 'bg-transparent text-muted-foreground hover:text-foreground',
                        )}
                        data-track-category='Support'
                        data-track-name='ToggleMyTickets'
                        data-track-metadata={JSON.stringify({
                          showMyTicketsOnly: !showMyTicketsOnly,
                        })}
                      >
                        My Tickets
                      </button>

                      {/* Priority Filter — dropdown with multi-select submenu */}
                      <Popover.Root open={priorityFilterOpen} onOpenChange={setPriorityFilterOpen}>
                        <Popover.Trigger asChild>
                          <button
                            type='button'
                            className={cn(
                              'inline-flex items-center justify-between gap-2 w-[130px] h-8 px-3 text-sm font-medium rounded-md border border-input shadow-xs whitespace-nowrap transition-[color,box-shadow] outline-none',
                              selectedPriorities.length > 0
                                ? 'text-primary bg-border'
                                : 'bg-transparent text-foreground hover:text-foreground',
                            )}
                          >
                            <span className='truncate'>
                              {selectedPriorities.length > 0
                                ? `${selectedPriorities.length} selected`
                                : 'Priority'}
                            </span>
                            <ChevronDown
                              className={cn(
                                'w-4 h-4 opacity-50 shrink-0 transition-transform',
                                priorityFilterOpen && 'rotate-180',
                              )}
                            />
                          </button>
                        </Popover.Trigger>
                        <Popover.Content
                          side='bottom'
                          align='start'
                          sideOffset={6}
                          className='z-[60]'
                        >
                          <PrioritySubmenu
                            selectedPriorities={selectedPriorities}
                            onChange={setSelectedPriorities}
                          />
                        </Popover.Content>
                      </Popover.Root>

                      {/* Stage Filter — dropdown with searchable multi-select */}
                      <Popover.Root open={stageFilterOpen} onOpenChange={setStageFilterOpen}>
                        <Popover.Trigger asChild>
                          <button
                            type='button'
                            className={cn(
                              'inline-flex items-center justify-between gap-2 w-[130px] h-8 px-3 text-sm font-medium rounded-md border border-input shadow-xs whitespace-nowrap transition-[color,box-shadow] outline-none',
                              selectedStages.length > 0
                                ? 'text-primary bg-border'
                                : 'bg-transparent text-foreground hover:text-foreground',
                            )}
                          >
                            <span className='truncate'>
                              {selectedStages.length > 0
                                ? `${selectedStages.length} selected`
                                : 'Stage'}
                            </span>
                            <ChevronDown
                              className={cn(
                                'w-4 h-4 opacity-50 shrink-0 transition-transform',
                                stageFilterOpen && 'rotate-180',
                              )}
                            />
                          </button>
                        </Popover.Trigger>
                        <Popover.Content
                          side='bottom'
                          align='start'
                          sideOffset={6}
                          className='z-[60]'
                        >
                          <StagesSubmenu
                            selectedStages={selectedStages}
                            onChange={setSelectedStages}
                            availableStages={
                              stages?.map(s => ({
                                name: s.name,
                                status: s.defaultTicketStatusV2,
                              })) ?? []
                            }
                          />
                        </Popover.Content>
                      </Popover.Root>

                      {/* Assignee Filter — dropdown with searchable user list */}
                      <Popover.Root open={assigneeFilterOpen} onOpenChange={setAssigneeFilterOpen}>
                        <Popover.Trigger asChild>
                          <button
                            type='button'
                            className={cn(
                              'inline-flex items-center justify-between gap-2 w-[150px] h-8 px-3 text-sm font-medium rounded-md border border-input shadow-xs whitespace-nowrap transition-[color,box-shadow] outline-none',
                              selectedAssignees.length > 0
                                ? 'text-primary bg-border'
                                : 'bg-transparent text-foreground hover:text-foreground',
                            )}
                          >
                            <span className='truncate'>
                              {selectedAssignees.length > 0
                                ? `${selectedAssignees.length} assignee${selectedAssignees.length > 1 ? 's' : ''}`
                                : 'Assignee'}
                            </span>
                            <ChevronDown
                              className={cn(
                                'w-4 h-4 opacity-50 shrink-0 transition-transform',
                                assigneeFilterOpen && 'rotate-180',
                              )}
                            />
                          </button>
                        </Popover.Trigger>
                        <Popover.Content
                          side='bottom'
                          align='start'
                          sideOffset={6}
                          className='z-[60]'
                        >
                          <UserSubmenu
                            selectedUsers={selectedAssignees}
                            onChange={setSelectedAssignees}
                            label='Assignee'
                          />
                        </Popover.Content>
                      </Popover.Root>

                      {hasActiveFilters && (
                        <Tooltip side='bottom' content='Clear all filters'>
                          <button
                            type='button'
                            onClick={clearAllFilters}
                            className='inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                            data-track-category='Support'
                            data-track-name='ClearAllFilters'
                          >
                            <X size={16} />
                          </button>
                        </Tooltip>
                      )}
                    </>
                  )}
                  {selectedChannelId &&
                    selectedChannelId !== ALL_CHANNELS_ID &&
                    selectedChannelFull && (
                      <button
                        onClick={() => {
                          setInfoDefaultTab('members');
                          setIsInfoOpen(true);
                        }}
                        className='inline-flex items-center gap-2 h-8 px-3 py-2 text-sm font-medium whitespace-nowrap rounded-md border border-input shadow-xs transition-[color,box-shadow] outline-none text-muted-foreground hover:text-foreground bg-transparent'
                        data-track-category='Support'
                        data-track-name='ViewMembers'
                        data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
                        title='View members'
                      >
                        <Users2 size={16} />
                        <span>{selectedChannelFull.channelStats?.participantCount ?? 0}</span>
                      </button>
                    )}
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
                  {canRefetch && isSelectedChannelJoined && (
                    <Tooltip
                      content={isRefetching ? 'Fetching latest…' : 'Fetch latest emails'}
                      side='bottom'
                    >
                      <button
                        onClick={handleRefetch}
                        disabled={isRefetching}
                        className={cn(
                          'p-1.5 rounded transition-colors text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                          isRefetching && 'opacity-60 cursor-not-allowed',
                        )}
                        data-track-category='Support'
                        data-track-name='RefetchExternalSource'
                        data-track-metadata={JSON.stringify({ channelId: refetchChannelId })}
                      >
                        <RefreshCw size={16} className={cn(isRefetching && 'animate-spin')} />
                      </button>
                    </Tooltip>
                  )}
                  {isSelectedChannelJoined && (
                    <button
                      onClick={() => {
                        if (isSettingsOpen) {
                          void navigate(-1);
                        } else {
                          const base = selectedChannelId
                            ? `/support/${selectedChannelId}`
                            : '/support';
                          void navigate(`${base}?settings=open`);
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
                  )}
                  {ticketId && (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => {
                        const back = selectedChannelId
                          ? `/support/${selectedChannelId}`
                          : '/support';
                        void navigate(back);
                      }}
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
                  <div className='p-4 space-y-6'>
                    {selectedChannelId && (
                      <>
                        <InboxAssigneeSettings
                          channelId={selectedChannelId}
                          currentAssigneeUserGroupId={emailChannelPreference?.assigneeUserGroupId}
                        />
                        <div className='border-t border-border' />
                      </>
                    )}
                    <SignatureEditor />
                  </div>
                </div>
              )}
              <div className='h-full flex-1 min-h-0 overflow-y-auto no-scrollbar'>
                {!selectedChannelId ? (
                  <div className='h-full flex flex-col items-center justify-center gap-2 text-center text-muted-foreground px-6'>
                    <Inbox size={28} className='text-muted-foreground/70' />
                    <p className='text-sm font-medium text-foreground'>
                      Select a channel to preview tickets
                    </p>
                    <p className='text-xs text-muted-foreground max-w-sm'>
                      Pick a Desk channel from the sidebar to see its tickets here.
                    </p>
                  </div>
                ) : !isSelectedChannelKnown ? (
                  <div className='h-full flex flex-col items-center justify-center gap-2 text-center text-muted-foreground px-6'>
                    <Inbox size={28} className='text-muted-foreground/70' />
                    <p className='text-sm font-medium text-foreground'>Channel not found</p>
                    <p className='text-xs text-muted-foreground max-w-sm'>
                      This channel either doesn&apos;t exist or is private and you don&apos;t have
                      access. Pick a different channel from the sidebar.
                    </p>
                  </div>
                ) : !isSelectedChannelJoined ? (
                  <div className='h-full flex items-center justify-center'>
                    <JoinChannel
                      channelId={selectedChannelId}
                      {...(selectedChannelName && selectedChannelName !== 'Xyne Desk'
                        ? { channelTitle: selectedChannelName }
                        : {})}
                    />
                  </div>
                ) : viewMode === 'kanban' ? (
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
                      channelId: selectedChannelId,
                      ...ticketFilter,
                    }}
                    showExtraFields={true}
                    activeTicketId={ticketId}
                    onTicketClick={ticket => {
                      void navigate(`/support/${ticket.channelId}/${ticket.xyneId}`, {
                        state: {
                          conversationId: ticket.conversationId,
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

      {/* Channel Info Modal */}
      {selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID && (
        <ChannelInfoModal
          channelId={selectedChannelId}
          isOpen={isInfoOpen}
          defaultTab={infoDefaultTab}
          onClose={() => setIsInfoOpen(false)}
        />
      )}

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
    <div className='flex items-center gap-1.5 flex-wrap min-h-[24px]'>
      <PriorityPicker ticketId={ticket.id} priority={ticket.priority} />
      <StagePicker ticketId={ticket.id} stageName={ticket.stageName} stageLabel={stage} />
      <AssigneePicker ticketId={ticket.id} assignedTo={ticket.assignedTo} label={assigneeName} />
    </div>
  );
};

const SupportTicketDetail = (): ReactElement => {
  const { channelId: channelIdParam, ticketId: ticketIdParam } = useParams<{
    channelId?: string;
    ticketId?: string;
  }>();
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const isAIPanelOpen = useSelector(
    xyneAIActor,
    snapshot => snapshot.context.xyneAIState === 'open',
  );
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const location = useLocation();
  const navigate = useNavigate();
  const routerState = location.state as {
    conversationId?: string | null;
    ticketId?: string | null;
  };
  // Router state is a perf hint from list navigation (instant paint); direct
  // URL loads and new-tab openings fall back to the supportTicketByXyneId fetch
  // below using the :ticketId path param. Title is NOT carried in state so that
  // it always reflects the current ticket row (and disappears when ACL hides it).
  const stateConversationId = routerState?.conversationId ?? null;
  const ticketId = routerState?.ticketId ?? null;

  // channelId for ACL + query gating — comes from the URL path. Both ticket
  // fetches below require it; without it we don't run the queries at all.
  const routeChannelId = channelIdParam ?? '';
  const channelUserStatus = useGetChannelUserStatus(routeChannelId);
  const isMember = !!channelUserStatus;

  // Single consolidated fetch: the ticket row with `.related('emails')` gives us emails,
  // channelId (scalar on ticket), conversationId, and everything else we need — replaces
  // getEmailsForTicket + getConversationById. Use id when we have it (from list navigation
  // state), otherwise fall back to xyneId lookup (direct URL loads).
  const [ticketById] = useCachedQuery(
    queries.supportTicketRowV2({
      id: ticketId || '',
      channelId: routeChannelId,
      isMember,
    }),
    { enabled: !!ticketId && !!routeChannelId },
  );
  const [ticketByXyneId] = useCachedQuery(
    queries.supportTicketByXyneIdV2({
      xyneId: ticketIdParam || '',
      channelId: routeChannelId,
      isMember,
    }),
    { enabled: !ticketId && !!ticketIdParam && !!routeChannelId },
  );
  const ticket = ticketById ?? ticketByXyneId;
  const emails = useMemo(() => (ticket?.emails as Email[] | undefined) ?? [], [ticket?.emails]);
  const emailCollapseState = useEmailCollapseState(emails);
  const channelId = ticket?.channelId || '';
  const conversationId = ticket?.conversationId ?? stateConversationId;
  const title = ticket?.title ?? null;

  useAskAiTicketContext({
    channelId: channelId || null,
    conversationId: conversationId ?? null,
    previewText: title || 'Ticket conversation',
  });
  const conversation = ticket?.conversation;

  // Prev / next cursor queries — each returns at most 1 adjacent ticket in the
  // EMAIL-channel scope ordered by lastEmailAt desc. Served from IVM when
  // cached, otherwise a tiny server fetch.
  const cursorStart =
    ticket?.id && typeof ticket.lastEmailAt === 'number'
      ? { id: ticket.id, lastEmailAt: ticket.lastEmailAt }
      : null;
  const [nextPage] = useCachedQuery(
    queries.supportTicketsPageV2({
      channelId,
      isMember,
      limit: 1,
      start: cursorStart,
      dir: 'forward',
    }),
    { enabled: !!cursorStart && !!channelId },
  );
  const [prevPage] = useCachedQuery(
    queries.supportTicketsPageV2({
      channelId,
      isMember,
      limit: 1,
      start: cursorStart,
      dir: 'backward',
    }),
    { enabled: !!cursorStart && !!channelId },
  );
  const nextTicket = nextPage?.[0];
  const prevTicket = prevPage?.[0];

  const goToTicket = (t: {
    id: string;
    xyneId?: string | null;
    channelId?: string | null;
    conversationId: string;
    title: string;
  }): void => {
    if (!t.xyneId) return;
    const nextChannelId = t.channelId || channelIdParam;
    if (!nextChannelId) return;
    void navigate(`/support/${nextChannelId}/${t.xyneId}`, {
      state: {
        conversationId: t.conversationId,
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

  // ── Email thread summary ──
  const [emailSummaryState, setEmailSummaryState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  );
  const [emailSummaryPoints, setEmailSummaryPoints] = useState<string[]>([]);
  const [emailSummarySummary, setEmailSummarySummary] = useState('');
  const [emailSummaryError, setEmailSummaryError] = useState('');
  const [showEmailSummary, setShowEmailSummary] = useState(false);
  const emailSummaryAbortRef = useRef<AbortController | null>(null);

  // Reset summary when conversation changes or new emails arrive
  const emailCount = emails.length;
  useEffect(() => {
    emailSummaryAbortRef.current?.abort();
    setEmailSummaryState('idle');
    setEmailSummaryPoints([]);
    setEmailSummarySummary('');
    setEmailSummaryError('');
    setShowEmailSummary(false);
  }, [conversationId, emailCount]);

  const fetchEmailSummary = useCallback(
    async (regenerate = false) => {
      if (!conversationId) return;
      emailSummaryAbortRef.current?.abort();
      const controller = new AbortController();
      emailSummaryAbortRef.current = controller;

      setEmailSummaryState('loading');
      setEmailSummaryPoints([]);
      setEmailSummarySummary('');
      setEmailSummaryError('');

      await summarizeEmailThread(
        conversationId,
        {
          onComplete: data => {
            setEmailSummarySummary(data.summary);
            setEmailSummaryPoints(data.keypoints);
            setEmailSummaryState('done');
          },
          onError: error => {
            setEmailSummaryError(error);
            setEmailSummaryState('error');
          },
        },
        controller.signal,
        regenerate,
      );
    },
    [conversationId],
  );

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
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const [isScheduleCallModalOpen, setIsScheduleCallModalOpen] = useState(false);
  const hasActiveCallForConversation = !!conversation?.callId;

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
            <div className='w-full px-6 py-4 flex flex-col gap-2.5 flex-shrink-0 sticky top-0 bg-background z-10 border-b border-border'>
              <div className='flex items-center gap-2 min-w-0'>
                <button
                  type='button'
                  onClick={() => {
                    const back = channelIdParam ? `/support/${channelIdParam}` : '/support';
                    void navigate(back);
                  }}
                  className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0'
                  aria-label='Back to ticket list'
                  data-track-category='Support'
                  data-track-name='BackToList'
                >
                  <ArrowLeft size={18} />
                </button>
                <span className='bg-border py-[3px] px-3 flex items-center justify-center text-xs text-foreground rounded-md font-mono shrink-0 whitespace-nowrap'>
                  {ticketIdParam}
                </span>
                <span
                  className='font-medium text-foreground min-w-0 flex-1 truncate'
                  title={title || 'Untitled Ticket'}
                >
                  {title || 'Untitled Ticket'}
                </span>

                {emailCollapseState.canToggleAll && (
                  <>
                    <Tooltip
                      side='bottom'
                      delayDuration={300}
                      content={
                        <span className='flex items-center gap-2'>
                          {emailCollapseState.anyExpanded ? 'Collapse all' : 'Expand all'}
                          <kbd className='px-1 py-px rounded bg-background/15 border border-background/20 text-[10px] font-mono uppercase'>
                            E
                          </kbd>
                        </span>
                      }
                    >
                      <button
                        type='button'
                        onClick={emailCollapseState.toggleAll}
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
                    </Tooltip>

                    <div className='w-px h-4 bg-border' />
                  </>
                )}

                {emails.length > 0 && (
                  <>
                    <Tooltip side='bottom' delayDuration={300} content='Summarize email thread'>
                      <button
                        type='button'
                        onClick={() => {
                          if (emailSummaryState === 'idle' || emailSummaryState === 'error') {
                            setShowEmailSummary(true);
                            void fetchEmailSummary();
                          } else if (emailSummaryState === 'done') {
                            setShowEmailSummary(prev => !prev);
                          }
                        }}
                        disabled={emailSummaryState === 'loading'}
                        className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors'
                        data-track-category='Support'
                        data-track-name='SummarizeEmailThread'
                      >
                        {emailSummaryState === 'loading' ? (
                          <Loader2 size={16} className='animate-spin' />
                        ) : (
                          <Wand2 size={16} />
                        )}
                      </button>
                    </Tooltip>
                    <div className='w-px h-4 bg-border' />
                  </>
                )}

                <Tooltip side='bottom' delayDuration={300} content='Copy link to ticket'>
                  <button
                    type='button'
                    onClick={() => {
                      if (!channelId || !ticketIdParam) {
                        toast.error('Cannot copy link');
                        return;
                      }
                      const url = `${SHAREABLE_ORIGIN}/support/${channelId}/${ticketIdParam}`;
                      void navigator.clipboard
                        .writeText(url)
                        .then(() => toast.success('Link copied'))
                        .catch(() => toast.error('Failed to copy link'));
                    }}
                    className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                    aria-label='Copy link to ticket'
                    data-track-category='Support'
                    data-track-name='CopyTicketLink'
                  >
                    <LinkIcon size={16} />
                  </button>
                </Tooltip>
                <div className='w-px h-4 bg-border' />

                <div className='flex items-center gap-1'>
                  <Tooltip
                    side='bottom'
                    delayDuration={300}
                    content={
                      <span className='flex items-center gap-2'>
                        Previous ticket
                        <kbd className='px-1 py-px rounded bg-background/15 border border-background/20 text-[10px] font-mono uppercase'>
                          K
                        </kbd>
                      </span>
                    }
                  >
                    <button
                      type='button'
                      onClick={() => prevTicket && goToTicket(prevTicket)}
                      disabled={!prevTicket}
                      className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                      data-track-category='Support'
                      data-track-name='PrevTicket'
                    >
                      <ChevronUp size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip
                    side='bottom'
                    delayDuration={300}
                    content={
                      <span className='flex items-center gap-2'>
                        Next ticket
                        <kbd className='px-1 py-px rounded bg-background/15 border border-background/20 text-[10px] font-mono uppercase'>
                          J
                        </kbd>
                      </span>
                    }
                  >
                    <button
                      type='button'
                      onClick={() => nextTicket && goToTicket(nextTicket)}
                      disabled={!nextTicket}
                      className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                      data-track-category='Support'
                      data-track-name='NextTicket'
                    >
                      <ChevronDown size={16} />
                    </button>
                  </Tooltip>
                </div>
                {!isRightPanelOpen && (
                  <>
                    <div className='w-px h-4 bg-border' />
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setIsRightPanelOpen(true)}
                      data-track-category='Support'
                      data-track-name='OpenThreadPanel'
                    >
                      Open Thread
                    </Button>
                  </>
                )}
              </div>
              <div className='flex items-center gap-2 flex-shrink-0'>
                <div className='pl-9'>
                  <TicketMetaRow ticket={ticket} />
                </div>
              </div>
            </div>
            {showEmailSummary &&
              (emailSummaryState === 'loading' ||
                emailSummaryState === 'done' ||
                emailSummaryState === 'error') && (
                <div
                  className='flex-shrink-0 mx-6 mt-4 rounded-2xl p-px max-h-[40%] flex flex-col'
                  style={{
                    background:
                      emailSummaryState === 'loading'
                        ? 'linear-gradient(135deg, #FFB3B3, #FFCECE, #FFC0C0, #FFB3B3)'
                        : 'linear-gradient(135deg, rgba(255,179,179,0.3), rgba(255,206,206,0.15), rgba(255,179,179,0.3))',
                    backgroundSize: emailSummaryState === 'loading' ? '300% 300%' : '100% 100%',
                    animation:
                      emailSummaryState === 'loading' ? 'gradient-xy 3s ease infinite' : 'none',
                  }}
                >
                  <div className='rounded-[calc(1rem-1px)] bg-background/95 dark:bg-background/90 backdrop-blur-xl overflow-hidden flex flex-col h-full'>
                    {/* Header */}
                    <div className='flex items-center justify-between px-4 py-2.5 shrink-0'>
                      <div className='flex items-center gap-2.5'>
                        <div className='relative flex items-center justify-center w-6 h-6'>
                          {emailSummaryState === 'loading' && (
                            <div
                              className='absolute inset-0 rounded-lg opacity-30 blur-[3px]'
                              style={{
                                background: 'linear-gradient(135deg, #FFB3B3, #FFCECE, #FFC0C0)',
                                backgroundSize: '200% 200%',
                                animation: 'gradient-xy 2s ease infinite',
                              }}
                            />
                          )}
                          <div
                            className='relative flex items-center justify-center w-6 h-6 rounded-lg'
                            style={{ background: '#F87171' }}
                          >
                            <Sparkles size={12} className='text-white' />
                          </div>
                        </div>
                        <span className='text-sm font-bold' style={{ color: '#1a1a1a' }}>
                          AI Summary
                        </span>
                      </div>
                      <div className='flex items-center gap-1'>
                        {(emailSummaryState === 'done' || emailSummaryState === 'error') && (
                          <Tooltip
                            side='bottom'
                            delayDuration={300}
                            content={emailSummaryState === 'error' ? 'Retry' : 'Regenerate summary'}
                          >
                            <button
                              type='button'
                              onClick={() => void fetchEmailSummary(true)}
                              className='p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                              data-track-category='Support'
                              data-track-name='RegenerateEmailSummary'
                            >
                              <RefreshCw size={13} />
                            </button>
                          </Tooltip>
                        )}
                        <button
                          type='button'
                          onClick={() => setShowEmailSummary(false)}
                          className='p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                          data-track-category='Support'
                          data-track-name='DismissEmailSummary'
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Content */}
                    <div className='px-4 pb-3 overflow-y-auto no-scrollbar'>
                      {/* Loading state */}
                      {emailSummaryState === 'loading' && (
                        <div className='space-y-3'>
                          <div className='space-y-2'>
                            <div
                              className='h-3 w-full rounded-full'
                              style={{
                                background:
                                  'linear-gradient(90deg, rgba(255,179,179,0.08), rgba(255,206,206,0.18), rgba(255,179,179,0.08))',
                                backgroundSize: '200% 100%',
                                animation: 'gradient-x 2s ease-in-out infinite',
                              }}
                            />
                            <div
                              className='h-3 w-3/4 rounded-full'
                              style={{
                                background:
                                  'linear-gradient(90deg, rgba(255,179,179,0.08), rgba(255,206,206,0.18), rgba(255,179,179,0.08))',
                                backgroundSize: '200% 100%',
                                animation: 'gradient-x 2s ease-in-out infinite 0.15s',
                              }}
                            />
                          </div>
                          <div className='space-y-2.5 pt-1'>
                            {[1, 0.83, 0.66].map((width, idx) => (
                              <div key={idx} className='flex items-center gap-2.5'>
                                <div
                                  className='h-[5px] w-[5px] rounded-full shrink-0'
                                  style={{
                                    background: '#FFB3B3',
                                    opacity: 0.6,
                                    animation: `pulse 1.5s ease-in-out infinite ${idx * 0.2}s`,
                                  }}
                                />
                                <div
                                  className='h-3 rounded-full'
                                  style={{
                                    width: `${width * 100}%`,
                                    background:
                                      'linear-gradient(90deg, rgba(255,179,179,0.06), rgba(255,206,206,0.14), rgba(255,179,179,0.06))',
                                    backgroundSize: '200% 100%',
                                    animation: `gradient-x 2s ease-in-out infinite ${0.1 + idx * 0.15}s`,
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Done state */}
                      {emailSummaryState === 'done' && (
                        <div className='space-y-3'>
                          {emailSummarySummary && (
                            <p className='text-[13px] text-muted-foreground leading-relaxed'>
                              {emailSummarySummary}
                            </p>
                          )}
                          {emailSummaryPoints.length > 0 && (
                            <>
                              {emailSummarySummary && (
                                <div
                                  className='h-px w-full'
                                  style={{
                                    background:
                                      'linear-gradient(to right, transparent, rgba(255,179,179,0.2), transparent)',
                                  }}
                                />
                              )}
                              <ul className='space-y-2'>
                                {emailSummaryPoints.map((point, i) => (
                                  <li
                                    key={i}
                                    className='flex items-start gap-2.5 text-[13px] text-foreground leading-relaxed'
                                  >
                                    <span
                                      className='h-[5px] w-[5px] mt-[7px] rounded-full shrink-0'
                                      style={{ background: '#FF9B9B' }}
                                    />
                                    <span>{point}</span>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </div>
                      )}

                      {/* Error state */}
                      {emailSummaryState === 'error' && (
                        <p className='text-sm text-destructive'>{emailSummaryError}</p>
                      )}
                    </div>

                    {/* Footer */}
                    {emailSummaryState === 'done' && (
                      <div
                        className='px-4 py-1.5 shrink-0'
                        style={{ borderTop: '1px solid rgba(255,179,179,0.12)' }}
                      >
                        <p className='text-[11px] text-muted-foreground/50'>
                          AI-generated · may not be fully accurate
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            <div className='flex-1 overflow-y-auto no-scrollbar px-6 py-4 bg-background'>
              {emails && emails.length > 0 && (
                <div className='mb-6'>
                  <EmailThread
                    collapseState={emailCollapseState}
                    ticketId={ticket?.id}
                    emailReads={
                      ticket?.emailReads as
                        | Array<{ userId: string; lastReadEmailId: string }>
                        | undefined
                    }
                  />
                </div>
              )}
            </div>
            <div className='sticky bottom-0 w-full flex-shrink-0 bg-background'>
              {composerOpen ? (
                <EmailComposer
                  conversationId={conversationId}
                  onClose={() => setComposerOpen(false)}
                  isAIPanelOpen={isAIPanelOpen}
                  onToggleAIPanel={() => {
                    if (isAIPanelOpen) {
                      xyneAIActor.send({ type: 'CLOSE' });
                    } else {
                      xyneAIActor.send({ type: 'OPEN' });
                    }
                  }}
                  channelId={channelId}
                  ticketId={ticketId}
                />
              ) : (
                <div className='px-6 py-3 flex items-center gap-2'>
                  <Tooltip
                    side='top'
                    delayDuration={300}
                    content={
                      <span className='flex items-center gap-2'>
                        Reply
                        <kbd className='px-1 py-px rounded bg-background/15 border border-background/20 text-[10px] font-mono uppercase'>
                          R
                        </kbd>
                      </span>
                    }
                  >
                    <button
                      type='button'
                      onClick={() => setComposerOpen(true)}
                      data-track-category='Support'
                      data-track-name='OpenReplyComposer'
                      className='inline-flex items-center justify-center h-9 min-w-[104px] pl-3 pr-4 rounded-full border border-border bg-transparent text-sm font-medium text-muted-foreground hover:bg-muted active:bg-accent transition-colors cursor-pointer select-none'
                    >
                      <ArrowUp size={16} className='rotate-[-90deg] mr-2' />
                      Reply
                    </button>
                  </Tooltip>
                  <Tooltip
                    side='top'
                    delayDuration={300}
                    content={
                      <span className='flex items-center gap-2'>
                        Reply all
                        <kbd className='px-1 py-px rounded bg-background/15 border border-background/20 text-[10px] font-mono uppercase'>
                          A
                        </kbd>
                      </span>
                    }
                  >
                    <button
                      type='button'
                      onClick={() => setComposerOpen(true)}
                      data-track-category='Support'
                      data-track-name='OpenReplyAllComposer'
                      className='inline-flex items-center justify-center h-9 min-w-[104px] pl-3 pr-4 rounded-full border border-border bg-transparent text-sm font-medium text-muted-foreground hover:bg-muted active:bg-accent transition-colors cursor-pointer select-none'
                    >
                      <ReplyAll size={16} className='mr-2' />
                      Reply all
                    </button>
                  </Tooltip>
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
                        <div className='flex items-center gap-1'>
                          {/* Initiate Call Button */}
                          {conversationId && (
                            <ThreadCallButton
                              onStartCall={() => setShowParticipantsModal(true)}
                              onScheduleCall={() => setIsScheduleCallModalOpen(true)}
                              hasActiveCall={hasActiveCallForConversation}
                              testId='support-initiate-call-button'
                            />
                          )}
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
                      {ticket?.id ? (
                        <TicketDetails ticketId={ticket.id} />
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
                {/* Call Participants Selection Modal */}
                {conversationId && (
                  <CallParticipantsSelectionModal
                    isOpen={showParticipantsModal}
                    onClose={() => setShowParticipantsModal(false)}
                    channelId={channelId}
                    conversationId={conversationId}
                  />
                )}
                {/* Schedule Call Modal — single modal that always allows guests
                    (people outside Xyne) to be invited alongside internal members. */}
                <ScheduleCallModal
                  isOpen={isScheduleCallModalOpen}
                  onClose={() => setIsScheduleCallModalOpen(false)}
                  enableExternalInvitees
                  {...(channelId ? { channelId } : {})}
                  {...(conversationId ? { conversationId } : {})}
                />
              </div>
            </Panel>
          </>
        )}
        {/* Ask AI panel removed — there's now only one Ask AI window globally,
            mounted in AppRoot. SupportScreen tells it which ticket via
            useAskAiTicketContext above; the EmailComposer's Ask AI button
            opens it via xyneAIActor.send('OPEN'). */}
      </PanelGroup>
    </div>
  );
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

const EmailThread = ({
  collapseState,
  ticketId,
  emailReads,
}: {
  collapseState: EmailCollapseState;
  ticketId?: string | null | undefined;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailId: string }> | undefined;
}): ReactElement => {
  const { sortedEmails, collapsedIds, toggleOne, lastEmailId } = collapseState;
  // Thread-level: upsert the current user's email_reads row with the id of
  // the newest email in this thread. `isRead` is derived by comparing that
  // stored id to the current latest email, so every email header in the
  // thread flips read/unread together.
  const { isRead } = useMarkEmailRead(ticketId, lastEmailId ?? null, emailReads, true);
  return (
    <div className='divide-y divide-gray-200 relative'>
      {sortedEmails.map(email => (
        <EmailThreadItem
          key={email.id}
          email={email}
          isCollapsed={collapsedIds.has(email.id)}
          canCollapse={email.id !== lastEmailId}
          onToggleCollapse={() => toggleOne(email.id)}
          isRead={isRead}
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
  isCollapsed = false,
  canCollapse = true,
  onToggleCollapse,
  isRead = true,
}: {
  email: Email;
  isCollapsed?: boolean;
  canCollapse?: boolean;
  onToggleCollapse?: () => void;
  isRead?: boolean;
}): ReactElement => {
  const { name: fromName, email: fromEmail } = parseFromField(email.from || '');
  const toList = email.to || [];
  const ccList = email.cc || [];
  const bccList = email.bcc || [];

  // DISABLED: demerge-email feature commented out. Re-enable by uncommenting
  // the block below and the `extras={demergeButton}` prop on EmailThreadHeader.
  /*
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
        const nextChannelId =
          response.data.newTicket.channelId || channelIdParam;
        if (nextChannelId) {
          void navigate(
            `/support/${nextChannelId}/${response.data.newTicket.xyneId}`,
            {
              state: {
                conversationId: response.data.newTicket.conversationId,
                title: email.subject,
                ticketId: response.data.newTicket.ticketId,
              },
            },
          );
        }
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

  const demergeButton =
    email.type === EmailType.DEFAULT &&
    email.externalThreadId === email.externalMessageId &&
    email.id !== firstEmail.id ? (
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
    ) : null;
  */

  const headerClickable = canCollapse && !!onToggleCollapse;
  const preview = stripHtml(email.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

  return (
    <div
      id={`mail-${email.id}`}
      data-external-message-id={email.externalMessageId || undefined}
      className={cn('w-full scroll-mt-20 transition-colors', isCollapsed ? 'py-3' : 'py-6')}
    >
      <div
        className={cn(headerClickable && 'cursor-pointer')}
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
        <EmailThreadHeader
          fromName={fromName}
          fromEmail={fromEmail}
          to={toList}
          cc={ccList}
          bcc={bccList}
          createdAt={email.createdAt}
          isCollapsed={isCollapsed}
          previewText={preview}
          isRead={isRead}
          // extras={demergeButton}  // DISABLED: see commented handleDemerge block above
        />
      </div>
      {!isCollapsed && (
        <div className='flex items-start gap-3 mt-4'>
          <div className='size-8 shrink-0' aria-hidden='true' />
          <div className='flex-1 min-w-0'>
            <div className='text-sm text-foreground leading-relaxed'>
              {email.body ? (
                <EmailBodyRenderer
                  body={email.body}
                  emailId={email.id}
                  attachments={email.attachments}
                />
              ) : (
                <span className='text-muted-foreground italic'>No content</span>
              )}
            </div>
            {email.attachments && email.attachments.length > 0 && (
              <EmailAttachmentsRow
                attachments={email.attachments}
                conversationId={email.conversationId}
                channelId={email.channelId}
              />
            )}
          </div>
        </div>
      )}
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
  ticketId,
}: {
  conversationId?: string | null | undefined;
  onClose?: () => void;
  isAIPanelOpen?: boolean;
  onToggleAIPanel?: () => void;
  channelId?: string;
  ticketId?: string | null | undefined;
}): ReactElement => {
  const [emails] = useCachedQuery(
    queries.getEmailsForTicket({ conversationId: conversationId || '' }),
  );
  // Use email draft hooks
  const draftContent = useEmailDraft(conversationId);
  const { saveDraft, deleteDraft, draftId } = useEmailDraftOperations(conversationId, channelId);

  const aiDraft = useDeskAIDraft({
    channelId: channelId || '',
    conversationId: conversationId || '',
    ticketId: ticketId ?? null,
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

  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [composerHeight, setComposerHeight] = useState<number>(320);
  const [isResizingComposer, setIsResizingComposer] = useState<boolean>(false);
  const resizeStartYRef = useRef<number>(0);
  const resizeStartHeightRef = useRef<number>(320);

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
    // Allow attachment-only sends (no body) when at least one file is attached.
    const hasContent = !!emailContent.trim();
    const hasAttachments = attachments.length > 0;
    if ((!hasContent && !hasAttachments) || !conversationId || isSending || toEmails.length === 0) {
      return;
    }
    setIsSending(true);
    try {
      let attachmentIds: string[] = [];

      // Upload attachments if any
      if (hasAttachments) {
        attachmentIds = await uploadAttachments(attachments);
      }

      const activeSig = selectedSignatureId
        ? signatures?.find(s => s.id === selectedSignatureId)
        : null;
      const bodyContent = hasContent ? await markdownToHtml(emailContent.trim()) : '';
      const bodyHtml = activeSig
        ? `${bodyContent}${bodyContent ? '<br>--<br>' : ''}${activeSig.content}`
        : bodyContent;
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
    // Reset input early so the same file can be selected again after a rejection.
    e.target.value = '';
    if (files.length === 0) return;

    const accepted: File[] = [];
    const rejectedTooLarge: string[] = [];
    let availableSlots = MAX_EMAIL_ATTACHMENT_FILES - attachments.length;
    let droppedForCount = 0;

    for (const file of files) {
      if (availableSlots <= 0) {
        droppedForCount++;
        continue;
      }
      if (file.size > MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES) {
        rejectedTooLarge.push(file.name);
        continue;
      }
      accepted.push(file);
      availableSlots--;
    }

    if (rejectedTooLarge.length > 0) {
      toast.error(
        `Skipped ${rejectedTooLarge.length} file${rejectedTooLarge.length > 1 ? 's' : ''} over ${MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES / (1024 * 1024)}MB: ${rejectedTooLarge.join(', ')}`,
      );
    }
    if (droppedForCount > 0) {
      toast.error(
        `You can attach at most ${MAX_EMAIL_ATTACHMENT_FILES} files per email. Dropped ${droppedForCount}.`,
      );
    }

    if (accepted.length > 0) {
      setAttachments(prev => [...prev, ...accepted]);
    }
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

  const startComposerResize = (clientY: number): void => {
    if (!isExpanded || isSending) return;
    resizeStartYRef.current = clientY;
    resizeStartHeightRef.current = composerHeight;
    setIsResizingComposer(true);
  };

  const handleComposerResizeTouchStart = (event: React.TouchEvent<HTMLDivElement>): void => {
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    startComposerResize(touch.clientY);
  };

  useEffect(() => {
    if (!isResizingComposer) return undefined;

    const MIN_HEIGHT = 260;
    const MAX_HEIGHT = 760;

    const handlePointerMove = (clientY: number): void => {
      const deltaY = resizeStartYRef.current - clientY;
      const nextHeight = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, resizeStartHeightRef.current + deltaY),
      );
      setComposerHeight(nextHeight);
    };

    const handleMouseMove = (event: MouseEvent): void => {
      handlePointerMove(event.clientY);
    };

    const handleTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      handlePointerMove(touch.clientY);
    };

    const stopResizing = (): void => {
      setIsResizingComposer(false);
    };

    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', stopResizing);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopResizing);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', stopResizing);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isResizingComposer]);

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
        className={`border border-border rounded-xl relative flex flex-col overflow-hidden ${isSending ? 'opacity-60 pointer-events-none' : ''}`}
        style={isExpanded ? { height: `${composerHeight}px` } : undefined}
      >
        {isExpanded && (
          <div
            className='h-4 flex-shrink-0 flex items-center justify-center cursor-row-resize touch-none'
            onMouseDown={e => {
              e.preventDefault();
              startComposerResize(e.clientY);
            }}
            onTouchStart={handleComposerResizeTouchStart}
            onKeyDown={() => {}}
            role='button'
            tabIndex={0}
            aria-label='Resize composer'
          >
            <div className='h-1 w-14 rounded-full bg-muted-foreground/30' />
          </div>
        )}
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
              <span className='text-sm text-foreground font-medium flex-shrink-0'>Reply to</span>
              <div className='flex items-center gap-1.5 flex-wrap flex-1 min-w-0'>
                {collapsedDisplay.visibleEmails.map(raw => {
                  const parsed = parseFromField(raw);
                  const displayName = parsed.email ? parsed.name : raw;
                  const initial = (displayName.charAt(0) || '?').toUpperCase();
                  const tooltip = parsed.email ? `${parsed.name} <${parsed.email}>` : raw;
                  return (
                    <span
                      key={raw}
                      className='inline-flex items-center gap-1.5 bg-muted/60 rounded-md px-1.5 py-0.5 max-w-full'
                      title={tooltip}
                    >
                      <span className='w-4 h-4 rounded-[3px] bg-border flex items-center justify-center flex-shrink-0'>
                        <span className='text-[9px] font-medium text-muted-foreground'>
                          {initial}
                        </span>
                      </span>
                      <span className='text-sm text-foreground truncate'>{displayName}</span>
                    </span>
                  );
                })}
                {collapsedDisplay.remainingCount > 0 && (
                  <span className='text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded hover:bg-border'>
                    +{collapsedDisplay.remainingCount}
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

        <div className='flex-1 min-h-0 overflow-y-auto'>
          {aiDraft.isDraftActive ? (
            <DraftCard
              draftContent={aiDraft.draftContent}
              isStreaming={aiDraft.isStreaming}
              onAccept={() => {
                const content = aiDraft.acceptDraft();
                setEmailContent(content);
                if (content) saveDraft(content);
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
              onKeyDown={e => {
                if (
                  e.key === 'Enter' &&
                  (e.metaKey || e.ctrlKey) &&
                  (emailContent.trim() || attachments.length > 0) &&
                  conversationId &&
                  !isSending &&
                  toEmails.length > 0
                ) {
                  e.preventDefault();
                  void handleSendEmail();
                }
              }}
              className='w-full px-4 py-3 focus:outline-none text-sm resize-none bg-background'
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
        </div>

        <div className='px-3 py-1.5 flex items-center justify-between'>
          <div className='flex items-center gap-0.5'>
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
              <Tooltip content='Attach files' side='bottom' delayDuration={300}>
                <button
                  type='button'
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSending || isUploadingAttachments}
                  className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                  aria-label='Attach files'
                  data-track-category='SUPPORT'
                  data-track-name='AddEmailAttachment'
                  data-track-metadata={JSON.stringify({
                    conversationId,
                    attachmentCount: attachments.length,
                  })}
                >
                  <Paperclip size={14} />
                </button>
              </Tooltip>
            </div>

            {/* Signature selector */}
            {signatures.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                    title={
                      selectedSignatureId
                        ? (signatures.find(s => s.id === selectedSignatureId)?.name ?? 'Signature')
                        : 'No signature'
                    }
                    data-track-category='email-compose'
                    data-track-name='select-signature'
                  >
                    <Signature size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' side='top'>
                  <DropdownMenuItem
                    onClick={() => {
                      const base = channelId ? `/support/${channelId}` : '/support';
                      void composerNavigate(`${base}?openSettings=signatures`);
                    }}
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
              <Tooltip content='Add signature' side='bottom' delayDuration={300}>
                <button
                  type='button'
                  onClick={() => {
                    const base = channelId ? `/support/${channelId}` : '/support';
                    void composerNavigate(`${base}?openSettings=signatures`);
                  }}
                  className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                  aria-label='Add signature'
                  data-track-category='email-compose'
                  data-track-name='add-signature'
                >
                  <Signature size={14} />
                </button>
              </Tooltip>
            )}
          </div>
          <div className='flex items-center gap-0.5'>
            {/* Ask AI button */}
            {onToggleAIPanel && (
              <Tooltip content='Ask AI' side='bottom' delayDuration={300}>
                <button
                  type='button'
                  onClick={onToggleAIPanel}
                  className={cn(
                    'size-7 flex items-center justify-center rounded-full transition-colors',
                    isAIPanelOpen ? 'bg-[#F3EEFF]' : 'hover:bg-muted',
                  )}
                  aria-label='Toggle Ask AI panel'
                  data-track-category='Support'
                  data-track-name='ToggleAIPanel'
                >
                  <span className='inline-flex animate-ai-pop'>
                    <XyneAIStar size={14} />
                  </span>
                </button>
              </Tooltip>
            )}

            {/* Draft button */}
            <Tooltip content='Generate AI draft reply' side='bottom' delayDuration={300}>
              <button
                type='button'
                onClick={() => {
                  aiDraft.triggerDraft();
                }}
                disabled={aiDraft.isStreaming || !emails?.length}
                className='size-7 flex items-center justify-center rounded-full text-primary hover:bg-violet-50 hover:text-violet-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                aria-label='Draft reply with AI'
                data-track-category='Support'
                data-track-name='TriggerAIDraft'
              >
                <Wand2 size={14} />
              </button>
            </Tooltip>

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
                <div className='w-px h-4 bg-border mx-1' />
                <button
                  className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
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
                  <Minimize2 size={14} />
                </button>
                <button
                  className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors'
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
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <div className='w-px h-4 bg-border mx-1' />
            <button
              className='size-7 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors'
              onClick={() => void handleSendEmail()}
              disabled={
                (!emailContent.trim() && attachments.length === 0) ||
                !conversationId ||
                isSending ||
                toEmails.length === 0 ||
                aiDraft.isDraftActive
              }
              aria-label='Send email'
              title={aiDraft.isDraftActive ? 'Accept the AI draft to enable Send' : 'Send (⌘↵)'}
              data-track-category='Support'
              data-track-name='SendEmailReply'
              data-track-metadata={JSON.stringify({
                conversationId,
                attachmentCount: attachments.length,
              })}
            >
              {isSending ? <RefreshCw size={14} className='animate-spin' /> : <ArrowUp size={14} />}
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
