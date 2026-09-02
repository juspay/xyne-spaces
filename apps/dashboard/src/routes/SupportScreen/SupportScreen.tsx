import { ReplyAll, Split, Wand2, Archive, Plug, MailOpen } from 'lucide-react';
import {
  ChannelVisibility,
  ChannelType,
  EmailType,
  DeskType,
  TicketReferenceRelation,
  NotificationLevel,
  AutoDraftStatus,
} from '@xyne/shared';
import React, { ReactElement, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ResizableGroup, Panel, Separator } from '../../components/ui/Resizable/Resizable';
import {
  SUPPORT_SIDEBAR_DEFAULT_WIDTH,
  SUPPORT_SIDEBAR_MAX_WIDTH,
  SUPPORT_SIDEBAR_MIN_WIDTH,
} from './supportSidebarWidth';
import { useHasResourceAccess } from '../../hooks/usePermissions';
import { cn } from '../../utils/classNames';
import { getApiErrorMessage } from '../../utils/apiError';
import { surfaceMutationError } from '../../utils/zeroMutationToast';
import {
  GridDashboard01,
  LayoutGridTwoVertical as Columns3,
  TicketToken as TicketIcon,
  Hashtag,
  Star,
  ChevronRight,
  Circle,
  Tag,
  CalendarDefault as CalendarRange,
  MultipleCrossCancelDefault as X,
  SidebarRightOpen as PanelRight,
  KanbanBoard as LayoutGrid,
  ListDefault as List,
  GridTable as Table2,
  CheckTickSingle as Check,
  SparkleAi02 as Sparkles,
  PencilEdit as Pencil,
  UserTwo as Users,
  SearchDefault as Search,
  UserDefault as User,
  FilterLines as ListFilter,
  BarchartDefault as BarChart4Icon,
  CalendarDefault as CalendarDays,
  Tag as TagIcon,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Refresh as RefreshCw,
  ArrowLeft,
  ArrowUp,
  DoubleChevronUp as ChevronsDownUp,
  DoubleChevronDown as ChevronsUpDown,
  PaperclipSlant as Paperclip,
  LinkChainHorizontal as LinkIcon,
  Settings02 as Settings,
  PlusDefault as Plus,
  Spinner as Loader2,
  AlertCircle,
  UserThree as Users2,
  LockClose as Lock,
  Hashtag as Hash,
  InboxDefault as Inbox,
  CheckTickDouble as CheckCheck,
  Merge as GitMerge,
  EnvelopeDefault as Mail,
  BarchartDefault as BarChart3,
  UserPlus,
  InformationCircle as InfoIcon,
  FileText,
} from '@xyne/icons';
import ChannelIcon from '../../components/Chat/ChannelIcon/ChannelIcon';
import { logger, Event } from '../../utils/logger';
import Tooltip, { TruncatedTooltip } from '../../components/ui/Tooltip';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { useTicketKeysetWindow } from '../../hooks/useTicketKeysetWindow';
import { QueryResultType } from '@rocicorp/zero';
import ThreadMessages from '../../components/Chat/ThreadPannel';
import { useChannel, useEmailChannels, useUserChannelStatuses } from '../../hooks/useChannels';
import { useRefetchExternalSource } from '../../hooks/useRefetchExternalSource';
import { useDlMemberSyncStatus } from '../../hooks/useDlMemberSyncStatus';
import { RefetchRangeDialog } from '../../components/Chat/EmailRefetch/RefetchRangeDialog';
import { DlMemberSyncDialog } from '../../components/Chat/EmailRefetch/DlMemberSyncDialog';
import { useMarkTicketsAsRead } from '../../hooks/useMarkTicketsAsRead';
import * as Popover from '@radix-ui/react-popover';
import {
  PrioritySubmenu,
  UserSubmenu,
  AICategorySubmenu,
  GeneratedTagsSubmenu,
  UserGroupSubmenu,
  StagesSubmenu,
  DynamicFieldSubmenu,
  ConversationLabelSubmenu,
} from '../../components/Tickets/TicketFilters/Submenus';
import { getIconForFieldType } from '../../components/Tickets/TicketFilters/fieldTypeIcons';
import {
  resolveDisplayFormFields,
  type ResolvedDisplayFormField,
} from '../../utils/board/resolveDisplayFormFields';
import {
  buildDynamicFieldFilterEntries,
  toDynamicFieldQueryFilters,
  type DynamicFieldQueryFilter,
} from '../../utils/board/dynamicFieldFilters';
import { dynamicColumnKey } from '../../components/Tickets/TicketTable/dynamicFieldColumns';
import { useDeskTableColumns, DESK_TABLE_BUILTIN_COLUMNS } from './useDeskTableColumns';
import { tagsConfigApi } from '../../api/tagsConfigApi';
import { classificationApi } from '../../api/classificationApi';
import {
  CalendarView,
  PRESETS,
  type DateRangeValue,
} from '../../components/ui/DateRangeFilter/DateRangeFilter';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import { Switch } from '../../components/ui/Switch';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../components/ui/dropdown-menu';
import { useMachine } from '@xstate/react';
import { ticketFiltersMachine, clearTicketFilterParams } from '../../machines/ticketFiltersMachine';
import { useChannelSubscription } from '../../hooks/useChannelSubscription';
import JoinChannel from '../../components/Chat/JoinChannel/JoinChannel';
import { mutators } from '../../zero/mutators';
import { Button } from '../../components/ui/Button/Button';
import { Badge } from '../../components/ui/Badge/Badge';
import { useAuthContextValues } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import { TicketListView } from '../../components/Tickets/TicketListView';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { SupportKanbanBoard } from './SupportKanbanBoard';
import { SupportTicketTable } from './SupportTicketTable';
import { BoardType, FormContextType, TicketPriority, parseFieldOptionValues } from '@xyne/shared';
import type { Ticket, FormFields, EmailChannelPreference } from '@xyne/shared';
import { useShortcut, invokeShortcut } from '../../shortcuts';
import { v4 as uuidv4 } from 'uuid';
import { useUser } from '../../hooks/useUsers';
import { BulkActionToolbar } from '../../components/Tickets/TicketTable/BulkActionToolbar';
import { assigneeOptionToTicketUpdate } from '../../components/Tickets/TicketTable/TicketTableHelper';
import {
  dueDateToEta,
  sharedChannelId,
  useBulkAssignableUsers,
  useBulkTicketActions,
  type BulkTicketUpdates,
} from '../../components/Tickets/TicketTable/useBulkTicketActions';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { AssigneePicker } from '../../components/Tickets/TicketListView/AssigneePicker';
import { StagePicker } from '../../components/Tickets/TicketListView/StagePicker';
import { PriorityPicker } from '../../components/Tickets/TicketListView/PriorityPicker';
import { EmailComposer } from '../../components/xyne-desk/EmailComposer/EmailComposer';
import { ReplyPill } from '../../components/xyne-desk/EmailComposer/ReplyPill';
import { ComposeEmailModal } from '../../components/xyne-desk/EmailComposer/ComposeEmailModal';
import { getOzonetelConfig } from '../../services/clients/telephonyApi';
import { AnimatePresence, motion } from 'framer-motion';
import { parseFromField, stripHtml } from '../../components/xyne-desk/EmailComposer/helpers';
import { EmailBodyRenderer } from '../../components/xyne-desk/EmailBody/EmailBodyRenderer';
import CallThread from '../../components/xyne-desk/CallThread/CallThread';
import { SlackThread, SlackComposer } from '../../components/xyne-desk/SlackThread';
import { SocialMediaReplyComposer } from '../../components/xyne-desk/DeskReplyComposer';
import { startGooglePlayOAuth } from '../../services/clients/socialMediaDeskApi';
import { EmailThreadHeader } from '../../components/xyne-desk/EmailBody/EmailThreadHeader';
import { CloudAgentDock } from '../../components/xyne-desk/CloudAgentDock/CloudAgentDock';
import { DeskCalendarView } from '../../components/xyne-desk/DeskCalendar/DeskCalendarView';
import { ConversationLabels } from '../../components/xyne-desk/ConversationLabels/ConversationLabels';
import { TicketTagsRow } from '../../components/xyne-desk/EmailBody/TagsBadgePopover';
import { useEmailDrafts } from '../../hooks/useEmailDraft';
import {
  useComposeDrafts,
  useComposeDraftOperations,
  type ComposeDraftRecord,
} from '../../hooks/useComposeDraft';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { DeskDraftSubtree } from '../../components/xyne-desk/DeskFolders/DeskDraftSubtree';
import { DeskLabelsSidebar } from '../../components/xyne-desk/DeskFolders/DeskLabelsSidebar';
import {
  DeskMailboxSidebar,
  type MailboxFolder,
} from '../../components/xyne-desk/DeskFolders/DeskMailboxSidebar';
import { MailboxActions } from '../../components/xyne-desk/MailboxActions/MailboxActions';
import { useMarkEmailRead } from '../../hooks/useMarkEmailRead';
import { formatFileSize } from '../../components/ui/utils/files';
import { createPreviewUrl, downloadFile } from '../../services/clients/fileFetchService';
import { apiInstance } from '../../services/clients/apiClient';
import { attachmentViewerActor, type AttachmentRef } from '../../machines/attachmentViewerMachine';

import { DeskSettings } from '../../components/xyne-desk/DeskSettings';
import { DeskMetricsDashboard } from '../../components/xyne-desk/DeskMetrics';
import { TopicsExplorer } from '../../components/xyne-desk/TopicsExplorer';
import { AutoLabelWizard } from '../../components/xyne-desk/AutoLabelWizard/AutoLabelWizard';
import { DeskReportPanel } from '../../components/xyne-desk/DeskReport';
import {
  useChannelIntegrationInfo,
  clearChannelConnectedEmailCache,
} from '../../hooks/useChannelConnectedEmail';
import AddChannelForm from '../../components/Chat/AddChannelForm/AddChannelForm';
import Info, { ChannelTab } from '../../components/Chat/Info/Info';
import { useVisibleChannel } from '../../hooks/useChannels';
import { API_BASE_URL } from '../../config';
import { useShareableOrigin } from '../../hooks/useShareableOrigin';
import { initDeskChannelOAuth } from '../../services/clients/integrationOAuthApi';
import Dialog from '../../components/ui/Dialog';
import { MergeTicketsDialog } from '../../components/Tickets/MergeTicketsDialog/MergeTicketsDialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useSelector } from '@xstate/react';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import { useAskAiTicketContext } from '../../hooks/useAskAiTicketContext';
import {
  COLLAPSIBLE_FILTER_IDS,
  COLLAPSIBLE_FILTER_META,
  DeskFilterTrigger,
  type CollapsibleFilterId,
} from './DeskFilterTrigger';
import { useDeskToolbarOverflow } from './useDeskToolbarOverflow';
import { clearDeskContactsCache } from '../../hooks/useDeskContacts';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { trackAskAIOpened } from '../../services/otel/xyneAIMetrics';
import {
  channelService,
  CreateChannelFormData,
  EmailDeskOpts,
} from '../../services/Chat/channelService';
import { summarizeEmailThread } from '../../services/summarizeService';
import { CallParticipantsSelectionModal } from '../../components/Call/CallParticipantsSelectionModal';
import { ScheduleCallModal } from '../../components/Call/ScheduleCallModal/ScheduleCallModal';
import { WorkspaceDeskEmailCard } from '../../components/xyne-desk/WorkspaceDeskEmailCard/WorkspaceDeskEmailCard';
import { WorkspaceOzonetelCard } from '../../components/xyne-desk/WorkspaceOzonetelCard/WorkspaceOzonetelCard';

// Unified type for tickets from the supportTicketsFiltered query
type SupportTicket = QueryResultType<typeof queries.supportTicketsFilteredV3>[number];

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
      className='max-w-[620px] rounded-2xl overflow-hidden'
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

const composerOpenByConv = new Map<string, boolean>();

// ---------------------------------------------------------------------------
// Multi-compose types + localStorage helpers
// ---------------------------------------------------------------------------

/**
 * Represents one in-flight compose window. Each instance has a stable UUID
 * (`id`) that is used as the localStorage draft scope key, independent of
 * channelId — so two windows on the same channel keep separate drafts.
 */
interface ComposeInstance {
  /** Stable UUID. Used as composeDraftId inside EmailComposer. */
  id: string;
  channelId: string;
  minimized: boolean;
  /** Incremented to force-remount the inner EmailComposer when needed. */
  key: number;
  initialTo?: string[] | undefined;
}

/** Persisted shape — only the stable fields, no ephemeral UI state. */
interface PersistedComposeInstance {
  id: string;
  channelId: string;
  /**
   * When `true` the window was explicitly closed (X) and the draft was
   * intentionally saved. Such instances are surfaced in the Drafts list
   * rather than auto-restored as minimized windows on channel revisit.
   */
  closedAsDraft?: boolean;
  /** Unix ms timestamp of when the draft was last saved/closed. */
  savedAt?: number;
}

/** Desk types with no "new message" concept: calls aren't composed, and Slack/app
 *  desks can only reply into a thread that already exists externally. */
const COMPOSE_DISABLED_CHANNEL_TYPES: ReadonlySet<ChannelType | undefined> = new Set([
  ChannelType.CALL,
  ChannelType.SLACK,
  ChannelType.APP,
  ChannelType.SOCIAL_MEDIA,
]);

const COMPOSE_INSTANCES_KEY_PREFIX = 'xyne:composeInstances:';
const COMPOSE_DRAFT_KEY_PREFIX = 'xyne:composeDraft:';
const COMPOSE_DRAFT_META_KEY_PREFIX = 'xyne:composeDraftMeta:';
const COMPOSE_DRAFTS_MIGRATED_KEY_PREFIX = 'xyne:composeDraftsMigratedV1:';

/** Legacy localStorage compose-draft payload — read only for the one-time migration. */
interface LegacyComposeDraftPayload {
  subject?: string;
  body?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{ attachmentId: string }>;
}

const readPersistedInstances = (userId: string): PersistedComposeInstance[] => {
  try {
    const raw = localStorage.getItem(`${COMPOSE_INSTANCES_KEY_PREFIX}${userId}`);
    if (!raw) return [];
    return JSON.parse(raw) as PersistedComposeInstance[];
  } catch {
    return [];
  }
};

/** Reads a legacy localStorage compose draft (used only for the one-time server migration). */
const readLegacyComposeDraft = (
  userId: string,
  instanceId: string,
): LegacyComposeDraftPayload | null => {
  try {
    const raw = localStorage.getItem(`${COMPOSE_DRAFT_KEY_PREFIX}${userId}:${instanceId}`);
    if (!raw) return null;
    return JSON.parse(raw) as LegacyComposeDraftPayload;
  } catch {
    return null;
  }
};

const legacyComposeDraftHasContent = (d: LegacyComposeDraftPayload | null): boolean => {
  if (!d) return false;
  const bodyText = d.body ? stripHtml(d.body) : '';
  return (
    (d.subject?.trim().length ?? 0) > 0 ||
    bodyText.trim().length > 0 ||
    (d.to?.length ?? 0) > 0 ||
    (d.cc?.length ?? 0) > 0 ||
    (d.bcc?.length ?? 0) > 0 ||
    (d.attachments?.length ?? 0) > 0
  );
};

/** Removes all browser-local artefacts for a compose instance (display cache + legacy draft + AI draft). */
const clearComposeLocalCache = (userId: string, instanceId: string, channelId: string): void => {
  try {
    localStorage.removeItem(`${COMPOSE_DRAFT_META_KEY_PREFIX}${userId}:${instanceId}`);
    localStorage.removeItem(`${COMPOSE_DRAFT_KEY_PREFIX}${userId}:${instanceId}`);
    localStorage.removeItem(`xd-ai-draft:${channelId}_compose`);
    localStorage.removeItem(`xd-ai-draft:${instanceId}_compose`);
  } catch {
    /* ignore */
  }
};

