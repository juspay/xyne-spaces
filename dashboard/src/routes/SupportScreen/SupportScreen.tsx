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
  Loader2,
  Pencil,
  Trash2,
  Users2,
  Lock,
  Hash,
  Inbox,
  CheckCheck,
  SquareCheck,
} from 'lucide-react';
import { ChannelVisibility, EmailType, EmailMergeMode } from '@xyne/shared';
import React, { ReactElement, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '../../utils/classNames';
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
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import { useRefetchExternalSource } from '../../hooks/useRefetchExternalSource';
import { RefetchRangeDialog } from '../../components/Chat/EmailRefetch/RefetchRangeDialog';
import { useMarkTicketsAsRead } from '../../hooks/useMarkTicketsAsRead';
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
import { Button } from '../../components/ui/Button/Button';
import Badge from '../../components/ui/Badge';
import { useAuthContextValues } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import { TicketListView } from '../../components/Tickets/TicketListView';
import type { TicketListViewHandle } from '../../components/Tickets/TicketListView/TicketListView';
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
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import type { Ticket, BoardMetadata, TicketStageRequest } from '@xyne/shared';
import type { Stage } from '../KanbanBoardScreen/KanbanBoardScreen.types';
import { StageFormModal } from '../../components/Tickets/StageFormModal/StageFormModal';
import { getDraft } from '../../hooks/useDraft';
import { useShortcut } from '../../shortcuts';
import { v4 as uuidv4 } from 'uuid';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { AssigneePicker } from '../../components/Tickets/TicketListView/AssigneePicker';
import { StagePicker } from '../../components/Tickets/TicketListView/StagePicker';
import { PriorityPicker } from '../../components/Tickets/TicketListView/PriorityPicker';
import { EmailComposer } from '../../components/xyne-desk/EmailComposer/EmailComposer';
import { ComposeEmailModal } from '../../components/xyne-desk/EmailComposer/ComposeEmailModal';
import { parseFromField, stripHtml } from '../../components/xyne-desk/EmailComposer/helpers';
import { EmailBodyRenderer } from '../../components/xyne-desk/EmailBody/EmailBodyRenderer';
import { EmailThreadHeader } from '../../components/xyne-desk/EmailBody/EmailThreadHeader';
import { formatEmailHeaderDate } from '../../components/xyne-desk/EmailBody/emailHeaderUtils';
import { useEmailDrafts, type EmailDraftRecord } from '../../hooks/useEmailDraft';
import { useMarkEmailRead } from '../../hooks/useMarkEmailRead';
import { formatFileSize } from '../../components/ui/utils/files';
import { createPreviewUrl, downloadFile } from '../../services/clients/fileFetchService';
import { apiInstance } from '../../services/clients/apiClient';
import { attachmentViewerActor, type AttachmentRef } from '../../machines/attachmentViewerMachine';
import { SignatureEditor } from '../../components/xyne-desk/SignatureEditor/SignatureEditor';
import { InboxSettings } from '../../components/xyne-desk/InboxSettings/InboxSettings';
import { ClassificationSettings } from '../../components/xyne-desk/ClassificationSettings/ClassificationSettings';
import { PrioritySettings } from '../../components/xyne-desk/PrioritySettings';
import { useUserGroups } from '../../hooks/useUserGroup';
import { DeskIntegrationCard } from '../../components/xyne-desk/DeskIntegrationCard/DeskIntegrationCard';
import {
  useEmailChannelPreference,
  useUpdateEmailChannelPreference,
} from '../../hooks/useEmailChannelPreference';
import { useBoardsSlaPolicies } from '../../hooks/useChannelSlaPolicy';
import {
  useChannelConnectedEmail,
  clearChannelConnectedEmailCache,
} from '../../hooks/useChannelConnectedEmail';
import AddChannelForm from '../../components/Chat/AddChannelForm/AddChannelForm';
import Info, { ChannelTab } from '../../components/Chat/Info/Info';
import { useVisibleChannel } from '../../hooks/useChannels';
import { API_BASE_URL, SHAREABLE_ORIGIN } from '../../config';
import Dialog from '../../components/ui/Dialog';
import { useMutation } from '@tanstack/react-query';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useSelector } from '@xstate/react';
import { useAskAiTicketContext } from '../../hooks/useAskAiTicketContext';
import { clearDeskContactsCache } from '../../hooks/useDeskContacts';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { channelService, CreateChannelFormData } from '../../services/Chat/channelService';
import { summarizeEmailThread } from '../../services/summarizeService';
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

