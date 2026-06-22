import {
  MessageCircle,
  FileText,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
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
  Link as LinkIcon,
  Settings,
  Plus,
  Wand2,
  Sparkles,
  Brain,
  Loader2,
  Pencil,
  Users2,
  Lock,
  Hash,
  Inbox,
  CheckCheck,
  Search,
  GitMerge,
  Mail,
  User,
  ListFilter,
  BarChart4Icon,
  Circle,
} from 'lucide-react';
import {
  ChannelVisibility,
  ChannelType,
  EmailType,
  NotificationLevel,
  AutoDraftStatus,
} from '@xyne/shared';
import React, { ReactElement, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '../../utils/classNames';
import { logger, Event } from '../../utils/logger';
import Tooltip from '../../components/ui/Tooltip';
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
import { useRefetchExternalSource } from '../../hooks/useRefetchExternalSource';
import { RefetchRangeDialog } from '../../components/Chat/EmailRefetch/RefetchRangeDialog';
import { useMarkTicketsAsRead } from '../../hooks/useMarkTicketsAsRead';
import * as Popover from '@radix-ui/react-popover';
import {
  PrioritySubmenu,
  UserSubmenu,
  AICategorySubmenu,
} from '../../components/Tickets/TicketFilters/Submenus';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import { Switch } from '../../components/ui/Switch';
import { StageFilterPopup } from '../../components/Tickets/TicketFilters/Submenus/StagesSubmenu/StageFilterPopup';
import { useChannelSubscription } from '../../hooks/useChannelSubscription';
import { useDragAndDropAreaRef } from '../../hooks/useDragAndDropAreaRef';
import { DragAndDropOverlay } from '../../components/Chat/DragAndDropOverlay';
import JoinChannel from '../../components/Chat/JoinChannel/JoinChannel';
import { mutators } from '../../zero/mutators';
import * as Tabs from '@radix-ui/react-tabs';
import { TicketDetails } from '../../components/Tickets/TicketDetails/TicketDetails';
import { Button } from '../../components/ui/Button/Button';
import { useAuthContextValues } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import { TicketListView } from '../../components/Tickets/TicketListView';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { SupportKanbanBoard } from './SupportKanbanBoard';
import { TicketPriority } from '@xyne/shared';
import type { Ticket } from '@xyne/shared';
import { getDraft } from '../../hooks/useDraft';
import { useShortcut, invokeShortcut } from '../../shortcuts';
import { v4 as uuidv4 } from 'uuid';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { AssigneePicker } from '../../components/Tickets/TicketListView/AssigneePicker';
import { StagePicker } from '../../components/Tickets/TicketListView/StagePicker';
import { PriorityPicker } from '../../components/Tickets/TicketListView/PriorityPicker';
import { EmailComposer } from '../../components/xyne-desk/EmailComposer/EmailComposer';
import { ReplyPill } from '../../components/xyne-desk/EmailComposer/ReplyPill';
import { ComposeEmailModal } from '../../components/xyne-desk/EmailComposer/ComposeEmailModal';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DraftSourcesPanel,
  isOpenableCitationUrl,
  resolveCitedClawCitations,
} from '../../components/xyne-desk/DraftSourcesPanel/DraftSourcesPanel';
import { AutoDraftReasoningPanel } from '../../components/xyne-desk/AutoDraftReasoningPanel/AutoDraftReasoningPanel';
import type {
  ClawCitation,
  ToolInvocation,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import {
  fetchSessionDetail,
  fetchUserSessionForConversation,
} from '../../services/XyneAI/XyneAISessionsService';
import { parseFromField, stripHtml } from '../../components/xyne-desk/EmailComposer/helpers';
import { EmailBodyRenderer } from '../../components/xyne-desk/EmailBody/EmailBodyRenderer';
import { SlackThread, SlackComposer } from '../../components/xyne-desk/SlackThread';
import { EmailThreadHeader } from '../../components/xyne-desk/EmailBody/EmailThreadHeader';
import { useEmailDraft } from '../../hooks/useEmailDraft';
import { DeskDraftSubtree } from '../../components/xyne-desk/DeskFolders/DeskDraftSubtree';
import { UserDraftsView } from '../../components/xyne-desk/DeskFolders/UserDraftsView';
import { useMarkEmailRead } from '../../hooks/useMarkEmailRead';
import { formatFileSize } from '../../components/ui/utils/files';
import { createPreviewUrl, downloadFile } from '../../services/clients/fileFetchService';
import { apiInstance } from '../../services/clients/apiClient';
import { attachmentViewerActor, type AttachmentRef } from '../../machines/attachmentViewerMachine';
import {
  extractInlineCitations,
  type InlineCitation,
} from '../../components/ui/TipTapExtensions/CitationMark';

import { DeskSettings } from '../../components/xyne-desk/DeskSettings';
import {
  useChannelConnectedEmail,
  clearChannelConnectedEmailCache,
} from '../../hooks/useChannelConnectedEmail';
import AddChannelForm from '../../components/Chat/AddChannelForm/AddChannelForm';
import Info, { ChannelTab } from '../../components/Chat/Info/Info';
import { useVisibleChannel } from '../../hooks/useChannels';
import { API_BASE_URL, SHAREABLE_ORIGIN } from '../../config';
import Dialog from '../../components/ui/Dialog';
import { MergeTicketsDialog } from '../../components/Tickets/MergeTicketsDialog/MergeTicketsDialog';
import { useMutation } from '@tanstack/react-query';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useSelector } from '@xstate/react';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import { useAskAiTicketContext } from '../../hooks/useAskAiTicketContext';
import { clearDeskContactsCache } from '../../hooks/useDeskContacts';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import {
  channelService,
  CreateChannelFormData,
  EmailDeskOpts,
} from '../../services/Chat/channelService';
import { summarizeEmailThread } from '../../services/summarizeService';
import { CallParticipantsSelectionModal } from '../../components/Call/CallParticipantsSelectionModal';
import { ScheduleCallModal } from '../../components/Call/ScheduleCallModal/ScheduleCallModal';
import { ThreadCallButton } from '../../components/Call/ThreadCallButton/ThreadCallButton';

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

const COMPOSE_INSTANCES_KEY_PREFIX = 'xyne:composeInstances:';
const COMPOSE_DRAFT_KEY_PREFIX = 'xyne:composeDraft:';

const readPersistedInstances = (userId: string): PersistedComposeInstance[] => {
  try {
    const raw = localStorage.getItem(`${COMPOSE_INSTANCES_KEY_PREFIX}${userId}`);
    if (!raw) return [];
    return JSON.parse(raw) as PersistedComposeInstance[];
  } catch {
    return [];
  }
};

const writePersistedInstances = (userId: string, instances: PersistedComposeInstance[]): void => {
  try {
    localStorage.setItem(`${COMPOSE_INSTANCES_KEY_PREFIX}${userId}`, JSON.stringify(instances));
  } catch {
    /* ignore quota errors */
  }
};