/** Display label for a server compose-draft row in the Drafts list. */
const composeDraftLabel = (d: ComposeDraftRecord): string => {
  const subject = d.subject?.trim();
  if (subject) return subject;
  const to = Array.isArray(d.toRecipients) ? d.toRecipients : [];
  if (to.length > 0 && to[0]) return `To: ${to[0]}`;
  const snippet = d.draftContent
    ? stripHtml(d.draftContent).replace(/\s+/g, ' ').trim().slice(0, 120)
    : '';
  return snippet || 'No subject';
};
type Email = NonNullable<QueryResultType<typeof queries.getEmailsForConversations>>[number];

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
  body,
}: {
  attachments: NonNullable<Email['attachments']>;
  conversationId?: string;
  channelId?: string;
  body?: string;
}): ReactElement | null => {
  const inlineCids = new Set<string>();
  const inlineAttachmentIds = new Set<string>();
  if (body) {
    const cidRe = /cid:([^\s"'>]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = cidRe.exec(body)) !== null) {
      if (m[1]) inlineCids.add(m[1].trim());
    }
    const dataAttRe = /data-att-id="([^"]+)"/gi;
    while ((m = dataAttRe.exec(body)) !== null) {
      if (m[1]) inlineAttachmentIds.add(m[1].trim());
    }
  }
  const visibleRows = rows.filter(r => {
    const meta = r.metadata as { contentId?: string } | null | undefined;
    if (meta?.contentId && inlineCids.has(meta.contentId)) return false;
    if (inlineAttachmentIds.has(r.id)) return false;
    return true;
  });

  if (!visibleRows || visibleRows.length === 0) return null;

  const images: AttachmentRef[] = visibleRows
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
      {visibleRows.map(att => {
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
              const toastId = toast.loading(`Downloading ${att.originalFilename}…`);
              downloadFile(att.id, att.originalFilename)
                .then(() => toast.success(`Downloaded ${att.originalFilename}`, { id: toastId }))
                .catch(() =>
                  toast.error(`Failed to download ${att.originalFilename}`, { id: toastId }),
                );
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

interface DemergeEmailResponse {
  success: boolean;
  newTicket: {
    ticketId: string;
    xyneId: string;
    conversationId: string;
  };
}

type ViewMode = 'kanban' | 'list' | 'table' | 'calendar';

const SupportScreen = (): ReactElement => {
  const {
    workspaceId,
    channelId: channelIdParam,
    ticketId,
  } = useParams<{
    workspaceId?: string;
    channelId?: string;
    ticketId?: string;
  }>();
  const supportBase = workspaceId ? `/${workspaceId}/support` : '/support';
  const navigate = useNavigate();
  // Gate the Tickets shortcut the same way the main rail gates '/projects'.
  const canAccessProjects = useHasResourceAccess('PROJECTS');
  const [searchParams, setSearchParams] = useSearchParams();
  const { userID } = useAuthContextValues();
  const { isMobile } = usePlatform();
  const zero = useZero();
  const queryClient = useQueryClient();
  // Channel selection is sourced strictly from the URL path (/support/:channelId).
  // A bare /support visit renders the empty state prompting the user to pick one.
  const selectedChannelId = channelIdParam ?? null;

  const [resolvedChannelBoard, setResolvedChannelBoard] = useState<{
    channelId: string;
    boardId: string;
  } | null>(null);
  const channelBoardId =
    resolvedChannelBoard?.channelId === selectedChannelId ? resolvedChannelBoard.boardId : null;
  const handleChannelBoardIdResolved = useCallback(
    (boardId: string): void => {
      if (selectedChannelId) {
        setResolvedChannelBoard({ channelId: selectedChannelId, boardId });
      }
    },
    [selectedChannelId],
  );
  const [kanbanTickets, setKanbanTickets] = useState<Ticket[]>([]);
  useEffect(() => {
    setKanbanTickets([]);
  }, [selectedChannelId]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('support-view-mode');
    return (saved as ViewMode) || 'list';
  });

  const setSelectedChannelId = useCallback(
    (next: string | null): void => {
      // Preserve non-routing query params but drop filter params and modal-open flags —
      // filters are persisted per channel (restored from sessionStorage), and modals like
      // ?metrics=open / ?settings=open should not carry over to a different channel.
      const params = new URLSearchParams(searchParams);
      clearTicketFilterParams(params);
      params.delete('metrics');
      params.delete('topics');
      params.delete('settings');
      const qs = params.toString();
      const path = next ? `${supportBase}/${next}` : supportBase;
      void navigate(qs ? `${path}?${qs}` : path, { replace: true });
    },
    [navigate, searchParams, supportBase],
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('support-sidebar-open');
    return saved ? saved === 'true' : true;
  });
  const [filtersState, sendFilters] = useMachine(ticketFiltersMachine);
  const filters = filtersState.context.filters;

  const setFilters = useCallback(
    (nextFilters: TicketFilters): void => {
      sendFilters({ type: 'SET_FILTERS', filters: nextFilters });
    },
    [sendFilters],
  );

  useEffect(() => {
    sendFilters({
      type: 'INIT',
      channelId: selectedChannelId ?? undefined,
      viewMode: 'support',
      enabled: !!selectedChannelId,
      searchParams,
      setSearchParams,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendFilters, selectedChannelId]);

  // Sync URL changes to the machine (browser back/forward)
  useEffect(() => {
    if (filtersState.value === 'initialized') {
      sendFilters({ type: 'URL_CHANGED', searchParams });
    }
  }, [searchParams, sendFilters, filtersState.value]);

  const [expandedDeskIds, setExpandedDeskIds] = useState<Set<string>>(new Set());
  const [selectedLabel, setSelectedLabel] = useState<{ id: string; name: string } | null>(null);
  // Active mailbox folder for the base ticket list (Inbox by default). Inbox / All Mail /
  // Starred / Spam filter the same rich list, rather than opening a separate view.
  const [selectedFolder, setSelectedFolder] = useState<{
    key: MailboxFolder;
    label: string;
  }>({ key: 'inbox', label: 'Inbox' });

  const preferenceChannelId =
    selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID ? selectedChannelId : null;
  const [channelPreferenceList, channelPreferenceDetails] = useCachedQuery(
    queries.getEmailChannelPreference({ channelId: preferenceChannelId || '' }),
    { enabled: !!preferenceChannelId },
  );
  const channelPreference = channelPreferenceList?.[0];
  const deskBoardId = channelPreference?.boardId || channelBoardId;
  const [channelBoardDetail, channelBoardDetailDetails] = useCachedQuery(
    queries.boardDetailById({ boardId: deskBoardId || '' }),
    { enabled: !!deskBoardId },
  );
  const deskDynamicFields = useMemo<ResolvedDisplayFormField[]>(() => {
    const fieldsMap = new Map<string, ResolvedDisplayFormField>();
    (channelBoardDetail?.formContextMappings ?? []).forEach(mapping => {
      const mappingWithFields = mapping as unknown as {
        formId?: string;
        formFields?: FormFields[];
      };
      const fields = mappingWithFields.formId
        ? resolveDisplayFormFields(mappingWithFields.formId, mappingWithFields.formFields ?? [])
        : [];
      fields.forEach(field => {
        if (!fieldsMap.has(field.id)) fieldsMap.set(field.id, field);
      });
    });
    return Array.from(fieldsMap.values());
  }, [channelBoardDetail]);

  const dynamicFieldTypesById = useMemo(
    () => new Map(deskDynamicFields.map(field => [field.id, field.fieldType])),
    [deskDynamicFields],
  );
  const dynamicFieldEntries = useMemo(
    () => buildDynamicFieldFilterEntries(filters.dynamicFields, dynamicFieldTypesById),
    [filters.dynamicFields, dynamicFieldTypesById],
  );

  const { selectedColumnKeys, toggleColumn } = useDeskTableColumns(selectedChannelId);
  const tableVisibleColumns = useMemo(
    () => new Set([...selectedColumnKeys].filter(key => !key.startsWith('df:'))),
    [selectedColumnKeys],
  );
  const tableDynamicFieldColumns = useMemo(
    () => deskDynamicFields.filter(field => selectedColumnKeys.has(dynamicColumnKey(field.id))),
    [deskDynamicFields, selectedColumnKeys],
  );

  const [tagFilterConversationIds, setTagFilterConversationIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!selectedChannelId || !filters.generatedTags || filters.generatedTags.length === 0) {
      setTagFilterConversationIds(null);
      return;
    }
    setTagFilterConversationIds([]); // [] during loading → shows 0 while waiting, not all tickets
    let cancelled = false;
    tagsConfigApi
      .filterConversationsByTags(selectedChannelId, filters.generatedTags)
      .then(ids => {
        if (!cancelled) setTagFilterConversationIds(ids);
      })
      .catch(() => {
        if (!cancelled) setTagFilterConversationIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChannelId, filters.generatedTags]);

  // Build the filter args once — reused by both the kanban query and the list view.
  // "My Tickets" toggle is the assignee fallback when the explicit assignee filter is empty.
  const ticketFilter = useMemo(
    () => ({
      assignedTo:
        filters.assignee && filters.assignee.length > 0
          ? filters.assignee
          : filters.assigned
            ? [userID]
            : undefined,
      createdBy: filters.createdBy && filters.createdBy.length > 0 ? filters.createdBy : undefined,
      priority: filters.priority && filters.priority.length > 0 ? filters.priority : undefined,
      stageName: filters.stages && filters.stages.length > 0 ? filters.stages : undefined,
      aiCategory:
        filters.aiCategory && filters.aiCategory.length > 0 ? filters.aiCategory : undefined,
      conversationIdWhitelist:
        filters.generatedTags && filters.generatedTags.length > 0
          ? (tagFilterConversationIds ?? [])
          : undefined,
      hasAiDraft: filters.hasAiDraft === true ? true : undefined,
      userGroups:
        filters.userGroups && filters.userGroups.length > 0 ? filters.userGroups : undefined,
      lastEmailAtStart: filters.lastEmailAtStart,
      lastEmailAtEnd: filters.lastEmailAtEnd,
      createdAtStart: filters.createdDateStart,
      createdAtEnd: filters.createdDateEnd,
      dynamicFieldFilters: toDynamicFieldQueryFilters(dynamicFieldEntries),
      // Sidebar label view (selectedLabel) takes precedence over the More-Filters label pick.
      conversationLabelId: selectedLabel?.id ?? filters.conversationLabelId,
    }),
    [filters, userID, dynamicFieldEntries, tagFilterConversationIds, selectedLabel?.id],
  );

  const availablePriorities = useMemo(() => Object.values(TicketPriority), []);

  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [autoLabelWizardOpen, setAutoLabelWizardOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Radix replays outside-dismissal on `click` with the original pointerdown target, which is
  // already detached when a submenu button unmounts itself (AI Tags category drill-down), so the
  // `closest('[data-filter-submenu]')` guard below misses it. Remember the exact node the
  // pointerdown started on — matching on identity means a pointerdown that never leads to a
  // dismissal (touch scroll, Escape) can't latch and swallow a later, genuine outside click.
  const submenuPointerDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    if (!moreFiltersOpen) {
      setActiveSubmenu(null);
    }
  }, [moreFiltersOpen]);

  const [filterOptionsEnabled, setFilterOptionsEnabled] = useState(false);
  useEffect(() => {
    if (moreFiltersOpen) {
      setFilterOptionsEnabled(true);
    }
  }, [moreFiltersOpen]);

  const [classificationMappings] = useCachedQuery(
    queries.getClassificationMappings({ channelId: selectedChannelId ?? '' }),
    {
      enabled: filterOptionsEnabled && !!selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID,
    },
  );
  // Categories the AI actually assigned to tickets. The AI emits free-form values, so the
  // configured mappings only cover the subset that has an assignment rule — without this the
  // filter hides every unmapped category that is visibly labelled on the list.
  const [ticketAiCategories, setTicketAiCategories] = useState<string[]>([]);
  const aiCategoriesChannelId =
    filterOptionsEnabled && selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID
      ? selectedChannelId
      : null;

  useEffect(() => {
    if (!aiCategoriesChannelId) {
      setTicketAiCategories([]);
      return;
    }
    let cancelled = false;
    classificationApi
      .getAiCategories(aiCategoriesChannelId)
      .then(categories => {
        if (!cancelled) setTicketAiCategories(categories);
      })
      .catch(() => {
        if (!cancelled) setTicketAiCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [aiCategoriesChannelId]);

  const availableAiCategories = useMemo(() => {
    const merged = [
      ...new Set([
        ...(classificationMappings ?? [])
          .map(m => m.category)
          .filter((c): c is string => Boolean(c)),
        ...ticketAiCategories,
      ]),
    ];
    if (merged.length === 0) return [];
    if (!merged.includes('Other')) {
      merged.push('Other');
    }
    return merged;
  }, [classificationMappings, ticketAiCategories]);

  const availableStages = useMemo(
    () =>
      channelBoardDetail?.stages.map(s => ({
        name: s.name,
        status: s.defaultTicketStatusV2,
      })) ?? [],
    [channelBoardDetail?.stages],
  );

  const hasAssigneeFilter = !!(filters.assignee && filters.assignee.length > 0);
  const hasPriorityFilter = !!(filters.priority && filters.priority.length > 0);
  const hasStagesFilter = !!(filters.stages && filters.stages.length > 0);
  const moreFiltersActiveCount =
    (filters.assigned ? 1 : 0) +
    (filters.hasAiDraft === true ? 1 : 0) +
    (filters.aiCategory && filters.aiCategory.length > 0 ? 1 : 0) +
    (filters.generatedTags && filters.generatedTags.length > 0 ? 1 : 0) +
    (filters.userGroups && filters.userGroups.length > 0 ? 1 : 0) +
    (filters.createdBy && filters.createdBy.length > 0 ? 1 : 0) +
    (filters.lastEmailAtStart !== undefined || filters.lastEmailAtEnd !== undefined ? 1 : 0) +
    (filters.createdDateStart !== undefined || filters.createdDateEnd !== undefined ? 1 : 0) +
    (filters.dynamicFields ? Object.keys(filters.dynamicFields).length : 0) +
    (!selectedLabel && filters.conversationLabelId ? 1 : 0);
  const hasMoreFiltersActive = moreFiltersActiveCount > 0;
  const hasAnyFilterActive =
    hasAssigneeFilter || hasPriorityFilter || hasStagesFilter || hasMoreFiltersActive;

  const {
    rowRef: filterRowRef,
    filterTwinRef,
    staticLeftRef: filterStaticLeftRef,
    actionsRestRef,
    columnsWideTwinRef,
    columnsNarrowTwinRef,
    isColumnsLabelled,
    collapsedFilterIds,
    hasCollapsedFilters,
    isFilterVisibleOnBar,
  } = useDeskToolbarOverflow({ showColumnsPicker: viewMode === 'table' });

  // Shown on the "Filters" trigger once anything is folded, so an active-but-hidden filter
  // still announces itself instead of silently disappearing.
  const collapsedActiveFilterCount = useMemo(() => {
    const activeById: Record<CollapsibleFilterId, boolean> = {
      assignee: hasAssigneeFilter,
      priority: hasPriorityFilter,
      stages: hasStagesFilter,
    };
    const foldedActive = collapsedFilterIds.filter(id => activeById[id]).length;
    return foldedActive + moreFiltersActiveCount;
  }, [
    collapsedFilterIds,
    hasAssigneeFilter,
    hasPriorityFilter,
    hasStagesFilter,
    moreFiltersActiveCount,
  ]);

  const handleFilterChange = useCallback(
    (key: keyof TicketFilters, value: unknown): void => {
      const newFilters = { ...filters, [key]: value };
      // Remove undefined/empty values
      Object.keys(newFilters).forEach((filterKey: string) => {
        const k = filterKey as keyof TicketFilters;
        const filterValue = newFilters[k];
        if (
          filterValue === undefined ||
          filterValue === null ||
          (Array.isArray(filterValue) && filterValue.length === 0)
        ) {
          delete newFilters[k];
        }
      });
      setFilters(newFilters);
    },
    [filters, setFilters],
  );

  const handleDateRangeChange = useCallback(
    (range: DateRangeValue): void => {
      const newFilters = {
        ...filters,
        lastEmailAtStart: range.startDate.getTime(),
        lastEmailAtEnd: range.endDate.getTime(),
      };
      Object.keys(newFilters).forEach((filterKey: string) => {
        const k = filterKey as keyof TicketFilters;
        const filterValue = newFilters[k];
        if (
          filterValue === undefined ||
          filterValue === null ||
          (Array.isArray(filterValue) && filterValue.length === 0)
        ) {
          delete newFilters[k];
        }
      });
      setFilters(newFilters);
    },
    [filters, setFilters],
  );

  const handleCreatedDateRangeChange = useCallback(
    (range: DateRangeValue): void => {
      const newFilters = {
        ...filters,
        createdDateStart: range.startDate.getTime(),
        createdDateEnd: range.endDate.getTime(),
      };
      Object.keys(newFilters).forEach((filterKey: string) => {
        const k = filterKey as keyof TicketFilters;
        const filterValue = newFilters[k];
        if (
          filterValue === undefined ||
          filterValue === null ||
          (Array.isArray(filterValue) && filterValue.length === 0)
        ) {
          delete newFilters[k];
        }
      });
      setFilters(newFilters);
    },
    [filters, setFilters],
  );

  const handleMenuItemClick = useCallback((category: string): void => {
    setActiveSubmenu(prev => (prev === category ? null : category));
  }, []);

  const handleDynamicFieldChange = useCallback(
    (fieldId: string, value: string[] | { start?: number; end?: number }): void => {
      const newFilters = { ...filters };
      const dynamicFields = { ...newFilters.dynamicFields };
      const isEmpty = Array.isArray(value) ? value.length === 0 : !value.start && !value.end;
      if (isEmpty) {
        delete dynamicFields[fieldId];
      } else {
        dynamicFields[fieldId] = value;
      }
      if (Object.keys(dynamicFields).length === 0) {
        delete newFilters.dynamicFields;
      } else {
        newFilters.dynamicFields = dynamicFields;
      }
      setFilters(newFilters);
    },
    [filters, setFilters],
  );

  // Assignee, Priority and Stages/Status are top-level popover buttons while the row has
  // room for them, and fold in here (highest-priority first) once it doesn't — see
  // `collapsedFilterIds`. The rest of the filters always live in this menu. The "Label"
  // filter is hidden while a sidebar label view is active (`selectedLabel`): the whole list
  // is already scoped to that label, so a second label picker is redundant.
  const filterMenuItems = useMemo(() => {
    const items = [
      ...collapsedFilterIds.map(id => ({
        id: id as string,
        label: COLLAPSIBLE_FILTER_META[id].label,
        icon: COLLAPSIBLE_FILTER_META[id].icon,
      })),
      { id: 'aiCategory', label: 'AI Category', icon: Sparkles },
      { id: 'generatedTags', label: 'AI Tags', icon: TagIcon },
      { id: 'userGroups', label: 'User Groups', icon: Users },
      { id: 'createdBy', label: 'Created by', icon: User },
      { id: 'date', label: 'Last updated', icon: CalendarDays },
      { id: 'createdDate', label: 'Created at', icon: CalendarDays },
      ...deskDynamicFields.map(field => ({
        id: `dynamic-${field.id}`,
        label: field.fieldName,
        icon: getIconForFieldType(field.fieldType),
        dynamicFieldId: field.id,
      })),
    ];
    if (!selectedLabel) {
      items.push({ id: 'conversationLabel', label: 'Label', icon: TagIcon });
    }
    return items;
  }, [collapsedFilterIds, deskDynamicFields, selectedLabel]);

  const renderSubmenu = useCallback((): ReactElement | null => {
    if (!activeSubmenu) return null;
    if (activeSubmenu.startsWith('dynamic-')) {
      const field = deskDynamicFields.find(f => `dynamic-${f.id}` === activeSubmenu);
      if (!field) return null;
      return (
        <DynamicFieldSubmenu
          fieldId={field.id}
          fieldName={field.fieldName}
          fieldType={field.fieldType}
          fieldEnum={parseFieldOptionValues(field.fieldEnum)}
          selectedValue={filters.dynamicFields?.[field.id]}
          onChange={value => handleDynamicFieldChange(field.id, value)}
          onClose={() => setActiveSubmenu(null)}
        />
      );
    }
    switch (activeSubmenu) {
      case 'assignee':
        return (
          <UserSubmenu
            key='assignee-submenu'
            selectedUsers={filters.assignee || []}
            onChange={(users: string[]) => handleFilterChange('assignee', users)}
            label='Assignee'
          />
        );
      case 'priority':
        return (
          <PrioritySubmenu
            selectedPriorities={filters.priority || []}
            onChange={(priorities: TicketPriority[]) => handleFilterChange('priority', priorities)}
            availablePriorities={availablePriorities}
          />
        );
      case 'stages':
        return (
          <StagesSubmenu
            selectedStages={filters.stages || []}
            onChange={(stages: string[]) => handleFilterChange('stages', stages)}
            availableStages={availableStages}
            isLoading={!!deskBoardId && channelBoardDetailDetails.type !== 'complete'}
          />
        );
      case 'aiCategory':
        return (
          <AICategorySubmenu
            selectedCategories={filters.aiCategory || []}
            onChange={(categories: string[]) => handleFilterChange('aiCategory', categories)}
            availableCategories={availableAiCategories}
          />
        );
      case 'generatedTags':
        return (
          <GeneratedTagsSubmenu
            selectedTags={filters.generatedTags || []}
            onChange={(tags: string[]) => handleFilterChange('generatedTags', tags)}
            channelId={selectedChannelId}
          />
        );
      case 'userGroups':
        return (
          <UserGroupSubmenu
            selectedGroups={filters.userGroups || []}
            onChange={(groups: string[]) => handleFilterChange('userGroups', groups)}
            onClose={() => setActiveSubmenu(null)}
          />
        );
      case 'createdBy':
        return (
          <UserSubmenu
            key='created-by-submenu'
            selectedUsers={filters.createdBy || []}
            onChange={(users: string[]) => handleFilterChange('createdBy', users)}
            label='Created by'
            channelId={selectedChannelId ?? undefined}
          />
        );
      case 'date': {
        const currentRange: DateRangeValue | null =
          filters.lastEmailAtStart !== undefined && filters.lastEmailAtEnd !== undefined
            ? {
                startDate: new Date(filters.lastEmailAtStart),
                endDate: new Date(filters.lastEmailAtEnd),
              }
            : null;
        return (
          <div className='w-[252px] bg-background border border-border rounded-lg shadow-lg overflow-hidden'>
            <div className='p-1 border-b border-border'>
              {PRESETS.map(preset => {
                const v = preset.getValue();
                const isActive =
                  filters.lastEmailAtStart !== undefined &&
                  filters.lastEmailAtEnd !== undefined &&
                  Math.abs(filters.lastEmailAtStart - v.startDate.getTime()) < 1000 &&
                  Math.abs(filters.lastEmailAtEnd - v.endDate.getTime()) < 1000;
                return (
                  <button
                    key={preset.label}
                    type='button'
                    data-track-category='Support'
                    data-track-name='SelectDatePreset'
                    onClick={() => {
                      handleDateRangeChange(v);
                    }}
                    className={cn(
                      'flex w-full items-center rounded-sm px-2 py-1.5 text-sm select-none',
                      isActive
                        ? 'bg-accent text-foreground font-medium'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <CalendarView
              key='last-email-calendar'
              range={currentRange}
              onSelect={(range: DateRangeValue) => {
                handleDateRangeChange(range);
              }}
            />
          </div>
        );
      }
      case 'createdDate': {
        const currentCreatedRange: DateRangeValue | null =
          filters.createdDateStart !== undefined && filters.createdDateEnd !== undefined
            ? {
                startDate: new Date(filters.createdDateStart),
                endDate: new Date(filters.createdDateEnd),
              }
            : null;
        return (
          <div className='w-[252px] bg-background border border-border rounded-lg shadow-lg overflow-hidden'>
            <div className='p-1 border-b border-border'>
              {PRESETS.map(preset => {
                const v = preset.getValue();
                const isActive =
                  filters.createdDateStart !== undefined &&
                  filters.createdDateEnd !== undefined &&
                  Math.abs(filters.createdDateStart - v.startDate.getTime()) < 1000 &&
                  Math.abs(filters.createdDateEnd - v.endDate.getTime()) < 1000;
                return (
                  <button
                    key={preset.label}
                    type='button'
                    data-track-category='Support'
                    data-track-name='SelectCreatedAtPreset'
                    onClick={() => {
                      handleCreatedDateRangeChange(v);
                    }}
                    className={cn(
                      'flex w-full items-center rounded-sm px-2 py-1.5 text-sm select-none',
                      isActive
                        ? 'bg-accent text-foreground font-medium'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <CalendarView
              key='created-at-calendar'
              range={currentCreatedRange}
              onSelect={(range: DateRangeValue) => {
                handleCreatedDateRangeChange(range);
              }}
            />
          </div>
        );
      }
      case 'conversationLabel':
        return (
          <ConversationLabelSubmenu
            selectedLabelId={filters.conversationLabelId}
            onChange={(labelId?: string) => handleFilterChange('conversationLabelId', labelId)}
            channelId={selectedChannelId}
          />
        );
      default:
        return null;
    }
  }, [
    activeSubmenu,
    filters,
    handleFilterChange,
    handleDateRangeChange,
    handleCreatedDateRangeChange,
    handleDynamicFieldChange,
    availableAiCategories,
    availablePriorities,
    availableStages,
    deskBoardId,
    channelBoardDetailDetails.type,
    deskDynamicFields,
    selectedChannelId,
  ]);

  useEffect(() => {
    if (
      activeSubmenu &&
      COLLAPSIBLE_FILTER_IDS.includes(activeSubmenu as CollapsibleFilterId) &&
      !collapsedFilterIds.includes(activeSubmenu as CollapsibleFilterId)
    ) {
      setActiveSubmenu(null);
    }
  }, [activeSubmenu, collapsedFilterIds]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(
    () =>
      searchParams.get('settings') === 'open' || searchParams.get('openSettings') === 'signatures',
  );
  const [isMetricsOpen, setIsMetricsOpen] = useState(() => searchParams.get('metrics') === 'open');
  const [isReportOpen, setIsReportOpen] = useState(() => searchParams.get('report') === 'open');
  const [isTopicsOpen, setIsTopicsOpen] = useState(() => searchParams.get('topics') === 'open');
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [showDeskIntegrationsModal, setShowDeskIntegrationsModal] = useState(
    () =>
      searchParams.get('deskIntegrations') === 'open' ||
      searchParams.get('workspaceMailboxConnected') === 'true',
  );
  const [showRefetchDialog, setShowRefetchDialog] = useState(false);
  const [showDlMemberSyncDialog, setShowDlMemberSyncDialog] = useState(false);

  // ---------------------------------------------------------------------------
  // Multi-compose state — each entry is one floating compose window.
  // ---------------------------------------------------------------------------
  const [composeInstances, setComposeInstances] = useState<ComposeInstance[]>([]);

  // Server-backed compose drafts for the selected channel (synced across devices).
  // The composer itself autosaves each window's content; here we only read the list
  // and delete rows on discard.
  const { drafts: composeDraftRows, isLoaded: composeDraftRowsLoaded } =
    useComposeDrafts(selectedChannelId);
  const { deleteComposeDraft: deleteComposeDraftRow } =
    useComposeDraftOperations(selectedChannelId);

  /** Add a new compose window for the given channel. */
  const openNewCompose = useCallback((channelId: string, initialTo?: string[]): void => {
    const id = uuidv4();
    setComposeInstances(prev => [
      ...prev,
      { id, channelId, minimized: false, key: 0, initialTo: initialTo ?? [] },
    ]);
  }, []);

  const handleMailtoClick = useCallback(
    (email: string): void => {
      if (!selectedChannelId) return;
      openNewCompose(selectedChannelId, [email]);
    },
    [openNewCompose, selectedChannelId],
  );

  /**
   * Close a compose window. Its content is already persisted server-side by the
   * composer's autosave (and an empty draft deletes its own row), so closing just
   * removes the floating window — any saved draft stays in the Drafts list.
   */
  const closeCompose = useCallback((instanceId: string): void => {
    setComposeInstances(prev => prev.filter(i => i.id !== instanceId));
  }, []);

  /** Close a compose window and explicitly discard its draft. */
  const discardCompose = useCallback(
    (instanceId: string): void => {
      deleteComposeDraftRow(instanceId);
      if (userID) {
        const channelId =
          composeInstances.find(i => i.id === instanceId)?.channelId ?? selectedChannelId ?? '';
        clearComposeLocalCache(userID, instanceId, channelId);
      }
      setComposeInstances(prev => prev.filter(i => i.id !== instanceId));
    },
    [userID, deleteComposeDraftRow, composeInstances, selectedChannelId],
  );

  /** Permanently discard a saved draft (from the Drafts list). */
  const discardDraft = useCallback(
    (instanceId: string): void => {
      const channelId =
        composeDraftRows.find(d => d.id === instanceId)?.channelId ?? selectedChannelId ?? '';
      deleteComposeDraftRow(instanceId);
      if (userID) clearComposeLocalCache(userID, instanceId, channelId);
      setComposeInstances(prev => prev.filter(i => i.id !== instanceId));
    },
    [userID, deleteComposeDraftRow, composeDraftRows, selectedChannelId],
  );

  /** Reopen a saved draft as a compose window (the composer loads its content from the server). */
  const reopenDraft = useCallback(
    (instanceId: string): void => {
      const channelId =
        composeDraftRows.find(d => d.id === instanceId)?.channelId ?? selectedChannelId;
      if (!channelId) return;
      setComposeInstances(prev => {
        if (prev.find(i => i.id === instanceId)) return prev; // already open
        return [...prev, { id: instanceId, channelId, minimized: false, key: 0 }];
      });
    },
    [composeDraftRows, selectedChannelId],
  );

  /** Toggle minimized state for a single compose window. */
  const setComposeMinimized = useCallback((instanceId: string, minimized: boolean): void => {
    setComposeInstances(prev => prev.map(i => (i.id === instanceId ? { ...i, minimized } : i)));
  }, []);

  // One-time migration: push any browser-local compose drafts (saved before server-side
  // compose drafts existed) up to the server so in-flight work isn't lost. Idempotent
  // per user via a localStorage flag.
  useEffect(() => {
    if (!userID) return;
    const migratedKey = `${COMPOSE_DRAFTS_MIGRATED_KEY_PREFIX}${userID}`;
    try {
      if (localStorage.getItem(migratedKey) === 'true') return;
    } catch {
      return;
    }
    for (const inst of readPersistedInstances(userID)) {
      const legacy = readLegacyComposeDraft(userID, inst.id);
      if (!legacy || !legacyComposeDraftHasContent(legacy)) continue;
      void zero.mutate(
        mutators.emailDraft.upsertComposeDraft({
          id: inst.id,
          channelId: inst.channelId,
          ...(legacy.subject !== undefined && { subject: legacy.subject }),
          ...(legacy.body !== undefined && { draftContent: legacy.body }),
          ...(legacy.to !== undefined && { toRecipients: legacy.to }),
          ...(legacy.cc !== undefined && { ccRecipients: legacy.cc }),
          ...(legacy.bcc !== undefined && { bccRecipients: legacy.bcc }),
          ...(legacy.attachments !== undefined && {
            attachmentIds: legacy.attachments.map(a => a.attachmentId),
          }),
          updatedAt: Date.now(),
        }),
      );
    }
    try {
      localStorage.setItem(migratedKey, 'true');
    } catch {
      /* ignore */
    }
  }, [userID, zero]);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [infoDefaultTab, setInfoDefaultTab] = useState<ChannelTab>('about');

  const deeplinkConversationId = searchParams.get('conversationId');
  const deeplinkMessageId = searchParams.get('messageId');
  const [deeplinkConversation] = useCachedQuery(
    queries.getConversationByIdWithChannel({
      conversationId: deeplinkConversationId || '',
      channelId: selectedChannelId || '',
      isMember: true,
    }),
    { enabled: !!deeplinkConversationId && !!selectedChannelId },
  );
  useEffect(() => {
    if (!deeplinkConversationId || !selectedChannelId) return;
    const xyneId = deeplinkConversation?.ticket?.xyneId;
    if (!xyneId) return;
    const params = new URLSearchParams();
    if (deeplinkMessageId) params.set('messageId', deeplinkMessageId);
    const mailId = searchParams.get('mail');
    if (mailId) params.set('mail', mailId);
    const qs = params.toString();
    void navigate(`${supportBase}/${selectedChannelId}/${xyneId}${qs ? `?${qs}` : ''}`, {
      replace: true,
    });
  }, [
    deeplinkConversationId,
    deeplinkMessageId,
    selectedChannelId,
    deeplinkConversation,
    navigate,
    supportBase,
  ]);

  useEffect(() => {
    const emailError = searchParams.get('emailError');
    const emailConnected = searchParams.get('emailConnected');
    const emailReconnected = searchParams.get('emailReconnected');
    const channelFromCallback = searchParams.get('channel');
    const workspaceMailboxConnected = searchParams.get('workspaceMailboxConnected');
    const isDeskIntegrationsCallback = searchParams.get('deskIntegrations') === 'open';

    if (workspaceMailboxConnected === 'true' || isDeskIntegrationsCallback) {
      setShowDeskIntegrationsModal(true);
      if (workspaceMailboxConnected === 'true') {
        const email = searchParams.get('email');
        toast.success(email ? `Connected ${email}` : 'Shared mailbox connected');
        void queryClient.invalidateQueries({ queryKey: ['workspace-shared-mailbox-status'] });
      } else if (emailError) {
        toast.error(emailError);
      }
      setSearchParams(
        prev => {
          const p = new URLSearchParams(prev);
          p.delete('deskIntegrations');
          p.delete('workspaceMailboxConnected');
          p.delete('emailError');
          p.delete('email');
          p.delete('provider');
          return p;
        },
        { replace: true },
      );
    } else if (emailConnected === 'true' || emailReconnected === 'true') {
      const provider = searchParams.get('provider') ?? 'Email';
      const action = emailReconnected === 'true' ? 'reconnected' : 'connected';
      toast.success(
        `${provider.charAt(0).toUpperCase() + provider.slice(1)} mailbox ${action} successfully`,
      );
      // Bust the per-channel hook caches so the just-changed integration
      // state propagates immediately. Without this, the contacts hook (5h
      // TTL) would keep its pre-reconnect entry alive — the recipient
      // dropdown would show empty/stale until the cache expired.
      if (channelFromCallback) {
        clearChannelConnectedEmailCache(channelFromCallback);
        clearDeskContactsCache(channelFromCallback);
        void navigate(`${supportBase}/${channelFromCallback}`, { replace: true });
      } else {
        setSearchParams(
          prev => {
            const p = new URLSearchParams(prev);
            p.delete('emailConnected');
            p.delete('emailReconnected');
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
        void navigate(`${supportBase}/${channelFromCallback}`, { replace: true });
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

    const dlMemberSyncStarted = searchParams.get('dlMemberSyncStarted');
    if (dlMemberSyncStarted === 'true') {
      toast.success('Syncing older DL emails in background', {
        description: "We'll notify you when this finishes.",
      });
      setSearchParams(
        prev => {
          const p = new URLSearchParams(prev);
          p.delete('dlMemberSyncStarted');
          p.delete('provider');
          return p;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams, navigate, queryClient]);

  // Sync panel open/close with the URL so back button works correctly
  useEffect(() => {
    const isOpen =
      searchParams.get('settings') === 'open' || searchParams.get('openSettings') === 'signatures';
    setIsSettingsOpen(isOpen);
    // Clean up the openSettings param (used by "Add signature" deep-link)
    if (searchParams.get('openSettings') === 'signatures') {
      const base = selectedChannelId ? `${supportBase}/${selectedChannelId}` : supportBase;
      void navigate(`${base}?settings=open`, { replace: true });
    }
  }, [searchParams, navigate, selectedChannelId, supportBase]);

  useEffect(() => {
    setIsMetricsOpen(searchParams.get('metrics') === 'open');
    setIsTopicsOpen(searchParams.get('topics') === 'open');
  }, [searchParams]);

  useEffect(() => {
    setIsReportOpen(searchParams.get('report') === 'open');
  }, [searchParams]);

  useEffect(() => {
    localStorage.setItem('support-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('support-sidebar-open', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  // Derive EMAIL channels from already-loaded state (no extra Zero query).
  // channelStats are fetched inside the hook and merged onto each channel.
  const emailChannels = useEmailChannels();

  // Email channels are already sorted by the useEmailChannels hook
  const sortedEmailChannels = emailChannels;
  const userChannelStatuses = useUserChannelStatuses();
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
  const statusByChannelId = useMemo(() => {
    const map = new Map<string, (typeof userChannelStatuses)[number]>();
    for (const status of userChannelStatuses) map.set(status.channelId, status);
    return map;
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
  // Used to gate member-only affordances (My Tickets toggle, fetch, settings)
  // and to flip the body to a Join-channel CTA when the user is on a public
  // channel they haven't joined yet.
  const isSelectedChannelJoined = !!selectedChannelId && joinedChannelIds.has(selectedChannelId);
  // Topics Explorer rolls up one desk at a time, behind the same preference as metrics.
  const canExploreTopics =
    isSelectedChannelJoined &&
    selectedChannelId !== ALL_CHANNELS_ID &&
    !!channelPreference?.metricsEnabled;

  const metricsSelectableDesks = useMemo(
    () =>
      sortedEmailChannels
        .filter(c => joinedChannelIds.has(c.id))
        .map(c => ({ id: c.id, name: c.name?.trim() || 'Untitled desk' })),
    [sortedEmailChannels, joinedChannelIds],
  );
  // A selected channelId that doesn't appear in useEmailChannels() means the
  // channel either doesn't exist or is a private channel the user isn't in —
  // in both cases we show a "Channel not found" message instead of the Join
  // CTA (there is nothing to join).
  const isSelectedChannelKnown =
    !!selectedChannelId && sortedEmailChannels.some(c => c.id === selectedChannelId);
  const isSelectedChannelStarred = !!selectedChannelId && starredChannelIds.has(selectedChannelId);
  const handleToggleSelectedChannelStar = useCallback((): void => {
    if (!selectedChannelId || selectedChannelId === ALL_CHANNELS_ID) return;
    void zero.mutate(
      mutators.channel.toggleStarred({ channelId: selectedChannelId, updatedAt: Date.now() }),
    );
  }, [selectedChannelId, zero]);

  useEffect(() => {
    if (!selectedChannelId || !isSelectedChannelJoined) return;
    const markViewed = (): void => {
      void zero.mutate(
        mutators.channel.markChannelAsViewed({
          channelId: selectedChannelId,
          timestamp: Date.now(),
          draftMessageId: uuidv4(),
          draftMessage: '',
        }),
      );
    };
    markViewed();
    return markViewed;
  }, [selectedChannelId, isSelectedChannelJoined]);
  const selectedChannelFull = useMemo(
    () => sortedEmailChannels.find(c => c.id === selectedChannelId),
    [sortedEmailChannels, selectedChannelId],
  );
  const selectedChannelName = selectedChannelFull?.name?.trim() || 'Xyne Desk';
  const isSocialMediaDesk = selectedChannelFull?.type === ChannelType.SOCIAL_MEDIA;

  // Manual fetch for the selected desk. Social-media desks fetch every review
  // currently available from Google; email desks open the range picker.
  const refetchChannelId =
    selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID ? selectedChannelId : undefined;
  const { refetch: handleRefetch, isPending: isRefetching } = useRefetchExternalSource(
    refetchChannelId,
    isSocialMediaDesk,
  );
  const canRefetch = !!refetchChannelId;
  const isDlDesk = channelPreference?.deskType === DeskType.DL;
  useEffect(() => {
    if (channelPreference?.boardId) {
      handleChannelBoardIdResolved(channelPreference.boardId);
    }
  }, [channelPreference?.boardId, handleChannelBoardIdResolved]);
  const { data: dlMemberSyncStatus } = useDlMemberSyncStatus(refetchChannelId, isDlDesk);
  const isDlMemberSyncing = dlMemberSyncStatus?.active === true;
  const dlMemberSyncTooltip = isDlMemberSyncing
    ? `Syncing older emails from ${dlMemberSyncStatus.memberEmail}`
    : 'Fetch latest emails or sync older DL emails';
  const { markAsRead: markBulkAsRead, markAsUnread: markBulkAsUnread } = useMarkTicketsAsRead();

  type SelectedTicket = {
    id: string;
    lastEmailAt: number;
    emailReads: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
    title: string;
    xyneId: string;
    createdAt: number;
    channelId: string;
    conversationId: string;
    stageName?: string | null | undefined;
    priority?: string | null | undefined;
    assignedTo?: string | null | undefined;
    userGroupId?: string | null | undefined;
    // The bulk bar routes stage changes by board type and creates labels under the
    // ticket's project, so both ids are captured with the selection.
    boardId?: string | null | undefined;
    projectId?: string | null | undefined;
  };
  const [selectedTickets, setSelectedTickets] = useState<Map<string, SelectedTicket>>(
    () => new Map(),
  );
  // Clear the selection on channel, folder OR label change — switching views hides the
  // previously-selected rows, so a stale selection would let bulk actions (mark-read,
  // merge) operate on tickets that aren't visible in the current view.
  useEffect(() => {
    setSelectedTickets(new Map());
  }, [selectedChannelId, selectedFolder.key, selectedLabel?.id]);
  const selectedTicketIds = useMemo(() => new Set(selectedTickets.keys()), [selectedTickets]);
  const toggleTicketSelected = useCallback(
    (row: {
      id: string;
      lastEmailAt: number;
      emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
      title: string;
      xyneId: string;
      createdAt: number;
      channelId: string;
      conversationId: string;
      stageName?: string | null | undefined;
      priority?: string | null | undefined;
      assignedTo?: string | null | undefined;
      userGroupId?: string | null | undefined;
      boardId?: string | null | undefined;
      projectId?: string | null | undefined;
    }): void => {
      setSelectedTickets(prev => {
        const next = new Map(prev);
        if (next.has(row.id)) {
          next.delete(row.id);
        } else {
          next.set(row.id, {
            id: row.id,
            lastEmailAt: row.lastEmailAt,
            emailReads: row.emailReads ?? [],
            title: row.title,
            xyneId: row.xyneId,
            createdAt: row.createdAt,
            channelId: row.channelId,
            conversationId: row.conversationId,
            stageName: row.stageName,
            priority: row.priority,
            assignedTo: row.assignedTo,
            userGroupId: row.userGroupId,
            boardId: row.boardId,
            projectId: row.projectId,
          });
        }
        return next;
      });
    },
    [],
  );
  const clearTicketSelection = useCallback((): void => {
    setSelectedTickets(new Map());
  }, []);
  const handleMarkSelectedAsRead = useCallback((): void => {
    if (selectedTickets.size === 0) return;
    const tickets = Array.from(selectedTickets.values());
    markBulkAsRead(tickets);
    setSelectedTickets(new Map());
  }, [selectedTickets, markBulkAsRead]);

  const handleMarkSelectedAsUnread = useCallback((): void => {
    if (selectedTickets.size === 0) return;
    const tickets = Array.from(selectedTickets.values());
    markBulkAsUnread(tickets);
    setSelectedTickets(new Map());
  }, [selectedTickets, markBulkAsUnread]);

  const handleToggleSelectAll = useCallback(
    (
      rows: ReadonlyArray<{
        id: string;
        lastEmailAt: number;
        emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
        title: string;
        xyneId: string;
        createdAt: number;
        channelId: string;
        conversationId: string;
        stageName?: string | null | undefined;
        priority?: string | null | undefined;
        assignedTo?: string | null | undefined;
        userGroupId?: string | null | undefined;
        boardId?: string | null | undefined;
        projectId?: string | null | undefined;
      }>,
      select: boolean,
    ): void => {
      setSelectedTickets(prev => {
        const next = new Map(prev);
        for (const row of rows) {
          if (select) {
            next.set(row.id, {
              id: row.id,
              lastEmailAt: row.lastEmailAt,
              emailReads: row.emailReads ?? [],
              title: row.title,
              xyneId: row.xyneId,
              createdAt: row.createdAt,
              channelId: row.channelId,
              conversationId: row.conversationId,
              stageName: row.stageName,
              priority: row.priority,
              assignedTo: row.assignedTo,
              userGroupId: row.userGroupId,
              boardId: row.boardId,
              projectId: row.projectId,
            });
          } else {
            next.delete(row.id);
          }
        }
        return next;
      });
    },
    [],
  );

  const handleTableSelectionChange = useCallback((tickets: Ticket[]): void => {
    setSelectedTickets(
      new Map(
        tickets.map(ticket => [
          ticket.id,
          {
            id: ticket.id,
            lastEmailAt: ticket.lastEmailAt ?? 0,
            emailReads:
              (
                ticket as Ticket & {
                  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
                }
              ).emailReads ?? [],
            title: ticket.title ?? '',
            xyneId: ticket.xyneId ?? '',
            createdAt: ticket.createdAt ?? 0,
            channelId: ticket.channelId ?? '',
            conversationId: ticket.conversationId ?? '',
            stageName: ticket.stageName,
            priority: ticket.priority,
            assignedTo: ticket.assignedTo,
            userGroupId: ticket.userGroupId,
            boardId: ticket.boardId,
            projectId: ticket.projectId,
          },
        ]),
      ),
    );
  }, []);

  // --- Bulk field edits over the current selection ---------------------------
  // The list view has no grid of its own, so the shared bulk bar is driven from
  // here; the table view renders the same bar from inside TicketTable.
  const { applyUpdates: applyBulkUpdates, applyTags: applyBulkTags } = useBulkTicketActions();

  const selectedTicketList = useMemo(() => Array.from(selectedTickets.values()), [selectedTickets]);

  // Active users in the selection's channel — see useBulkAssignableUsers.
  const bulkChannelId = useMemo(() => sharedChannelId(selectedTicketList), [selectedTicketList]);
  const deskUsers = useBulkAssignableUsers(bulkChannelId);

  // Every desk ticket lives on the channel's board, so the label catalog can be
  // read off whichever page of tickets is currently loaded.
  const deskProjectId = kanbanTickets[0]?.projectId;
  const [deskProjectTags] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId: deskProjectId ?? '' }),
    { enabled: !!deskProjectId },
  );
  const deskAvailableTags = useMemo(
    () => Array.from(new Set((deskProjectTags ?? []).map(tag => tag.name))).sort(),
    [deskProjectTags],
  );
  // No Stage control on boards that gate moves client-side (evaluateLinearStageGate) —
  // a bulk bar can't run per-ticket forms/approvals. NON_LINEAR is server-enforced.
  const deskBoardGatesStageMoves = useMemo(() => {
    if (channelBoardDetail?.boardType === BoardType.NON_LINEAR) return false;
    return (channelBoardDetail?.stages ?? []).some(
      stage =>
        (stage.approvers?.length ?? 0) > 0 ||
        (stage.formContextMappings ?? []).some(
          mapping => mapping.contextType === FormContextType.STAGE,
        ),
    );
  }, [channelBoardDetail?.boardType, channelBoardDetail?.stages]);

  const deskBulkStages = useMemo(
    () =>
      deskBoardGatesStageMoves
        ? []
        : availableStages.map(stage => ({ id: stage.name, name: stage.name })),
    [availableStages, deskBoardGatesStageMoves],
  );

  // A stage's default status must ride along in the same write — see BulkTicketUpdates.stage.
  const deskStageStatusByName = useMemo(
    () => new Map(availableStages.map(stage => [stage.name, stage.status])),
    [availableStages],
  );

  const handleBulkFieldUpdate = useCallback(
    (updates: BulkTicketUpdates): void => {
      if (selectedTicketList.length === 0) return;
      applyBulkUpdates(selectedTicketList, updates);
      clearTicketSelection();
    },
    [applyBulkUpdates, selectedTicketList, clearTicketSelection],
  );

  const handleBulkStageChange = useCallback(
    (name: string): void => {
      const statusV2 = deskStageStatusByName.get(name);
      handleBulkFieldUpdate({ stage: { name, ...(statusV2 ? { statusV2 } : {}) } });
    },
    [deskStageStatusByName, handleBulkFieldUpdate],
  );

  const handleBulkTagsChange = useCallback(
    (tags: string[]): void => {
      if (selectedTicketList.length === 0 || tags.length === 0) return;
      applyBulkTags(selectedTicketList, tags);
      clearTicketSelection();
    },
    [applyBulkTags, selectedTicketList, clearTicketSelection],
  );

  const handleMergeSelectedTickets = useCallback(
    async (parentTicketId: string, ticketIds: string[]): Promise<void> => {
      if (ticketIds.length < 2) return;
      try {
        await Promise.all(
          ticketIds
            .filter(id => id !== parentTicketId)
            .map(id =>
              apiInstance.post(`/tickets/${id}/merge`, { targetTicketId: parentTicketId }),
            ),
        );
        toast.success('Tickets merged');
        const parentTicket = selectedTickets.get(parentTicketId);
        clearTicketSelection();
        setShowMergeDialog(false);
        if (parentTicket) {
          void navigate(`${supportBase}/${parentTicket.channelId}/${parentTicket.xyneId}`, {
            state: {
              conversationId: parentTicket.conversationId,
              ticketId: parentTicket.id,
              fromDeskList: true,
            },
          });
        }
      } catch (error: unknown) {
        const err = error as {
          response?: { data?: { error?: string; message?: string } };
          message?: string;
        };
        toast.error('Merge failed', {
          description:
            err.response?.data?.error ||
            err.response?.data?.message ||
            err.message ||
            'Unknown error',
        });
      }
    },
    [selectedTickets, clearTicketSelection, navigate, supportBase],
  );

  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const mergeDialogTickets = useMemo(() => {
    // Build the parent-candidate list from the enriched selected-ticket map, which
    // persists across kanban pages — not from the current-page kanbanTickets. Using
    // kanbanTickets here would merge every selected ID while omitting off-page
    // selections as parent candidates, so multi-page selections could never pick an
    // off-page ticket as the parent.
    const selected = Array.from(selectedTickets.values());
    return [...selected].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }, [selectedTickets]);

  // Mutation for creating email channel
  const createChannelMutation = useMutation({
    mutationFn: async (
      data: CreateChannelFormData & {
        channelType?: 'EMAIL' | 'SLACK' | 'APP' | 'CALL' | undefined;
        emailDeskOpts?: EmailDeskOpts;
      },
    ) => {
      const { channelType, emailDeskOpts, ...formData } = data;
      const response = await channelService.createChannel(
        formData,
        channelType || 'EMAIL',
        emailDeskOpts ?? { deskType: DeskType.EMAIL },
      );
      return response;
    },
    onSuccess: () => {
      setShowCreateChannelModal(false);
      toast.success('Channel created successfully');
      void queryClient.invalidateQueries({ queryKey: ['app-desk-eligible-apps'] });
      void queryClient.invalidateQueries({ queryKey: ['slack-desk-channels'] });
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
      channelType?: 'EMAIL' | 'SLACK' | 'APP' | 'CALL' | 'SOCIAL_MEDIA' | undefined;
      assigneeUserGroupId?: string;
      deskType?: 'EMAIL' | 'DL' | 'SLACK' | 'APP' | 'CALL' | 'SOCIAL_MEDIA';
      callSource?: 'OZONETEL';
      dlEmail?: string;
      slackChannelId?: string;
      installedAppId?: string;
      applications?: Array<{ displayName: string; packageName: string }>;
    },
  ) => {
    const {
      connector,
      deskType,
      callSource,
      dlEmail,
      slackChannelId,
      installedAppId,
      applications,
      channelType: _submittedChannelType,
      ...rest
    } = data;
    const isElectron = typeof window.electronAPI?.openExternal === 'function';

    if (deskType === 'SOCIAL_MEDIA') {
      if (!applications?.length || !rest.boardId) {
        toast.error('At least one Google Play application and a board are required');
        return;
      }
      void startGooglePlayOAuth({
        channelName: rest.name,
        applications,
        projectId: rest.projectId,
        boardId: rest.boardId,
        ...(rest.assigneeUserGroupId && {
          assigneeUserGroupId: rest.assigneeUserGroupId,
        }),
        visibility: rest.visibility === 'public' ? 'PUBLIC' : 'PRIVATE',
        platform: isElectron ? 'electron' : 'web',
      })
        .then(authorizationUrl => {
          setShowCreateChannelModal(false);
          if (isElectron && window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(authorizationUrl);
          } else {
            window.location.href = authorizationUrl;
          }
        })
        .catch(error => {
          toast.error(error instanceof Error ? error.message : 'Failed to start Google Play OAuth');
        });
      return;
    }

    if (deskType === 'SLACK') {
      if (!slackChannelId) {
        toast.error('Please select a Slack channel');
        return;
      }
      createChannelMutation.mutate({
        ...rest,
        channelType: 'SLACK',
        emailDeskOpts: { deskType: DeskType.SLACK, slackChannelId },
      });
      return;
    }

    if (deskType === 'APP') {
      if (!installedAppId) {
        toast.error('Please select a Xyne App');
        return;
      }
      createChannelMutation.mutate({
        ...rest,
        channelType: 'APP',
        emailDeskOpts: { deskType: DeskType.APP, installedAppId },
      });
      return;
    }

    if (deskType === 'CALL') {
      void (async () => {
        if (callSource === 'OZONETEL') {
          try {
            const ozonetel = await getOzonetelConfig();
            if (!ozonetel.configured) {
              toast.error('Ozonetel is not configured. Set it up in Desk Integrations first.');
              return;
            }
          } catch {
            // Ignore preflight issues; channel creation can still continue.
          }
        }

        await createChannelMutation.mutateAsync({
          ...rest,
          channelType: 'CALL',
          emailDeskOpts: { deskType: DeskType.CALL },
        });
      })();
      return;
    }

    if (deskType === 'DL') {
      if (!dlEmail) {
        toast.error('Please select a distribution list');
        return;
      }
      createChannelMutation.mutate({
        ...rest,
        channelType: 'EMAIL',
        emailDeskOpts: { deskType: DeskType.DL, dlEmail },
      });
      return;
    }

    if (connector === 'microsoft') {
      if (isElectron && window.electronAPI?.openExternal) {
        void initDeskChannelOAuth('microsoft', {
          name: rest.name,
          projectId: rest.projectId,
          visibility: rest.visibility,
          ...(rest.description && { description: rest.description }),
          ...(rest.assigneeUserGroupId && { assigneeUserGroupId: rest.assigneeUserGroupId }),
          ...(rest.boardId && { boardId: rest.boardId }),
          platform: 'electron',
        })
          .then(authUrl => {
            window.electronAPI?.openExternal(authUrl);
            setShowCreateChannelModal(false);
          })
          .catch(error => {
            toast.error(error instanceof Error ? error.message : 'Failed to start Microsoft OAuth');
          });
      } else {
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
        if (rest.boardId) {
          params.set('boardId', rest.boardId);
        }
        const microsoftUrl = `${API_BASE_URL}/integrations/microsoft/connect?${params.toString()}`;
        window.location.href = microsoftUrl;
      }
      return;
    }

    if (connector === 'google') {
      if (isElectron && window.electronAPI?.openExternal) {
        void initDeskChannelOAuth('google', {
          name: rest.name,
          projectId: rest.projectId,
          visibility: rest.visibility,
          ...(rest.description && { description: rest.description }),
          ...(rest.assigneeUserGroupId && { assigneeUserGroupId: rest.assigneeUserGroupId }),
          ...(rest.boardId && { boardId: rest.boardId }),
          platform: 'electron',
        })
          .then(authUrl => {
            window.electronAPI?.openExternal(authUrl);
            setShowCreateChannelModal(false);
          })
          .catch(error => {
            toast.error(error instanceof Error ? error.message : 'Failed to start Google OAuth');
          });
      } else {
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
        if (rest.boardId) {
          params.set('boardId', rest.boardId);
        }
        const googleUrl = `${API_BASE_URL}/integrations/google/connect?${params.toString()}`;
        window.location.href = googleUrl;
      }
      return;
    }

    createChannelMutation.mutate(rest);
  };

  useEffect(() => {
    const connected = searchParams.get('socialMediaOAuth') === 'success';
    const error = searchParams.get('socialMediaError');
    const failedPackage = searchParams.get('socialMediaPackage');
    if (!connected && !error) return;
    if (connected) {
      toast.success('Google Play reviews connected successfully');
      if (selectedChannelId) clearChannelConnectedEmailCache(selectedChannelId);
    }
    if (error === 'google_play_package_validation_failed' && failedPackage) {
      toast.error('Google Play app connection failed', {
        description: `Could not access ${failedPackage}. Check its Play Console permissions.`,
      });
    } else if (error) {
      toast.error(error.replaceAll('_', ' '));
    }
    setSearchParams(
      previous => {
        const next = new URLSearchParams(previous);
        next.delete('socialMediaOAuth');
        next.delete('socialMediaError');
        next.delete('socialMediaPackage');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, selectedChannelId, setSearchParams]);

  const handleTicketClick = useCallback(
    (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => {
      const isCmdClick = 'metaKey' in e && (e.metaKey || e.ctrlKey);
      const ticketData = ticket as SupportTicket;
      const ticketUrl = `${supportBase}/${ticketData.channelId}/${ticketData.xyneId}`;

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
          fromDeskList: true,
        },
      });
    },
    [navigate, isMobile, supportBase],
  );

  // Saved compose drafts for the current channel that aren't currently open as a
  // window — shown in the Drafts banner and the Drafts view. Server-backed (synced).
  const savedDrafts = useMemo<ComposeDraftRecord[]>(() => {
    if (!selectedChannelId) return [];
    const openIds = new Set(composeInstances.map(i => i.id));
    return composeDraftRows
      .filter(d => !openIds.has(d.id))
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [selectedChannelId, composeInstances, composeDraftRows]);

  const toggleDeskExpanded = useCallback((id: string): void => {
    setExpandedDeskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const lastSelectedDeskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedChannelId || !isSelectedChannelJoined) {
      lastSelectedDeskRef.current = null;
      return;
    }
    const prev = lastSelectedDeskRef.current;
    lastSelectedDeskRef.current = selectedChannelId;
    if (prev === selectedChannelId) return;
    setExpandedDeskIds(prevSet => {
      const next = new Set(prevSet);
      if (prev) next.delete(prev);
      next.add(selectedChannelId);
      return next;
    });
  }, [selectedChannelId, isSelectedChannelJoined]);

  // Plain desk selection: return to the normal ticket list for the channel.
  const selectDesk = useCallback(
    (id: string): void => {
      setSelectedChannelId(id);
      // Clicking a channel lands on its Inbox (Gmail-style default) and expands its
      // folder subtree if it was collapsed.
      setSelectedFolder({ key: 'inbox', label: 'Inbox' });
      setExpandedDeskIds(prev => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setSelectedLabel(null);
    },
    [setSelectedChannelId],
  );

  // A label is just another filter dimension on the same ticket list: selecting one opens
  // the normal ticket list (list view) scoped to that label, so it gets the full Inbox
  // experience (rich rows, filters, view toggles, pagination) rather than a bare panel.
  const openLabel = useCallback(
    (channelId: string, labelId: string, labelName: string): void => {
      setSelectedChannelId(channelId);
      setSelectedLabel({ id: labelId, name: labelName });
      setViewMode('list');
      if (filters.conversationLabelId) {
        handleFilterChange('conversationLabelId', undefined);
      }
    },
    [setSelectedChannelId, filters.conversationLabelId, handleFilterChange],
  );

  const handleDeletedLabel = useCallback(
    (labelId: string): void => {
      if (selectedLabel?.id !== labelId) return;
      setSelectedLabel(null);
      setViewMode('list');
    },
    [selectedLabel?.id],
  );

  const openMailbox = useCallback(
    (channelId: string, folder: MailboxFolder, label: string): void => {
      setSelectedChannelId(channelId);
      setSelectedFolder({ key: folder, label });
      setSelectedLabel(null);
      // Folders filter the base ticket LIST in place. The kanban board doesn't apply the
      // folder, so selecting a folder switches to list view to avoid silently ignoring it.
      setViewMode('list');
    },
    [setSelectedChannelId],
  );

  const renderChannelRow = (c: (typeof sortedEmailChannels)[number]): ReactElement => {
    const isPrivate = c.visibility === ChannelVisibility.PRIVATE;
    const deskSource =
      c.type === ChannelType.SLACK
        ? {
            label: 'Slack',
            className:
              'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-200',
          }
        : c.type === ChannelType.APP
          ? {
              label: 'App',
              className:
                'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
            }
          : c.type === ChannelType.SOCIAL_MEDIA
            ? {
                label: 'Social',
                className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
              }
            : c.type === ChannelType.CALL
              ? {
                  label: 'Call',
                  className: 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-200',
                }
              : {
                  label: 'Mailbox',
                  className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200',
                };
    const isJoined = joinedChannelIds.has(c.id);
    const canExpandDesk = isJoined && c.type === ChannelType.EMAIL;
    const isExpanded = canExpandDesk && expandedDeskIds.has(c.id);
    const isActive = selectedChannelId === c.id;
    const status = statusByChannelId.get(c.id);
    const isMuted = status?.desktopNotificationLevel === NotificationLevel.NONE;
    const shouldShowBold =
      !isActive &&
      !isMuted &&
      !!status?.lastViewedAt &&
      !!c.channelStats?.lastActivityAt &&
      c.channelStats.lastActivityAt > status.lastViewedAt;
    return (
      <div key={c.id}>
        <div
          role='button'
          tabIndex={0}
          className={cn(
            'flex items-center gap-3 h-9 mt-px group rounded-[10px] px-3 border border-transparent cursor-pointer transition-colors',
            // The active highlight lives on the selected mailbox folder (Inbox) in the
            // subtree below, not on the channel header — so the channel row only gets text
            // emphasis when active, not a background.
            isActive
              ? 'text-sidebar-accent-foreground font-medium'
              : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent',
          )}
          onClick={() => selectDesk(c.id)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectDesk(c.id);
            }
          }}
          data-track-category='Support'
          data-track-name='SelectEmailChannel'
        >
          <span className='flex items-center gap-1 shrink-0'>
            {canExpandDesk ? (
              <button
                type='button'
                onClick={e => {
                  e.stopPropagation();
                  toggleDeskExpanded(c.id);
                }}
                className='size-4 flex items-center justify-center shrink-0 rounded'
                aria-label={isExpanded ? 'Collapse desk' : 'Expand desk'}
                data-track-category='Support'
                data-track-name='ToggleDeskExpand'
              >
                {isExpanded ? (
                  <ChevronDown size={12} strokeWidth={2.33} />
                ) : (
                  <ChevronRight size={12} strokeWidth={2.33} />
                )}
              </button>
            ) : (
              <span className='size-4 shrink-0' />
            )}
            <span className='size-4 flex items-center justify-center shrink-0'>
              {isPrivate ? <Lock size={14} /> : <Hash size={14} />}
            </span>
          </span>
          <span
            className={cn(
              'text-sm flex-1 truncate min-w-0',
              shouldShowBold && '!font-semibold text-sidebar-unread-foreground',
            )}
            style={shouldShowBold ? { fontWeight: 700 } : undefined}
          >
            {c.name?.trim() || 'Unnamed Channel'}
          </span>
          <Badge
            variant='secondary'
            className={cn(
              'flex-shrink-0 border-transparent px-1.5 py-0 text-[10px] font-medium leading-tight',
              deskSource.className,
            )}
          >
            {deskSource.label}
          </Badge>
        </div>
        {isExpanded && (
          <div className='mt-0.5 ml-3 pl-2 border-l border-border/60 flex flex-col gap-1'>
            <DeskMailboxSidebar
              activeFolder={
                selectedChannelId === c.id && viewMode === 'list' && !selectedLabel
                  ? selectedFolder.key
                  : null
              }
              onSelectFolder={(folder, label) => openMailbox(c.id, folder, label)}
            />
            <DeskDraftSubtree
              activeFolder={
                selectedChannelId === c.id && viewMode === 'list' && !selectedLabel
                  ? selectedFolder.key === 'drafts'
                    ? 'userDrafts'
                    : selectedFolder.key === 'sent'
                      ? 'userSent'
                      : null
                  : null
              }
              // Drafts and Sent are both folders on the ticket list (reply drafts / sent
              // emails roll up to their tickets); route them through openMailbox for the
              // same rich rows as Inbox. Compose drafts (no ticket) surface via the banner.
              onOpenUserDrafts={() => openMailbox(c.id, 'drafts', 'Drafts')}
              onOpenUserSent={() => openMailbox(c.id, 'sent', 'Sent')}
            />
            <DeskLabelsSidebar
              channelId={c.id}
              isMember={isJoined}
              activeLabelId={selectedChannelId === c.id && selectedLabel ? selectedLabel.id : null}
              onSelectLabel={(labelId, labelName) => openLabel(c.id, labelId, labelName)}
              onDeletedLabel={handleDeletedLabel}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-testid='support-page' className='h-full flex flex-col relative overflow-hidden'>
      <ResizableGroup
        orientation='horizontal'
        className='flex-1 overflow-hidden'
        autoSaveId='support-panel-layout'
        panelIds={
          ticketId
            ? ['ticket-detail']
            : isSidebarOpen && !isSettingsOpen
              ? ['sidebar', 'main']
              : ['main']
        }
      >
        {isSidebarOpen && !isSettingsOpen && !ticketId && (
          <>
            <Panel
              id='sidebar'
              defaultSize={SUPPORT_SIDEBAR_DEFAULT_WIDTH}
              minSize={SUPPORT_SIDEBAR_MIN_WIDTH}
              maxSize={SUPPORT_SIDEBAR_MAX_WIDTH}
              groupResizeBehavior='preserve-pixel-size'
            >
              <div
                className={cn('h-full w-full flex flex-col outline-none', isMobile && 'bg-sidebar')}
              >
                <div className='w-full h-[52px] shrink-0'>
                  <AppNavigator />
                </div>
                <div className='flex-1 min-h-0 px-3 pt-3 pb-12 sm:pb-0 flex flex-col border-t border-sidebar-border-muted'>
                  {/* Header */}
                  <div className='flex pt-2 pb-3 px-2 h-10 items-center justify-between mb-2'>
                    <h2 className='text-base font-semibold leading-normal text-sidebar-accent-foreground'>
                      Desks
                    </h2>
                    <div className='flex items-center gap-1'>
                      <button
                        onClick={() => setShowCreateChannelModal(true)}
                        className='p-1 rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        aria-label='Create channel'
                        title='Create channel'
                        data-track-category='Support'
                        data-track-name='CreateChannelOpen'
                      >
                        <Plus className='size-4' />
                      </button>
                      <button
                        onClick={() => setShowDeskIntegrationsModal(true)}
                        className='p-2 hover:bg-muted rounded-md transition-colors'
                        aria-label='Desk Integrations'
                        title='Desk Integrations'
                        data-track-category='Support'
                        data-track-name='OpenDeskIntegrations'
                      >
                        <Plug className='size-4 text-muted-foreground' />
                      </button>
                      <button
                        onClick={() => setIsSidebarOpen(false)}
                        className='p-1 rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        aria-label='Collapse sidebar'
                        title='Collapse sidebar'
                        data-track-category='Support'
                        data-track-name='CollapseChannelsSidebar'
                      >
                        <ChevronLeft className='size-4' />
                      </button>
                    </div>
                  </div>
                  {/* Tickets shortcut — jumps to the Projects/Tickets board.
                    Replaces the old rail icon; gated on PROJECTS access. */}
                  {canAccessProjects && (
                    <div className='shrink-0'>
                      <button
                        onClick={() => void navigate('/projects')}
                        className='flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        aria-label='Go to Tickets'
                        title='Tickets'
                        data-track-category='Support'
                        data-track-name='OpenTicketsFromSupport'
                      >
                        <span className='size-4 flex items-center justify-center shrink-0'>
                          <TicketIcon className='size-4' />
                        </span>
                        <span className='flex-1 min-w-0 text-left truncate block'>My Tickets</span>
                      </button>
                    </div>
                  )}
                  <div className='py-3 w-full' />
                  {/* Scrollable channel list */}
                  <div className='flex-1 min-h-0 overflow-y-scroll no-scrollbar pb-[calc(2.5rem+env(safe-area-inset-bottom))] px-0.5 pt-1 outline-none'>
                    {sortedEmailChannels.length === 0 ? (
                      <div className='flex flex-col items-center justify-center h-32 text-sidebar-foreground text-sm px-4 text-center'>
                        No channels available
                      </div>
                    ) : (
                      <div className='space-y-4'>
                        {starredEmailChannels.length > 0 && (
                          <div>
                            <div className='flex items-center h-7 px-3 text-sidebar-foreground text-xs font-medium'>
                              Starred
                            </div>
                            {starredEmailChannels.map(c => renderChannelRow(c))}
                          </div>
                        )}
                        {joinedEmailChannels.length > 0 && (
                          <div>
                            <div className='flex items-center h-7 px-3 text-sidebar-foreground text-xs font-medium'>
                              Joined
                            </div>
                            {joinedEmailChannels.map(c => renderChannelRow(c))}
                          </div>
                        )}
                        {notJoinedEmailChannels.length > 0 && (
                          <div>
                            <div className='flex items-center h-7 px-3 text-sidebar-foreground text-xs font-medium'>
                              Not joined
                            </div>
                            {notJoinedEmailChannels.map(c => renderChannelRow(c))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
            <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
              <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary'></div>
            </Separator>
          </>
        )}
        {/* `main` has no size constraints — the pixel-pinned sidebar takes its width and
            this panel grows to fill the rest. A percentage min/max here would fight the
            pin and force the sidebar to scale with the window again. */}
        {!ticketId && (
          <Panel id='main'>
            <div className='h-full flex flex-col relative bg-background'>
              <div className='flex-shrink-0 relative border-b border-border'>
                <div
                  className={cn(
                    'flex flex-col w-full transition-opacity duration-150',
                    selectedTicketIds.size > 0 && 'opacity-0 pointer-events-none',
                  )}
                >
                  <div className='flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 min-w-0'>
                    <div className='flex items-center gap-2 text-foreground min-w-0 flex-1'>
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
                      {selectedChannelId &&
                        selectedChannelId !== ALL_CHANNELS_ID &&
                        isSelectedChannelJoined && (
                          <Tooltip content={isSelectedChannelStarred ? 'Unstar' : 'Star'}>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleToggleSelectedChannelStar();
                              }}
                              className='h-7 w-7 rounded-lg shrink-0 text-muted-foreground hover:text-foreground'
                              aria-label={isSelectedChannelStarred ? 'Unstar desk' : 'Star desk'}
                              data-track-category='Support'
                              data-track-name='ToggleStarChannel'
                              data-track-metadata={JSON.stringify({
                                channelId: selectedChannelId,
                                isStarred: isSelectedChannelStarred,
                              })}
                            >
                              <Star
                                size={16}
                                variant={isSelectedChannelStarred ? 'Solid' : 'Stroke'}
                                className={isSelectedChannelStarred ? 'text-status-pending' : ''}
                              />
                            </Button>
                          </Tooltip>
                        )}
                      {selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID ? (
                        <Tooltip content='Get channel details' side='bottom' delayDuration={500}>
                          <button
                            onClick={() => {
                              setInfoDefaultTab('about');
                              setIsInfoOpen(true);
                            }}
                            className='text-base font-semibold tracking-[-0.32px] flex items-center gap-2 min-w-0 px-1.5 py-0.5 rounded-md hover:bg-muted transition-colors duration-100'
                            data-track-category='Support'
                            data-track-name='OpenChannelInfo'
                          >
                            <span className='shrink-0 inline-flex items-center leading-none'>
                              {selectedChannelFull ? (
                                <ChannelIcon channel={selectedChannelFull} />
                              ) : (
                                <Hashtag size={16} />
                              )}
                            </span>
                            <span className='truncate'>{selectedChannelName}</span>
                          </button>
                        </Tooltip>
                      ) : (
                        <span className='flex items-center gap-2 min-w-0 px-1.5 py-0.5'>
                          <Hashtag size={16} className='shrink-0' />
                          <span className='truncate'>{selectedChannelName}</span>
                        </span>
                      )}
                      {selectedLabel && (
                        <span className='ml-1 flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                          <TagIcon size={12} className='shrink-0' />
                          <span className='max-w-[160px] truncate'>{selectedLabel.name}</span>
                        </span>
                      )}
                    </div>
                    <div className='flex items-center gap-2 shrink-0'>
                      {selectedChannelId &&
                        selectedChannelId !== ALL_CHANNELS_ID &&
                        selectedChannelFull && (
                          <Button
                            variant='outline'
                            size='sm'
                            className='rounded-[10px] border-border hover:bg-muted text-muted-foreground'
                            onClick={() => {
                              setInfoDefaultTab('members');
                              setIsInfoOpen(true);
                            }}
                            data-track-category='Support'
                            data-track-name='ViewMembers'
                            data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
                            title='View members'
                          >
                            <Users2 size={16} />
                            <span>{selectedChannelFull.channelStats?.participantCount ?? 0}</span>
                          </Button>
                        )}
                      {canRefetch &&
                        isSelectedChannelJoined &&
                        (isDlDesk ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <span>
                                <Tooltip content={dlMemberSyncTooltip} side='bottom'>
                                  <button
                                    disabled={isRefetching}
                                    className={cn(
                                      'p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted',
                                      isRefetching && 'opacity-60 cursor-not-allowed',
                                    )}
                                    data-track-category='Support'
                                    data-track-name='SyncDropdown'
                                  >
                                    <RefreshCw
                                      size={16}
                                      className={cn(
                                        (isRefetching || isDlMemberSyncing) && 'animate-spin',
                                      )}
                                    />
                                  </button>
                                </Tooltip>
                              </span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end' className='w-80'>
                              <DropdownMenuItem
                                onClick={() => setShowRefetchDialog(true)}
                                data-track-category='Support'
                                data-track-name='OPEN_EMAIL_REFETCH_DIALOG'
                              >
                                <RefreshCw size={14} className='mr-2 shrink-0' />
                                <span className='flex min-w-0 flex-1 items-center justify-between gap-3'>
                                  <span className='truncate'>Fetch latest emails</span>
                                  <Tooltip
                                    content='Fetch recent emails from the connected shared mailbox for this desk.'
                                    side='left'
                                    className='max-w-72'
                                  >
                                    <InfoIcon
                                      size={13}
                                      className='shrink-0 text-muted-foreground'
                                      onClick={event => event.stopPropagation()}
                                    />
                                  </Tooltip>
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  if (!isDlMemberSyncing) setShowDlMemberSyncDialog(true);
                                }}
                                data-track-category='Support'
                                data-track-name='OPEN_DL_MEMBER_SYNC_DIALOG'
                                disabled={isDlMemberSyncing}
                              >
                                <UserPlus size={14} className='mr-2 shrink-0' />
                                <span className='flex min-w-0 flex-1 items-center justify-between gap-3'>
                                  <span className='truncate'>
                                    {isDlMemberSyncing
                                      ? 'Older email sync in progress'
                                      : 'Sync older emails'}
                                  </span>
                                  <Tooltip
                                    content='Fetch emails sent to this distribution list before the shared mailbox was added. Sign in with a member mailbox that has the older emails.'
                                    side='left'
                                    className='max-w-72'
                                  >
                                    <InfoIcon
                                      size={13}
                                      className='shrink-0 text-muted-foreground'
                                      onClick={event => event.stopPropagation()}
                                    />
                                  </Tooltip>
                                </span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <Tooltip
                            content={
                              isRefetching
                                ? 'Fetching latest…'
                                : isSocialMediaDesk
                                  ? 'Fetch all available Google Play reviews'
                                  : 'Fetch latest emails'
                            }
                            side='bottom'
                          >
                            <button
                              onClick={() =>
                                isSocialMediaDesk ? handleRefetch() : setShowRefetchDialog(true)
                              }
                              disabled={isRefetching}
                              className={cn(
                                'p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted',
                                isRefetching && 'opacity-60 cursor-not-allowed',
                              )}
                              data-track-category='Support'
                              data-track-name='RefetchExternalSource'
                              data-track-metadata={JSON.stringify({ channelId: refetchChannelId })}
                            >
                              <RefreshCw size={16} className={cn(isRefetching && 'animate-spin')} />
                            </button>
                          </Tooltip>
                        ))}
                      {isSelectedChannelJoined && selectedChannelId !== ALL_CHANNELS_ID && (
                        <Tooltip content='Ask AI' side='bottom'>
                          <button
                            onClick={() => {
                              if (!selectedChannelId) return;
                              trackAskAIOpened(
                                emailChannels?.find(c => c.id === selectedChannelId)?.scopeType,
                              );
                              xyneAIActor.send({ type: 'OPEN', channelId: selectedChannelId });
                            }}
                            className='p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-accent'
                            data-track-category='Support'
                            data-track-name='OPEN_XYNE_AI'
                            data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
                          >
                            <XyneAIStar />
                          </button>
                        </Tooltip>
                      )}
                      {isSelectedChannelJoined &&
                        selectedChannelId !== ALL_CHANNELS_ID &&
                        channelPreference?.metricsEnabled && (
                          <Tooltip content='Desk metrics' side='bottom'>
                            <button
                              onClick={() => {
                                const base = selectedChannelId
                                  ? `${supportBase}/${selectedChannelId}`
                                  : supportBase;
                                if (isMetricsOpen) {
                                  void navigate(base, { replace: true });
                                } else {
                                  void navigate(`${base}?metrics=open`);
                                }
                              }}
                              className={cn(
                                'p-1.5 rounded transition-colors',
                                isMetricsOpen
                                  ? 'bg-muted text-foreground'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                              )}
                              data-track-category='Support'
                              data-track-name='OpenDeskMetrics'
                              data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
                            >
                              <BarChart3 size={16} />
                            </button>
                          </Tooltip>
                        )}
                      {isSelectedChannelJoined &&
                        selectedChannelId !== ALL_CHANNELS_ID &&
                        channelPreference?.deskReportEnabled && (
                          <Tooltip content='Desk report' side='bottom'>
                            <button
                              onClick={() => {
                                const base = selectedChannelId
                                  ? `${supportBase}/${selectedChannelId}`
                                  : supportBase;
                                if (isReportOpen) {
                                  void navigate(base, { replace: true });
                                } else {
                                  void navigate(`${base}?report=open`);
                                }
                              }}
                              className={cn(
                                'p-1.5 rounded transition-colors',
                                isReportOpen
                                  ? 'bg-muted text-foreground'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                              )}
                              data-track-category='Support'
                              data-track-name='OpenDeskReport'
                              data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
                            >
                              <FileText size={16} />
                            </button>
                          </Tooltip>
                        )}
                      {canExploreTopics && (
                        <Tooltip content='Topics explorer' side='bottom'>
                          <button
                            type='button'
                            onClick={() => {
                              const base = `${supportBase}/${selectedChannelId}`;
                              if (isTopicsOpen) void navigate(base, { replace: true });
                              else void navigate(`${base}?topics=open`);
                            }}
                            className={cn(
                              'p-1.5 rounded transition-colors',
                              isTopicsOpen
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                            )}
                            data-track-category='Support'
                            data-track-name='OpenTopicsExplorer'
                            data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
                          >
                            <GridDashboard01 size={16} />
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
                                ? `${supportBase}/${selectedChannelId}`
                                : supportBase;
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
                    </div>
                  </div>
                  <div
                    ref={filterRowRef}
                    className='relative flex h-14 shrink-0 items-center justify-between gap-2 px-4 min-w-0'
                  >
                    {isSelectedChannelJoined && (
                      <div
                        aria-hidden
                        className='pointer-events-none invisible absolute left-0 top-0 -z-10 flex items-center gap-2'
                      >
                        <div ref={filterTwinRef} className='flex items-center gap-2'>
                          <DeskFilterTrigger id='assignee' active={hasAssigneeFilter} />
                          <DeskFilterTrigger id='priority' active={hasPriorityFilter} />
                          <DeskFilterTrigger id='stages' active={hasStagesFilter} />
                        </div>
                        {viewMode === 'table' && (
                          <>
                            <div ref={columnsWideTwinRef} className='flex items-center'>
                              <Button
                                variant='outline'
                                size='sm'
                                className='rounded-[10px] border-border text-muted-foreground'
                              >
                                <div className='flex items-center gap-1.5'>
                                  <Columns3 className='w-3.5 h-3.5' />
                                  <span className='font-medium'>Columns</span>
                                </div>
                              </Button>
                            </div>
                            <div ref={columnsNarrowTwinRef} className='flex items-center'>
                              <Button
                                variant='outline'
                                size='sm'
                                className='rounded-[10px] border-border text-muted-foreground'
                              >
                                <div className='flex items-center gap-1.5'>
                                  <Columns3 className='w-3.5 h-3.5' />
                                </div>
                              </Button>
                            </div>
                          </>
                        )}
                        <div ref={filterStaticLeftRef} className='flex items-center gap-2'>
                          {selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID && (
                            <span className='p-1.5'>
                              <Search size={16} />
                            </span>
                          )}
                          <Button
                            variant='outline'
                            size='sm'
                            className='rounded-[10px] border-border text-muted-foreground'
                          >
                            <div className='flex items-center gap-1.5'>
                              <ListFilter className='w-3 h-3 font-medium' />
                              <span className='font-medium'>More Filters</span>
                              <span className='w-1.5 h-1.5 rounded-full' />
                            </div>
                          </Button>
                          {hasAnyFilterActive && (
                            <Button
                              variant='outline'
                              size='sm'
                              className='rounded-[10px] border-border text-muted-foreground'
                            >
                              <div className='flex items-center gap-1.5'>
                                <X className='w-3 h-3' />
                                <span className='font-medium'>Clear</span>
                              </div>
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                    <div className='flex items-center gap-2 min-w-0 flex-1 overflow-hidden'>
                      {selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID && (
                        <Tooltip content='Search emails' side='bottom'>
                          <button
                            onClick={() => invokeShortcut('mod+f')}
                            className='p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                            data-track-category='Support'
                            data-track-name='OpenDeskSearch'
                            data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
                          >
                            <Search size={16} />
                          </button>
                        </Tooltip>
                      )}
                      {isSelectedChannelJoined && (
                        <>
                          {isFilterVisibleOnBar('assignee') && (
                            <Popover.Root open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                              <Popover.Trigger asChild>
                                <DeskFilterTrigger
                                  id='assignee'
                                  active={hasAssigneeFilter}
                                  open={assigneeOpen}
                                />
                              </Popover.Trigger>
                              <Popover.Content
                                side='bottom'
                                align='start'
                                sideOffset={6}
                                className='z-[60] min-w-[200px] bg-background border border-border rounded-lg shadow-lg'
                              >
                                <UserSubmenu
                                  key='assignee-popover-submenu'
                                  selectedUsers={filters.assignee || []}
                                  onChange={(users: string[]) =>
                                    handleFilterChange('assignee', users)
                                  }
                                  label='Assignee'
                                />
                              </Popover.Content>
                            </Popover.Root>
                          )}

                          {isFilterVisibleOnBar('priority') && (
                            <Popover.Root open={priorityOpen} onOpenChange={setPriorityOpen}>
                              <Popover.Trigger asChild>
                                <DeskFilterTrigger
                                  id='priority'
                                  active={hasPriorityFilter}
                                  open={priorityOpen}
                                />
                              </Popover.Trigger>
                              <Popover.Content
                                side='bottom'
                                align='start'
                                sideOffset={6}
                                className='z-[60]'
                              >
                                <PrioritySubmenu
                                  selectedPriorities={filters.priority || []}
                                  onChange={(priorities: TicketPriority[]) =>
                                    handleFilterChange('priority', priorities)
                                  }
                                  availablePriorities={availablePriorities}
                                />
                              </Popover.Content>
                            </Popover.Root>
                          )}

                          {isFilterVisibleOnBar('stages') && (
                            <Popover.Root open={stagesOpen} onOpenChange={setStagesOpen}>
                              <Popover.Trigger asChild>
                                <DeskFilterTrigger
                                  id='stages'
                                  active={hasStagesFilter}
                                  open={stagesOpen}
                                />
                              </Popover.Trigger>
                              <Popover.Content
                                side='bottom'
                                align='start'
                                sideOffset={6}
                                className='z-[60]'
                              >
                                <StagesSubmenu
                                  selectedStages={filters.stages || []}
                                  onChange={(stages: string[]) =>
                                    handleFilterChange('stages', stages)
                                  }
                                  availableStages={availableStages}
                                  isLoading={
                                    !!deskBoardId && channelBoardDetailDetails.type !== 'complete'
                                  }
                                />
                              </Popover.Content>
                            </Popover.Root>
                          )}

                          <Popover.Root open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
                            <Popover.Trigger asChild>
                              <Button
                                variant='outline'
                                size='sm'
                                className={cn(
                                  hasMoreFiltersActive ? 'border-border' : '',
                                  'rounded-[10px] border-border hover:bg-muted text-muted-foreground',
                                )}
                              >
                                <div className='flex items-center gap-1.5'>
                                  <ListFilter className='w-3 h-3 font-medium' />
                                  <span className='font-medium'>
                                    {hasCollapsedFilters ? 'Filters' : 'More Filters'}
                                  </span>
                                  {hasCollapsedFilters ? (
                                    collapsedActiveFilterCount > 0 && (
                                      <span className='ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white'>
                                        {collapsedActiveFilterCount}
                                      </span>
                                    )
                                  ) : hasMoreFiltersActive ? (
                                    <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />
                                  ) : null}
                                </div>
                              </Button>
                            </Popover.Trigger>

                            <Popover.Content
                              side='bottom'
                              align='start'
                              sideOffset={6}
                              className='w-56 bg-background border border-border rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto'
                              onInteractOutside={e => {
                                if (e.target === submenuPointerDownTargetRef.current) {
                                  submenuPointerDownTargetRef.current = null;
                                  e.preventDefault();
                                  return;
                                }
                                const target = e.target;
                                if (
                                  target instanceof Element &&
                                  target.closest('[data-filter-submenu="true"]')
                                ) {
                                  e.preventDefault();
                                } else {
                                  setActiveSubmenu(null);
                                }
                              }}
                            >
                              <div className='px-4 py-3 flex flex-col gap-3 border-b border-border'>
                                <button
                                  type='button'
                                  onClick={() => {
                                    setMoreFiltersOpen(false);
                                    setAutoLabelWizardOpen(true);
                                  }}
                                  className='flex w-full items-center gap-2 rounded-md px-0 py-0.5 text-left text-sm text-foreground hover:text-foreground'
                                  data-track-category='Support'
                                  data-track-name='OpenAutoLabelWizard'
                                >
                                  <Tag className='size-3.5 text-muted-foreground' />
                                  <span className='font-medium'>Auto-label…</span>
                                </button>
                                <div
                                  data-track-category='Support'
                                  data-track-name='ToggleMyTickets'
                                  data-track-metadata={JSON.stringify({
                                    assigned: !filters.assigned,
                                  })}
                                >
                                  <Switch
                                    checked={!!filters.assigned}
                                    onCheckedChange={checked =>
                                      handleFilterChange('assigned', checked ? true : undefined)
                                    }
                                    label='My tickets'
                                    aria-label='My tickets'
                                  />
                                </div>
                                <div
                                  data-track-category='Support'
                                  data-track-name='ToggleHasAiDraft'
                                  data-track-metadata={JSON.stringify({
                                    hasAiDraft: filters.hasAiDraft !== true,
                                  })}
                                >
                                  <Switch
                                    checked={filters.hasAiDraft === true}
                                    onCheckedChange={checked =>
                                      handleFilterChange('hasAiDraft', checked ? true : undefined)
                                    }
                                    label='AI draft'
                                    aria-label='Has AI draft'
                                  />
                                </div>
                              </div>
                              <div className='py-1'>
                                {filterMenuItems.map(item => {
                                  const Icon = item.icon;
                                  const isActive = activeSubmenu === item.id;
                                  const isFilterActive =
                                    (item.id === 'assignee' && hasAssigneeFilter) ||
                                    (item.id === 'priority' && hasPriorityFilter) ||
                                    (item.id === 'stages' && hasStagesFilter) ||
                                    (item.id === 'aiCategory' &&
                                      !!(filters.aiCategory && filters.aiCategory.length > 0)) ||
                                    (item.id === 'generatedTags' &&
                                      !!(
                                        filters.generatedTags && filters.generatedTags.length > 0
                                      )) ||
                                    (item.id === 'userGroups' &&
                                      !!(filters.userGroups && filters.userGroups.length > 0)) ||
                                    (item.id === 'createdBy' &&
                                      !!(filters.createdBy && filters.createdBy.length > 0)) ||
                                    (item.id === 'date' &&
                                      (filters.lastEmailAtStart !== undefined ||
                                        filters.lastEmailAtEnd !== undefined)) ||
                                    (item.id === 'createdDate' &&
                                      (filters.createdDateStart !== undefined ||
                                        filters.createdDateEnd !== undefined)) ||
                                    ('dynamicFieldId' in item &&
                                      !!filters.dynamicFields?.[item.dynamicFieldId]) ||
                                    (item.id === 'conversationLabel' &&
                                      !!filters.conversationLabelId);
                                  const menuButton = (
                                    <button
                                      ref={el => {
                                        menuItemRefs.current[item.id] = el;
                                      }}
                                      onClick={() => {
                                        handleMenuItemClick(item.id);
                                      }}
                                      className={cn(
                                        'w-full flex items-center justify-between px-4 py-2 text-sm',
                                        isActive ? 'bg-muted font-medium' : '',
                                        'hover:bg-muted',
                                      )}
                                      data-track-category='Support'
                                      data-track-name='OpenFilterSubmenu'
                                      data-track-metadata={JSON.stringify({
                                        filterId: item.id,
                                        filterLabel: item.label,
                                      })}
                                    >
                                      <div className='flex items-center gap-3'>
                                        <Icon className='w-4 h-4' />
                                        <span>{item.label}</span>
                                        {isFilterActive && (
                                          <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />
                                        )}
                                      </div>
                                      <ChevronRight className='w-4 h-4 text-muted-foreground' />
                                    </button>
                                  );
                                  return (
                                    <React.Fragment key={item.id}>{menuButton}</React.Fragment>
                                  );
                                })}
                              </div>
                            </Popover.Content>
                            {activeSubmenu && menuItemRefs.current[activeSubmenu] && (
                              <div
                                ref={submenuRef}
                                data-filter-submenu='true'
                                onPointerDownCapture={e => {
                                  submenuPointerDownTargetRef.current = e.target;
                                }}
                                className='fixed z-[60]'
                                style={{
                                  left:
                                    (menuItemRefs.current[activeSubmenu]?.getBoundingClientRect()
                                      .right || 0) + 4,
                                  top:
                                    menuItemRefs.current[activeSubmenu]?.getBoundingClientRect()
                                      .top || 0,
                                }}
                              >
                                {renderSubmenu()}
                              </div>
                            )}
                          </Popover.Root>

                          {hasAnyFilterActive && (
                            <Button
                              variant='outline'
                              size='sm'
                              className='rounded-[10px] border-border hover:bg-muted text-muted-foreground'
                              onClick={() => setFilters({})}
                              data-track-category='Support'
                              data-track-name='CLEAR_SUPPORT_FILTERS'
                            >
                              <div className='flex items-center gap-1.5'>
                                <X className='w-3 h-3' />
                                <span className='font-medium'>Clear</span>
                              </div>
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                    <div className='flex items-center gap-2 shrink-0'>
                      {viewMode === 'table' && (
                        <Popover.Root open={columnsOpen} onOpenChange={setColumnsOpen}>
                          <Popover.Trigger asChild>
                            <Button
                              variant='outline'
                              size='sm'
                              className='rounded-[10px] border-border hover:bg-muted text-muted-foreground'
                              title={isColumnsLabelled ? undefined : 'Columns'}
                              aria-label='Columns'
                            >
                              <div className='flex items-center gap-1.5'>
                                <Columns3 className='w-3.5 h-3.5' />
                                {/* Label yields before any filter folds — this is secondary
                                    chrome, and the icon plus tooltip carries it fine. */}
                                {isColumnsLabelled && <span className='font-medium'>Columns</span>}
                              </div>
                            </Button>
                          </Popover.Trigger>
                          <Popover.Content
                            side='bottom'
                            align='end'
                            sideOffset={6}
                            className='z-[60] w-56 bg-background border border-border rounded-lg shadow-lg py-1 max-h-[400px] overflow-y-auto'
                          >
                            {DESK_TABLE_BUILTIN_COLUMNS.map(column => {
                              const Icon =
                                column.key === 'assignee'
                                  ? User
                                  : column.key === 'dueDate' || column.key === 'createdAt'
                                    ? CalendarDays
                                    : column.key === 'priority'
                                      ? BarChart4Icon
                                      : column.key === 'tags'
                                        ? Tag
                                        : Circle;
                              const isSelected = selectedColumnKeys.has(column.key);
                              return (
                                <button
                                  key={column.key}
                                  type='button'
                                  onClick={() => toggleColumn(column.key, !isSelected)}
                                  className='w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-muted'
                                  data-track-category='Support'
                                  data-track-name='ToggleTableColumn'
                                  data-track-metadata={JSON.stringify({
                                    column: column.key,
                                    visible: !isSelected,
                                  })}
                                >
                                  <div className='flex items-center gap-3'>
                                    <Icon className='w-4 h-4' />
                                    <span>{column.label}</span>
                                  </div>
                                  {isSelected && <Check className='w-4 h-4 text-primary' />}
                                </button>
                              );
                            })}
                            {deskDynamicFields.length > 0 && (
                              <>
                                <div className='my-1 border-t border-border' />
                                <div className='px-4 py-1 text-xs font-medium text-muted-foreground'>
                                  Custom fields
                                </div>
                                {deskDynamicFields.map(field => {
                                  const key = dynamicColumnKey(field.id);
                                  const Icon = getIconForFieldType(field.fieldType);
                                  const isSelected = selectedColumnKeys.has(key);
                                  return (
                                    <button
                                      key={key}
                                      type='button'
                                      onClick={() => toggleColumn(key, !isSelected)}
                                      className='w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-muted'
                                      data-track-category='Support'
                                      data-track-name='ToggleTableColumn'
                                      data-track-metadata={JSON.stringify({
                                        column: key,
                                        fieldName: field.fieldName,
                                        visible: !isSelected,
                                      })}
                                    >
                                      <div className='flex items-center gap-3'>
                                        <Icon className='w-4 h-4' />
                                        <span className='truncate'>{field.fieldName}</span>
                                      </div>
                                      {isSelected && (
                                        <Check className='w-4 h-4 text-primary shrink-0' />
                                      )}
                                    </button>
                                  );
                                })}
                              </>
                            )}
                          </Popover.Content>
                        </Popover.Root>
                      )}
                      <div ref={actionsRestRef} className='flex items-center gap-2'>
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
                          <button
                            onClick={() => setViewMode('table')}
                            className={cn(
                              'p-1.5 transition-colors',
                              viewMode === 'table'
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                            )}
                            title='Table View'
                            data-track-category='Support'
                            data-track-name='SetTableView'
                          >
                            <Table2 size={16} />
                          </button>
                          <button
                            onClick={() => setViewMode('calendar')}
                            className={cn(
                              'p-1.5 transition-colors',
                              viewMode === 'calendar'
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                            )}
                            title='Calendar View'
                            data-track-category='Support'
                            data-track-name='SetCalendarView'
                          >
                            <CalendarRange size={16} />
                          </button>
                        </div>
                        {/* Keep desk-specific actions and expose the shared Ozonetel toolbar. */}
                        {isSelectedChannelJoined && selectedChannelFull && (
                          <CloudAgentDock buttonBehavior='floating' />
                        )}
                        {isSelectedChannelJoined &&
                          selectedChannelId &&
                          !COMPOSE_DISABLED_CHANNEL_TYPES.has(selectedChannelFull?.type) && (
                            <Tooltip content='Compose new email' side='bottom'>
                              <Button
                                variant='default'
                                size='sm'
                                className='rounded-[10px] bg-primary hover:bg-primary/90 text-white'
                                onClick={() => openNewCompose(selectedChannelId)}
                                data-track-category='Support'
                                data-track-name='OpenComposeEmail'
                                data-track-metadata={JSON.stringify({
                                  channelId: selectedChannelId,
                                })}
                              >
                                <Pencil size={14} />
                                <span>Compose</span>
                              </Button>
                            </Tooltip>
                          )}
                        {ticketId && (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => {
                              const back = selectedChannelId
                                ? `${supportBase}/${selectedChannelId}`
                                : supportBase;
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
                  </div>
                </div>
                <div
                  aria-hidden={selectedTicketIds.size === 0}
                  className={cn(
                    'absolute inset-0 px-4 flex items-center justify-between bg-background transition-opacity duration-150',
                    selectedTicketIds.size > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none',
                  )}
                >
                  <span className='text-sm font-medium text-foreground'>
                    {selectedTicketIds.size} selected
                  </span>
                  <div className='flex items-center gap-2'>
                    <Button
                      type='button'
                      size='sm'
                      variant='default'
                      className='bg-primary hover:bg-primary/90 text-white'
                      onClick={handleMarkSelectedAsRead}
                      data-track-category='Support'
                      data-track-name='MarkSelectedTicketsAsRead'
                      data-track-metadata={JSON.stringify({
                        channelId: refetchChannelId,
                        count: selectedTicketIds.size,
                      })}
                    >
                      <CheckCheck size={14} />
                      Mark as read
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={handleMarkSelectedAsUnread}
                      data-track-category='Support'
                      data-track-name='MarkSelectedTicketsAsUnread'
                      data-track-metadata={JSON.stringify({
                        channelId: refetchChannelId,
                        count: selectedTicketIds.size,
                      })}
                    >
                      <Mail size={14} />
                      Mark as unread
                    </Button>
                    {selectedTicketIds.size >= 2 && (
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() => setShowMergeDialog(true)}
                        data-track-category='Support'
                        data-track-name='MergeTickets'
                        data-track-metadata={JSON.stringify({
                          channelId: refetchChannelId,
                          count: selectedTicketIds.size,
                        })}
                      >
                        <GitMerge size={14} />
                        Merge
                      </Button>
                    )}
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      onClick={clearTicketSelection}
                      data-track-category='Support'
                      data-track-name='ClearTicketSelection'
                    >
                      <X size={14} />
                      Clear
                    </Button>
                  </div>
                </div>
              </div>
              {isSettingsOpen && (
                <DeskSettings
                  open
                  onClose={() => void navigate(-1)}
                  channelId={selectedChannelId}
                  userID={userID}
                />
              )}
              {isMetricsOpen && selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID && (
                <DeskMetricsDashboard
                  open
                  onClose={() => {
                    const base = selectedChannelId
                      ? `${supportBase}/${selectedChannelId}`
                      : supportBase;
                    void navigate(base, { replace: true });
                  }}
                  channelId={selectedChannelId}
                  channelName={selectedChannelName ?? undefined}
                  availableDesks={metricsSelectableDesks}
                  customFieldDefinitions={deskDynamicFields}
                  availableStages={availableStages}
                  onTicketClick={ticket => {
                    void navigate(`${supportBase}/${ticket.channelId}/${ticket.xyneId}`, {
                      state: { ticketId: ticket.ticketId, fromDeskList: true },
                    });
                  }}
                />
              )}
              {isReportOpen && selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID && (
                <DeskReportPanel
                  open
                  onClose={() => {
                    const base = selectedChannelId
                      ? `${supportBase}/${selectedChannelId}`
                      : supportBase;
                    void navigate(base, { replace: true });
                  }}
                  channelId={selectedChannelId}
                  channelName={selectedChannelName ?? undefined}
                />
              )}
              {isTopicsOpen && selectedChannelId && canExploreTopics && (
                <TopicsExplorer
                  open
                  onClose={() =>
                    void navigate(`${supportBase}/${selectedChannelId}`, { replace: true })
                  }
                  channelId={selectedChannelId}
                  channelName={selectedChannelName ?? undefined}
                  supportBase={supportBase}
                  availableAiCategories={availableAiCategories}
                  availableStages={availableStages}
                />
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
                ) : (
                  <>
                    {/* Drafts banner — visible when there are saved-but-closed drafts */}
                    {savedDrafts.length > 0 && userID && (
                      <div className='flex-shrink-0 border-b border-border'>
                        <div className='px-4 py-2 flex items-center gap-1.5'>
                          <span className='text-xs font-semibold text-muted-foreground uppercase tracking-wide mr-1'>
                            Drafts
                          </span>
                          <div className='flex items-center gap-2 flex-wrap'>
                            {savedDrafts.map(draft => {
                              const label = composeDraftLabel(draft);
                              return (
                                <div
                                  key={draft.id}
                                  className='flex items-center gap-1 bg-muted/60 border border-border rounded-full pl-3 pr-1 py-0.5 max-w-[280px] group'
                                >
                                  <button
                                    type='button'
                                    onClick={() => reopenDraft(draft.id)}
                                    className='text-xs text-foreground truncate hover:text-primary transition-colors'
                                    title={`Reopen draft: ${label}`}
                                    data-track-category='Support'
                                    data-track-name='ReopenDraft'
                                  >
                                    {label}
                                  </button>
                                  <button
                                    type='button'
                                    onClick={() => discardDraft(draft.id)}
                                    className='p-0.5 rounded-full text-muted-foreground hover:text-destructive transition-colors shrink-0'
                                    title='Discard draft'
                                    aria-label='Discard draft'
                                    data-track-category='Support'
                                    data-track-name='DiscardDraft'
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                    {viewMode === 'kanban' ? (
                      <SupportKanbanBoard
                        channelId={selectedChannelId}
                        boardId={channelBoardId}
                        onBoardIdResolved={handleChannelBoardIdResolved}
                        ticketFilter={ticketFilter}
                        dynamicFieldEntries={dynamicFieldEntries}
                        onTicketClick={handleTicketClick}
                        onTicketsLoaded={setKanbanTickets}
                        {...(ticketId !== undefined && { activeTicketId: ticketId })}
                      />
                    ) : viewMode === 'calendar' && selectedChannelId ? (
                      <DeskCalendarView
                        channelId={selectedChannelId}
                        isMember={isSelectedChannelJoined}
                        ticketFilter={ticketFilter}
                        onTicketClick={ticket => {
                          void navigate(`${supportBase}/${ticket.channelId}/${ticket.xyneId}`, {
                            state: {
                              conversationId: ticket.conversationId,
                              ticketId: ticket.id,
                              fromDeskList: true,
                            },
                          });
                        }}
                        onTicketsLoaded={setKanbanTickets}
                      />
                    ) : viewMode === 'table' ? (
                      <SupportTicketTable
                        channelId={selectedChannelId}
                        ticketFilter={ticketFilter}
                        dynamicFieldEntries={dynamicFieldEntries}
                        visibleColumns={tableVisibleColumns}
                        dynamicFieldColumns={tableDynamicFieldColumns}
                        onBoardIdResolved={handleChannelBoardIdResolved}
                        onTicketsLoaded={setKanbanTickets}
                        selectedIds={selectedTicketIds}
                        onSelectionChange={handleTableSelectionChange}
                        onTicketClick={ticket => {
                          void navigate(`${supportBase}/${ticket.channelId}/${ticket.xyneId}`, {
                            state: {
                              conversationId: ticket.conversationId,
                              ticketId: ticket.id,
                              fromDeskList: true,
                            },
                          });
                        }}
                      />
                    ) : (
                      <TicketListView
                        isMember={isSelectedChannelJoined}
                        mailboxFolder={selectedLabel ? undefined : selectedFolder.key}
                        filter={{
                          channelId: selectedChannelId,
                          ...ticketFilter,
                        }}
                        dynamicFieldEntries={dynamicFieldEntries}
                        showExtraFields={true}
                        activeTicketId={ticketId}
                        selectedIds={selectedTicketIds}
                        onToggleSelect={toggleTicketSelected}
                        onBoardIdReady={handleChannelBoardIdResolved}
                        onPageChange={clearTicketSelection}
                        onToggleSelectAll={handleToggleSelectAll}
                        onTicketsLoaded={setKanbanTickets}
                        onTicketClick={ticket => {
                          void navigate(`${supportBase}/${ticket.channelId}/${ticket.xyneId}`, {
                            state: {
                              conversationId: ticket.conversationId,
                              ticketId: ticket.id,
                              fromDeskList: true,
                            },
                          });
                        }}
                      />
                    )}
                  </>
                )}
              </div>
              {/* Bulk field actions for the list view — the table view already gets
                  the same bar from TicketTable, driven by its own grid selection. */}
              {viewMode === 'list' && selectedTicketIds.size > 0 && (
                <BulkActionToolbar
                  selectedCount={selectedTicketIds.size}
                  users={deskUsers}
                  stages={deskBulkStages}
                  onAssigneeChange={value =>
                    handleBulkFieldUpdate(assigneeOptionToTicketUpdate(value))
                  }
                  onStatusChange={value => handleBulkFieldUpdate({ statusV2: value })}
                  onPriorityChange={value => {
                    if (value) handleBulkFieldUpdate({ priority: value });
                  }}
                  onStageChange={handleBulkStageChange}
                  onDueDateChange={date => {
                    if (date) handleBulkFieldUpdate({ eta: dueDateToEta(date) });
                  }}
                  onClearSelection={clearTicketSelection}
                  availableTags={deskAvailableTags}
                  onTagsChange={handleBulkTagsChange}
                />
              )}
            </div>
          </Panel>
        )}
        {ticketId && (
          <Panel id='ticket-detail' defaultSize='100%' minSize='100%'>
            <div className='h-full overflow-hidden bg-background'>
              <SupportTicketDetail
                ticketFilter={ticketFilter}
                isMember={isSelectedChannelJoined}
                onMailtoClick={handleMailtoClick}
                navTickets={kanbanTickets}
                channelPreference={channelPreference}
                channelPreferenceLoaded={channelPreferenceDetails?.type === 'complete'}
              />
            </div>
          </Panel>
        )}
      </ResizableGroup>

      {/* Channel Info Modal */}
      {isInfoOpen && selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID && (
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
        title='Create Desk Channel'
      >
        <div className='p-4 overflow-y-auto max-h-[80vh] scrollbar-none'>
          <AddChannelForm
            title='Create Desk Channel'
            hideVisibility={false}
            requireConnector={true}
            onSubmit={data => handleCreateEmailChannel(data)}
            onCancel={() => setShowCreateChannelModal(false)}
            loading={createChannelMutation.isPending}
          />
        </div>
      </Dialog>

      <Dialog
        open={showDeskIntegrationsModal}
        onOpenChange={setShowDeskIntegrationsModal}
        title='Desk Integrations'
        description='Manage workspace connections used by Email and Call Desks'
        className='max-w-3xl overflow-hidden rounded-xl'
        testId='desk-integrations-modal'
      >
        <div className='flex max-h-[85vh] flex-col'>
          <div className='border-b border-border px-6 py-4'>
            <div className='flex items-center justify-between gap-4'>
              <div className='flex items-center gap-2'>
                <Plug className='size-5 text-muted-foreground' />
                <h2 className='text-lg font-semibold text-foreground'>Desk Integrations</h2>
              </div>
              <button
                type='button'
                onClick={() => setShowDeskIntegrationsModal(false)}
                className='rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                aria-label='Close Desk Integrations'
                title='Close'
                data-track-category='Support'
                data-track-name='CloseDeskIntegrations'
              >
                <X className='size-4' />
              </button>
            </div>
            <p className='mt-1 text-sm text-muted-foreground'>
              Manage workspace connections used by Email and Call Desks
            </p>
          </div>
          <div className='space-y-6 overflow-y-auto p-6'>
            <section className='space-y-3'>
              <div>
                <h3 className='text-base font-semibold text-foreground'>Desk Email</h3>
                <p className='text-sm text-muted-foreground'>
                  Connect the shared mailbox used by distribution-list desks.
                </p>
              </div>
              <WorkspaceDeskEmailCard />
            </section>

            <section className='space-y-3'>
              <div>
                <h3 className='text-base font-semibold text-foreground'>Telephony</h3>
                <p className='text-sm text-muted-foreground'>
                  Configure Ozonetel and route campaigns to Call Desks.
                </p>
              </div>
              <WorkspaceOzonetelCard />
            </section>
          </div>
        </div>
      </Dialog>

      {/* Fetch Range Dialog */}
      {canRefetch && !isSocialMediaDesk && (
        <RefetchRangeDialog
          open={showRefetchDialog}
          onOpenChange={setShowRefetchDialog}
          isPending={isRefetching}
          onConfirm={range => {
            setShowRefetchDialog(false);
            handleRefetch(range);
          }}
        />
      )}

      {/* DL Member Sync Dialog */}
      {canRefetch && isDlDesk && refetchChannelId && (
        <DlMemberSyncDialog
          open={showDlMemberSyncDialog}
          onOpenChange={setShowDlMemberSyncDialog}
          channelId={refetchChannelId}
        />
      )}

      <MergeTicketsDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        tickets={mergeDialogTickets}
        onMerge={handleMergeSelectedTickets}
      />

      {selectedChannelId && (
        <AutoLabelWizard
          open={autoLabelWizardOpen}
          onOpenChange={setAutoLabelWizardOpen}
          channelId={selectedChannelId}
          isMember={isSelectedChannelJoined}
        />
      )}

      {/* Multi-compose scrollable strip — fixed at the bottom, spans full width.
          Windows are laid out right-to-left (flex-row-reverse) so the newest
          window always sits at the right edge. When there are more windows than
          fit on screen, the strip becomes horizontally scrollable; the user
          scrolls left to reveal older windows. pointer-events-none on the strip
          itself prevents it from blocking clicks on the ticket list beneath. */}
      {isSelectedChannelJoined &&
        !COMPOSE_DISABLED_CHANNEL_TYPES.has(selectedChannelFull?.type) &&
        composeInstances.filter(inst => inst.channelId === selectedChannelId).length > 0 && (
          <div
            className='fixed bottom-0 left-0 right-0 z-50 flex flex-row-reverse items-end gap-3 overflow-x-auto pointer-events-none pr-6'
            style={{ scrollbarWidth: 'none' }}
          >
            {composeInstances
              .filter(inst => inst.channelId === selectedChannelId)
              .map(inst => (
                <ComposeEmailModal
                  key={inst.id}
                  open
                  channelId={inst.channelId}
                  channelName={selectedChannelName}
                  channelPreference={channelPreference}
                  channelPreferenceLoaded={channelPreferenceDetails?.type === 'complete'}
                  composeDrafts={composeDraftRows}
                  composeDraftsLoaded={composeDraftRowsLoaded}
                  draftId={inst.id}
                  resetKey={inst.key}
                  minimized={inst.minimized}
                  initialTo={inst.initialTo}
                  onMinimizedChange={next => setComposeMinimized(inst.id, next)}
                  onClose={() => closeCompose(inst.id)}
                  onDiscard={() => discardCompose(inst.id)}
                />
              ))}
          </div>
        )}
    </div>
  );
};

const TicketMetaRow = ({
  ticket,
  boardId,
}: {
  ticket:
    | {
        id: string;
        priority?: string | null;
        stageName?: string | null;
        assignedTo?: string | null;
        aiCategory?: string | null;
        channelId?: string | null;
      }
    | undefined
    | null;
  boardId: string | null;
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
      <StagePicker
        ticketId={ticket.id}
        stageName={ticket.stageName}
        stageLabel={stage}
        boardId={boardId}
      />
      <AssigneePicker
        ticketId={ticket.id}
        assignedTo={ticket.assignedTo}
        channelId={ticket.channelId ?? undefined}
        label={assigneeName}
      />
      {ticket.aiCategory && (
        <span
          className='inline-flex items-center justify-center h-[18px] px-2 rounded-sm bg-blue-100 dark:bg-blue-950/50 text-[10px] font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap'
          title={`AI Category: ${ticket.aiCategory}`}
        >
          {ticket.aiCategory}
        </span>
      )}
    </div>
  );
};

type SupportTicketDetailProps = {
  ticketFilter: {
    assignedTo: string[] | undefined;
    createdBy: string[] | undefined;
    priority: TicketPriority[] | undefined;
    stageName: string[] | undefined;
    aiCategory: string[] | undefined;
    conversationIdWhitelist: string[] | undefined;
    hasAiDraft: boolean | undefined;
    userGroups: string[] | undefined;
    lastEmailAtStart: number | undefined;
    lastEmailAtEnd: number | undefined;
    createdAtStart: number | undefined;
    createdAtEnd: number | undefined;
    dynamicFieldFilters?: DynamicFieldQueryFilter[] | undefined;
  };
  isMember: boolean;
  onMailtoClick: (email: string) => void;
  channelPreference: EmailChannelPreference | undefined;
  channelPreferenceLoaded: boolean;
  /**
   * Base path used to build in-detail ticket navigation (e.g. next/prev ticket).
   * Defaults to the Support inbox base (`/{workspaceId}/support`). Embedded
   * surfaces (e.g. the Activity panel) pass their own base so navigation stays
   * within that surface instead of jumping to the Support inbox.
   */
  navBasePath?: string;
  /**
   * Overrides the back-button behaviour. Defaults to navigating to the Support
   * channel ticket list.
   */
  onBack?: () => void;
  navTickets?: ReadonlyArray<{
    id: string;
    xyneId?: string | null;
    channelId?: string | null;
    conversationId: string;
    title: string;
    lastEmailAt?: number | null;
  }>;
};

type TicketReplyKind = 'app' | 'channel';

/**
 * Reply routing is per-ticket, not per-channel: an app-sourced ticket can live in ANY
 * desk channel (e.g. EMAIL intake + a connected app), so channel.type alone can no
 * longer pick the thread/composer. 'channel' = the channel-type chain, unchanged.
 */
const getTicketReplyKind = (ticketMetadata: unknown): TicketReplyKind => {
  const deskSource = (ticketMetadata as { deskSource?: { type?: string } } | null | undefined)
    ?.deskSource;
  return deskSource?.type === 'app' ? 'app' : 'channel';
};

export const SupportTicketDetail = ({
  ticketFilter,
  isMember,
  onMailtoClick,
  channelPreference,
  channelPreferenceLoaded,
  navBasePath,
  onBack,
  navTickets,
}: SupportTicketDetailProps): ReactElement => {
  const {
    workspaceId: routeWorkspaceId,
    channelId: channelIdParam,
    ticketId: ticketIdParam,
  } = useParams<{
    workspaceId?: string;
    channelId?: string;
    ticketId?: string;
  }>();
  const supportBase = routeWorkspaceId ? `/${routeWorkspaceId}/support` : '/support';
  const shareableOrigin = useShareableOrigin();
  const { workspaceId } = useAuthContextValues();
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const isAIPanelOpen = useSelector(
    xyneAIActor,
    snapshot => snapshot.context.xyneAIState === 'open',
  );
  const restoreThreadOnSidebarCloseRef = useRef<boolean>(false);
  const prevIsAIPanelOpenRef = useRef<boolean>(isAIPanelOpen);
  useEffect(() => {
    const wasOpen = prevIsAIPanelOpenRef.current;
    const isOpen = isAIPanelOpen;
    prevIsAIPanelOpenRef.current = isOpen;
    if (wasOpen && !isOpen && restoreThreadOnSidebarCloseRef.current) {
      setIsRightPanelOpen(true);
      restoreThreadOnSidebarCloseRef.current = false;
    }
  }, [isAIPanelOpen]);
  const [composerOpen, setComposerOpenState] = useState<boolean>(false);
  const [replyToEmailId, setReplyToEmailId] = useState<string | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll'>('replyAll');
  const [showArchiveConfirmDialog, setShowArchiveConfirmDialog] = useState(false);
  const [isArchivingTicket, setIsArchivingTicket] = useState(false);
  const clearStoredRecipients = useCallback((cid: string | null | undefined): void => {
    if (!cid) return;
    try {
      localStorage.removeItem(`xyne:emailDraft:recipients:${cid}`);
    } catch {
      /* ignore */
    }
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routerState = location.state as {
    conversationId?: string | null;
    ticketId?: string | null;
    returnToUrl?: string | null;
    fromDeskList?: boolean;
  };
  // List navigation supplies stable IDs in router state; direct URL loads and
  // new-tab openings fall back to the :ticketId path parameter below.
  const stateConversationId = routerState?.conversationId ?? null;
  const ticketId = routerState?.ticketId ?? null;

  // channelId for ACL + query gating — comes from the URL path. Both ticket
  // fetches below require it; without it we don't run the queries at all.
  const routeChannelId = channelIdParam ?? '';
  // `mail` is set by navigateToMail (mail search-result click) and carries
  // either Postgres email.id or Gmail externalMessageId. We scroll to the
  // matching EmailThreadItem after emails load.
  const targetMailId = searchParams.get('mail');

  // Fetch the ticket metadata needed to resolve the detail view. Emails and drafts use
  // their dedicated conversation-scoped queries below. supportTicketDetailV2 looks up by
  // `id` when list navigation supplied it, else by `xyneId` from the URL path param.
  const [ticket] = useCachedQuery(
    queries.supportTicketDetailV2({
      id: ticketId || undefined,
      xyneId: ticketIdParam || undefined,
      workspaceId,
      channelId: routeChannelId,
      isMember,
    }),
    { enabled: (!!ticketId || !!ticketIdParam) && !!routeChannelId },
  );
  const detailConversationId = ticket?.conversationId ?? stateConversationId;
  const isAppSourcedTicket = getTicketReplyKind(ticket?.metadata) === 'app';
  const ticketEmailDrafts = useEmailDrafts(detailConversationId, routeChannelId, isMember);

  // Start the primary email query from router state while ticket metadata loads,
  // then include any merged-ticket conversations once the detail query resolves.
  const allConversationIds = useMemo(() => {
    const ids = new Set<string>();
    if (detailConversationId) ids.add(detailConversationId);
    (ticket?.referencesIn ?? [])
      .filter(ref => ref.relationType === TicketReferenceRelation.MERGED_INTO)
      .forEach(ref => {
        if (ref.sourceTicket?.conversationId) ids.add(ref.sourceTicket.conversationId);
      });
    return Array.from(ids);
  }, [detailConversationId, ticket?.referencesIn]);

  // conversationId -> the manually-merged-in ticket that owns it (needed so its
  // thread-root email uses the ticket-level unmerge action; see mergedRootEmailSource).
  const mergedSourceByConversationId = useMemo(() => {
    const map = new Map<string, { id: string; xyneId?: string | null | undefined }>();
    (ticket?.referencesIn ?? [])
      .filter(ref => ref.relationType === TicketReferenceRelation.MERGED_INTO)
      .forEach(ref => {
        if (ref.sourceTicket?.id && ref.sourceTicket?.conversationId) {
          map.set(ref.sourceTicket.conversationId, {
            id: ref.sourceTicket.id,
            xyneId: ref.sourceTicket.xyneId,
          });
        }
      });
    return map;
  }, [ticket?.referencesIn]);

  const handleUnmergeMergedSource = useCallback(
    async (sourceTicketId: string, sourceTicketXyneId?: string | null): Promise<void> => {
      const toastId = toast.loading('Unmerging ticket...');
      try {
        await apiInstance.post(`/tickets/${sourceTicketId}/unmerge`);
        toast.success('Ticket unmerged successfully', {
          id: toastId,
          description: sourceTicketXyneId
            ? `${sourceTicketXyneId} is now a separate ticket`
            : undefined,
        });
        if (sourceTicketXyneId && channelIdParam) {
          // Same in-place swap as prev/next — the opener stays directly behind us.
          void navigate(`${navBasePath ?? supportBase}/${channelIdParam}/${sourceTicketXyneId}`, {
            replace: true,
            state: {
              ...(routerState?.fromDeskList ? { fromDeskList: true } : {}),
              ...(routerState?.returnToUrl ? { returnToUrl: routerState.returnToUrl } : {}),
            },
          });
        }
      } catch (err) {
        toast.error('Unmerge Failed', {
          id: toastId,
          description: getApiErrorMessage(err, 'Operation failed. Please try again.'),
        });
      }
    },
    [
      channelIdParam,
      navigate,
      navBasePath,
      routerState?.fromDeskList,
      routerState?.returnToUrl,
      supportBase,
    ],
  );

  const [allEmails] = useCachedQuery(
    queries.getEmailsForConversationsV2({
      conversationIds: allConversationIds,
      channelId: routeChannelId,
      isMember,
    }),
    { enabled: allConversationIds.length > 0 },
  );

  const emails = useMemo(() => (allEmails as Email[] | undefined) ?? [], [allEmails]);
  const emailCollapseState = useEmailCollapseState(emails);

  const initiator = useMemo(() => {
    const first = emailCollapseState.sortedEmails[0];
    if (!first?.from) return null;
    return parseFromField(first.from);
  }, [emailCollapseState.sortedEmails]);

  // When arriving via a mail deep-link (`?mail=<id>`), un-collapse the target
  // email so it's visible, then scroll to it with a brief yellow flash.
  const scrolledForTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!targetMailId) {
      scrolledForTargetRef.current = null;
      return;
    }
    if (emails.length === 0) return;
    if (scrolledForTargetRef.current === targetMailId) return;
    if (!emails.some(e => e.id === targetMailId)) return;
    scrolledForTargetRef.current = targetMailId;
    emailCollapseState.expandOne(targetMailId);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target =
          document.getElementById(`mail-${targetMailId}`) ||
          document.querySelector(`[data-external-message-id="${targetMailId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.classList.add('bg-yellow-50');
          setTimeout(() => target.classList.remove('bg-yellow-50'), 2500);
        }
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMailId, emails]);

  const channelId = ticket?.channelId || routeChannelId;
  const conversationId = ticket?.conversationId ?? stateConversationId;
  const title = ticket?.title ?? null;
  // DB ticket id (not the xyneId) for per-user mailbox actions; router state carries it
  // on list navigation, else it comes from the fetched ticket row.
  const mailboxTicketId = ticket?.id ?? ticketId ?? null;
  const boardId = ticket?.boardId ?? null;

  const draftAgentSlug = channelPreference?.autoDraftAgentSlug || 'draft-agent';
  const { setSelectedAgentSlug } = useSelectedAgent();

  const openDraftAgentSession = useCallback(
    (explicitSessionId?: string): void => {
      if (!conversationId || !channelId) {
        xyneAIActor.send({ type: 'OPEN' });
        return;
      }
      setSelectedAgentSlug(draftAgentSlug);
      window.dispatchEvent(new PopStateEvent('popstate'));

      let sessionId: string | null = explicitSessionId ?? null;
      if (!sessionId) {
        try {
          sessionId = localStorage.getItem(`xd-ai-session:${channelId}_${conversationId}`);
        } catch {
          sessionId = null;
        }
      }

      const threadInfo = { conversationId, previewText: title ?? '' };
      xyneAIActor.send({
        type: 'OPEN',
        contextType: 'chat',
        channelId,
        threadInfo,
        focusSessionId: sessionId ?? conversationId,
        deskAutoDraft: { conversationId, channelId },
      });
    },
    [conversationId, channelId, draftAgentSlug, title, setSelectedAgentSlug],
  );

  useEffect(() => {
    if (!conversationId) {
      setComposerOpenState(false);
      return;
    }
    setComposerOpenState(composerOpenByConv.get(conversationId) ?? false);
  }, [conversationId]);

  const setComposerOpen: React.Dispatch<React.SetStateAction<boolean>> = useCallback(
    next => {
      setComposerOpenState(prev => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        if (conversationId) {
          if (resolved) composerOpenByConv.set(conversationId, true);
          else composerOpenByConv.delete(conversationId);
        }
        return resolved;
      });
    },
    [conversationId],
  );

  const channelIntegrationInfo = useChannelIntegrationInfo(channelId || null);
  const deskEmail = channelIntegrationInfo.email ?? '';

  useAskAiTicketContext({
    channelId: channelId || null,
    conversationId: conversationId ?? null,
    previewText: title || 'Ticket conversation',
  });
  const ticketDraft = ticketEmailDrafts[0];
  const draftAutoOpenedConversationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    if (draftAutoOpenedConversationRef.current === conversationId) return;
    if (ticketDraft?.draftContent?.trim()) {
      setComposerOpen(true);
      draftAutoOpenedConversationRef.current = conversationId;
      if (ticketDraft.userId === null) {
        setReplyMode('replyAll');
      }
    }
  }, [conversationId, ticketDraft, setComposerOpen, setReplyMode]);

  const cursorStart =
    ticket?.id && typeof ticket.lastEmailAt === 'number'
      ? { id: ticket.id, lastEmailAt: ticket.lastEmailAt }
      : null;

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
    // Swap the ticket in place: pushing would bury the opener under the ticket chain
    // and leave the back arrow one entry short of it.
    void navigate(`${navBasePath ?? supportBase}/${nextChannelId}/${t.xyneId}`, {
      replace: true,
      state: {
        conversationId: t.conversationId,
        ticketId: t.id,
        ...(routerState?.fromDeskList ? { fromDeskList: true } : {}),
        ...(routerState?.returnToUrl ? { returnToUrl: routerState.returnToUrl } : {}),
      },
    });
  };

  type DeskNavRow = {
    id: string;
    xyneId?: string | null;
    channelId?: string | null;
    conversationId: string;
    title: string;
    lastEmailAt?: number | null;
  };
  const currentNavRow: DeskNavRow | null = ticket
    ? {
        id: ticket.id,
        xyneId: ticket.xyneId,
        channelId: ticket.channelId,
        conversationId: ticket.conversationId,
        title: ticket.title,
        lastEmailAt: ticket.lastEmailAt,
      }
    : null;
  const { prev: windowPrev, next: windowNext } = useTicketKeysetWindow<
    DeskNavRow,
    { id: string; lastEmailAt: number }
  >({
    currentId: ticket?.id ?? null,
    currentRow: currentNavRow,
    seed: navTickets,
    idOf: r => r.id,
    cursorOf: r => ({ id: r.id, lastEmailAt: r.lastEmailAt ?? 0 }),
    fetchPage: async (start, dir, limit) => {
      if (!channelId) return [];
      const { conversationIdWhitelist: _ciw, ...restTicketFilter } = ticketFilter;
      return (await zero.run(
        queries.supportTicketsPageV3({
          channelId,
          isMember,
          ...restTicketFilter,
          ...(_ciw !== undefined ? { conversationIds: _ciw } : {}),
          limit,
          start,
          dir,
        }),
        { type: 'complete' },
      )) as DeskNavRow[];
    },
    enabled: !!channelId && !!ticket?.id,
  });

  const goBackToTicketList = useCallback((): void => {
    if (onBack) {
      onBack();
      return;
    }
    // Both markers are stamped by the opener (desk list, Kanban, My Tickets) as it pushes
    // this entry, so its page is one Back away — pop it rather than stacking a second copy.
    // returnToUrl is only a signal now; we never navigate to it, so it needs no URL check.
    if (routerState?.fromDeskList || routerState?.returnToUrl) {
      void navigate(-1);
      return;
    }
    const base = navBasePath ?? supportBase;
    const back = channelIdParam ? `${base}/${channelIdParam}` : base;
    void navigate(back, { replace: true });
  }, [
    channelIdParam,
    navBasePath,
    navigate,
    onBack,
    routerState?.fromDeskList,
    routerState?.returnToUrl,
    supportBase,
  ]);

  const navigateAdjacent = async (dir: 'forward' | 'backward'): Promise<void> => {
    const windowTarget = dir === 'forward' ? windowNext : windowPrev;
    if (windowTarget) {
      goToTicket(windowTarget);
      return;
    }
    if (!cursorStart || !channelId) return;
    try {
      const { conversationIdWhitelist: _ciw, ...restTicketFilter } = ticketFilter;
      const result = (await zero.run(
        queries.supportTicketsPageV3({
          channelId,
          isMember,
          ...restTicketFilter,
          ...(_ciw !== undefined ? { conversationIds: _ciw } : {}),
          limit: 1,
          start: cursorStart,
          dir,
        }),
        { type: 'complete' },
      )) as Array<{
        id: string;
        xyneId?: string | null;
        channelId?: string | null;
        conversationId: string;
        title: string;
      }>;
      const target = result?.[0];
      if (target) goToTicket(target);
    } catch (err) {
      logger.error(Event.ZERO_RUN_ERROR, {
        source: 'SupportTicketDetail.navigateAdjacent',
        dir,
        channelId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleArchiveTicket = (): void => {
    if (!ticket || isArchivingTicket) return;

    try {
      if (ticket.isArchived) {
        throw new Error('Ticket is already archived');
      }

      setIsArchivingTicket(true);
      setShowArchiveConfirmDialog(false);
      void surfaceMutationError(
        zero.mutate(
          mutators.ticket.archiveDeskTicket({
            id: ticket.id,
            updatedAt: Date.now(),
          }),
        ),
        'Failed to archive ticket',
      ).then(ok => {
        setIsArchivingTicket(false);
        if (ok) {
          toast.success('Ticket archived successfully');
          goBackToTicketList();
        }
      });
    } catch (err) {
      setIsArchivingTicket(false);
      toast.error('Failed to archive ticket', {
        description: err instanceof Error ? err.message : 'Please try again',
      });
    }
  };

  // Keyboard shortcuts: j = next, k = previous, e = toggle collapse/expand all.
  useShortcut(
    'j',
    () => {
      void navigateAdjacent('forward');
    },
    {
      scope: 'global',
      description: 'Next ticket',
      category: 'Support',
    },
  );
  useShortcut(
    'k',
    () => {
      void navigateAdjacent('backward');
    },
    {
      scope: 'global',
      description: 'Previous ticket',
      category: 'Support',
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
  useShortcut(
    'r',
    () => {
      setReplyToEmailId(null);
      setReplyMode('reply');
      setComposerOpen(true);
    },
    {
      scope: 'global',
      description: 'Reply',
      category: 'Support',
      enabled: !composerOpen,
    },
  );
  useShortcut(
    'a',
    () => {
      setReplyToEmailId(null);
      setReplyMode('replyAll');
      setComposerOpen(true);
    },
    {
      scope: 'global',
      description: 'Reply all',
      category: 'Support',
      enabled: !composerOpen,
    },
  );

  // ── Email thread summary ──
  const [emailSummaryState, setEmailSummaryState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  );
  const [emailSummaryPoints, setEmailSummaryPoints] = useState<string[]>([]);
  const [emailSummarySummary, setEmailSummarySummary] = useState('');
  const [emailSummaryError, setEmailSummaryError] = useState('');
  const [showEmailSummary, setShowEmailSummary] = useState(false);
  const emailSummaryAbortRef = useRef<AbortController | null>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const scrollThreadToTop = (): void => {
    requestAnimationFrame(() => {
      threadScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const composerOverlayRef = useRef<HTMLDivElement>(null);
  const [composerOverlayHeight, setComposerOverlayHeight] = useState<number>(96);
  useEffect(() => {
    const el = composerOverlayRef.current;
    if (!el) return undefined;
    const update = (): void => setComposerOverlayHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const targetMessageId = searchParams.get('messageId');

  // Get channel info and user status
  const channel = useChannel(channelId);
  const [mailboxRows] = useCachedQuery(
    queries.myTicketMailboxV2({
      ticketId: mailboxTicketId ?? '',
      channelId: routeChannelId,
      isMember,
    }),
    { enabled: channel?.type === ChannelType.EMAIL && !!mailboxTicketId },
  );
  const mailboxOverlay = mailboxRows?.[0];
  const [conversationLabelMappings] = useCachedQuery(
    queries.conversationLabelMappingsByConversationIdV2({
      conversationId: conversationId || '',
      channelId: routeChannelId,
      isMember,
    }),
    { enabled: !!conversationId },
  );
  // Subscribe to channel for real-time updates
  useChannelSubscription(channelId, conversationId ? [conversationId] : []);

  const zero = useZero();
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const [isScheduleCallModalOpen, setIsScheduleCallModalOpen] = useState(false);
  if (!ticketIdParam) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-lg font-semibold text-muted-foreground'>Ticket not found</div>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col overflow-hidden'>
      <ResizableGroup
        orientation='horizontal'
        className='flex-1 overflow-hidden'
        autoSaveId='support-ticket-detail'
        panelIds={isRightPanelOpen ? ['ticket-main', 'ticket-side-panel'] : ['ticket-main']}
      >
        <Panel
          id='ticket-main'
          defaultSize={isRightPanelOpen ? '65%' : '100%'}
          minSize={isRightPanelOpen ? '30%' : '100%'}
          maxSize={isRightPanelOpen ? '70%' : '100%'}
        >
          <div className='h-full flex flex-col overflow-hidden relative'>
            <div className='w-full px-6 py-4 flex flex-col gap-2.5 flex-shrink-0 sticky top-0 bg-background z-10 border-b border-border'>
              <div className='flex flex-wrap items-center gap-2 min-w-0 overflow-hidden'>
                <button
                  type='button'
                  onClick={() => {
                    if (onBack) {
                      onBack();
                      return;
                    }
                    goBackToTicketList();
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
                {channel?.type === ChannelType.EMAIL && mailboxTicketId && channelId && (
                  <MailboxActions
                    ticketId={mailboxTicketId}
                    channelId={channelId}
                    slot='star'
                    mailboxOverlay={mailboxOverlay}
                  />
                )}
                {/* `min-w-[8rem]` (rem, so it tracks font scaling) is what makes the
                    row break its flex line instead of crushing the title to nothing. */}
                <TruncatedTooltip content={title || 'Untitled Ticket'} side='bottom'>
                  <span className='font-medium text-foreground flex-1 min-w-[8rem] truncate'>
                    {title || 'Untitled Ticket'}
                  </span>
                </TruncatedTooltip>

                {/* One cluster so the actions wrap as a block rather than dribbling
                    onto the next line one icon at a time. `[&>*]:shrink-0` keeps the
                    1px dividers alive — their min-content size is 0, so they are the
                    first thing flexbox would collapse. */}
                <div className='flex flex-wrap items-center gap-2 min-w-0 [&>*]:shrink-0'>
                  {/* Same self-gating trick as the row-2 pill box: the trailing divider
                      is an `after:` pseudo and `empty:hidden` drops the whole group, so a
                      SPAM ticket with no conversation (picker absent, and the 'actions'
                      slot renders nothing in that state) cannot strand a leading divider. */}
                  <div className="flex items-center gap-2 empty:hidden after:w-px after:h-4 after:shrink-0 after:bg-border after:content-['']">
                    {conversationId && channelId && (
                      <ConversationLabels
                        conversationId={conversationId}
                        channelId={channelId}
                        isMember={isMember}
                        slot='picker'
                        appliedMappings={conversationLabelMappings ?? []}
                      />
                    )}
                    {channel?.type === ChannelType.EMAIL && mailboxTicketId && channelId && (
                      <MailboxActions
                        ticketId={mailboxTicketId}
                        channelId={channelId}
                        slot='actions'
                        mailboxOverlay={mailboxOverlay}
                      />
                    )}
                  </div>
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
                              scrollThreadToTop();
                              void fetchEmailSummary();
                            } else if (emailSummaryState === 'done') {
                              setShowEmailSummary(prev => {
                                const next = !prev;
                                if (next) scrollThreadToTop();
                                return next;
                              });
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
                        const url = `${shareableOrigin}/support/${channelId}/${ticketIdParam}`;
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

                  {channel && <CloudAgentDock buttonBehavior='floating' />}

                  <Tooltip
                    side='bottom'
                    delayDuration={300}
                    content={ticket?.isArchived ? 'Already archived' : 'Archive ticket'}
                  >
                    <button
                      type='button'
                      onClick={() => setShowArchiveConfirmDialog(true)}
                      disabled={!ticket || !!ticket.isArchived}
                      className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                      aria-label='Archive ticket'
                      data-track-category='Support'
                      data-track-name='ArchiveTicket'
                    >
                      <Archive size={16} />
                    </button>
                  </Tooltip>
                  {emails.length > 0 &&
                    channel?.type !== ChannelType.SLACK &&
                    channel?.type !== ChannelType.APP && (
                      <>
                        <div className='w-px h-4 bg-border' />
                        <Tooltip side='bottom' delayDuration={300} content='Mark as unread'>
                          <button
                            type='button'
                            onClick={() => {
                              if (!ticket?.id) return;
                              void zero.mutate(
                                mutators.emailRead.bulkMarkAsUnread({ ticketIds: [ticket.id] }),
                              );
                              goBackToTicketList();
                            }}
                            className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                            aria-label='Mark as unread'
                            data-track-category='Support'
                            data-track-name='MarkTicketUnread'
                          >
                            <MailOpen size={16} />
                          </button>
                        </Tooltip>
                      </>
                    )}
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
                        onClick={() => void navigateAdjacent('backward')}
                        className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
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
                        onClick={() => void navigateAdjacent('forward')}
                        className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
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
              </div>
              <div className='flex flex-col gap-1 flex-shrink-0'>
                <div className='pl-9 flex items-center gap-3 flex-wrap'>
                  <TicketMetaRow ticket={ticket} boardId={boardId} />
                  {initiator && (
                    <div
                      className='inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-xs text-foreground whitespace-nowrap h-[24px]'
                      title={
                        initiator.email
                          ? `Initiated by ${initiator.name} <${initiator.email}>`
                          : `Initiated by ${initiator.name}`
                      }
                      aria-label={`Initiated by ${initiator.name}`}
                    >
                      <Mail size={12} className='shrink-0 text-muted-foreground' />
                      <span className='truncate max-w-[160px]'>{initiator.name}</span>
                    </div>
                  )}

                  {/* Pills only — the picker trigger and the move actions live in the
                      row-1 icon cluster. This is the metadata strip, so what lands here
                      is state you read (which labels, which mailbox), not buttons you
                      hunt for. Both slots render null when they have nothing to show
                      (archived has no chip, zero labels has no chips), so the leading
                      divider is a `before:` pseudo on this box and `empty:hidden` drops
                      the whole thing — a real sibling element would strand a divider
                      with nothing after it. */}
                  {channelId && (conversationId || mailboxTicketId) && (
                    <div className="flex items-center gap-1.5 flex-wrap min-h-[24px] empty:hidden before:w-px before:h-4 before:shrink-0 before:bg-border before:content-['']">
                      {channel?.type === ChannelType.EMAIL && mailboxTicketId && (
                        <MailboxActions
                          ticketId={mailboxTicketId}
                          channelId={channelId}
                          slot='chip'
                          mailboxOverlay={mailboxOverlay}
                        />
                      )}
                      {conversationId && (
                        <ConversationLabels
                          conversationId={conversationId}
                          channelId={channelId}
                          isMember={isMember}
                          slot='chips'
                          appliedMappings={conversationLabelMappings ?? []}
                        />
                      )}
                    </div>
                  )}
                </div>
                {ticket && (
                  <div className='pl-9'>
                    <TicketTagsRow ticketId={ticket.id} />
                  </div>
                )}
              </div>
            </div>
            <div
              ref={threadScrollRef}
              className='flex-1 overflow-y-auto no-scrollbar px-6 py-4'
              style={{
                paddingBottom: composerOverlayHeight + 12,
                transition: 'padding-bottom 280ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {showEmailSummary &&
                (emailSummaryState === 'loading' ||
                  emailSummaryState === 'done' ||
                  emailSummaryState === 'error') && (
                  <div
                    className='mb-4 rounded-2xl p-px'
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
                    <div className='rounded-[calc(1rem-1px)] bg-background/95 dark:bg-background/90 backdrop-blur-xl overflow-hidden'>
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
                              content={
                                emailSummaryState === 'error' ? 'Retry' : 'Regenerate summary'
                              }
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
                      <div className='px-4 pb-3'>
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
              {emails && emails.length > 0 && (
                <div className='mb-6'>
                  {isAppSourcedTicket ||
                  channel?.type === ChannelType.SLACK ||
                  channel?.type === ChannelType.APP ||
                  channel?.type === ChannelType.SOCIAL_MEDIA ? (
                    <SlackThread emails={emails} ticketId={ticket?.id} />
                  ) : channel?.type === ChannelType.CALL ? (
                    <CallThread emails={emails} ticketId={ticket?.id} />
                  ) : (
                    <EmailThread
                      collapseState={emailCollapseState}
                      ticketId={ticket?.id}
                      onReplyToEmail={(emailId, mode) => {
                        clearStoredRecipients(conversationId);
                        setReplyToEmailId(emailId);
                        setReplyMode(mode);
                        setComposerOpen(true);
                      }}
                      deskEmail={deskEmail}
                      onMailtoClick={onMailtoClick}
                      mergedSourceByConversationId={mergedSourceByConversationId}
                      onUnmergeSource={handleUnmergeMergedSource}
                    />
                  )}
                </div>
              )}
            </div>
            <div
              className='absolute inset-x-0 bottom-0 z-20 bg-background'
              ref={composerOverlayRef}
            >
              {isAppSourcedTicket ? (
                conversationId ? (
                  <SlackComposer
                    conversationId={conversationId}
                    channelId={channel?.id ?? null}
                    drafts={ticketEmailDrafts}
                    variant='app'
                    // The ticket is app-sourced whatever the desk type, so the
                    // channel preference alone decides whether the reply reaches
                    // the app — matching appDeskService's outbound gate.
                    recordOnly={channelPreference?.appWebhookDeliveryEnabled === false}
                  />
                ) : null
              ) : channel?.type === ChannelType.SOCIAL_MEDIA ? (
                conversationId ? (
                  <SocialMediaReplyComposer
                    conversationId={conversationId}
                    channelId={channel?.id ?? null}
                    drafts={ticketEmailDrafts}
                    replyBasePath='/integrations/social-media'
                    placeholder='Reply to this review…'
                    maxLength={350}
                    trackingCategory='social-media-composer'
                  />
                ) : null
              ) : channel?.type === ChannelType.SLACK || channel?.type === ChannelType.APP ? (
                conversationId ? (
                  <SlackComposer
                    conversationId={conversationId}
                    channelId={channel?.id ?? null}
                    drafts={ticketEmailDrafts}
                    variant={channel?.type === ChannelType.APP ? 'app' : 'slack'}
                    recordOnly={
                      channel.type === ChannelType.APP &&
                      channelPreference?.appWebhookDeliveryEnabled === false
                    }
                  />
                ) : null
              ) : channel?.type === ChannelType.EMAIL ? (
                <AnimatePresence mode='popLayout' initial={false}>
                  {composerOpen ? (
                    <motion.div
                      key='composer'
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <EmailComposer
                        conversationId={conversationId}
                        drafts={ticketEmailDrafts}
                        channelConnectedEmail={deskEmail}
                        emails={emails}
                        onClose={() => {
                          setComposerOpen(false);
                          setReplyToEmailId(null);
                        }}
                        isAIPanelOpen={isAIPanelOpen}
                        onToggleAIPanel={() => {
                          if (isAIPanelOpen) {
                            xyneAIActor.send({ type: 'CLOSE' });
                          } else {
                            xyneAIActor.send({ type: 'OPEN' });
                          }
                        }}
                        onOpenAskAISidebarFresh={() => {
                          xyneAIActor.send({ type: 'OPEN' });
                        }}
                        onSeeSources={sessionId => void openDraftAgentSession(sessionId)}
                        hasAutoDraft={ticketDraft?.autoDraftStatus === AutoDraftStatus.READY}
                        channelId={channelId}
                        channelPreference={channelPreference}
                        channelPreferenceLoaded={channelPreferenceLoaded}
                        ticketId={ticketId}
                        replyToEmailId={replyToEmailId}
                        replyMode={replyMode}
                        setReplyMode={mode => {
                          clearStoredRecipients(conversationId);
                          setReplyMode(mode);
                        }}
                        ticketSubject={title}
                      />
                    </motion.div>
                  ) : (
                    <motion.div
                      key='pill'
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      className='px-6 py-3'
                    >
                      <ReplyPill
                        emails={emails}
                        deskEmail={deskEmail}
                        replyMode={replyMode}
                        setReplyMode={mode => {
                          clearStoredRecipients(conversationId);
                          setReplyMode(mode);
                        }}
                        onOpen={mode => {
                          setReplyToEmailId(null);
                          setReplyMode(mode);
                          setComposerOpen(true);
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              ) : null}
            </div>
          </div>
        </Panel>
        {isRightPanelOpen && (
          <>
            {' '}
            <Separator className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
              <div className='w-[1px] h-full bg-border'></div>
            </Separator>
            <Panel id='ticket-side-panel' defaultSize='35%' minSize='30%' maxSize='70%'>
              <div
                className='h-full flex flex-col overflow-hidden relative'
                data-thread-citation-host
              >
                {conversationId && channelId ? (
                  <ThreadMessages
                    channelId={channelId}
                    conversationId={conversationId}
                    ticketId={ticket?.id ?? null}
                    matchedMessageId={targetMessageId}
                    skipInputAutoFocus
                    onClose={() => setIsRightPanelOpen(false)}
                    onAskAI={() => {
                      if (isAIPanelOpen) {
                        xyneAIActor.send({ type: 'CLOSE' });
                      } else {
                        void openDraftAgentSession();
                      }
                    }}
                  />
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
                  externalInviteDelivery='conversation_reply'
                  {...(channelId ? { channelId } : {})}
                  {...(conversationId ? { conversationId } : {})}
                />
                {showArchiveConfirmDialog && (
                  <Dialog
                    open={showArchiveConfirmDialog}
                    onOpenChange={setShowArchiveConfirmDialog}
                    title='Archive Ticket'
                  >
                    <div className='p-6'>
                      <div className='flex items-center gap-3 mb-4'>
                        <div className='p-2 rounded-full bg-destructive/10'>
                          <AlertCircle className='w-6 h-6 text-destructive' />
                        </div>
                        <h3 className='text-lg font-semibold'>This action is irreversible</h3>
                      </div>
                      <p className='text-sm text-muted-foreground mb-6'>
                        {ticket?.isArchived
                          ? 'This ticket is already archived. It is hidden from the Desk ticket list, while the existing conversation data stays preserved.'
                          : 'Once archived, this ticket cannot be unarchived. It will be hidden from the Desk ticket list, while the existing conversation data stays preserved.'}
                      </p>

                      <div className='flex justify-end gap-3'>
                        <Button
                          variant='secondary'
                          onClick={() => setShowArchiveConfirmDialog(false)}
                          data-track-category='Support'
                          data-track-name='CANCEL_ARCHIVE_TICKET'
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => handleArchiveTicket()}
                          data-track-category='Support'
                          data-track-name='CONFIRM_ARCHIVE_TICKET'
                          disabled={!ticket || !!ticket.isArchived || isArchivingTicket}
                          loading={isArchivingTicket}
                          className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                        >
                          {ticket?.isArchived ? 'Already Archived' : 'Archive Ticket'}
                        </Button>
                      </div>
                    </div>
                  </Dialog>
                )}
              </div>
            </Panel>
          </>
        )}
        {/* Ask AI panel removed — there's now only one Ask AI window globally,
            mounted in AppRoot. SupportScreen tells it which ticket via
            useAskAiTicketContext above; the EmailComposer's Ask AI button
            opens it via xyneAIActor.send('OPEN'). */}
      </ResizableGroup>
    </div>
  );
};

interface EmailCollapseState {
  collapsedIds: Set<string>;
  toggleOne: (id: string) => void;
  /** Force a specific email to be expanded (used for ?mail=X deep links). */
  expandOne: (id: string) => void;
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
  const prevIdsRef = useRef<Set<string>>(new Set(sortedEmails.map(e => e.id)));
  useEffect(() => {
    setCollapsedIds(prev => {
      const currentIds = new Set(sortedEmails.map(e => e.id));
      const previousIds = prevIdsRef.current;
      const next = new Set(prev);
      for (const id of Array.from(next)) {
        if (!currentIds.has(id)) next.delete(id);
      }
      for (const email of sortedEmails) {
        if (!previousIds.has(email.id) && email.id !== lastEmailId) {
          next.add(email.id);
        }
      }
      if (lastEmailId) next.delete(lastEmailId);
      prevIdsRef.current = currentIds;
      return next;
    });
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

  const expandOne = (id: string): void => {
    setCollapsedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
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
    expandOne,
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
  onReplyToEmail,
  deskEmail,
  onMailtoClick,
  mergedSourceByConversationId,
  onUnmergeSource,
}: {
  collapseState: EmailCollapseState;
  ticketId?: string | null | undefined;
  onReplyToEmail?: (emailId: string, mode: 'reply' | 'replyAll') => void;
  deskEmail?: string | null | undefined;
  onMailtoClick: (email: string) => void;
  mergedSourceByConversationId?: ReadonlyMap<
    string,
    { id: string; xyneId?: string | null | undefined }
  >;
  onUnmergeSource?: (
    sourceTicketId: string,
    sourceTicketXyneId?: string | null,
  ) => void | Promise<void>;
}): ReactElement => {
  const { sortedEmails, collapsedIds, toggleOne, lastEmailId } = collapseState;
  useMarkEmailRead(ticketId, lastEmailId ?? null, true);
  const threadAttachments = useMemo(
    () => sortedEmails.flatMap(e => e.attachments ?? []),
    [sortedEmails],
  );
  // The first email (by position in this already-createdAt-sorted list) seen for
  // each conversationId is that conversation's own root. For a foreign
  // conversationId this is a manually-merged-in ticket's thread root, which must
  // use the ticket-level unmerge action — see mergedSourceByConversationId. Root status is
  // tracked per-conversationId (not against the combined thread's overall first
  // email) because auto-merge demerge eligibility is validated per-conversation
  // server-side (EmailDemergeController resolves "root" via
  // findByConversationIdOrdered on that email's own conversationId).
  const { mergedRootEmailSource, conversationRootEmailIds } = useMemo(() => {
    const mergedMap = new Map<string, { id: string; xyneId?: string | null | undefined }>();
    const rootIds = new Set<string>();
    const seenConversationIds = new Set<string>();
    for (const e of sortedEmails) {
      if (!seenConversationIds.has(e.conversationId)) {
        seenConversationIds.add(e.conversationId);
        rootIds.add(e.id);
        const source = mergedSourceByConversationId?.get(e.conversationId);
        if (source) mergedMap.set(e.id, source);
      }
    }
    return { mergedRootEmailSource: mergedMap, conversationRootEmailIds: rootIds };
  }, [sortedEmails, mergedSourceByConversationId]);
  return (
    <div className='divide-y divide-gray-200 relative'>
      {sortedEmails.map(email => {
        const mergedSource = mergedRootEmailSource.get(email.id);
        return (
          <EmailThreadItem
            key={email.id}
            email={email}
            isCollapsed={collapsedIds.has(email.id)}
            canCollapse={email.id !== lastEmailId}
            onToggleCollapse={() => toggleOne(email.id)}
            threadAttachments={threadAttachments}
            {...(onReplyToEmail &&
              email.id !== lastEmailId && {
                // Per-email Reply / Reply all only on older messages — the
                // latest already has the dedicated bar at the thread footer,
                // so showing one here would be a duplicate.
                onReply: (mode: 'reply' | 'replyAll') => onReplyToEmail(email.id, mode),
              })}
            deskEmail={deskEmail}
            isConversationRoot={conversationRootEmailIds.has(email.id)}
            onMailtoClick={onMailtoClick}
            {...(mergedSource && { mergedSource })}
            {...(onUnmergeSource && { onUnmergeSource })}
          />
        );
      })}
    </div>
  );
};

const EmailThreadItem = ({
  email,
  isCollapsed = false,
  canCollapse = true,
  onToggleCollapse,
  onReply,
  deskEmail,
  isConversationRoot,
  threadAttachments,
  onMailtoClick,
  mergedSource,
  onUnmergeSource,
}: {
  email: Email;
  isCollapsed?: boolean;
  canCollapse?: boolean;
  onToggleCollapse?: () => void;
  onReply?: (mode: 'reply' | 'replyAll') => void;
  deskEmail?: string | null | undefined;
  /** True when this email is the earliest email in its own conversationId —
   * scoped per-conversation (not the combined thread's overall first email) to
   * match the backend's per-conversation root check. See canDemerge below. */
  isConversationRoot: boolean;
  threadAttachments?: NonNullable<Email['attachments']>;
  onMailtoClick: (email: string) => void;
  /** Set when this email is the thread-root of a manually-merged-in ticket and
   * must use the ticket-level unmerge action. */
  mergedSource?: { id: string; xyneId?: string | null | undefined };
  onUnmergeSource?: (
    sourceTicketId: string,
    sourceTicketXyneId?: string | null,
  ) => void | Promise<void>;
}): ReactElement => {
  const { channelId: channelIdParam } = useParams<{ channelId?: string }>();
  const navigate = useNavigate();
  const emailRouterState = useLocation().state as {
    fromDeskList?: boolean;
    returnToUrl?: string | null;
  } | null;
  const { name: fromName, email: fromEmail } = parseFromField(email.from || '');
  const toList = email.to || [];
  const ccList = email.cc || [];
  const bccList = email.bcc || [];
  const replyToList = email.replyTo || [];

  const [isDemerging, setIsDemerging] = useState(false);

  // mergedSource routes to the ticket-level unmerge API; otherwise email-level demerge.
  const handleDemerge = async (): Promise<void> => {
    if (isDemerging) return;
    setIsDemerging(true);

    if (mergedSource) {
      try {
        await onUnmergeSource?.(mergedSource.id, mergedSource.xyneId);
      } finally {
        setIsDemerging(false);
      }
      return;
    }

    const toastId = toast.loading('Unmerging email...', {
      description: 'Creating new ticket from this email',
    });

    try {
      const response = await apiInstance.post<DemergeEmailResponse>('/email/demerge', {
        emailId: email.id,
      });

      if (response.data?.success && response.data.newTicket) {
        toast.success('Unmerge Successful', {
          id: toastId,
          description: `Created new ticket ${response.data.newTicket.xyneId}`,
        });

        if (channelIdParam) {
          // In-place swap like the ticket-level unmerge — the opener stays directly behind.
          void navigate(`/support/${channelIdParam}/${response.data.newTicket.xyneId}`, {
            replace: true,
            state: {
              conversationId: response.data.newTicket.conversationId,
              title: email.subject,
              ticketId: response.data.newTicket.ticketId,
              ...(emailRouterState?.fromDeskList ? { fromDeskList: true } : {}),
              ...(emailRouterState?.returnToUrl
                ? { returnToUrl: emailRouterState.returnToUrl }
                : {}),
            },
          });
        }
      }
    } catch (err) {
      toast.error('Unmerge Failed', {
        id: toastId,
        description: getApiErrorMessage(err, 'Operation failed. Please try again.'),
      });
    } finally {
      setIsDemerging(false);
    }
  };

  const canDemerge =
    !!mergedSource ||
    (email.type === EmailType.DEFAULT &&
      !isConversationRoot &&
      email.externalThreadId === email.externalMessageId);

  const demergeButton = canDemerge ? (
    <button
      onClick={e => {
        e.stopPropagation();
        void handleDemerge();
      }}
      disabled={isDemerging}
      className='flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
      title={mergedSource ? 'Unmerge this ticket' : 'Unmerge this email to a new ticket'}
      data-track-category='Support'
      data-track-name={mergedSource ? 'UnmergeTicket' : 'DemergeEmail'}
      data-track-metadata={JSON.stringify({
        emailId: email.id,
        conversationId: email.conversationId,
        ...(mergedSource && { sourceTicketId: mergedSource.id }),
      })}
    >
      <Split size={12} />
      {isDemerging ? 'Unmerging...' : 'Unmerge'}
    </button>
  ) : null;

  const headerClickable = canCollapse && !!onToggleCollapse;
  const preview = useMemo(
    () =>
      stripHtml(email.body || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140),
    [email.body],
  );

  return (
    <div
      id={`mail-${email.id}`}
      data-external-message-id={email.externalMessageId || undefined}
      className={cn(
        'w-full scroll-mt-20 transition-colors',
        '[content-visibility:auto] [contain-intrinsic-size:auto_240px]',
        !isCollapsed && 'py-6',
      )}
    >
      <div
        className={cn(headerClickable && 'cursor-pointer', isCollapsed && 'py-3')}
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
          replyTo={replyToList}
          createdAt={email.createdAt}
          isCollapsed={isCollapsed}
          previewText={preview}
          deskEmail={deskEmail}
          extras={demergeButton}
          emailId={email.id}
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
                  attachments={threadAttachments ?? email.attachments}
                  onMailtoClick={onMailtoClick}
                  autoScroll={!canCollapse}
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
                body={email.body}
              />
            )}
            {onReply && (
              <div className='mt-3 flex items-center gap-2'>
                <button
                  type='button'
                  onClick={e => {
                    e.stopPropagation();
                    onReply('reply');
                  }}
                  className='inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-border text-xs font-medium text-muted-foreground hover:bg-muted active:bg-accent transition-colors cursor-pointer'
                  data-track-category='Support'
                  data-track-name='ReplyToSpecificEmail'
                  data-track-metadata={JSON.stringify({ emailId: email.id })}
                >
                  <ArrowUp size={12} className='rotate-[-90deg]' />
                  Reply
                </button>
                <button
                  type='button'
                  onClick={e => {
                    e.stopPropagation();
                    onReply('replyAll');
                  }}
                  className='inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-border text-xs font-medium text-muted-foreground hover:bg-muted active:bg-accent transition-colors cursor-pointer'
                  data-track-category='Support'
                  data-track-name='ReplyAllToSpecificEmail'
                  data-track-metadata={JSON.stringify({ emailId: email.id })}
                >
                  <ReplyAll size={12} />
                  Reply all
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

SupportScreen.displayName = 'SupportScreen';

export default SupportScreen;