const getStageOptions = (stages: ReadonlyArray<{ name: string }> | undefined): string[] =>
  stages?.map(stage => stage.name) ?? [];

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
  const selectedChannelForSettings = useVisibleChannel(selectedChannelId ?? '');

  // Inbox settings panel form state — drafts for owner + assignee user group with a single
  // Save button rendered in the panel header.
  const updateEmailChannelPreference = useUpdateEmailChannelPreference();
  const currentInboxOwnerUserId = emailChannelPreference?.ownerUserId ?? null;
  const currentInboxAssigneeUserGroupId = emailChannelPreference?.assigneeUserGroupId ?? null;
  const currentInboxSendAsEmail = emailChannelPreference?.sendAsEmail ?? null;
  const currentInboxDefaultCc = emailChannelPreference?.defaultCc ?? null;
  const currentInboxEmailMergeMode: EmailMergeMode =
    emailChannelPreference?.emailMergeMode ?? EmailMergeMode.ENABLED;
  const [draftInboxOwnerUserId, setDraftInboxOwnerUserId] = useState<string | null>(
    currentInboxOwnerUserId,
  );
  const [draftInboxAssigneeUserGroupId, setDraftInboxAssigneeUserGroupId] = useState<string | null>(
    currentInboxAssigneeUserGroupId,
  );
  const [draftInboxSendAsEmail, setDraftInboxSendAsEmail] = useState<string | null>(
    currentInboxSendAsEmail,
  );
  const [draftInboxEmailMergeMode, setDraftInboxEmailMergeMode] = useState<EmailMergeMode>(
    currentInboxEmailMergeMode,
  );
  const [isSavingInboxSettings, setIsSavingInboxSettings] = useState(false);
  const [isSavingDefaultCc, setIsSavingDefaultCc] = useState(false);
  useEffect(() => {
    setDraftInboxOwnerUserId(currentInboxOwnerUserId);
  }, [currentInboxOwnerUserId]);

  useEffect(() => {
    setDraftInboxAssigneeUserGroupId(currentInboxAssigneeUserGroupId);
  }, [currentInboxAssigneeUserGroupId]);

  useEffect(() => {
    setDraftInboxSendAsEmail(currentInboxSendAsEmail);
  }, [currentInboxSendAsEmail]);

  useEffect(() => {
    setDraftInboxEmailMergeMode(currentInboxEmailMergeMode);
  }, [currentInboxEmailMergeMode]);

  const canEditSendAsEmail =
    !!userID &&
    !!selectedChannelForSettings &&
    (selectedChannelForSettings.createdBy === userID || currentInboxOwnerUserId === userID);

  const inboxSettingsHasChanges =
    !!selectedChannelId &&
    (draftInboxOwnerUserId !== currentInboxOwnerUserId ||
      draftInboxAssigneeUserGroupId !== currentInboxAssigneeUserGroupId ||
      (canEditSendAsEmail && draftInboxSendAsEmail !== currentInboxSendAsEmail) ||
      draftInboxEmailMergeMode !== currentInboxEmailMergeMode);

  const handleSaveInboxSettings = useCallback(async () => {
    if (!selectedChannelId) {
      return;
    }
    setIsSavingInboxSettings(true);
    try {
      await updateEmailChannelPreference.mutateAsync({
        channelId: selectedChannelId,
        ...(draftInboxOwnerUserId !== currentInboxOwnerUserId && draftInboxOwnerUserId
          ? { ownerUserId: draftInboxOwnerUserId }
          : {}),
        ...(draftInboxAssigneeUserGroupId !== currentInboxAssigneeUserGroupId
          ? { assigneeUserGroupId: draftInboxAssigneeUserGroupId }
          : {}),
        ...(canEditSendAsEmail && draftInboxSendAsEmail !== currentInboxSendAsEmail
          ? { sendAsEmail: draftInboxSendAsEmail }
          : {}),
        ...(draftInboxEmailMergeMode !== currentInboxEmailMergeMode
          ? { emailMergeMode: draftInboxEmailMergeMode }
          : {}),
      });
    } catch (error) {
      setDraftInboxOwnerUserId(currentInboxOwnerUserId);
      setDraftInboxAssigneeUserGroupId(currentInboxAssigneeUserGroupId);
      setDraftInboxSendAsEmail(currentInboxSendAsEmail);
      setDraftInboxEmailMergeMode(currentInboxEmailMergeMode);
      console.error('Failed to update email channel preference:', error);
    } finally {
      setIsSavingInboxSettings(false);
    }
  }, [
    selectedChannelId,
    draftInboxOwnerUserId,
    currentInboxOwnerUserId,
    draftInboxAssigneeUserGroupId,
    currentInboxAssigneeUserGroupId,
    canEditSendAsEmail,
    draftInboxSendAsEmail,
    currentInboxSendAsEmail,
    draftInboxEmailMergeMode,
    currentInboxEmailMergeMode,
    updateEmailChannelPreference,
  ]);

  const handleCancelInboxSettings = useCallback(() => {
    setDraftInboxOwnerUserId(currentInboxOwnerUserId);
    setDraftInboxAssigneeUserGroupId(currentInboxAssigneeUserGroupId);
    setDraftInboxSendAsEmail(currentInboxSendAsEmail);
    setDraftInboxEmailMergeMode(currentInboxEmailMergeMode);
  }, [
    currentInboxOwnerUserId,
    currentInboxAssigneeUserGroupId,
    currentInboxSendAsEmail,
    currentInboxEmailMergeMode,
  ]);

  const allUserGroups = useUserGroups();

  const handleSaveDefaultCc = useCallback(
    async (value: string | null) => {
      if (!selectedChannelId) return;
      setIsSavingDefaultCc(true);
      try {
        await updateEmailChannelPreference.mutateAsync({
          channelId: selectedChannelId,
          defaultCc: value,
        });
      } catch (error) {
        console.error('Failed to save default CC:', error);
      } finally {
        setIsSavingDefaultCc(false);
      }
    },
    [selectedChannelId, updateEmailChannelPreference],
  );

  // Fetch stages for the board configured in email channel preference
  const boardId = emailChannelPreference?.boardId;
  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: boardId || '' }), {
    enabled: !!boardId,
  });

  // Fetch board metadata to determine the active SLA mechanism.
  // getBoardById is lightweight (board + project only, no stages) and is a
  // separate subscription from stagesByBoard, which returns stages not board rows.
  const [boardForSla] = useCachedQuery(queries.getBoardById({ boardId: boardId || '' }), {
    enabled: !!boardId,
  });
  const isBoardPrioritySla =
    (boardForSla?.metadata as BoardMetadata | null | undefined)?.slaPolicyType === 'priority';

  // Fetch SLA policies only when the board is configured for priority-based SLA.
  // Boards using stage-based SLA (the default) have no active entries in
  // board_sla_policies, so we skip the subscription entirely rather than letting
  // it fire an empty query.
  const kanbanSlaPolicies = useBoardsSlaPolicies(isBoardPrioritySla && boardId ? [boardId] : []);

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
  const [showRefetchDialog, setShowRefetchDialog] = useState(false);

  // ---------------------------------------------------------------------------
  // Multi-compose state — each entry is one floating compose window.
  // ---------------------------------------------------------------------------
  const [composeInstances, setComposeInstances] = useState<ComposeInstance[]>([]);

  /** Add a new compose window for the given channel. */
  const openNewCompose = useCallback(
    (channelId: string): void => {
      const id = uuidv4();
      const next: ComposeInstance = { id, channelId, minimized: false, key: 0 };
      setComposeInstances(prev => [...prev, next]);
      if (userID) {
        const persisted = readPersistedInstances(userID);
        writePersistedInstances(userID, [...persisted, { id, channelId }]);
      }
    },
    [userID],
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
    setSelectedStages([]);
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
    void navigate(`/support/${selectedChannelId}/${xyneId}${qs ? `?${qs}` : ''}`, {
      replace: true,
    });
  }, [
    deeplinkConversationId,
    deeplinkMessageId,
    selectedChannelId,
    deeplinkConversation,
    navigate,
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
        void navigate(`/support/${channelFromCallback}`, { replace: true });
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
    { enabled: !!selectedChannelId },
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
    emails: ReadonlyArray<{ id: string; createdAt: number }>;
    emailReads: ReadonlyArray<{ userId: string; lastReadEmailId: string }>;
  };
  const listViewRef = useRef<TicketListViewHandle>(null);
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
      emails?: ReadonlyArray<{ id: string; createdAt: number }>;
      emailReads?: ReadonlyArray<{ userId: string; lastReadEmailId: string }>;
    }): void => {
      setSelectedTickets(prev => {
        const next = new Map(prev);
        if (next.has(row.id)) {
          next.delete(row.id);
        } else {
          next.set(row.id, {
            id: row.id,
            emails: row.emails ?? [],
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

  // Get full selected channel for member count and other stats
  const selectedChannelFull = useVisibleChannel(selectedChannelId ?? '');

  // Filters are now applied server-side via the supportTicketsFilteredV2 query
  const displayedTickets = supportTickets;

  const [localTickets, setLocalTickets] = useState<Ticket[]>([]);

  // Stages fetched dynamically from the board configured in EmailChannelPreference.
  // Empty if no board is configured — dropdown and kanban will show no stages.
  const stageColumns = useMemo(() => stages?.map(toStageColumn) ?? [], [stages]);
  const stageOptions = useMemo(() => getStageOptions(stages), [stages]);

  // Full stage objects (with formId and approvers) used for drag-and-drop and form checks.
  const stagesForDragDrop = useMemo<Stage[]>(() => {
    if (!stages) return [];
    return stages.map(stage => {
      const formId =
        stage.formContextMappings?.find(
          (m: { contextType: string; entityType: string; formId: string }) =>
            m.contextType === 'STAGE' && m.entityType === 'TICKET',
        )?.formId ?? null;
      return {
        id: stage.id,
        name: stage.name,
        color: getStageColor(stage.name.toLowerCase().replace(/\s+/g, '_')),
        ...(stage.sequenceNumber !== undefined ? { sequenceNumber: stage.sequenceNumber } : {}),
        ...(stage.defaultTicketStatusV2 !== undefined
          ? { defaultTicketStatusV2: stage.defaultTicketStatusV2 }
          : {}),
        ...(formId ? { formId } : {}),
        ...(stage.approvers ? { approvers: stage.approvers } : {}),
      } satisfies Stage;
    });
  }, [stages]);

  // Map of stageId -> formId for quick lookup during drag-and-drop.
  const stageFormMap = useMemo(() => {
    const map = new Map<string, string>();
    stagesForDragDrop.forEach(stage => {
      if (stage.formId) {
        map.set(stage.id, stage.formId);
      }
    });
    return map;
  }, [stagesForDragDrop]);

  // Stage form modal state — shown when moving a ticket to a stage that has a form.
  const [stageFormModal, setStageFormModal] = useState<{
    ticket: Ticket;
    targetStage: Stage;
    sourceStageName: string;
    formId: string;
    hasApprovers: boolean;
    existingRequest?: TicketStageRequest | null;
  } | null>(null);

  // Backward movement confirmation dialog state.
  const [showBackwardConfirmDialog, setShowBackwardConfirmDialog] = useState(false);
  const [backwardStageChange, setBackwardStageChange] = useState<{
    stageName: string;
    fromSequenceNumber: number;
    newStatus?: TicketStatusV2;
    ticketId: string;
  } | null>(null);

  useEffect(() => {
    if (displayedTickets) {
      setLocalTickets(displayedTickets as Ticket[]);
    }
  }, [displayedTickets]);

  const handleSelectAll = useCallback((): void => {
    const rows = listViewRef.current?.getLoadedRows() ?? [];
    if (rows.length === 0) return;
    setSelectedTickets(() => {
      const next = new Map<string, SelectedTicket>();
      for (const row of rows) {
        next.set(row.id, {
          id: row.id,
          emails: row.emails ?? [],
          emailReads: row.emailReads ?? [],
        });
      }
      return next;
    });
  }, []);

  const ticketsByStage = useMemo(
    () => groupTicketsByStage(localTickets, stageColumns),
    [localTickets, stageColumns],
  );

  const tagsByTicketId = useMemo(() => createTagsByTicketIdMap([]), []);

  // Handler for when a stage transition requires a form to be filled out.
  const handleStageFormRequired = useCallback(
    async (data: { ticket: Ticket; targetStage: Stage; formId: string; hasApprovers: boolean }) => {
      const sourceStage = stagesForDragDrop.find(s => s.name === data.ticket.stageName);
      const ticketRequests = await zero.run(
        queries.getTicketStageRequests({ ticketId: data.ticket.id }),
        { type: 'complete' },
      );
      const existingRequest = ticketRequests?.find(
        (r: TicketStageRequest) => r.stageId === data.targetStage.id,
      );
      setStageFormModal({
        ...data,
        sourceStageName: sourceStage?.name || data.ticket.stageName || '',
        existingRequest: existingRequest || null,
      });
    },
    [stagesForDragDrop, zero],
  );

  // Handler for backward stage movement — shows a confirmation dialog.
  const handleBackwardStageChange = useCallback(
    (data: {
      ticket: Ticket;
      stageName: string;
      fromSequenceNumber: number;
      newStatus?: TicketStatusV2;
    }) => {
      setBackwardStageChange({
        stageName: data.stageName,
        fromSequenceNumber: data.fromSequenceNumber,
        ...(data.newStatus !== undefined && { newStatus: data.newStatus }),
        ticketId: data.ticket.id,
      });
      setShowBackwardConfirmDialog(true);
    },
    [],
  );

  // Handler for list-view StagePicker — mirrors the form-check logic used by drag-and-drop.
  const handleListViewStageChange = useCallback(
    async (ticketId: string, newStageName: string, currentStageName: string | null | undefined) => {
      const targetStage = stagesForDragDrop.find(s => s.name === newStageName);
      const currentStage = stagesForDragDrop.find(s => s.name === currentStageName);

      if (!targetStage) {
        // Fallback: no stage info, do a direct update
        void zero.mutate(
          mutators.ticket.update({ id: ticketId, stageName: newStageName, updatedAt: Date.now() }),
        );
        return;
      }

      // Check for backward movement
      if (
        currentStage &&
        targetStage.sequenceNumber !== undefined &&
        currentStage.sequenceNumber !== undefined &&
        targetStage.sequenceNumber < currentStage.sequenceNumber
      ) {
        setBackwardStageChange({
          stageName: newStageName,
          fromSequenceNumber: currentStage.sequenceNumber,
          ticketId,
        });
        setShowBackwardConfirmDialog(true);
        return;
      }

      // Check if target stage has a form
      const targetStageFormId = stageFormMap.get(targetStage.id);
      if (targetStageFormId) {
        const hasApprovers = stagesForDragDrop.some(s => s.approvers && s.approvers.length > 0);
        // Fetch the ticket to pass to the form modal
        const ticket = localTickets.find(t => t.id === ticketId);
        if (ticket) {
          await handleStageFormRequired({
            ticket,
            targetStage,
            formId: targetStageFormId,
            hasApprovers,
          });
          return;
        }
      }

      // No form required — direct update
      void zero.mutate(
        mutators.ticket.update({ id: ticketId, stageName: newStageName, updatedAt: Date.now() }),
      );
    },
    [stagesForDragDrop, stageFormMap, zero, localTickets, handleStageFormRequired],
  );

  const { activeTicket, handleDragStart, handleDragEnd } = useDragAndDrop({
    localTickets,
    setLocalTickets,
    zero,
    stages: stagesForDragDrop,
    mode: 'stage',
    canReorder: false,
    onStageFormRequired: handleStageFormRequired,
    onBackwardStageChange: handleBackwardStageChange,
    stageFormMap,
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
    const isElectron = typeof window.electronAPI?.openExternal === 'function';

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
            <div className='h-full flex flex-col'>
              <div className='flex-shrink-0 relative h-14 px-4 border-b border-border flex items-center justify-between'>
                <div
                  className={cn(
                    'flex items-center justify-between w-full gap-2 transition-opacity duration-150',
                    selectedTicketIds.size > 0 && 'opacity-0 pointer-events-none',
                  )}
                >
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
                        <Popover.Root
                          open={priorityFilterOpen}
                          onOpenChange={setPriorityFilterOpen}
                        >
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
                        <Popover.Root
                          open={assigneeFilterOpen}
                          onOpenChange={setAssigneeFilterOpen}
                        >
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
                    {/* Compose new email — visible only on a joined email channel */}
                    {isSelectedChannelJoined && selectedChannelId && (
                      <Tooltip content='Compose new email' side='bottom'>
                        <button
                          onClick={() => openNewCompose(selectedChannelId)}
                          className='inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input shadow-xs text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                          data-track-category='Support'
                          data-track-name='OpenComposeEmail'
                          data-track-metadata={JSON.stringify({ channelId: selectedChannelId })}
                        >
                          <Pencil size={14} />
                          <span>Compose</span>
                        </button>
                      </Tooltip>
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
                      variant='outline'
                      onClick={handleSelectAll}
                      data-track-category='Support'
                      data-track-name='SelectAllTickets'
                      data-track-metadata={JSON.stringify({
                        channelId: refetchChannelId,
                      })}
                    >
                      <SquareCheck size={14} />
                      Select all
                    </Button>
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
                <div className='absolute inset-0 z-10 bg-background flex flex-col overflow-y-auto'>
                  <div className='flex-shrink-0 h-14 px-4 border-b border-border flex items-center justify-between'>
                    <span className='text-sm font-semibold text-foreground'>Inbox Settings</span>
                    <div className='flex items-center gap-2'>
                      {inboxSettingsHasChanges && (
                        <>
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={handleCancelInboxSettings}
                            disabled={isSavingInboxSettings}
                            data-track-category='inbox-settings'
                            data-track-name='cancel-inbox-settings'
                          >
                            Cancel
                          </Button>
                          <Button
                            size='sm'
                            onClick={() => void handleSaveInboxSettings()}
                            disabled={isSavingInboxSettings || !draftInboxOwnerUserId}
                            data-track-category='inbox-settings'
                            data-track-name='save-inbox-settings'
                          >
                            {isSavingInboxSettings ? 'Saving...' : 'Save Changes'}
                          </Button>
                        </>
                      )}
                      <button
                        onClick={() => void navigate(-1)}
                        className='p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors'
                        data-track-category='inbox-settings'
                        data-track-name='close-inbox-settings'
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className='p-4 space-y-6'>
                    {selectedChannelId && (
                      <>
                        <InboxSettings
                          ownerUserId={draftInboxOwnerUserId}
                          onOwnerChange={setDraftInboxOwnerUserId}
                          assigneeUserGroupId={draftInboxAssigneeUserGroupId}
                          onAssigneeChange={setDraftInboxAssigneeUserGroupId}
                          sendAsEmail={draftInboxSendAsEmail}
                          onSendAsEmailChange={setDraftInboxSendAsEmail}
                          canEditSendAsEmail={canEditSendAsEmail}
                          defaultCc={currentInboxDefaultCc}
                          onSaveDefaultCc={value => void handleSaveDefaultCc(value)}
                          isSavingDefaultCc={isSavingDefaultCc}
                          emailMergeMode={draftInboxEmailMergeMode}
                          onEmailMergeModeChange={setDraftInboxEmailMergeMode}
                          disabled={isSavingInboxSettings}
                        />
                        <div className='border-t border-border' />
                        <DeskIntegrationCard
                          channelId={selectedChannelId}
                          canManage={canEditSendAsEmail}
                        />
                        <ClassificationSettings
                          channelId={selectedChannelId}
                          userGroups={allUserGroups.map(g => ({ id: g.id, name: g.name }))}
                          canManage={canEditSendAsEmail}
                        />
                        <div className='border-t border-border' />
                        <PrioritySettings
                          channelId={selectedChannelId}
                          canManage={canEditSendAsEmail}
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
                          slaPolicies={kanbanSlaPolicies}
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
                              slaPolicies={kanbanSlaPolicies}
                            />
                          ) : null}
                        </DragOverlay>
                      </DndContext>
                    ) : (
                      <TicketListView
                        ref={listViewRef}
                        filter={{
                          channelId: selectedChannelId,
                          ...ticketFilter,
                        }}
                        showExtraFields={true}
                        activeTicketId={ticketId}
                        selectedIds={selectedTicketIds}
                        onToggleSelect={toggleTicketSelected}
                        stageOptions={stageOptions}
                        onStageChange={(ticketId, newStageName, currentStageName) =>
                          void handleListViewStageChange(ticketId, newStageName, currentStageName)
                        }
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
                  </>
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

      {/* Stage Form Modal — shown when a ticket is moved to a stage that has a form */}
      {stageFormModal && (
        <StageFormModal
          isOpen={!!stageFormModal}
          onClose={() => setStageFormModal(null)}
          ticket={stageFormModal.ticket}
          targetStage={stageFormModal.targetStage}
          sourceStageName={stageFormModal.sourceStageName}
          existingRequest={stageFormModal.existingRequest ?? null}
          formId={stageFormModal.formId}
          hasApprovers={stageFormModal.hasApprovers ?? false}
          onSuccess={() => setStageFormModal(null)}
        />
      )}

      {/* Backward stage movement confirmation dialog */}
      {backwardStageChange && (
        <Dialog
          open={showBackwardConfirmDialog}
          onOpenChange={setShowBackwardConfirmDialog}
          title='Confirm Stage Change'
        >
          <div className='p-6'>
            <p className='text-sm text-muted-foreground mb-6'>
              Moving to a previous stage will clear all status change requests for status after this
              one. These requests will need to be submitted again. Do you want to continue?
            </p>
            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => setShowBackwardConfirmDialog(false)}
                data-track-category='Support'
                data-track-name='CancelBackwardStageChange'
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (backwardStageChange) {
                    void zero.mutate(
                      mutators.cleanupStageApprovals({
                        ticketId: backwardStageChange.ticketId,
                        fromSequenceNumber: backwardStageChange.fromSequenceNumber,
                      }),
                    );
                    void zero.mutate(
                      mutators.ticket.update({
                        id: backwardStageChange.ticketId,
                        stageName: backwardStageChange.stageName,
                        updatedAt: Date.now(),
                      }),
                    );
                  }
                  setShowBackwardConfirmDialog(false);
                  setBackwardStageChange(null);
                }}
                data-track-category='Support'
                data-track-name='ConfirmBackwardStageChange'
              >
                Continue
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Multi-compose scrollable strip — fixed at the bottom, spans full width.
          Windows are laid out right-to-left (flex-row-reverse) so the newest
          window always sits at the right edge. When there are more windows than
          fit on screen, the strip becomes horizontally scrollable; the user
          scrolls left to reveal older windows. pointer-events-none on the strip
          itself prevents it from blocking clicks on the ticket list beneath. */}
      {isSelectedChannelJoined &&
        !ticketId &&
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
  stageOptions,
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
  stageOptions: ReadonlyArray<string>;
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
        stageOptions={stageOptions}
      />
      <AssigneePicker ticketId={ticket.id} assignedTo={ticket.assignedTo} label={assigneeName} />
    </div>
  );
};

const readReplyDraftRecipients = (
  draftId: string,
): { to: string[]; cc: string[]; bcc: string[] } => {
  try {
    const raw = localStorage.getItem(`xyne:emailDraft:recipients:${draftId}`);
    if (!raw) return { to: [], cc: [], bcc: [] };
    const parsed = JSON.parse(raw) as {
      to?: string[];
      cc?: string[];
      bcc?: string[];
    };
    return {
      to: parsed.to ?? [],
      cc: parsed.cc ?? [],
      bcc: parsed.bcc ?? [],
    };
  } catch {
    return { to: [], cc: [], bcc: [] };
  }
};

const ReplyDraftThreadItem = ({
  draft,
  isActive,
  deskEmail: _deskEmail,
  onEdit,
  onSend,
  onDiscard,
}: {
  draft: EmailDraftRecord;
  isActive: boolean;
  deskEmail?: string | null | undefined;
  onEdit: () => void;
  onSend: () => void;
  onDiscard: () => void;
}): ReactElement => {
  const recipients = useMemo(() => readReplyDraftRecipients(draft.id), [draft.id]);
  const createdAt = formatEmailHeaderDate(draft.updatedAt);

  return (
    <div className={cn('w-full scroll-mt-20 transition-colors py-6', isActive && 'bg-muted/30')}>
      <div className='px-6'>
        <div className='w-full flex items-start gap-3'>
          <div className='size-8 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center'>
            <Pencil size={14} />
          </div>
          <div className='flex-1 min-w-0'>
            <div className='flex items-start justify-between gap-3'>
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2 flex-wrap'>
                  <span className='inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700'>
                    Draft
                  </span>
                  {isActive && (
                    <span className='inline-flex rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-background'>
                      Editing
                    </span>
                  )}
                </div>
                <div className='mt-1 space-y-1 text-sm'>
                  <div className='flex gap-3 items-start'>
                    <span className='text-muted-foreground w-14 shrink-0'>to:</span>
                    <span className='text-foreground break-words flex-1 min-w-0'>
                      {recipients.to.length > 0 ? recipients.to.join(', ') : 'No recipients'}
                    </span>
                  </div>
                  {recipients.cc.length > 0 && (
                    <div className='flex gap-3 items-start'>
                      <span className='text-muted-foreground w-14 shrink-0'>cc:</span>
                      <span className='text-foreground break-words flex-1 min-w-0'>
                        {recipients.cc.join(', ')}
                      </span>
                    </div>
                  )}
                  {recipients.bcc.length > 0 && (
                    <div className='flex gap-3 items-start'>
                      <span className='text-muted-foreground w-14 shrink-0'>bcc:</span>
                      <span className='text-foreground break-words flex-1 min-w-0'>
                        {recipients.bcc.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div
                className='text-xs text-muted-foreground shrink-0 whitespace-nowrap'
                title={createdAt.full}
              >
                {createdAt.short}
              </div>
            </div>
          </div>
        </div>
        <div className='flex items-start gap-3 mt-4'>
          <div className='size-8 shrink-0' aria-hidden='true' />
          <div className='flex-1 min-w-0'>
            <div className='text-sm text-foreground leading-relaxed'>
              {draft.draftContent ? (
                <EmailBodyRenderer body={draft.draftContent} emailId={`draft-${draft.id}`} />
              ) : (
                <span className='text-muted-foreground italic'>No content</span>
              )}
            </div>
            <div className='mt-3 flex items-center justify-between gap-3'>
              <div className='text-xs text-muted-foreground' title={createdAt.full}>
                Last edited {createdAt.short}
              </div>
              <div className='flex items-center gap-1.5'>
                <button
                  type='button'
                  onClick={onEdit}
                  className='inline-flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                  title='Edit draft'
                  aria-label='Edit draft'
                  data-track-category='Support'
                  data-track-name='OpenReplyDraft'
                >
                  <Pencil size={12} />
                </button>
                <button
                  type='button'
                  onClick={onDiscard}
                  className='inline-flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                  title='Discard draft'
                  aria-label='Discard draft'
                  data-track-category='Support'
                  data-track-name='DiscardDraft'
                >
                  <Trash2 size={12} />
                </button>
                <button
                  type='button'
                  onClick={onSend}
                  className='inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors cursor-pointer select-none'
                  title='Send draft'
                  aria-label='Send draft'
                  data-track-category='Support'
                  data-track-name='SendReplyDraft'
                >
                  <ArrowUp size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SupportTicketDetail = (): ReactElement => {
  const { channelId: channelIdParam, ticketId: ticketIdParam } = useParams<{
    channelId?: string;
    ticketId?: string;
  }>();
  const { workspaceId } = useAuthContextValues();
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const isAIPanelOpen = useSelector(
    xyneAIActor,
    snapshot => snapshot.context.xyneAIState === 'open',
  );
  const [composerOpen, setComposerOpenState] = useState<boolean>(false);
  const [activeReplyDraftId, setActiveReplyDraftId] = useState<string | null>(null);
  const [sendDraftRequest, setSendDraftRequest] = useState<{
    draftId: string;
    requestedAt: number;
  } | null>(null);
  const [replyToEmailId, setReplyToEmailId] = useState<string | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll'>('reply');
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
  const channelUserStatus = useGetChannelUserStatus(routeChannelId);
  const isMember = !!channelUserStatus;
  // `mail` is set by navigateToMail (mail search-result click) and carries
  // either Postgres email.id or Gmail externalMessageId. We scroll to the
  // matching EmailThreadItem after emails load.
  const targetMailId = searchParams.get('mail');

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
    queries.supportTicketByXyneIdV3({
      xyneId: ticketIdParam || '',
      workspaceId: workspaceId,
      channelId: routeChannelId,
      isMember,
    }),
    { enabled: !ticketId && !!ticketIdParam && !!routeChannelId },
  );
  const ticket = ticketById ?? ticketByXyneId;
  const emails = useMemo(() => (ticket?.emails as Email[] | undefined) ?? [], [ticket?.emails]);
  const emailCollapseState = useEmailCollapseState(emails);

  // When arriving via a mail deep-link (`?mail=<id>`), un-collapse the target
  // email so it's visible, then scroll to it with a brief yellow flash.
  useEffect(() => {
    if (!targetMailId || emails.length === 0) return;
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
  const emailChannelPreference = useEmailChannelPreference(channelId || null);
  const boardId = emailChannelPreference?.boardId ?? null;
  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: boardId || '' }), {
    enabled: !!boardId,
  });
  const stageOptions = useMemo(() => getStageOptions(stages), [stages]);

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
  const replyDrafts = useEmailDrafts(conversationId ?? null);
  const draftAutoOpenedConversationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    if (draftAutoOpenedConversationRef.current === conversationId) return;
    const latestDraft = replyDrafts[0];
    if (latestDraft?.draftContent?.trim()) {
      setActiveReplyDraftId(latestDraft.id);
      setComposerOpen(true);
      draftAutoOpenedConversationRef.current = conversationId;
    }
  }, [conversationId, replyDrafts, setComposerOpen]);

  useEffect(() => {
    if (!conversationId) {
      setActiveReplyDraftId(null);
      return;
    }
    if (!activeReplyDraftId) {
      return;
    }
    if (replyDrafts.some(draft => draft.id === activeReplyDraftId)) {
      return;
    }
    setActiveReplyDraftId(null);
  }, [activeReplyDraftId, conversationId, replyDrafts]);

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
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const scrollThreadToTop = (): void => {
    requestAnimationFrame(() => {
      threadScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

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

  const activeTab: TabType = searchParams.get('selectedTab') === 'details' ? 'details' : 'messages';
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
                  <TicketMetaRow ticket={ticket} stageOptions={stageOptions} />
                </div>
              </div>
            </div>
            <div ref={threadScrollRef} className='flex-1 overflow-y-auto no-scrollbar px-6 py-4'>
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
                  <EmailThread
                    collapseState={emailCollapseState}
                    ticketId={ticket?.id}
                    emailReads={
                      ticket?.emailReads as
                        | Array<{ userId: string; lastReadEmailId: string }>
                        | undefined
                    }
                    onReplyToEmail={(emailId, mode) => {
                      clearStoredRecipients(conversationId);
                      setActiveReplyDraftId(null);
                      setReplyToEmailId(emailId);
                      setReplyMode(mode);
                      setComposerOpen(true);
                    }}
                    deskEmail={deskEmail}
                  />
                </div>
              )}
              {replyDrafts.length > 0 && (
                <div className='px-6 pb-3 space-y-2'>
                  <div className='flex items-center justify-between gap-3'>
                    <div className='flex items-center gap-2'>
                      <span className='inline-flex h-6 items-center rounded-full border border-border/70 bg-muted/40 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'>
                        Drafts
                      </span>
                      <span className='text-xs text-muted-foreground'>
                        {replyDrafts.length} saved
                      </span>
                    </div>
                    <button
                      type='button'
                      onClick={() => {
                        setReplyToEmailId(null);
                        setReplyMode('reply');
                        setActiveReplyDraftId(null);
                        setComposerOpen(true);
                      }}
                      className='inline-flex items-center rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors'
                      data-track-category='Support'
                      data-track-name='NewDraftClick'
                    >
                      New draft
                    </button>
                  </div>
                  <div className='overflow-hidden rounded-2xl border border-border/80 bg-background'>
                    {replyDrafts.map(draft => (
                      <ReplyDraftThreadItem
                        key={draft.id}
                        draft={draft}
                        isActive={draft.id === activeReplyDraftId}
                        deskEmail={deskEmail}
                        onEdit={() => {
                          setReplyToEmailId(null);
                          setReplyMode('reply');
                          setActiveReplyDraftId(draft.id);
                          setComposerOpen(true);
                        }}
                        onSend={() => {
                          setReplyToEmailId(null);
                          setReplyMode('reply');
                          setActiveReplyDraftId(draft.id);
                          setComposerOpen(true);
                          setSendDraftRequest({ draftId: draft.id, requestedAt: Date.now() });
                        }}
                        onDiscard={() => {
                          if (draft.id === activeReplyDraftId) {
                            setComposerOpen(false);
                            setReplyToEmailId(null);
                            setActiveReplyDraftId(null);
                          }
                          void zero.mutate(mutators.emailDraft.delete({ id: draft.id }));
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className='sticky bottom-0 w-full flex-shrink-0 bg-background'>
              {composerOpen ? (
                <EmailComposer
                  conversationId={conversationId}
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
                  channelId={channelId}
                  ticketId={ticketId}
                  replyDraftId={activeReplyDraftId}
                  onReplyDraftCreated={setActiveReplyDraftId}
                  sendRequest={sendDraftRequest}
                  replyToEmailId={replyToEmailId}
                  replyMode={replyMode}
                  ticketSubject={title}
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
                      onClick={() => {
                        setActiveReplyDraftId(null);
                        setReplyToEmailId(null);
                        setReplyMode('reply');
                        setComposerOpen(true);
                      }}
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
                      onClick={() => {
                        setActiveReplyDraftId(null);
                        setReplyToEmailId(null);
                        setReplyMode('replyAll');
                        setComposerOpen(true);
                      }}
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
            <Panel defaultSize={35} minSize={30} maxSize={70}>
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
                                  xyneAIActor.send({ type: 'OPEN' });
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
  emailReads,
  onReplyToEmail,
  deskEmail,
}: {
  collapseState: EmailCollapseState;
  ticketId?: string | null | undefined;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailId: string }> | undefined;
  onReplyToEmail?: (emailId: string, mode: 'reply' | 'replyAll') => void;
  deskEmail?: string | null | undefined;
}): ReactElement => {
  const { sortedEmails, collapsedIds, toggleOne, lastEmailId } = collapseState;
  const rootEmail = sortedEmails[0];
  // Thread-level: upsert the current user's email_reads row with the id of
  // the newest email in this thread. `isRead` is derived by comparing that
  // stored id to the current latest email, so every email header in the
  // thread flips read/unread together.
  const { isRead } = useMarkEmailRead(ticketId, lastEmailId ?? null, emailReads, true);
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
}): ReactElement => {
  const { channelId: channelIdParam } = useParams<{ channelId?: string }>();
  const navigate = useNavigate();
  const { name: fromName, email: fromEmail } = parseFromField(email.from || '');
  const toList = email.to || [];
  const ccList = email.cc || [];
  const bccList = email.bcc || [];

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