/** Returns true when the draft for this instance has any non-empty content. */
const instanceHasDraft = (userId: string, instanceId: string): boolean => {
  try {
    const raw = localStorage.getItem(`${COMPOSE_DRAFT_KEY_PREFIX}${userId}:${instanceId}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      subject?: string;
      body?: string;
      to?: string[];
      cc?: string[];
      bcc?: string[];
      attachments?: Array<{ attachmentId: string }>;
    };
    const bodyText = parsed.body ? stripHtml(parsed.body) : '';
    return (
      (parsed.subject?.trim().length ?? 0) > 0 ||
      bodyText.trim().length > 0 ||
      (parsed.to?.length ?? 0) > 0 ||
      (parsed.cc?.length ?? 0) > 0 ||
      (parsed.bcc?.length ?? 0) > 0 ||
      (parsed.attachments?.length ?? 0) > 0
    );
  } catch {
    return false;
  }
};

/** Returns a lightweight preview of a compose draft for display in the Drafts list. */
const readDraftPreview = (
  userId: string,
  instanceId: string,
): { subject: string; to: string[]; bodySnippet: string } => {
  try {
    const raw = localStorage.getItem(`${COMPOSE_DRAFT_KEY_PREFIX}${userId}:${instanceId}`);
    if (!raw) return { subject: '', to: [], bodySnippet: '' };
    const parsed = JSON.parse(raw) as {
      subject?: string;
      body?: string;
      to?: string[];
      attachments?: Array<{ originalName?: string }>;
    };
    const bodySnippet = parsed.body
      ? stripHtml(parsed.body).replace(/\s+/g, ' ').trim().slice(0, 120)
      : parsed.attachments?.[0]?.originalName
        ? `Attachment: ${parsed.attachments[0].originalName}`
        : '';
    return {
      subject: parsed.subject?.trim() ?? '',
      to: parsed.to ?? [],
      bodySnippet,
    };
  } catch {
    return { subject: '', to: [], bodySnippet: '' };
  }
};

/** Removes all localStorage artefacts for a compose instance (draft + AI draft). */
const clearInstanceStorage = (userId: string, instanceId: string, channelId: string): void => {
  try {
    localStorage.removeItem(`${COMPOSE_DRAFT_KEY_PREFIX}${userId}:${instanceId}`);
    // AI draft key mirrors the pattern used in SupportScreen's onClose handler.
    localStorage.removeItem(`xd-ai-draft:${channelId}_compose`);
    localStorage.removeItem(`xd-ai-draft:${instanceId}_compose`);
  } catch {
    /* ignore */
  }
};
type Email = NonNullable<
  NonNullable<QueryResultType<typeof queries.supportTicketDetail>>['emails']
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
type TabType = 'messages' | 'details' | 'sources' | 'reasoning';

type ViewMode = 'kanban' | 'list';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const { userID } = useAuthContextValues();
  const { isMobile } = usePlatform();
  const zero = useZero();
  // Channel selection is sourced strictly from the URL path (/support/:channelId).
  // A bare /support visit renders the empty state prompting the user to pick one.
  const selectedChannelId = channelIdParam ?? null;

  const [channelBoardId, setChannelBoardId] = useState<string | null>(null);
  useEffect(() => {
    setChannelBoardId(null);
  }, [selectedChannelId]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('support-view-mode');
    return (saved as ViewMode) || 'list';
  });

  const setSelectedChannelId = useCallback(
    (next: string | null): void => {
      // Preserve non-routing query params (settings, openSettings, etc.).
      const qs = searchParams.toString();
      const path = next ? `${supportBase}/${next}` : supportBase;
      void navigate(qs ? `${path}?${qs}` : path, { replace: true });
    },
    [navigate, searchParams, supportBase],
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('support-sidebar-open');
    return saved ? saved === 'true' : true;
  });
  const [filters, setFilters] = useState<TicketFilters>({});
  const [expandedDeskIds, setExpandedDeskIds] = useState<Set<string>>(new Set());
  const [deskView, setDeskView] = useState<'tickets' | 'userDrafts'>('tickets');
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
      priority: filters.priority && filters.priority.length > 0 ? filters.priority : undefined,
      stageName: filters.stages && filters.stages.length > 0 ? filters.stages : undefined,
      aiCategory:
        filters.aiCategory && filters.aiCategory.length > 0 ? filters.aiCategory : undefined,
      hasAiDraft: filters.hasAiDraft === true ? true : undefined,
    }),
    [filters, userID],
  );

  const availablePriorities = useMemo(() => Object.values(TicketPriority), []);

  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!moreFiltersOpen) {
      setActiveSubmenu(null);
    }
  }, [moreFiltersOpen]);

  const hasAssigneeFilter = !!(filters.assignee && filters.assignee.length > 0);
  const hasMoreFiltersActive = !!(
    filters.assigned ||
    filters.hasAiDraft === true ||
    (filters.priority && filters.priority.length > 0) ||
    (filters.stages && filters.stages.length > 0) ||
    (filters.aiCategory && filters.aiCategory.length > 0)
  );
  const hasAnyFilterActive = hasAssigneeFilter || hasMoreFiltersActive;

  const handleFilterChange = useCallback(
    (key: keyof TicketFilters, value: unknown): void => {
      setFilters(prev => {
        const newFilters = { ...prev, [key]: value };
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
        return newFilters;
      });
    },
    [setFilters],
  );

  const handleMenuItemClick = useCallback((category: string): void => {
    setActiveSubmenu(prev => (prev === category ? null : category));
  }, []);

  const filterMenuItems = [
    { id: 'priority', label: 'Priority', icon: BarChart4Icon },
    { id: 'stages', label: 'Stages', icon: Circle },
    { id: 'aiCategory', label: 'AI Category', icon: Sparkles },
  ] as const;

  const renderSubmenu = useCallback((): ReactElement | null => {
    if (!activeSubmenu) return null;
    switch (activeSubmenu) {
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
          <StageFilterPopup
            boardId={channelBoardId}
            selectedStages={filters.stages || []}
            onChange={(stages: string[]) => handleFilterChange('stages', stages)}
          />
        );
      case 'aiCategory':
        return (
          <AICategorySubmenu
            selectedCategories={filters.aiCategory || []}
            onChange={(categories: string[]) => handleFilterChange('aiCategory', categories)}
            channelId={selectedChannelId}
          />
        );
      default:
        return null;
    }
  }, [activeSubmenu, filters, handleFilterChange, availablePriorities]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(
    () =>
      searchParams.get('settings') === 'open' || searchParams.get('openSettings') === 'signatures',
  );
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [showRefetchDialog, setShowRefetchDialog] = useState(false);

  // ---------------------------------------------------------------------------
  // Multi-compose state — each entry is one floating compose window.
  // ---------------------------------------------------------------------------
  const [composeInstances, setComposeInstances] = useState<ComposeInstance[]>([]);

  /** Add a new compose window for the given channel. */
  const openNewCompose = useCallback(
    (channelId: string, initialTo?: string[]): void => {
      const id = uuidv4();
      const next: ComposeInstance = {
        id,
        channelId,
        minimized: false,
        key: 0,
        initialTo: initialTo ?? [],
      };
      setComposeInstances(prev => [...prev, next]);
      if (userID) {
        const persisted = readPersistedInstances(userID);
        writePersistedInstances(userID, [...persisted, { id, channelId }]);
      }
    },
    [userID],
  );

  const handleMailtoClick = useCallback(
    (email: string): void => {
      if (!selectedChannelId) return;
      openNewCompose(selectedChannelId, [email]);
    },
    [openNewCompose, selectedChannelId],
  );

  /** Close (save as draft) a compose window by instance ID. */
  const closeCompose = useCallback(
    (instanceId: string): void => {
      // localStorage reads/writes must happen outside the setState updater.
      // React StrictMode double-invokes updaters, which would corrupt the
      // persisted registry if the writes were inside the updater function.
      setComposeInstances(prev => {
        const target = prev.find(i => i.id === instanceId);
        if (target && userID) {
          const hasDraft = instanceHasDraft(userID, instanceId);
          if (hasDraft) {
            // Save as draft: keep localStorage intact, mark as closedAsDraft in registry.
            const persisted = readPersistedInstances(userID);
            const alreadyPresent = persisted.find(p => p.id === instanceId);
            const updated = alreadyPresent
              ? persisted.map(p =>
                  p.id === instanceId ? { ...p, closedAsDraft: true, savedAt: Date.now() } : p,
                )
              : [
                  ...persisted,
                  {
                    id: instanceId,
                    channelId: target.channelId,
                    closedAsDraft: true,
                    savedAt: Date.now(),
                  },
                ];
            writePersistedInstances(userID, updated);
          } else {
            // No content — discard silently.
            clearInstanceStorage(userID, instanceId, target.channelId);
            writePersistedInstances(
              userID,
              readPersistedInstances(userID).filter(p => p.id !== instanceId),
            );
          }
        }
        return prev.filter(i => i.id !== instanceId);
      });
    },
    [userID],
  );

  /** Close a compose window and explicitly discard any persisted draft state. */
  const discardCompose = useCallback(
    (instanceId: string): void => {
      setComposeInstances(prev => {
        const target = prev.find(i => i.id === instanceId);
        if (target && userID) {
          clearInstanceStorage(userID, instanceId, target.channelId);
          writePersistedInstances(
            userID,
            readPersistedInstances(userID).filter(p => p.id !== instanceId),
          );
        }
        return prev.filter(i => i.id !== instanceId);
      });
    },
    [userID],
  );

  /** Permanently discard a saved draft (from the Drafts list). */
  const discardDraft = useCallback(
    (instanceId: string): void => {
      if (!userID) return;
      const persisted = readPersistedInstances(userID);
      const target = persisted.find(p => p.id === instanceId);
      if (target) {
        clearInstanceStorage(userID, instanceId, target.channelId);
      }
      writePersistedInstances(
        userID,
        persisted.filter(p => p.id !== instanceId),
      );
      // Also remove from active instances if somehow present.
      setComposeInstances(prev => prev.filter(i => i.id !== instanceId));
    },
    [userID],
  );

  /** Reopen a saved draft as a compose window. */
  const reopenDraft = useCallback(
    (instanceId: string): void => {
      if (!userID) return;
      const persisted = readPersistedInstances(userID);
      const target = persisted.find(p => p.id === instanceId);
      if (!target) return;
      // Update registry: no longer closedAsDraft.
      const updated = persisted.map(p =>
        p.id === instanceId ? { ...p, closedAsDraft: false } : p,
      );
      writePersistedInstances(userID, updated);
      // Add to active compose instances (reuse same id so draft content is picked up).
      setComposeInstances(prev => {
        if (prev.find(i => i.id === instanceId)) return prev; // already open
        return [...prev, { id: instanceId, channelId: target.channelId, minimized: false, key: 0 }];
      });
    },
    [userID],
  );

  /** Toggle minimized state for a single compose window. */
  const setComposeMinimized = useCallback((instanceId: string, minimized: boolean): void => {
    setComposeInstances(prev => prev.map(i => (i.id === instanceId ? { ...i, minimized } : i)));
  }, []);

  // Restore any persisted compose drafts for the current channel on channel change.
  // Only instances that were NOT explicitly closed as drafts are restored as minimized
  // windows. Closed drafts are shown in the Drafts list instead.
  useEffect(() => {
    if (!selectedChannelId || !userID) return;
    const persisted = readPersistedInstances(userID);
    const channelPersisted = persisted.filter(p => p.channelId === selectedChannelId);
    if (channelPersisted.length === 0) return;

    setComposeInstances(prev => {
      // Only restore instances not already in state and not explicitly closed as drafts.
      const existingIds = new Set(prev.map(i => i.id));
      const toRestore: ComposeInstance[] = channelPersisted
        .filter(p => !p.closedAsDraft && !existingIds.has(p.id) && instanceHasDraft(userID, p.id))
        .map(p => ({ id: p.id, channelId: p.channelId, minimized: true, key: 0 }));
      if (toRestore.length === 0) return prev;
      return [...prev, ...toRestore];
    });

    // Prune any persisted instances whose drafts are now empty.
    const nonEmpty = channelPersisted.filter(p => instanceHasDraft(userID, p.id));
    const others = persisted.filter(p => p.channelId !== selectedChannelId);
    writePersistedInstances(userID, [...others, ...nonEmpty]);
  }, [selectedChannelId, userID]);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [infoDefaultTab, setInfoDefaultTab] = useState<ChannelTab>('about');

  // Reset stage filter when channel changes (different channels may have different stages)
  useEffect(() => {
    setFilters(prev => {
      const { stages: _, ...rest } = prev;
      return rest;
    });
  }, [selectedChannelId]);

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

    if (emailConnected === 'true' || emailReconnected === 'true') {
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
  }, [searchParams, setSearchParams, navigate]);

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
    localStorage.setItem('support-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('support-sidebar-open', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  // Fetch EMAIL channels using hook (from state machine, already loaded)
  const emailChannels = useEmailChannels(!ticketId);

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
  // A selected channelId that doesn't appear in useEmailChannels() means the
  // channel either doesn't exist or is a private channel the user isn't in —
  // in both cases we show a "Channel not found" message instead of the Join
  // CTA (there is nothing to join).
  const isSelectedChannelKnown =
    !!selectedChannelId && sortedEmailChannels.some(c => c.id === selectedChannelId);

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
  const selectedChannelName =
    sortedEmailChannels.find(c => c.id === selectedChannelId)?.name?.trim() || 'Xyne Desk';

  // Manual fetch — shown when a specific email channel is selected.
  // SupportScreen already filters to EMAIL channels; the hook owns its own
  // toasts and the 400 / 403 / generic-error branches.
  const refetchChannelId =
    selectedChannelId && selectedChannelId !== ALL_CHANNELS_ID ? selectedChannelId : undefined;
  const { refetch: handleRefetch, isPending: isRefetching } =
    useRefetchExternalSource(refetchChannelId);
  const canRefetch = !!refetchChannelId;
  const { markAsRead: markBulkAsRead } = useMarkTicketsAsRead();

  type SelectedTicket = {
    id: string;
    lastEmailAt: number;
    emailReads: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
  };
  const [selectedTickets, setSelectedTickets] = useState<Map<string, SelectedTicket>>(
    () => new Map(),
  );
  useEffect(() => {
    setSelectedTickets(new Map());
  }, [selectedChannelId]);
  const selectedTicketIds = useMemo(() => new Set(selectedTickets.keys()), [selectedTickets]);
  const toggleTicketSelected = useCallback(
    (row: {
      id: string;
      lastEmailAt: number;
      emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
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

  const handleMergeSelectedTickets = useCallback(
    async (parentTicketId: string): Promise<void> => {
      if (selectedTickets.size < 2) return;
      try {
        const ticketIds = Array.from(selectedTickets.keys());
        await Promise.all(
          ticketIds
            .filter(id => id !== parentTicketId)
            .map(id =>
              apiInstance.post(`/tickets/${id}/merge`, { targetTicketId: parentTicketId }),
            ),
        );
        toast.success('Tickets merged');
        clearTicketSelection();
        setShowMergeDialog(false);
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
    [selectedTickets, clearTicketSelection],
  );

  const selectedChannelFull = useMemo(
    () => sortedEmailChannels.find(c => c.id === selectedChannelId),
    [sortedEmailChannels, selectedChannelId],
  );

  const [kanbanTickets, setKanbanTickets] = useState<Ticket[]>([]);

  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const mergeDialogTickets = useMemo(() => {
    const selected = kanbanTickets.filter(t => selectedTickets.has(t.id));
    return [...selected].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }, [selectedTickets, kanbanTickets]);

  // Mutation for creating email channel
  const createChannelMutation = useMutation({
    mutationFn: async (
      data: CreateChannelFormData & {
        channelType?: 'EMAIL' | 'SLACK' | undefined;
        emailDeskOpts?: EmailDeskOpts;
      },
    ) => {
      const { channelType, emailDeskOpts, ...formData } = data;
      const response = await channelService.createChannel(
        formData,
        channelType || 'EMAIL',
        emailDeskOpts ?? { deskType: 'EMAIL' },
      );
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
      channelType?: 'EMAIL' | 'SLACK' | undefined;
      assigneeUserGroupId?: string;
      deskType?: 'EMAIL' | 'DL' | 'SLACK';
      dlEmail?: string;
      slackChannelId?: string;
    },
  ) => {
    const { connector, deskType, dlEmail, slackChannelId, ...rest } = data;
    const isElectron = typeof window.electronAPI?.openExternal === 'function';

    if (deskType === 'SLACK') {
      if (!slackChannelId) {
        toast.error('Please select a Slack channel');
        return;
      }
      createChannelMutation.mutate({
        ...rest,
        channelType: 'SLACK',
        emailDeskOpts: { deskType: 'SLACK', slackChannelId },
      });
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
        emailDeskOpts: { deskType: 'DL', dlEmail },
      });
      return;
    }

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
      if (rest.boardId) {
        params.set('boardId', rest.boardId);
      }
      if (isElectron) {
        params.set('platform', 'electron');
      }
      const microsoftUrl = `${API_BASE_URL}/integrations/microsoft/connect?${params.toString()}`;
      if (isElectron && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(microsoftUrl);
        setShowCreateChannelModal(false);
      } else {
        window.location.href = microsoftUrl;
      }
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
      if (rest.boardId) {
        params.set('boardId', rest.boardId);
      }
      if (isElectron) {
        params.set('platform', 'electron');
      }
      const googleUrl = `${API_BASE_URL}/integrations/google/connect?${params.toString()}`;
      if (isElectron && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(googleUrl);
        setShowCreateChannelModal(false);
      } else {
        window.location.href = googleUrl;
      }
      return;
    }

    createChannelMutation.mutate(rest);
  };

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
        },
      });
    },
    [navigate, isMobile, supportBase],
  );

  // Derive saved drafts: persisted instances for the current channel that were
  // explicitly closed (X) and still have content — shown in the Drafts banner.
  const savedDrafts = useMemo(() => {
    if (!selectedChannelId || !userID) return [];
    const openIds = new Set(composeInstances.map(i => i.id));
    return readPersistedInstances(userID).filter(
      p =>
        p.channelId === selectedChannelId &&
        p.closedAsDraft === true &&
        !openIds.has(p.id) &&
        instanceHasDraft(userID, p.id),
    );
  }, [selectedChannelId, userID, composeInstances]);

  const toggleDeskExpanded = useCallback((id: string): void => {
    setExpandedDeskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Plain desk selection: return to the normal ticket list for the channel.
  const selectDesk = useCallback(
    (id: string): void => {
      setSelectedChannelId(id);
      setDeskView('tickets');
    },
    [setSelectedChannelId],
  );

  const openUserDrafts = useCallback(
    (id: string): void => {
      setSelectedChannelId(id);
      setDeskView('userDrafts');
    },
    [setSelectedChannelId],
  );

  const openDeskTicket = useCallback(
    (item: {
      channelId: string;
      ticketXyneId: string;
      ticketId: string;
      conversationId: string;
    }): void => {
      void navigate(`${supportBase}/${item.channelId}/${item.ticketXyneId}`, {
        state: { conversationId: item.conversationId, ticketId: item.ticketId },
      });
    },
    [navigate, supportBase],
  );

  const composeDraftRefs = useMemo(() => {
    if (!userID) return [];
    return savedDrafts
      .slice()
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
      .map(draft => {
        const preview = readDraftPreview(userID, draft.id);
        const label =
          preview.subject ||
          (preview.to.length > 0 ? `To: ${preview.to[0]}` : '') ||
          preview.bodySnippet ||
          'No subject';
        return { id: draft.id, label };
      });
  }, [savedDrafts, userID]);

  const renderChannelRow = (c: (typeof sortedEmailChannels)[number]): ReactElement => {
    const isPrivate = c.visibility === ChannelVisibility.PRIVATE;
    const isJoined = joinedChannelIds.has(c.id);
    const isExpanded = isJoined && expandedDeskIds.has(c.id);
    const isActive = selectedChannelId === c.id && deskView === 'tickets';
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
            'flex items-center gap-1 h-8 rounded-md px-1.5 cursor-pointer transition-colors',
            isActive
              ? 'text-sidebar-primary-foreground font-medium bg-sidebar-item-active'
              : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover',
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
          {isJoined ? (
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                toggleDeskExpanded(c.id);
              }}
              className='flex items-center justify-center w-4 h-4 flex-shrink-0 rounded text-muted-foreground hover:text-foreground'
              aria-label={isExpanded ? 'Collapse desk' : 'Expand desk'}
              data-track-category='Support'
              data-track-name='ToggleDeskExpand'
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className='w-4 flex-shrink-0' />
          )}
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
              shouldShowBold && '!font-semibold text-sidebar-unread-foreground',
            )}
            style={shouldShowBold ? { fontWeight: 700 } : undefined}
          >
            {c.name?.trim() || 'Unnamed Channel'}
          </span>
        </div>
        {isExpanded && (
          <DeskDraftSubtree
            activeFolder={
              selectedChannelId === c.id && deskView === 'userDrafts' ? 'userDrafts' : null
            }
            onOpenUserDrafts={() => openUserDrafts(c.id)}
          />
        )}
      </div>
    );
  };

  return (
    <div
      data-testid='support-page'
      className='h-full flex flex-col relative bg-background md:rounded-2xl overflow-hidden shadow-md'
    >
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
                        <ChevronLeft className='size-4 text-muted-foreground' />
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
            <div className='h-full flex flex-col relative'>
              {deskView !== 'tickets' && selectedChannelId && (
                <div className='absolute inset-0 z-30 bg-background'>
                  {deskView === 'userDrafts' ? (
                    <UserDraftsView
                      channelId={selectedChannelId}
                      composeDrafts={composeDraftRefs}
                      onReopenCompose={reopenDraft}
                      onDiscardCompose={discardDraft}
                      onOpenTicket={openDeskTicket}
                      onClose={() => setDeskView('tickets')}
                    />
                  ) : null}
                </div>
              )}
              <div className='flex-shrink-0 relative border-b border-border'>
                <div
                  className={cn(
                    'flex flex-col w-full transition-opacity duration-150',
                    selectedTicketIds.size > 0 && 'opacity-0 pointer-events-none',
                  )}
                >
                  <div className='flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 min-w-0'>
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
                      <Hash size={14} className='text-muted-foreground shrink-0' />
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
                      {canRefetch && isSelectedChannelJoined && (
                        <Tooltip
                          content={isRefetching ? 'Fetching latest…' : 'Fetch latest emails'}
                          side='bottom'
                        >
                          <button
                            onClick={() => setShowRefetchDialog(true)}
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
                  <div className='flex h-14 shrink-0 items-center justify-between gap-2 px-4 min-w-0'>
                    <div className='flex items-center gap-2 min-w-0 flex-1'>
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
                          <Popover.Root open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                            <Popover.Trigger asChild>
                              <Button
                                variant='outline'
                                size='sm'
                                className='rounded-[10px] border-border hover:bg-muted text-muted-foreground'
                              >
                                <div className='flex items-center gap-1.5'>
                                  <User className='w-3 h-3 p-px font-medium' />
                                  <span className='font-medium'>Assignee</span>
                                  {hasAssigneeFilter && (
                                    <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />
                                  )}
                                  <ChevronDown
                                    className={cn(
                                      'w-3 h-3 ml-1 transition-transform',
                                      assigneeOpen && 'rotate-180',
                                    )}
                                  />
                                </div>
                              </Button>
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
                                  <span className='font-medium'>More Filters</span>
                                  {hasMoreFiltersActive && (
                                    <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />
                                  )}
                                </div>
                              </Button>
                            </Popover.Trigger>

                            <Popover.Content
                              side='bottom'
                              align='start'
                              sideOffset={6}
                              className='w-56 bg-background border border-border rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto'
                              onInteractOutside={e => {
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
                                    (item.id === 'priority' &&
                                      !!(filters.priority && filters.priority.length > 0)) ||
                                    (item.id === 'stages' &&
                                      !!(filters.stages && filters.stages.length > 0)) ||
                                    (item.id === 'aiCategory' &&
                                      !!(filters.aiCategory && filters.aiCategory.length > 0));
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
                      {/* Compose new email — visible only on a joined email channel */}
                      {isSelectedChannelJoined && selectedChannelId && (
                        <Tooltip content='Compose new email' side='bottom'>
                          <Button
                            variant='default'
                            size='sm'
                            className='rounded-[10px] bg-[#6276BE]/80 hover:bg-[#6276BE]'
                            onClick={() => openNewCompose(selectedChannelId)}
                            data-track-category='Support'
                            data-track-name='OpenComposeEmail'
                            data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
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
                            {savedDrafts
                              .slice()
                              .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
                              .map(draft => {
                                const preview = readDraftPreview(userID, draft.id);
                                const label =
                                  preview.subject ||
                                  (preview.to.length > 0 ? `To: ${preview.to[0]}` : '') ||
                                  preview.bodySnippet ||
                                  'No subject';
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
                        onBoardIdResolved={setChannelBoardId}
                        ticketFilter={ticketFilter}
                        onTicketClick={handleTicketClick}
                        onTicketsLoaded={setKanbanTickets}
                      />
                    ) : (
                      <TicketListView
                        isMember={isSelectedChannelJoined}
                        filter={{
                          channelId: selectedChannelId,
                          ...ticketFilter,
                        }}
                        showExtraFields={true}
                        activeTicketId={ticketId}
                        selectedIds={selectedTicketIds}
                        onToggleSelect={toggleTicketSelected}
                        onBoardIdReady={setChannelBoardId}
                        onTicketClick={ticket => {
                          void navigate(`${supportBase}/${ticket.channelId}/${ticket.xyneId}`, {
                            state: {
                              conversationId: ticket.conversationId,
                              ticketId: ticket.id,
                            },
                          });
                        }}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </Panel>
        )}
        {ticketId && (
          <Panel defaultSize={100} minSize={100} order={3}>
            <div className='h-full overflow-hidden'>
              <SupportTicketDetail
                ticketFilter={ticketFilter}
                isMember={isSelectedChannelJoined}
                onMailtoClick={handleMailtoClick}
              />
            </div>
          </Panel>
        )}
      </PanelGroup>

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

      {/* Fetch Range Dialog */}
      {canRefetch && (
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

      <MergeTicketsDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        tickets={mergeDialogTickets}
        onMerge={handleMergeSelectedTickets}
      />

      {/* Multi-compose scrollable strip — fixed at the bottom, spans full width.
          Windows are laid out right-to-left (flex-row-reverse) so the newest
          window always sits at the right edge. When there are more windows than
          fit on screen, the strip becomes horizontally scrollable; the user
          scrolls left to reveal older windows. pointer-events-none on the strip
          itself prevents it from blocking clicks on the ticket list beneath. */}
      {isSelectedChannelJoined &&
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
      <AssigneePicker ticketId={ticket.id} assignedTo={ticket.assignedTo} label={assigneeName} />
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
    priority: TicketPriority[] | undefined;
    stageName: string[] | undefined;
    aiCategory: string[] | undefined;
    hasAiDraft: boolean | undefined;
  };
  isMember: boolean;
  onMailtoClick: (email: string) => void;
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
};

export const SupportTicketDetail = ({
  ticketFilter,
  isMember,
  onMailtoClick,
  navBasePath,
  onBack,
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
  const { workspaceId, userID } = useAuthContextValues();
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
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll'>('reply');
  // Auto-draft citations, fetched from the desk-owner's claw draft conversation
  // via the autodraft-insight read-through endpoint (the auto-draft runs as the
  // channel owner, so its citations aren't in the querying user's sidebar).
  const [autoDraftCitations, setAutoDraftCitations] = useState<ClawCitation[]>([]);
  // The querying user's own draft-agent session for this email thread (rerun /
  // help-me-write run as the user). Used only to gate the "See sources" entry
  // points — its citations live in the user's sidebar, not in this panel.
  const [userDraftSession, setUserDraftSession] = useState<{
    sessionId: string;
    answered: boolean;
  } | null>(null);
  const [sourcesHydrating, setSourcesHydrating] = useState(false);
  const [draftInlineCitations, setDraftInlineCitations] = useState<InlineCitation[]>([]);
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
  const [searchParams, setSearchParams] = useSearchParams();
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
  // `mail` is set by navigateToMail (mail search-result click) and carries
  // either Postgres email.id or Gmail externalMessageId. We scroll to the
  // matching EmailThreadItem after emails load.
  const targetMailId = searchParams.get('mail');

  // Single consolidated fetch: the ticket row with `.related('emails')` gives us emails,
  // channelId (scalar on ticket), conversationId, and everything else we need — replaces
  // getEmailsForTicket + getConversationById. supportTicketDetail looks up by `id` when
  // list navigation supplied it (router state), else by `xyneId` from the URL path param.
  const [ticket] = useCachedQuery(
    queries.supportTicketDetail({
      id: ticketId || undefined,
      xyneId: ticketIdParam || undefined,
      workspaceId,
      channelId: routeChannelId,
      isMember,
    }),
    { enabled: (!!ticketId || !!ticketIdParam) && !!routeChannelId },
  );
  const ticketEmailDrafts = (
    ticket as
      | {
          emailDrafts?: ReadonlyArray<{
            draftContent?: string | null;
            userId?: string | null;
          }>;
        }
      | null
      | undefined
  )?.emailDrafts;
  const ticketEmailDraftCount = ticketEmailDrafts?.length ?? 0;
  const draftBodyHtml = useMemo<string | null>(() => {
    if (!ticketEmailDrafts || ticketEmailDrafts.length === 0) return null;

    const ownedBody: string | null = userID
      ? (ticketEmailDrafts.find(d => d.userId === userID)?.draftContent ?? null)
      : null;
    const fallbackBody: string | null =
      ticketEmailDrafts.find(d => d.userId === null)?.draftContent ?? null;
    return ownedBody ?? fallbackBody;
  }, [ticketEmailDrafts, userID]);
  const persistedInlineCitations = useMemo(
    () => extractInlineCitations(draftBodyHtml ?? ''),
    [draftBodyHtml],
  );
  const visibleInlineCitations = useMemo(
    () =>
      (draftInlineCitations.length > 0 ? draftInlineCitations : persistedInlineCitations).filter(
        citation => isOpenableCitationUrl(citation.url),
      ),
    [draftInlineCitations, persistedInlineCitations],
  );
  const visibleAutoDraftCitations = useMemo<ClawCitation[]>(() => {
    if (!(composerOpen || ticketEmailDraftCount > 0)) return [];
    return autoDraftCitations;
  }, [composerOpen, ticketEmailDraftCount, autoDraftCitations]);

  const draftHasCitations =
    (composerOpen || ticketEmailDraftCount > 0) &&
    (visibleAutoDraftCitations.length > 0 || visibleInlineCitations.length > 0);
  const hasUserDraftAgentSession = !!userDraftSession?.answered;
  const emails = useMemo(() => (ticket?.emails as Email[] | undefined) ?? [], [ticket?.emails]);
  const emailCollapseState = useEmailCollapseState(emails);

  const initiator = useMemo(() => {
    if (emails.length === 0) return null;
    const first = [...emails].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
    if (!first?.from) return null;
    return parseFromField(first.from);
  }, [emails]);

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

  const channelId = ticket?.channelId || '';
  const conversationId = ticket?.conversationId ?? stateConversationId;
  const title = ticket?.title ?? null;
  const boardId = ticket?.boardId ?? null;

  const [channelPreferenceList] = useCachedQuery(
    queries.getEmailChannelPreference({ channelId: channelId || '' }),
    { enabled: !!channelId },
  );
  const draftAgentSlug = channelPreferenceList?.[0]?.autoDraftAgentSlug || 'draft-agent';
  const { setSelectedAgentSlug } = useSelectedAgent();

  const openDraftAgentSession = useCallback(
    async (explicitSessionId?: string): Promise<void> => {
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
      if (!sessionId) {
        try {
          sessionId = await fetchUserSessionForConversation(conversationId);
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
        ...(sessionId ? { focusSessionId: sessionId } : { startFreshChat: true }),
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

  useEffect(() => {
    let cancelled = false;
    setAutoDraftCitations([]);
    setUserDraftSession(null);
    if (!conversationId) {
      setSourcesHydrating(false);
      return () => {
        cancelled = true;
      };
    }
    setSourcesHydrating(true);

    const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
      let lastErr = new Error('request failed');
      for (const delay of [0, 400, 1200]) {
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
        if (cancelled) throw new Error('cancelled');
        try {
          return await fn();
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw lastErr;
    };

    const hydrateAutodraft = async (): Promise<void> => {
      if (!channelId) return;
      try {
        const res = await withRetry(() =>
          apiInstance.get<{
            available: boolean;
            content: string | null;
            toolInvocations: ToolInvocation[];
          }>(`/email/${conversationId}/autodraft-insight`, { params: { channelId } }),
        );
        if (cancelled) return;
        const citations = resolveCitedClawCitations(res.data.content, res.data.toolInvocations);
        if (!cancelled) setAutoDraftCitations(citations);
      } catch {
        // No auto-draft insight yet for this conv — fine, leave empty.
      }
    };

    const hydrateUserSession = async (): Promise<void> => {
      try {
        const sessionId = await withRetry(() => fetchUserSessionForConversation(conversationId));
        if (cancelled || !sessionId) return;
        const detail = await withRetry(() => fetchSessionDetail(sessionId));
        if (cancelled) return;
        const answered = detail.messages.some(m => m.type === 'bot');
        if (!cancelled) setUserDraftSession({ sessionId, answered });
      } catch {
        // 404 = no user session yet for this conv — leave null (button hidden).
      }
    };

    void Promise.allSettled([hydrateAutodraft(), hydrateUserSession()]).finally(() => {
      if (!cancelled) setSourcesHydrating(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, channelId]);

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

  // Desk's connected mailbox — used as the "me" reference in thread headers
  // and recipient summaries. Sourced from the existing `/channels/:id/connected-email`
  // API via `useChannelConnectedEmail`. Empty string until loaded.
  const deskEmail = useChannelConnectedEmail(channelId || null);

  useAskAiTicketContext({
    channelId: channelId || null,
    conversationId: conversationId ?? null,
    previewText: title || 'Ticket conversation',
  });
  const conversation = ticket?.conversation;
  const ticketDraft = useEmailDraft(conversationId ?? null);
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
    void navigate(`${navBasePath ?? supportBase}/${nextChannelId}/${t.xyneId}`, {
      state: {
        conversationId: t.conversationId,
        ticketId: t.id,
      },
    });
  };

  const navigateAdjacent = async (dir: 'forward' | 'backward'): Promise<void> => {
    if (!cursorStart || !channelId) return;
    try {
      const result = (await zero.run(
        queries.supportTicketsPageV3({
          channelId,
          isMember,
          ...ticketFilter,
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

  // Fetch messages for the conversation
  const [messages] = useCachedQuery(
    queries.conversationMessagesV2({
      conversationId: conversationId || '',
    }),
    {
      enabled: !!conversationId && !!channelId,
    },
  );

  const targetMessageId = searchParams.get('messageId');
  useEffect(() => {
    if (!targetMessageId || !conversationId) return;
    if (!messages || messages.length === 0) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = document.getElementById(
          `thread-message-${conversationId}-${targetMessageId}`,
        );
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('bg-yellow-50');
          setTimeout(() => target.classList.remove('bg-yellow-50'), 2500);
        }
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [targetMessageId, conversationId, messages]);

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
          mutators.activities.markThreadActivitiesAsReadV2({
            conversationId,
            timestamp: Date.now(),
            draftMessage: draft || '',
            draftMessageId: uuidv4(),
            participantId: uuidv4(),
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

  const hasAutoDraftReasoning = ticketDraft?.autoDraftStatus === AutoDraftStatus.READY;
  const activeTab: TabType = ((): TabType => {
    const t = searchParams.get('selectedTab');
    if (t === 'details') return 'details';
    if (t === 'sources') return 'sources';
    if (t === 'reasoning' && hasAutoDraftReasoning) return 'reasoning';
    return 'messages';
  })();
  const setActiveTab = useCallback(
    (next: TabType) => {
      setSearchParams(
        prev => {
          const params = new URLSearchParams(prev);
          params.set('selectedTab', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
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
        <Panel defaultSize={65} minSize={30} maxSize={70}>
          <div className='h-full flex flex-col overflow-hidden relative'>
            <div className='w-full px-6 py-4 flex flex-col gap-2.5 flex-shrink-0 sticky top-0 bg-background z-10 border-b border-border'>
              <div className='flex items-center gap-2 min-w-0'>
                <button
                  type='button'
                  onClick={() => {
                    if (onBack) {
                      onBack();
                      return;
                    }
                    const back = channelIdParam ? `${supportBase}/${channelIdParam}` : supportBase;
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
              <div className='flex items-center gap-2 flex-shrink-0'>
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
                </div>
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
                  {channel?.type === ChannelType.SLACK ? (
                    <SlackThread
                      emails={emails}
                      ticketId={ticket?.id}
                      lastEmailAt={ticket?.lastEmailAt}
                      emailReads={
                        ticket?.emailReads as
                          | Array<{ userId: string; lastReadEmailAt: number }>
                          | undefined
                      }
                    />
                  ) : (
                    <EmailThread
                      collapseState={emailCollapseState}
                      ticketId={ticket?.id}
                      lastEmailAt={ticket?.lastEmailAt}
                      emailReads={
                        ticket?.emailReads as
                          | Array<{ userId: string; lastReadEmailAt: number }>
                          | undefined
                      }
                      onReplyToEmail={(emailId, mode) => {
                        clearStoredRecipients(conversationId);
                        setReplyToEmailId(emailId);
                        setReplyMode(mode);
                        setComposerOpen(true);
                      }}
                      deskEmail={deskEmail}
                      onMailtoClick={onMailtoClick}
                    />
                  )}
                </div>
              )}
            </div>
            <div className='absolute inset-x-0 bottom-0 z-20' ref={composerOverlayRef}>
              {channel?.type === ChannelType.SLACK ? (
                conversationId ? (
                  <SlackComposer conversationId={conversationId} channelId={channel?.id ?? null} />
                ) : null
              ) : (
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
                        emails={ticket?.emails}
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
                        onCitationClick={(): void => {
                          setActiveTab('sources');
                        }}
                        onSeeSources={sessionId => void openDraftAgentSession(sessionId)}
                        showSeeSources={hasUserDraftAgentSession}
                        onDraftInlineCitationsChange={setDraftInlineCitations}
                        channelId={channelId}
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
            <Panel defaultSize={35} minSize={30} maxSize={70}>
              <div
                className='h-full flex flex-col overflow-hidden relative'
                ref={dragAndDropAreaRef}
                data-thread-citation-host
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
                          {draftHasCitations && (
                            <Tabs.Trigger asChild value='sources'>
                              <button
                                className={cn(
                                  'px-3 py-2 flex items-center justify-start gap-2 transition-all duration-100 cursor-pointer',
                                  activeTab === 'sources'
                                    ? 'border-b-2 border-primary'
                                    : 'border-b-2 border-transparent',
                                )}
                                data-track-category='Support'
                                data-track-name='OpenSourcesTab'
                              >
                                <span
                                  className={`${activeTab === 'sources' ? 'text-primary' : 'text-muted-foreground'}`}
                                >
                                  <Sparkles size={12} />
                                </span>
                                <span
                                  className={`text-sm font-medium ${activeTab === 'sources' ? 'text-primary' : 'text-muted-foreground'}`}
                                >
                                  Sources
                                </span>
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold',
                                    activeTab === 'sources'
                                      ? 'bg-primary/10 text-primary'
                                      : 'bg-muted text-muted-foreground',
                                  )}
                                >
                                  {sourcesHydrating && visibleAutoDraftCitations.length === 0 ? (
                                    <Loader2 size={10} className='animate-spin' />
                                  ) : (
                                    visibleAutoDraftCitations.length
                                  )}
                                </span>
                              </button>
                            </Tabs.Trigger>
                          )}
                          {hasAutoDraftReasoning && (
                            <Tabs.Trigger asChild value='reasoning'>
                              <button
                                className={cn(
                                  'px-3 py-2 flex items-center justify-start gap-2 transition-all duration-100 cursor-pointer',
                                  activeTab === 'reasoning'
                                    ? 'border-b-2 border-primary'
                                    : 'border-b-2 border-transparent',
                                )}
                                data-track-category='Support'
                                data-track-name='OpenReasoningTab'
                              >
                                <span
                                  className={`${activeTab === 'reasoning' ? 'text-primary' : 'text-muted-foreground'}`}
                                >
                                  <Brain size={12} />
                                </span>
                                <span
                                  className={`text-sm font-medium ${activeTab === 'reasoning' ? 'text-primary' : 'text-muted-foreground'}`}
                                >
                                  Reasoning
                                </span>
                              </button>
                            </Tabs.Trigger>
                          )}
                        </Tabs.List>
                        <div className='flex items-center gap-2 shrink-0'>
                          {/* Initiate Call Button */}
                          {conversationId && (
                            <ThreadCallButton
                              onStartCall={() => setShowParticipantsModal(true)}
                              onScheduleCall={() => setIsScheduleCallModalOpen(true)}
                              hasActiveCall={hasActiveCallForConversation}
                              testId='support-initiate-call-button'
                            />
                          )}
                          <Tooltip content='Ask AI' side='bottom' delayDuration={300}>
                            <button
                              type='button'
                              onClick={() => {
                                if (isAIPanelOpen) {
                                  xyneAIActor.send({ type: 'CLOSE' });
                                } else {
                                  void openDraftAgentSession();
                                }
                              }}
                              className={cn(
                                'h-8 w-8 flex items-center justify-center rounded-lg border border-border transition-colors',
                                isAIPanelOpen ? 'bg-[#F3EEFF]' : 'hover:bg-muted',
                              )}
                              aria-label='Toggle Ask AI panel'
                              aria-pressed={isAIPanelOpen}
                              data-track-category='Support'
                              data-track-name='ToggleAIPanel'
                              data-track-metadata={JSON.stringify({ source: 'right-panel-header' })}
                            >
                              <span className='inline-flex animate-ai-pop'>
                                <XyneAIStar size={14} />
                              </span>
                            </button>
                          </Tooltip>
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

                    <Tabs.Content
                      value='sources'
                      className='flex-1 overflow-auto data-[state=inactive]:hidden p-4'
                    >
                      <DraftSourcesPanel
                        citations={visibleAutoDraftCitations}
                        embedded
                        showAutoDraftNote
                        loading={sourcesHydrating}
                      />
                    </Tabs.Content>

                    {hasAutoDraftReasoning && conversationId && channelId && (
                      <Tabs.Content
                        value='reasoning'
                        className='flex-1 overflow-auto data-[state=inactive]:hidden p-4'
                      >
                        <AutoDraftReasoningPanel
                          conversationId={conversationId}
                          channelId={channelId}
                        />
                      </Tabs.Content>
                    )}
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
  lastEmailAt,
  emailReads,
  onReplyToEmail,
  deskEmail,
  onMailtoClick,
}: {
  collapseState: EmailCollapseState;
  ticketId?: string | null | undefined;
  lastEmailAt?: number | null | undefined;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }> | undefined;
  onReplyToEmail?: (emailId: string, mode: 'reply' | 'replyAll') => void;
  deskEmail?: string | null | undefined;
  onMailtoClick: (email: string) => void;
}): ReactElement => {
  const { sortedEmails, collapsedIds, toggleOne, lastEmailId } = collapseState;
  const rootEmail = sortedEmails[0];
  // Thread-level: upsert the current user's email_reads row. `isRead` compares
  // the stored lastReadEmailAt snapshot against the ticket's lastEmailAt, so
  // every email header in the thread flips read/unread together.
  const { isRead } = useMarkEmailRead(
    ticketId,
    lastEmailId ?? null,
    lastEmailAt ?? null,
    emailReads,
    true,
  );
  const threadAttachments = useMemo(
    () => sortedEmails.flatMap(e => e.attachments ?? []),
    [sortedEmails],
  );
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
          threadAttachments={threadAttachments}
          {...(onReplyToEmail &&
            email.id !== lastEmailId && {
              // Per-email Reply / Reply all only on older messages — the
              // latest already has the dedicated bar at the thread footer,
              // so showing one here would be a duplicate.
              onReply: (mode: 'reply' | 'replyAll') => onReplyToEmail(email.id, mode),
            })}
          deskEmail={deskEmail}
          rootEmail={rootEmail}
          onMailtoClick={onMailtoClick}
        />
      ))}
    </div>
  );
};

const EmailThreadItem = ({
  email,
  isCollapsed = false,
  canCollapse = true,
  onToggleCollapse,
  isRead = true,
  onReply,
  deskEmail,
  rootEmail,
  threadAttachments,
  onMailtoClick,
}: {
  email: Email;
  isCollapsed?: boolean;
  canCollapse?: boolean;
  onToggleCollapse?: () => void;
  isRead?: boolean;
  onReply?: (mode: 'reply' | 'replyAll') => void;
  deskEmail?: string | null | undefined;
  rootEmail: Email | undefined;
  threadAttachments?: NonNullable<Email['attachments']>;
  onMailtoClick: (email: string) => void;
}): ReactElement => {
  const { channelId: channelIdParam } = useParams<{ channelId?: string }>();
  const navigate = useNavigate();
  const { name: fromName, email: fromEmail } = parseFromField(email.from || '');
  const toList = email.to || [];
  const ccList = email.cc || [];
  const bccList = email.bcc || [];
  const replyToList = email.replyTo || [];

  const [isDemerging, setIsDemerging] = useState(false);

  const handleDemerge = async (): Promise<void> => {
    if (isDemerging) return;
    setIsDemerging(true);

    const toastId = toast.loading('Demerging email...', {
      description: 'Creating new ticket from this email',
    });

    try {
      const response = await apiInstance.post<DemergeEmailResponse>('/email/demerge', {
        emailId: email.id,
      });

      if (response.data?.success && response.data.newTicket) {
        toast.success('Demerge Successful', {
          id: toastId,
          description: `Created new ticket ${response.data.newTicket.xyneId}`,
        });

        if (channelIdParam) {
          void navigate(`/support/${channelIdParam}/${response.data.newTicket.xyneId}`, {
            state: {
              conversationId: response.data.newTicket.conversationId,
              title: email.subject,
              ticketId: response.data.newTicket.ticketId,
            },
          });
        }
      }
    } catch {
      toast.error('Demerge Failed', {
        id: toastId,
        description: 'Operation failed. Please try again.',
      });
    } finally {
      setIsDemerging(false);
    }
  };

  const canDemerge =
    email.type === EmailType.DEFAULT &&
    !!rootEmail &&
    email.id !== rootEmail.id &&
    email.externalThreadId === email.externalMessageId;

  const demergeButton = canDemerge ? (
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

  const headerClickable = canCollapse && !!onToggleCollapse;
  const preview = stripHtml(email.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

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
          isRead={isRead}
          deskEmail={deskEmail}
          extras={demergeButton}
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
