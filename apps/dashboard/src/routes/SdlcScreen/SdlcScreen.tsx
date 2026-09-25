import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { globalClickTracker } from '../../services/Analytics/globalClickTracker';
import {
  ChannelRole,
  SDLC_ENTITY_TYPES,
  SDLC_RELATION_TYPES,
  SDLC_HUB_KNOWLEDGE_FOLDER,
  SDLC_WIKI_FOLDER,
  type SdlcEntityType,
  type SdlcRelationType,
  type SdlcCallLink,
  SDLC_CONTAINMENT_RELATION,
  SDLC_TRACK_FLAT_RELATION,
  SDLC_UPLOAD_ACCEPT,
  isAllowedSdlcUpload,
  TicketStatusV2,
  TicketPriority,
} from '@xyne/shared';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Layers,
  Link2,
  Loader2,
  Maximize2,
  MessageCircle,
  PanelLeft,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  Upload,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import { Tabs } from '../../components/ui/Tabs';
import NotFoundScreen from '../NotFoundScreen/NotFoundScreen';
import { SdlcArchiveMenu } from './SdlcArchiveMenu';
import { SdlcHubDialog } from './SdlcHubDialog';
import { SdlcHubRepositoriesDialog } from './SdlcHubRepositoriesDialog';
import {
  SdlcHubPicker,
  persistSdlcSectionHeights,
  sdlcFoldedGroupHeight,
  SdlcSidebarFitSection,
  SdlcSidebarSection,
  SdlcSidebarSectionSeparator,
} from './SdlcHubSidebar';
import { setUserPreference, useUserPreference } from '../../machines/userPreferencesMachine';
import {
  isFramedSdlcSurface,
  isSdlcDocumentWindow,
  requestSdlcFrameReset,
} from './useSdlcFrameBridge';
import { toast } from 'sonner';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { TicketToken } from '@xyne/icons';
import { CreateTicketModal } from '../../components/Tickets/CreateTicketModal/CreateTicketModal';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import { Panel, ResizableGroup, Separator } from '../../components/ui/Resizable/Resizable';
import { v4 as uuidv4 } from 'uuid';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { SdlcChatPanel } from './SdlcChatPanel';
import { CallTriggerModal } from '../../components/Call/CallTriggerModal/CallTriggerModal';
import { useAuthContextValues } from '../../hooks/useAuth';
import { xyneAIActor, type ThreadInfo } from '../../machines/xyneAIMachine';
import { apiInstance, getAttachmentStreamUrl } from '../../services/clients/apiClient';
import { searchService } from '../../services/searchService';
import { cn } from '../../utils/classNames';
import { queries } from '../../zero/queries';
import Info from '../../components/Chat/Info/Info';
import type { VisibleChannel } from '../../machines/stateMachine';
import {
  ContextPickerPanel,
  type ContextSelections,
} from '../../components/Chat/XyneAISidebar/components/ContextPickerPanel';
import CanvasScreen from '../../components/Canvas/CanvasScreen';
import {
  isElectronApp,
  openStandaloneWindow,
  shouldOpenInNewWindow,
} from '../../utils/electronApp';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import KanbanBoardScreen from '../KanbanBoardScreen/KanbanBoardScreen';
import {
  buildSdlcArtifactCreationPrompt,
  buildSdlcWikiPageCreationPrompt,
} from './artifactCreationPrompt';
import { SdlcWikiSection } from './SdlcWikiSection';
import { type WikiCanvas, wikiScopePages, wikiScopes } from './sdlcWikiTree';
import SdlcWorkflowsSection from './SdlcWorkflowsSection';
import { SdlcActivityPreview } from './SdlcActivityPreview';
import { EntityLinkContext, type EntityLinkScope } from '../../contexts/EntityLinkContext';
import { useScope, useShortcutById } from '../../shortcuts';
import {
  discussionConversationIds as discussionIdsForOwner,
  resolveSdlcDiscussionContext,
} from './sdlcDiscussionModel';
import {
  SDLC_CHAT_PANEL_ID,
  SDLC_MAIN_PANEL_ID,
  sdlcChatLayout,
  sdlcChatNavigationSearch,
  sdlcRightPanelIds,
  shouldCloseInvalidSdlcConversationDeepLink,
  shouldStartFreshSdlcAssistant,
} from './sdlcChatPolicy';
import { formatRelativeTime } from '../../utils/dateUtils';
import Avatar from '../../components/ui/Avatar/Avatar';
import { UserHoverWrapper } from '../../components/ui/UserMentionPopover/UserMentionPopover';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { Popover } from '../../components/ui/Popover';
import { Tooltip } from '../../components/ui/Tooltip';
import { fileKind } from './fileKind';
import { getLastSdlcLocation, sdlcHubIdOf } from './lastSdlcLocation';
import { SdlcFolderPage, SCRATCH_TAB_ID, type FolderTab } from './SdlcFolderPage';
import { setSdlcCommentContext } from './sdlcCommentStore';
import { publishPendingPassage, registerSelectionSink } from '../../components/workspaceItems';

/** What a conversation in a track can be filed against, beside an artifact. */
interface SdlcItemDiscussion {
  type: 'FOLDER' | 'LINK' | 'ATTACHMENT';
  id: string;
  name: string;
}
import {
  SdlcFinderColumn,
  SdlcFinderItemPreview,
  SdlcFinderPreview,
  type SdlcFinderCanvas,
  type SdlcFinderFile,
  type SdlcFinderLink,
  type SdlcFinderNodeType,
  type SdlcFinderStep,
} from './SdlcFinder';
import { type SdlcTicket } from './ticketPolicy';
import { linkedTicketIds } from './artifactTicketPolicy';
import { type HubWorkflow, type HubWorkflowPhase, useHubWorkflow } from './hubWorkflowRunPolicy';

type Section = 'overview' | 'wiki' | 'knowledge' | 'tracks' | 'tickets' | 'artifacts' | 'workflows';

const StableCanvasScreen = memo(CanvasScreen);

const SDLC_ENTITY_TYPE_SET: ReadonlySet<string> = new Set(SDLC_ENTITY_TYPES);
const SDLC_RELATION_TYPE_SET: ReadonlySet<string> = new Set(SDLC_RELATION_TYPES);
const isSdlcEntityType = (value: string): value is SdlcEntityType =>
  SDLC_ENTITY_TYPE_SET.has(value);
const isSdlcRelationType = (value: string): value is SdlcRelationType =>
  SDLC_RELATION_TYPE_SET.has(value);

const SECTIONS: Array<{ id: Exclude<Section, 'artifacts'>; label: string; icon: typeof Boxes }> = [
  { id: 'overview', label: 'Overview', icon: Boxes },
  { id: 'wiki', label: 'Wiki', icon: BookOpen },
  { id: 'knowledge', label: 'Hub Knowledge', icon: ShieldCheck },
  { id: 'tickets', label: 'Issues', icon: CircleDot },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
];

function sizeNameFieldToText(input: HTMLInputElement): void {
  const mirror = input.parentElement?.querySelector('[data-name-mirror]');
  if (!(mirror instanceof HTMLElement)) return;
  mirror.textContent = input.value || ' ';
  input.style.width = `${Math.ceil(mirror.getBoundingClientRect().width) + 2}px`;
}

const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'Low',
  [TicketPriority.MEDIUM]: 'Medium',
  [TicketPriority.HIGH]: 'High',
  [TicketPriority.CRITICAL]: 'Critical',
};

const READER_EXIT_MS = 200;

const TRACK_NAME_LIMIT = 120;
const TRACK_DESCRIPTION_LIMIT = 2000;

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COLLAPSE_AT = 150;
const SIDEBAR_RAIL_WIDTH = 52;
const SIDEBAR_HOVER_WIDTH = 260;

const TRACK_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ARCHIVED', label: 'Archived' },
] as const;

const TRACK_STATUS_DOT: Record<string, string> = {
  ACTIVE: 'bg-status-success',
  COMPLETED: 'bg-status-scheduled',
  ARCHIVED: 'bg-status-new',
};

const SECTION_IDS: ReadonlySet<string> = new Set<string>([
  ...SECTIONS.map(s => s.id),
  'artifacts',
  'tracks',
]);

const EMPTY_CONTEXT_SELECTIONS: ContextSelections = {
  channels: [],
  tickets: [],
  canvases: [],
  transcripts: [],
  recordings: [],
  localFolders: [],
};

/** Which document the shared create form is filling in. */
type SdlcDocumentKind = 'artifact' | 'knowledge' | 'wiki';

const HUB_DOCUMENT_HINT: Record<SdlcDocumentKind, string> = {
  artifact: 'Adding to this hub',
  knowledge: 'Read by SDLC Assistant in every chat in this hub',
  wiki: 'Adding to the Wiki you are viewing',
};

function AddItemHeaderIcon({ kind }: { kind: SdlcDocumentKind }): ReactElement {
  const Icon = kind === 'knowledge' ? ShieldCheck : kind === 'wiki' ? BookOpen : FileText;
  return <Icon className='size-5 shrink-0 text-primary/70' />;
}

function updatedAtLabel(value?: number): string {
  if (typeof value !== 'number') return 'Not updated yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Update time unavailable' : date.toLocaleString();
}

function actionErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: unknown } } }).response;
    if (typeof response?.data?.error === 'string') return response.data.error;
  }
  return error instanceof Error ? error.message : 'Action failed';
}

export default function SdlcScreen(): ReactElement {
  const {
    workspaceId,
    channelId,
    section: routeSection,
    '*': workflowsSplat,
  } = useParams<{
    workspaceId?: string;
    channelId?: string;
    section?: string;
    '*'?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthContextValues();
  // The workflows route is a splat, which outranks `:section` and names its param
  // `*`, so on /sdlc/:channelId/workflows there is no `section` param to read.
  const section: Section = (
    routeSection && SECTION_IDS.has(routeSection)
      ? routeSection
      : workflowsSplat !== undefined
        ? 'workflows'
        : 'overview'
  ) as Section;
  const routeSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [channels] = useCachedQuery(queries.getSdlcChannels());
  const [channelRow, repoQueryDetails] = useCachedQuery(
    queries.getSdlcChannelById({ channelId: channelId || '' }),
    {
      enabled: Boolean(channelId),
    },
  );
  const channel = channelRow instanceof Error ? undefined : channelRow;

  const channelRepos = useMemo(
    () =>
      (channel?.sdlcEntityLinks ?? [])
        .map(link => link.repo)
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)),
    [channel],
  );
  // Repositories come along so the switcher can search on their names.
  const hubOptions = useMemo(
    () =>
      (Array.isArray(channels) ? channels : []).map(item => ({
        id: item.id,
        name: item.name,
        visibility: item.visibility,
        repositories: (item.sdlcEntityLinks ?? []).flatMap(link => (link.repo ? [link.repo] : [])),
      })),
    [channels],
  );
  // Repositories in a hub coexist; there is no selection.
  const selectedRepo = channelRepos[0];
  const repo = useMemo(
    () =>
      selectedRepo && channel ? { ...selectedRepo, channel, channelId: channel.id } : undefined,
    [selectedRepo, channel],
  );
  const zero = useZero();
  useEffect(() => {
    setSdlcCommentContext({ zero: zero as never });
  }, [zero]);
  const [busy, setBusy] = useState<string | null>(null);
  const [artifactDialog, setArtifactDialog] = useState<{
    id: string;
    name: string;
    kind: SdlcDocumentKind;
  } | null>(null);
  const [artifactFolderPath, setArtifactFolderPath] = useState('');
  const [relatedCanvasIds, setRelatedCanvasIds] = useState<string[]>([]);
  const [relatedSearchQuery, setRelatedSearchQuery] = useState('');
  const [relatedSearchResults, setRelatedSearchResults] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [relatedSearching, setRelatedSearching] = useState(false);
  const [relatedListOpen, setRelatedListOpen] = useState(false);
  const [relatedChipsExpanded, setRelatedChipsExpanded] = useState(false);
  const [deriveSource, setDeriveSource] = useState<{ canvasId: string; title: string } | null>(
    null,
  );
  const [deriveTypeId, setDeriveTypeId] = useState<string | null>(null);
  const [hubDialog, setHubDialog] = useState<'create' | 'manage' | null>(null);
  const [showArchivedKnowledge, setShowArchivedKnowledge] = useState(false);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeName, setTypeName] = useState('');
  const [renameTypeId, setRenameTypeId] = useState<string | null>(null);
  const [renameTypeName, setRenameTypeName] = useState('');
  const [hoveredTypeId, setHoveredTypeId] = useState<string | null>(null);
  const [trackDialog, setTrackDialog] = useState(false);
  const showClosedTracks = useUserPreference('sdlcShowClosedTracks');
  const foldedSidebarHeight = sdlcFoldedGroupHeight(
    useUserPreference('sdlcSidebarSectionsCollapsed'),
  );
  const setShowClosedTracks = (next: boolean): void =>
    setUserPreference('sdlcShowClosedTracks', next);
  const finderGroupBy = useUserPreference('sdlcFinderGroupBy');
  const railCollapsed = useUserPreference('sdlcSidebarCollapsed');
  const storedRailWidth = useUserPreference('sdlcSidebarWidth');
  const [railHovered, setRailHovered] = useState(false);
  const finderRef = useRef<HTMLDivElement | null>(null);
  const ticketsRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [sidebarFocused, setSidebarFocused] = useState(false);
  const [ticketsFocused, setTicketsFocused] = useState(false);
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const finderFocusReturn = useRef<string | null>(null);
  const rememberFinderFocus = (): void => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !finderRef.current?.contains(active)) return;
    const columns = finderRef.current.querySelectorAll<HTMLElement>('[data-finder-column]');
    finderFocusReturn.current =
      active.closest<HTMLElement>('[data-finder-column]')?.dataset['finderColumn'] ??
      columns[columns.length - 1]?.dataset['finderColumn'] ??
      null;
  };
  const returnFocusToFinder = (): void => {
    const columnId = finderFocusReturn.current;
    finderFocusReturn.current = null;
    if (!columnId) return;
    requestAnimationFrame(() => {
      finderRef.current?.querySelector<HTMLElement>(`[data-finder-column="${columnId}"]`)?.focus();
    });
  };
  const [draggingWidth, setDraggingWidth] = useState<number | null>(null);
  const railWidth =
    draggingWidth ?? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, storedRailWidth));

  const startRailResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = railWidth;
    let latest = startWidth;
    let folded = false;

    const onMove = (moveEvent: globalThis.PointerEvent): void => {
      const raw = startWidth + (moveEvent.clientX - startX);
      if (raw < SIDEBAR_COLLAPSE_AT) {
        folded = true;
        finish();
        return;
      }
      latest = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, raw));
      setDraggingWidth(latest);
    };

    function finish(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      setDraggingWidth(null);
      if (folded) {
        setUserPreference('sdlcSidebarCollapsed', true);
        setRailHovered(false);
      } else if (latest !== startWidth) {
        setUserPreference('sdlcSidebarWidth', latest);
      }
    }

    document.body.style.setProperty('cursor', 'col-resize');
    document.body.style.setProperty('user-select', 'none');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };
  const railOpen = !railCollapsed || railHovered;
  const toggleRail = (): void => {
    const next = !railCollapsed;
    setUserPreference('sdlcSidebarCollapsed', next);
    if (next) setRailHovered(false);
  };
  useShortcutById('sdlc.toggleSidebarDock', toggleRail);
  const sidebarItems = (): HTMLElement[] =>
    [...(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])].filter(
      item => item.offsetParent !== null,
    );
  const moveSidebarFocus = (delta: number): void => {
    const items = sidebarItems();
    if (items.length === 0) return;
    const active = document.activeElement;
    const from = items.findIndex(item => item === active);
    const next = items[Math.min(items.length - 1, Math.max(0, (from === -1 ? -1 : from) + delta))];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  };
  useShortcutById('sdlc.focusSidebar', () => {
    if (railCollapsed) setRailHovered(true);
    requestAnimationFrame(() => {
      const current = sidebarRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      const target = current ?? sidebarItems()[0];
      target?.focus();
      target?.scrollIntoView({ block: 'nearest' });
    });
  });
  useScope('sdlc-sidebar', sidebarFocused);
  useShortcutById('sdlc.sidebarDown', () => moveSidebarFocus(1), { enabled: sidebarFocused });
  useShortcutById('sdlc.sidebarUp', () => moveSidebarFocus(-1), { enabled: sidebarFocused });
  useShortcutById('sdlc.focusTickets', () => {
    // The list, not a row: the cursor is state, so focusing a row would leave the
    // two out of step and let Enter both fire the binding and click the button.
    ticketsRef.current?.focus();
    ticketsRef.current?.scrollIntoView({ block: 'nearest' });
  });
  useShortcutById('sdlc.focusFinder', () => {
    const columns = [
      ...(finderRef.current?.querySelectorAll<HTMLElement>('[data-finder-column]') ?? []),
    ];
    // An empty level has nothing to put a cursor on, so land on the deepest one
    // that holds something — which puts the cursor on the folder itself.
    const target =
      [...columns].reverse().find(column => column.querySelector('[data-finder-row]')) ??
      columns[columns.length - 1];
    target?.focus();
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  });
  const [trackName, setTrackName] = useState('');
  const [trackDescription, setTrackDescription] = useState('');
  const [artifactTrack, setArtifactTrack] = useState<{ id: string; name: string } | null>(null);
  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactAiPrompt, setArtifactAiPrompt] = useState('');
  // Tech Doc dialog opened from a PRD card: track + parent PRD are fixed by that
  // context, so both fields are pre-filled and locked.
  const [artifactContextLocked, setArtifactContextLocked] = useState(false);
  const [linkDialog, setLinkDialog] = useState(false);
  const [membersDialog, setMembersDialog] = useState(false);
  const [trackStatusOpen, setTrackStatusOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const descriptionAbandoned = useRef(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameAbandoned = useRef(false);
  const [previewCanvasId, setPreviewCanvasId] = useState<string | null>(null);
  const [readerCanvasId, setReaderCanvasId] = useState<string | null>(null);
  const [readerClosing, setReaderClosing] = useState(false);

  const closeReader = (): void => {
    setReaderClosing(true);
    window.setTimeout(() => {
      setReaderCanvasId(null);
      setReaderClosing(false);
      returnFocusToFinder();
    }, READER_EXIT_MS);
  };
  useShortcutById('finder.closePreview', () => closeReader(), {
    enabled: readerCanvasId !== null && !readerClosing,
  });
  const [folderDiscussion, setFolderDiscussion] = useState<SdlcItemDiscussion | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<SdlcFinderStep | null>(null);
  const [addItemParent, setAddItemParent] = useState<SdlcFinderStep | null>(null);
  const [addItemTab, setAddItemTab] = useState<'artifact' | 'upload' | 'link'>('artifact');
  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  /** Named so the reader knows which file was dropped and why nothing happened. */
  const [refusedUploads, setRefusedUploads] = useState<string[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkPreview, setLinkPreview] = useState<{
    description?: string;
    favicon?: string;
  } | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [pendingArtifactFolder, setPendingArtifactFolder] = useState<string | null>(null);
  const [draggingItem, setDraggingItem] = useState<{
    type: SdlcFinderNodeType;
    id: string;
  } | null>(null);
  // A link or a file being previewed. Kept apart from previewCanvasId because an
  // artifact preview reads the canvas tables and these read their own.
  const [previewItem, setPreviewItem] = useState<{
    kind: 'LINK' | 'ATTACHMENT';
    id: string;
  } | null>(null);
  // State, not a ref: the folder page only portals its tabs once the node exists.
  const [folderTabsSlot, setFolderTabsSlot] = useState<HTMLElement | null>(null);
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  // Which surface opened the create form; rides on CREATE_TICKET_SUCCEEDED.
  const [createTicketSource, setCreateTicketSource] = useState('sdlc_header');
  const [relatedSourceId, setRelatedSourceId] = useState<string | null>(null);
  const [linkTargetType, setLinkTargetType] = useState('MESSAGE');
  const [linkTargetId, setLinkTargetId] = useState('');
  const automaticAccessChecksRef = useRef(new Set<string>());
  const { selectedAgentSlug, setSelectedAgentSlug } = useSelectedAgent();

  useEffect(() => {
    if (channelId || !Array.isArray(channels) || !workspaceId) return;
    const fallbackId = channels[0]?.id;
    if (!fallbackId) return;
    const storedPath = getLastSdlcLocation(workspaceId);
    const stored = channels.find(item => item.id === (storedPath ? sdlcHubIdOf(storedPath) : null));
    void navigate(`/sdlc/${stored?.id ?? fallbackId}/overview`, { replace: true });
  }, [navigate, channelId, channels, workspaceId]);

  const canvases = useMemo(() => {
    if (!channel) return [];
    return (channel.canvasFolders ?? []).flatMap(folder => folder.canvases ?? []);
  }, [channel]);
  const knowledgeFolderId = useMemo(
    () =>
      (channel?.canvasFolders ?? []).find(folder => folder.name === SDLC_HUB_KNOWLEDGE_FOLDER)
        ?.id ?? null,
    [channel],
  );
  // Adding and archiving hub documents is admin-only; the server enforces it too.
  const isHubAdmin = useMemo(
    () =>
      (channel?.participants ?? []).some(
        participant => participant.userId === auth.userID && participant.role === ChannelRole.ADMIN,
      ),
    [channel, auth.userID],
  );
  const archiveArtifact = (canvasId: string, archived: boolean): void => {
    void call(
      `archive-${canvasId}`,
      () =>
        apiInstance.post(`/sdlc/channels/${channelId}/artifacts/${canvasId}/archive`, { archived }),
      archived ? 'Archived' : 'Restored',
    );
  };
  const selectedCanvasId = routeSearchParams.get('canvas');
  const selectedCanvas = canvases.find(canvas => canvas.id === selectedCanvasId);
  const [trackRows] = useCachedQuery(queries.getSdlcTracks({ channelId: channelId || '' }), {
    enabled: Boolean(channelId),
  });
  // Membership edges share this table and are excluded by the query.
  const [linkRows] = useCachedQuery(queries.getSdlcLinks({ channelId: channelId || '' }), {
    enabled: Boolean(channelId),
  });
  const tracks = useMemo(
    () =>
      Array.isArray(trackRows)
        ? (trackRows as Array<{
            id: string;
            name: string;
            description: string | null;
            status: string;
            createdBy: string;
            createdAt: number;
            updatedAt: number;
          }>)
        : [],
    [trackRows],
  );
  const selectedTrackId = routeSearchParams.get('track');
  const openFolderId = routeSearchParams.get('folder');
  const browsingScratchTab = routeSearchParams.get('browse') === '1';
  const openFileId = routeSearchParams.get('file');
  const openLinkId = routeSearchParams.get('link');
  const selectedTrack = tracks.find(track => track.id === selectedTrackId);
  const trackOwner = useUser(selectedTrack?.createdBy ?? '');

  const finderPathByTrack = useUserPreference('sdlcFinderPathByTrack');
  const finderPath: SdlcFinderStep[] = selectedTrackId
    ? (finderPathByTrack[selectedTrackId] ?? [])
    : [];
  const setFinderPath = (next: SdlcFinderStep[]): void => {
    // Keyed by a track we know, never by the ?track= value directly: the param is
    // reader-supplied, and it would otherwise name any property it liked.
    const track = tracks.find(item => item.id === selectedTrackId);
    if (!track) return;
    setUserPreference('sdlcFinderPathByTrack', { ...finderPathByTrack, [track.id]: next });
  };
  useEffect(() => {
    setPreviewCanvasId(null);
    // Links and files are hub-scoped, so one from the previous track would still
    // resolve here and go on showing its preview column.
    setPreviewItem(null);
  }, [selectedTrackId]);
  const openTracks = useMemo(
    () => tracks.filter(track => track.status !== 'COMPLETED' && track.status !== 'ARCHIVED'),
    [tracks],
  );
  const closedTracks = useMemo(
    () => tracks.filter(track => track.status === 'COMPLETED' || track.status === 'ARCHIVED'),
    [tracks],
  );
  const [hubItemRows] = useCachedQuery(queries.getSdlcHubItems({ channelId: channelId || '' }), {
    enabled: Boolean(channelId),
  });
  const [wikiFolderRows] = useCachedQuery(
    queries.getSdlcHubFolders({ channelId: channelId || '' }),
    { enabled: Boolean(channelId) },
  );
  const hubItems = useMemo(() => (Array.isArray(hubItemRows) ? hubItemRows : []), [hubItemRows]);
  const hubFolderNames = useMemo(
    () =>
      new Map(
        (Array.isArray(wikiFolderRows) ? wikiFolderRows : []).map(folder => [
          folder.id,
          folder.name,
        ]),
      ),
    [wikiFolderRows],
  );
  const wikiScopeList = useMemo(
    () =>
      channelId
        ? wikiScopes({
            channelId,
            edges: hubItems,
            folderNames: hubFolderNames,
            memberRepoIds: new Set(channelRepos.map(item => item.id)),
          })
        : [],
    [channelId, hubItems, hubFolderNames, channelRepos],
  );
  const wikiPagesByScope = useMemo(() => {
    const wikiCanvases = new Map<string, WikiCanvas>(
      canvases.map(canvas => [
        canvas.id,
        {
          id: canvas.id,
          title: canvas.title,
          updatedAt: canvas.lastEditedAt ?? canvas.updatedAt,
          archived: canvas.sdlcArtifact?.artifactStatus === 'ARCHIVED',
        },
      ]),
    );
    return new Map(
      wikiScopeList.map(scope => [
        scope.folderId,
        wikiScopePages({
          scopeFolderId: scope.folderId,
          edges: hubItems,
          folderNames: hubFolderNames,
          canvases: wikiCanvases,
        }),
      ]),
    );
  }, [wikiScopeList, hubItems, hubFolderNames, canvases]);
  const wikiPageCounts = useMemo(
    () =>
      new Map(
        [...wikiPagesByScope].map(
          ([folderId, pages]) => [folderId, pages.filter(page => !page.archived).length] as const,
        ),
      ),
    [wikiPagesByScope],
  );
  // A page link without ?wiki= falls back to the page's own folder.
  const wikiScope =
    wikiScopeList.find(scope => scope.folderId === routeSearchParams.get('wiki')) ??
    wikiScopeList.find(scope =>
      wikiPagesByScope.get(scope.folderId)?.some(page => page.canvasId === selectedCanvasId),
    ) ??
    null;
  const wikiScopeRepo = useMemo(
    () => channelRepos.find(item => item.id === wikiScope?.repoId) ?? null,
    [channelRepos, wikiScope],
  );
  const [showArchivedWiki, setShowArchivedWiki] = useState(false);
  const wikiScopeAllPages = useMemo(
    () => (wikiScope ? (wikiPagesByScope.get(wikiScope.folderId) ?? []) : []),
    [wikiScope, wikiPagesByScope],
  );
  const wikiPages = useMemo(
    () => (showArchivedWiki ? wikiScopeAllPages : wikiScopeAllPages.filter(page => !page.archived)),
    [showArchivedWiki, wikiScopeAllPages],
  );
  const selectedWikiPage = wikiScopeAllPages.find(page => page.canvasId === selectedCanvasId);
  const assistantCanvas = useMemo(
    () =>
      selectedCanvas
        ? { canvasId: selectedCanvas.id, title: selectedCanvas.title }
        : selectedWikiPage
          ? { canvasId: selectedWikiPage.canvasId, title: selectedWikiPage.title }
          : null,
    [selectedCanvas, selectedWikiPage],
  );
  const knowledgeDocs = useMemo(
    () =>
      knowledgeFolderId
        ? canvases.filter(
            canvas =>
              canvas.folderId === knowledgeFolderId &&
              (showArchivedKnowledge || canvas.sdlcArtifact?.artifactStatus !== 'ARCHIVED'),
          )
        : [],
    [canvases, knowledgeFolderId, showArchivedKnowledge],
  );
  const folders = useMemo(() => channel?.canvasFolders ?? [], [channel]);
  const typeFolders = useMemo(
    () =>
      folders
        .filter(
          folder => folder.name !== SDLC_HUB_KNOWLEDGE_FOLDER && folder.name !== SDLC_WIKI_FOLDER,
        )
        .slice()
        .sort((left, right) => left.createdAt - right.createdAt)
        .map(folder => ({
          id: folder.id,
          name: folder.name,
          canvases: folder.canvases ?? [],
        })),
    [folders],
  );
  const activeTypeFolderId = routeSearchParams.get('type');
  const activeTypeFolder = useMemo(
    () => typeFolders.find(folder => folder.id === activeTypeFolderId) ?? null,
    [typeFolders, activeTypeFolderId],
  );
  const selectedCanvasTypeFolder = useMemo(
    () =>
      selectedCanvasId
        ? (typeFolders.find(folder =>
            folder.canvases.some(canvas => canvas.id === selectedCanvasId),
          ) ?? null)
        : null,
    [typeFolders, selectedCanvasId],
  );
  const folderNameByCanvasId = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of folders) {
      for (const canvas of folder.canvases ?? []) map.set(canvas.id, folder.name);
    }
    return map;
  }, [folders]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F2' || !hoveredTypeId || renameTypeId) return;
      const folder = typeFolders.find(item => item.id === hoveredTypeId);
      if (folder) {
        setRenameTypeId(folder.id);
        setRenameTypeName(folder.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hoveredTypeId, renameTypeId, typeFolders]);
  const links = useMemo(
    () =>
      linkRows
        ? linkRows.flatMap(link =>
            isSdlcEntityType(link.sourceType) &&
            isSdlcEntityType(link.targetType) &&
            isSdlcRelationType(link.relationType)
              ? [
                  {
                    ...link,
                    sourceType: link.sourceType,
                    targetType: link.targetType,
                    relationType: link.relationType,
                  },
                ]
              : [],
          )
        : [],
    [linkRows],
  );
  // Tickets belonging to a track (TRACK -> TICKET TRACK_ITEM links), propagated
  // from the ticket's source artifact when the ticket is created.
  const trackTicketIdsByTrack = useMemo(() => {
    const byTrack = new Map<string, Set<string>>();
    for (const link of links) {
      if (
        link.sourceType === 'TRACK' &&
        link.targetType === 'TICKET' &&
        link.relationType === 'TRACK_ITEM'
      ) {
        const set = byTrack.get(link.sourceId) ?? new Set<string>();
        set.add(link.targetId);
        byTrack.set(link.sourceId, set);
      }
    }
    return byTrack;
  }, [links]);
  // canvas id -> its track name (from TRACK -> CANVAS TRACK_ITEM links), for card metadata.
  /** ticket id -> the artifact it was raised from, for the ticket rows. */
  const artifactByTicketId = useMemo(() => {
    const byTicket = new Map<string, string>();
    for (const link of links) {
      if (
        link.sourceType === 'CANVAS' &&
        link.targetType === 'TICKET' &&
        link.relationType === 'TICKET'
      ) {
        const canvas = canvases.find(item => item.id === link.sourceId);
        if (canvas) byTicket.set(link.targetId, canvas.title);
      }
    }
    return byTicket;
  }, [links, canvases]);

  const trackByCanvasId = useMemo(() => {
    const nameById = new Map(tracks.map(track => [track.id, track.name]));
    const byCanvas = new Map<string, { id: string; name: string }>();
    for (const link of links) {
      if (
        link.sourceType === 'TRACK' &&
        link.targetType === 'CANVAS' &&
        link.relationType === SDLC_TRACK_FLAT_RELATION
      ) {
        const name = nameById.get(link.sourceId);
        if (name) byCanvas.set(link.targetId, { id: link.sourceId, name });
      }
    }
    return byCanvas;
  }, [links, tracks]);

  useEffect(() => {
    const query = relatedSearchQuery.trim();
    if (!artifactTrack || !channel || query.length < 2) {
      setRelatedSearchResults([]);
      setRelatedSearching(false);
      return undefined;
    }
    const trackId = artifactTrack.id;
    const controller = new AbortController();
    setRelatedSearching(true);
    const timer = setTimeout(() => {
      void searchService
        .vespaSearch({ query, apps: 'file', subApp: 'canvas', limit: 25 }, controller.signal)
        .then(response => {
          setRelatedSearchResults(
            response.results
              .filter(result => trackByCanvasId.get(result.id)?.id === trackId)
              .map(result => ({
                id: result.id,
                title: result.title.replace(/<\/?hi>/g, ''),
              })),
          );
        })
        .catch(() => {})
        .finally(() => setRelatedSearching(false));
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [relatedSearchQuery, artifactTrack, channel, trackByCanvasId]);
  const trackConversationIds = useMemo(
    () =>
      selectedTrackId
        ? Array.from(
            new Set(
              links
                .filter(
                  link =>
                    link.sourceType === 'TRACK' &&
                    link.sourceId === selectedTrackId &&
                    link.targetType === 'CONVERSATION' &&
                    (link.relationType === 'DISCUSSION' ||
                      link.relationType === SDLC_TRACK_FLAT_RELATION),
                )
                .map(link => link.targetId),
            ),
          )
        : [],
    [links, selectedTrackId],
  );
  const folderConversationIds = useMemo(
    () =>
      folderDiscussion
        ? links
            .filter(
              link =>
                link.sourceType === folderDiscussion.type &&
                link.sourceId === folderDiscussion.id &&
                link.targetType === 'CONVERSATION' &&
                link.relationType === 'DISCUSSION',
            )
            .map(link => link.targetId)
        : [],
    [links, folderDiscussion],
  );
  const [hubFolderRows] = useCachedQuery(
    queries.getSdlcFoldersByChannel({ channelId: channelId || '' }),
    { enabled: Boolean(channelId) },
  );
  const parentFolderOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of links) {
      if (link.relationType === SDLC_CONTAINMENT_RELATION && link.sourceType === 'FOLDER') {
        map.set(`${link.targetType}:${link.targetId}`, link.sourceId);
      }
    }
    return map;
  }, [links]);
  const folderPageCanvasById = useMemo(
    () =>
      new Map<string, SdlcFinderCanvas>(
        typeFolders.flatMap(folder =>
          folder.canvases.map(canvas => [
            canvas.id,
            {
              id: canvas.id,
              title: canvas.title,
              typeName: folder.name,
              createdBy: canvas.createdBy,
              createdAt: canvas.createdAt,
              updatedAt: canvas.updatedAt,
              lastEditedBy: canvas.lastEditedBy ?? undefined,
              lastEditedAt: canvas.lastEditedAt ?? undefined,
            } satisfies SdlcFinderCanvas,
          ]),
        ),
      ),
    [typeFolders],
  );
  const folderById = useMemo(
    () => new Map((hubFolderRows ?? []).map(row => [row.id, { id: row.id, name: row.name }])),
    [hubFolderRows],
  );
  const [hubLinkRows] = useCachedQuery(queries.getSdlcHubLinks({ channelId: channelId || '' }), {
    enabled: Boolean(channelId),
  });
  const linkById = useMemo(
    () =>
      new Map<string, SdlcFinderLink>(
        (hubLinkRows ?? []).map(row => [
          row.id,
          {
            id: row.id,
            title: row.title ?? '',
            url: row.url,
            description: row.description ?? null,
            favicon: row.favicon ?? null,
            createdBy: row.createdBy,
            createdAt: row.createdAt,
          } satisfies SdlcFinderLink,
        ]),
      ),
    [hubLinkRows],
  );
  const [hubFileRows] = useCachedQuery(queries.getSdlcHubFiles({ channelId: channelId || '' }), {
    enabled: Boolean(channelId),
  });
  const fileById = useMemo(
    () =>
      new Map<string, SdlcFinderFile>(
        (hubFileRows ?? []).map(row => [
          row.id,
          {
            id: row.id,
            name: row.originalFilename,
            url: getAttachmentStreamUrl(row.id),
            mimetype: row.mimetype,
            size: row.size,
            createdBy: row.createdBy,
            createdAt: row.createdAt,
          } satisfies SdlcFinderFile,
        ]),
      ),
    [hubFileRows],
  );
  const conversationOwnerById = useMemo(() => {
    const owners: ReadonlyArray<string> = ['FOLDER', 'CANVAS', 'LINK', 'ATTACHMENT'];
    const map = new Map<
      string,
      { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string }
    >();
    for (const link of links) {
      if (
        link.targetType === 'CONVERSATION' &&
        link.relationType === 'DISCUSSION' &&
        owners.includes(link.sourceType)
      ) {
        map.set(link.targetId, {
          type: link.sourceType as 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT',
          id: link.sourceId,
        });
      }
    }
    return map;
  }, [links]);
  useEffect(() => {
    setFolderDiscussion(null);
  }, [selectedTrackId]);

  useEffect(() => {
    // Opening an artifact hands the panel to that artifact. Leaving one does
    // not: closing a canvas tab for a file must not wipe the file's own
    // discussion, which the same navigation has just set.
    if (!selectedCanvasId) return;
    setFolderDiscussion(null);
  }, [selectedCanvasId]);
  const relatedTicketIds = useMemo(() => {
    const ids = new Set(linkedTicketIds(links));
    for (const set of trackTicketIdsByTrack.values()) {
      for (const id of set) ids.add(id);
    }
    return [...ids];
  }, [links, trackTicketIdsByTrack]);
  const [relatedTickets] = useCachedQuery(
    queries.sdlcTicketsByIds({ ticketIds: relatedTicketIds }),
  );
  const tickets = useMemo<readonly SdlcTicket[]>(
    () =>
      Array.isArray(relatedTickets) ? (relatedTickets as unknown as readonly SdlcTicket[]) : [],
    [relatedTickets],
  );
  const trackTicketList = useMemo<readonly SdlcTicket[]>(() => {
    if (!selectedTrack) return [];
    const ids = trackTicketIdsByTrack.get(selectedTrack.id) ?? new Set<string>();
    return tickets.filter(ticket => ids.has(ticket.id));
  }, [selectedTrack, trackTicketIdsByTrack, tickets]);
  useScope('sdlc-tickets', ticketsFocused);
  const focusedTicketIndex = trackTicketList.findIndex(ticket => ticket.id === focusedTicketId);
  const moveTicketFocus = (delta: number): void => {
    if (trackTicketList.length === 0) return;
    const from =
      focusedTicketIndex === -1 ? (delta > 0 ? -1 : trackTicketList.length) : focusedTicketIndex;
    const next = trackTicketList[Math.min(trackTicketList.length - 1, Math.max(0, from + delta))];
    if (!next) return;
    setFocusedTicketId(next.id);
    ticketsRef.current
      ?.querySelector(`[data-ticket-row="${next.id}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  const ticketBind = { enabled: ticketsFocused };
  // Shortcuts fire no DOM click, so the delegated tracker never sees them.
  const trackKeyboardNav = (action: 'down' | 'up' | 'open'): void => {
    globalClickTracker.trackManualEvent('Tickets', 'KEYBOARD_NAV', undefined, {
      action,
      surface: 'sdlc',
      listSize: trackTicketList.length,
    });
  };
  useShortcutById(
    'tickets.down',
    () => {
      trackKeyboardNav('down');
      moveTicketFocus(1);
    },
    ticketBind,
  );
  useShortcutById(
    'tickets.up',
    () => {
      trackKeyboardNav('up');
      moveTicketFocus(-1);
    },
    ticketBind,
  );
  useShortcutById(
    'tickets.open',
    () => {
      const ticket = trackTicketList[focusedTicketIndex];
      if (!ticket) return;
      trackKeyboardNav('open');
      setDiscussionUrl({
        open: true,
        conversationId: ticket.conversationId,
        selectedTab: 'details',
      });
    },
    ticketBind,
  );
  useEffect(() => {
    if (!ticketsFocused || focusedTicketId !== null) return;
    const first = trackTicketList[0];
    if (first) setFocusedTicketId(first.id);
  }, [ticketsFocused, focusedTicketId, trackTicketList]);

  const [channelTicketRows] = useCachedQuery(
    queries.sdlcTicketsByChannel({ channelId: channel?.id ?? '' }),
    { enabled: Boolean(channel?.id) },
  );
  const channelTicketCount = Array.isArray(channelTicketRows) ? channelTicketRows.length : 0;
  const [renderedConversationId, setRenderedConversationId] = useState<string | null>(null);
  const chatLayout = sdlcChatLayout({
    chatParam: routeSearchParams.get('chat'),
    discussionParam: routeSearchParams.get('discussion'),
  });
  const sdlcChatTab = chatLayout.activeTab;
  const discussionOpen = chatLayout.panelOpen && sdlcChatTab === 'conversations';
  const rightPanelOpen = chatLayout.panelOpen;
  const selectedDiscussionConversationId = routeSearchParams.get('conversation');
  useEffect(() => {
    if (selectedDiscussionConversationId) {
      setRenderedConversationId(selectedDiscussionConversationId);
      return;
    }
    const timer = setTimeout(() => setRenderedConversationId(null), 300);
    return () => clearTimeout(timer);
  }, [selectedDiscussionConversationId]);
  const discussionContext = useMemo(
    () =>
      resolveSdlcDiscussionContext({
        selectedCanvasId: selectedCanvas?.id ?? null,
        selectedWikiPage: selectedWikiPage ?? null,
        selectedConversationId: selectedDiscussionConversationId,
        canvases,
        links,
      }),
    [canvases, links, selectedCanvas?.id, selectedDiscussionConversationId, selectedWikiPage],
  );

  useEffect(() => {
    if (
      !shouldCloseInvalidSdlcConversationDeepLink({
        dataLoaded: repoQueryDetails.type === 'complete' && linkRows !== undefined,
        discussionOpen,
        selectedConversationId: selectedDiscussionConversationId,
        discussionContextResolved:
          Boolean(discussionContext) || Boolean(section === 'tracks' && selectedTrackId),
      })
    ) {
      return;
    }
    const next = new URLSearchParams(location.search);
    next.delete('discussion');
    next.delete('chat');
    next.delete('conversation');
    next.delete('selectedTab');
    const search = next.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
  }, [
    discussionContext,
    discussionOpen,
    location.pathname,
    location.search,
    navigate,
    repoQueryDetails.type,
    linkRows,
    section,
    selectedDiscussionConversationId,
    selectedTrackId,
  ]);
  const discussionOwner = discussionContext?.owner ?? null;
  const discussionSurface = discussionContext?.surface ?? null;
  const chatPanelAvailable =
    Boolean(discussionOwner && discussionSurface) || Boolean(section === 'tracks' && selectedTrack);
  const showRightPanel = rightPanelOpen && chatPanelAvailable;
  const discussionConversationIds = useMemo(
    () => discussionIdsForOwner(discussionOwner?.canvasId ?? null, links),
    [discussionOwner, links],
  );
  const activeFolderDiscussion =
    folderDiscussion && section === 'tracks' && selectedTrack ? folderDiscussion : null;
  const entityLinkScope = useMemo<EntityLinkScope | null>(() => {
    if (activeFolderDiscussion && selectedTrack) {
      return {
        sourceType: activeFolderDiscussion.type,
        sourceId: activeFolderDiscussion.id,
        rollUpTrackId: selectedTrack.id,
      };
    }
    if (discussionOwner) return { sourceType: 'CANVAS', sourceId: discussionOwner.canvasId };
    if (section === 'tracks' && selectedTrack) {
      return { sourceType: 'TRACK', sourceId: selectedTrack.id };
    }
    return null;
  }, [activeFolderDiscussion, discussionOwner, section, selectedTrack]);
  const relatedCanvas = canvases.find(canvas => canvas.id === relatedSourceId);
  const [hubWorkflowLink] = useCachedQuery(
    queries.getSdlcHubWorkflow({ channelId: channelId || '' }),
    { enabled: Boolean(channelId) },
  );
  const hubWorkflowId = hubWorkflowLink?.workflow?.id ?? null;
  const state = useHubWorkflow(hubWorkflowId);
  const knowledgeRunning = state.phase === 'RUNNING';
  const [wikiWorkflowLink] = useCachedQuery(
    queries.getSdlcWikiWorkflow({ channelId: channelId || '' }),
    { enabled: Boolean(channelId) },
  );
  const wikiState = useHubWorkflow(wikiWorkflowLink?.workflow?.id ?? null);

  const readyCount = knowledgeDocs.filter(
    canvas => canvas.sdlcArtifact?.artifactStatus === 'ACTIVE',
  ).length;
  const accessRepoId = repo ? repo.id : '';
  const accessCapabilities =
    repo && Array.isArray(repo.accessCapabilities)
      ? (repo.accessCapabilities as Array<{ capability?: string; state?: string; detail?: string }>)
      : [];
  const capabilityReady = (capability: string, states: string[]): boolean =>
    accessCapabilities.some(
      item => item.capability === capability && states.includes(item.state || ''),
    );
  const readReady = capabilityReady('READ_REPOSITORY', ['PROVEN']);
  const writeReady =
    capabilityReady('PUSH_BRANCH', ['PROVEN', 'INFERRED']) &&
    capabilityReady('CREATE_PULL_REQUEST', ['PROVEN', 'INFERRED']);
  const showAccessWarning = Boolean(repo) && (!readReady || !writeReady);
  const accessWarning = readReady
    ? {
        title: 'GitHub access needed to ship code',
        description:
          'Planning is available. Ask a workspace admin to update GitHub access before starting implementation.',
      }
    : {
        title: 'Repository connection needs attention',
        description: 'Ask a workspace admin to restore GitHub access before continuing.',
      };

  // Gates on the read being proven, not array length: a failed check stores UNAVAILABLE
  // entries, so a length test would never re-check a repo after access is restored.
  useEffect(() => {
    if (!accessRepoId || readReady) return;
    const fingerprint = accessRepoId;
    if (automaticAccessChecksRef.current.has(fingerprint)) return;
    automaticAccessChecksRef.current.add(fingerprint);
    void apiInstance
      .post(`/sdlc/repositories/${accessRepoId}/access-check`, { force: false })
      .catch(() => undefined);
  }, [readReady, accessRepoId]);
  const call = async (
    key: string,
    request: () => Promise<unknown>,
    success: string,
  ): Promise<void> => {
    setBusy(key);
    try {
      await request();
      toast.success(success);
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const navigateWithinSdlc = useCallback(
    (pathname: string, destinationSearch = ''): void => {
      const search = sdlcChatNavigationSearch({
        currentSearch: location.search,
        destinationSearch,
      });
      void navigate(`${pathname}${search}`);
    },
    [location.search, navigate],
  );

  interface OpenCanvasOptions {
    event?: { metaKey: boolean; ctrlKey: boolean } | undefined;
    withDiscussion?: boolean;
  }

  const canvasSearch = (canvasId: string, withDiscussion: boolean): URLSearchParams => {
    const search = new URLSearchParams({ canvas: canvasId });
    if (withDiscussion) {
      search.set('discussion', '1');
      search.set('chat', 'conversations');
    }
    return search;
  };

  const openWindowForCanvas = (
    targetSection: string,
    canvasId: string,
    search: URLSearchParams,
  ): boolean => {
    if (!workspaceId || !channelId) return false;
    return openStandaloneWindow(
      `/sdlc/${workspaceId}/${channelId}/${targetSection}?${search.toString()}`,
      `sdlc-canvas:${canvasId}`,
    );
  };

  const openCanvasInWindow = (canvasId: string, withDiscussion: boolean): boolean =>
    openWindowForCanvas(section, canvasId, canvasSearch(canvasId, withDiscussion));

  const openCanvas = (canvasId: string, options?: OpenCanvasOptions): void => {
    if (!channelId) return;

    const withDiscussion = options?.withDiscussion ?? true;
    if (shouldOpenInNewWindow(options?.event) && openCanvasInWindow(canvasId, withDiscussion)) {
      return;
    }

    setRelatedSourceId(null);
    const search = canvasSearch(canvasId, withDiscussion);
    navigateWithinSdlc(`/sdlc/${channelId}/${section}`, `?${search.toString()}`);
  };

  const openFolder = openFolderId
    ? (folderById.get(openFolderId) ??
      (selectedTrack && openFolderId === selectedTrack.id
        ? { id: selectedTrack.id, name: selectedTrack.name }
        : null))
    : null;
  /** True while the page open is the track's own, rather than a folder inside it. */
  const openFolderIsTrack = Boolean(openFolder && openFolder.id === selectedTrackId);
  /** Names a parent for the mutators, which care whether it is a track. */
  const folderPageParent = (parent: {
    id: string;
    name: string;
  }): { type: 'TRACK' | 'FOLDER'; id: string; name: string } =>
    parent.id === selectedTrackId
      ? { type: 'TRACK', id: parent.id, name: parent.name }
      : { type: 'FOLDER', id: parent.id, name: parent.name };
  const activeFolderTab: FolderTab | null = openFolder
    ? selectedCanvasId
      ? { kind: 'CANVAS', id: selectedCanvasId }
      : openFileId
        ? { kind: 'ATTACHMENT', id: openFileId }
        : openLinkId
          ? { kind: 'LINK', id: openLinkId }
          : browsingScratchTab
            ? { kind: 'BROWSER', id: SCRATCH_TAB_ID }
            : null
    : null;

  const discussionScopeIcon = (item: SdlcItemDiscussion): ReactNode => {
    const className = 'size-3.5 shrink-0';
    if (item.type === 'FOLDER') {
      return <Folder className={`${className} fill-primary/25 text-primary/70`} />;
    }
    if (item.type === 'LINK') {
      const favicon = linkById.get(item.id)?.favicon;
      return favicon ? (
        <img src={favicon} alt='' className={`${className} rounded-[2px]`} />
      ) : (
        <Link2 className={className} />
      );
    }
    const file = fileById.get(item.id);
    const Icon = file ? fileKind(file.mimetype, file.name).icon : Paperclip;
    return <Icon className={className} />;
  };

  const panelScopeActions = (place: 'header' | 'panel'): ReactNode => {
    if (!channel) return null;
    const callLink: SdlcCallLink | undefined = entityLinkScope
      ? { ownerType: entityLinkScope.sourceType, ownerId: entityLinkScope.sourceId }
      : undefined;
    return (
      <>
        <CallTriggerModal
          channelId={channel.id}
          {...(channel.scopeType && { scopeType: channel.scopeType })}
          channelName={channel.name}
          participantCount={channel.channelStats?.participantCount ?? 0}
          callDisplayName={channel.name}
          trackSource={place === 'panel' ? 'sdlc_conversation_header' : 'sdlc_repo_header'}
          isMember={Boolean(
            channel.participants?.some(participant => participant.userId === auth.userID),
          )}
          {...(callLink ? { sdlcLink: callLink } : {})}
        />
        <Button
          size='icon'
          variant='ghost'
          aria-label='Create ticket'
          title='Create ticket'
          onClick={() => {
            setCreateTicketSource('sdlc_header');
            setCreateTicketOpen(true);
          }}
          data-track-category='SdlcHub'
          data-track-name='HeaderCreateTicketClicked'
          data-track-metadata={JSON.stringify({
            place,
            scope: entityLinkScope?.sourceType ?? null,
            source: 'sdlc_header',
          })}
        >
          <TicketToken size={16} />
        </Button>
        <Button
          size='icon'
          variant='ghost'
          aria-label='Ask AI'
          title='Ask AI'
          onClick={() => openSdlcAssistant()}
          data-track-category='SdlcHub'
          data-track-name='HeaderAskAiClicked'
          data-track-metadata={JSON.stringify({ place })}
        >
          <XyneAIStar />
        </Button>
      </>
    );
  };

  /** Opens a previewed item on the page of whatever holds it — its folder, or
   *  the track's own page when it is filed straight on the track. */
  const openPreviewedItem = (
    kind: 'LINK' | 'ATTACHMENT',
    id: string,
    event?: { metaKey: boolean; ctrlKey: boolean },
  ): void => {
    const parentId = parentFolderOf.get(`${kind}:${id}`) ?? selectedTrackId;
    if (!parentId) return;
    openFolderPage(parentId, { kind, id }, event);
  };

  /** A track's own page, with its conversations alongside it. */
  const trackSearch = (trackId: string): string => {
    const search = new URLSearchParams({ track: trackId });
    search.set('discussion', '1');
    search.set('chat', 'conversations');
    return `?${search.toString()}`;
  };

  const folderPageSearch = (
    folderId: string,
    tab: FolderTab | null,
    withDiscussion = false,
  ): string => {
    const search = new URLSearchParams();
    if (selectedTrackId) search.set('track', selectedTrackId);
    search.set('folder', folderId);
    if (tab?.kind === 'CANVAS') search.set('canvas', tab.id);
    if (tab?.kind === 'ATTACHMENT') search.set('file', tab.id);
    if (tab?.kind === 'LINK') search.set('link', tab.id);
    if (tab?.kind === 'BROWSER') search.set('browse', '1');
    if (withDiscussion) {
      search.set('discussion', '1');
      search.set('chat', 'conversations');
    }
    return search.toString();
  };

  /** The track's page in a window of its own — the same thing a folder gets. */
  const openTrackInWindow = (trackId: string): boolean => {
    if (!workspaceId || !channelId) return false;
    return openStandaloneWindow(
      `/sdlc/${workspaceId}/${channelId}/tracks${trackSearch(trackId)}`,
      `sdlc-track:${trackId}`,
    );
  };

  const openFolderInWindow = (folderId: string, tab: FolderTab | null = null): boolean => {
    if (!workspaceId || !channelId) return false;
    return openStandaloneWindow(
      `/sdlc/${workspaceId}/${channelId}/tracks?${folderPageSearch(folderId, tab)}`,
      tab ? `sdlc-item:${tab.kind}:${tab.id}` : `sdlc-folder:${folderId}`,
    );
  };

  /** Stable identity: the folder page memoises its tree and tabs on this. */
  const folderPageMaps = useMemo(
    () => ({ folderById, canvasById: folderPageCanvasById, linkById, fileById }),
    [folderById, folderPageCanvasById, linkById, fileById],
  );

  const openFolderPage = (
    folderId: string,
    tab: FolderTab | null = null,
    event?: { metaKey: boolean; ctrlKey: boolean },
    /** Opens the conversation panel in the same navigation, rather than a second
     *  one that would replace this entry and take the tab with it. On by
     *  default: opening a folder, or a tab inside one, shows what is being
     *  discussed about it. */
    withDiscussion = true,
  ): void => {
    if (!channelId) return;
    if (shouldOpenInNewWindow(event) && openFolderInWindow(folderId, tab)) return;
    setPreviewCanvasId(null);
    setPreviewItem(null);
    if (tab?.kind === 'LINK') {
      const link = linkById.get(tab.id);
      setFolderDiscussion({
        type: 'LINK',
        id: tab.id,
        name: link ? link.title.trim() || link.url : 'Link',
      });
    } else if (tab?.kind === 'ATTACHMENT') {
      setFolderDiscussion({
        type: 'ATTACHMENT',
        id: tab.id,
        name: fileById.get(tab.id)?.name ?? 'File',
      });
    } else if (tab?.kind === 'CANVAS' || tab?.kind === 'BROWSER') {
      // An artifact carries its own discussion through the canvas owner.
      setFolderDiscussion(null);
    } else {
      // Opening the folder itself makes the folder the subject; otherwise the
      // panel keeps showing the track you came from while you are inside it.
      const folder = folderById.get(folderId);
      setFolderDiscussion(folder ? { type: 'FOLDER', id: folder.id, name: folder.name } : null);
    }
    navigateWithinSdlc(
      `/sdlc/${channelId}/tracks`,
      `?${folderPageSearch(folderId, tab, withDiscussion)}`,
    );
  };

  const closeFolderPage = (): void => {
    if (!channelId) return;
    setFolderDiscussion(null);
    navigateWithinSdlc(
      `/sdlc/${channelId}/tracks`,
      selectedTrackId ? trackSearch(selectedTrackId) : '',
    );
  };

  const openWikiPage = (canvasId: string): void => {
    if (!channelId) return;
    setRelatedSourceId(null);
    const search = new URLSearchParams({ canvas: canvasId });
    if (wikiScope) search.set('wiki', wikiScope.folderId);
    navigateWithinSdlc(`/sdlc/${channelId}/wiki`, `?${search.toString()}`);
  };

  const closeCanvas = (): void => {
    if (!channelId) return;
    const typeFolder =
      selectedCanvasTypeFolder ?? (section === 'artifacts' ? activeTypeFolder : null);
    if (typeFolder) {
      navigateWithinSdlc(
        `/sdlc/${channelId}/artifacts`,
        `?type=${encodeURIComponent(typeFolder.id)}`,
      );
      return;
    }
    navigateWithinSdlc(
      `/sdlc/${channelId}/${section}`,
      section === 'wiki' && wikiScope ? `?wiki=${encodeURIComponent(wikiScope.folderId)}` : '',
    );
  };

  const setDiscussionUrl = useCallback(
    (input: {
      open: boolean;
      conversationId?: string | null;
      selectedTab?: 'details' | null;
    }): void => {
      const next = new URLSearchParams(location.search);
      if (input.open) {
        next.set('discussion', '1');
        next.set('chat', 'conversations');
      } else {
        // Explicit, because an absent param now means open.
        next.set('discussion', '0');
        next.delete('chat');
      }
      if (input.conversationId) next.set('conversation', input.conversationId);
      else next.delete('conversation');
      if (input.conversationId && input.selectedTab) next.set('selectedTab', input.selectedTab);
      else next.delete('selectedTab');
      const search = next.toString();
      void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  const openConversations = useCallback((): void => {
    setFolderDiscussion(null);
    setDiscussionUrl({ open: true, conversationId: null });
  }, [setDiscussionUrl]);

  const openItemConversations = useCallback(
    (item: SdlcItemDiscussion): void => {
      setFolderDiscussion(item);
      setDiscussionUrl({ open: true, conversationId: null });
    },
    [setDiscussionUrl],
  );
  const openFolderConversations = useCallback(
    (folder: { id: string; name: string }): void =>
      openItemConversations({ type: 'FOLDER', id: folder.id, name: folder.name }),
    [openItemConversations],
  );

  const renderFolderConversationBadge = useCallback(
    (conversationId: string): ReactNode => {
      const owner = conversationOwnerById.get(conversationId);
      if (!owner) return null;

      const iconClass = 'size-[11px] shrink-0';
      const described =
        owner.type === 'FOLDER'
          ? (() => {
              const name = folderById.get(owner.id)?.name;
              return name
                ? {
                    name,
                    icon: <Folder className={`${iconClass} fill-primary/25 text-primary/70`} />,
                    open: () => openItemConversations({ type: 'FOLDER', id: owner.id, name }),
                  }
                : null;
            })()
          : owner.type === 'LINK'
            ? (() => {
                const link = linkById.get(owner.id);
                if (!link) return null;
                const name = link.title.trim() || link.url;
                return {
                  name,
                  icon: link.favicon ? (
                    <img src={link.favicon} alt='' className={`${iconClass} rounded-[2px]`} />
                  ) : (
                    <Link2 className={iconClass} />
                  ),
                  open: () => openItemConversations({ type: 'LINK', id: owner.id, name }),
                };
              })()
            : owner.type === 'ATTACHMENT'
              ? (() => {
                  const file = fileById.get(owner.id);
                  if (!file) return null;
                  const Icon = fileKind(file.mimetype, file.name).icon;
                  return {
                    name: file.name,
                    icon: <Icon className={iconClass} />,
                    open: () =>
                      openItemConversations({
                        type: 'ATTACHMENT',
                        id: owner.id,
                        name: file.name,
                      }),
                  };
                })()
              : (() => {
                  const canvas = folderPageCanvasById.get(owner.id);
                  if (!canvas) return null;
                  return {
                    name: canvas.title,
                    icon: <FileText className={`${iconClass} text-primary/70`} />,
                    open: () => openCanvas(owner.id, { withDiscussion: true }),
                  };
                })();

      if (!described) return null;
      return (
        <button
          type='button'
          onClick={described.open}
          title={`Conversations on ${described.name}`}
          aria-label={`Conversations on ${described.name}`}
          className='inline-flex min-w-[3.75rem] max-w-[9rem] shrink items-center gap-1 rounded bg-foreground/[0.06] px-1 py-px text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.11] hover:text-foreground'
          data-track-category='SdlcHub'
          data-track-name='FolderConversationsOpenedFromList'
          data-track-metadata={JSON.stringify({ ownerType: owner.type })}
        >
          {described.icon}
          <span className='truncate'>{described.name}</span>
        </button>
      );
    },
    [
      conversationOwnerById,
      fileById,
      folderById,
      folderPageCanvasById,
      linkById,
      openCanvas,
      openItemConversations,
    ],
  );

  const closeConversations = useCallback((): void => {
    setDiscussionUrl({ open: false, conversationId: null });
  }, [setDiscussionUrl]);

  // Toggles the panel without disturbing its scope: the url already says what it
  // is showing, so only the open flag moves.
  useShortcutById('sdlc.toggleConversations', () => {
    if (!chatPanelAvailable) return;
    setDiscussionUrl({
      open: !rightPanelOpen,
      conversationId: rightPanelOpen ? null : selectedDiscussionConversationId,
    });
  });

  const selectDiscussionConversation = useCallback(
    (conversationId: string | null, options?: { selectedTab?: 'details' }): void => {
      setDiscussionUrl({ open: true, conversationId, selectedTab: options?.selectedTab ?? null });
    },
    [setDiscussionUrl],
  );

  const openSdlcAssistant = useCallback(
    (threadInfo?: ThreadInfo): void => {
      if (!channel) return;
      // Ask AI renders inside the SDLC lane itself (the framed bundle's own
      // XyneAISidebar), so Ask AI changes ship with this lane and never need a
      // parent redeploy.
      const assistantState = xyneAIActor.getSnapshot();
      const actorResearchContext = assistantState.context.researchContext;
      const startFreshChat = shouldStartFreshSdlcAssistant({
        actorOpen: assistantState.matches('open'),
        selectedAgentSlug,
        actorChannelId: assistantState.context.channelId,
        repositoryChannelId: channel.id,
        actorRepositoryId:
          actorResearchContext?.type === 'repository' ? actorResearchContext.id : null,
        repositoryId: repo?.id ?? null,
      });
      setSelectedAgentSlug('sdlc-agent');
      xyneAIActor.send({
        type: 'OPEN',
        trackSource: 'sdlc_panel',
        contextType: 'chat',
        contextId: channel.id,
        channelId: channel.id,
        startFreshChat,
        ...(assistantCanvas && { canvasInfo: assistantCanvas }),
        ...(threadInfo && { threadInfo }),
        ...(repo && { researchContext: { type: 'repository', id: repo.id, name: repo.name } }),
      });
    },
    [assistantCanvas, channel, repo, selectedAgentSlug, setSelectedAgentSlug],
  );

  const askSdlcAssistant = useCallback(
    (query: string, canvas?: { canvasId: string; title: string }, forceFreshChat = false): void => {
      if (!channel) return;
      const assistantState = xyneAIActor.getSnapshot();
      const pinnedContext = assistantState.context.researchContext;
      const needsFreshChat =
        forceFreshChat ||
        !assistantState.matches('open') ||
        selectedAgentSlug !== 'sdlc-agent' ||
        assistantState.context.channelId !== channel.id ||
        (pinnedContext?.type === 'repository' ? pinnedContext.id : null) !== (repo?.id ?? null);
      setSelectedAgentSlug('sdlc-agent');
      xyneAIActor.send({
        type: 'OPEN',
        trackSource: 'sdlc_panel',
        contextType: 'chat',
        contextId: channel.id,
        channelId: channel.id,
        startFreshChat: needsFreshChat,
        ...(canvas && { canvasInfo: canvas }),
        ...(repo && { researchContext: { type: 'repository', id: repo.id, name: repo.name } }),
        initialQuery: query,
      });
    },
    [channel, repo, selectedAgentSlug, setSelectedAgentSlug],
  );

  // "Ask Xyne" on a picked passage goes to this hub's assistant, the way the AI
  // screen's sink goes to its composer.
  useEffect(() => {
    registerSelectionSink('sdlc-item', {
      send: passage => {
        // The passage rides along as a structured selection; the message is
        // just the question, so the thread reads like a question rather than a
        // wall of quoted text.
        publishPendingPassage(passage);
        askSdlcAssistant(passage.question?.trim() || 'What does this passage say?');
      },
    });
  }, [askSdlcAssistant]);

  const renderWorkflowControls = (label: string, workflow: HubWorkflow): ReactElement => {
    const running = workflow.phase === 'RUNNING';
    const busyKey = `hub-workflow:${label}`;
    return (
      <div className='flex shrink-0 items-center gap-1.5'>
        <WorkflowStatusIcon workflow={workflow} />
        {workflow.workflowId ? (
          <Button
            size='sm'
            variant={running ? 'outline' : 'default'}
            loading={busy === busyKey}
            disabled={busy === busyKey}
            onClick={() =>
              void call(
                busyKey,
                running ? workflow.cancel : workflow.start,
                running ? `${label} run cancelled` : `${label} run started`,
              )
            }
            data-track-category='SdlcHub'
            data-track-name={running ? 'HubWorkflowRunCancelled' : 'HubWorkflowRunStarted'}
            data-track-metadata={JSON.stringify({ label })}
          >
            {running ? 'Cancel' : 'Start'}
          </Button>
        ) : null}
      </div>
    );
  };

  const renderWorkflowHeader = (input: {
    icon: typeof Boxes;
    title: string;
    description: string;
    workflow: HubWorkflow;
  }): ReactElement => {
    const Icon = input.icon;
    return (
      <div className='mb-6 flex items-center justify-between gap-6 border-b pb-5'>
        <div className='flex min-w-0 flex-1 items-center gap-3'>
          <div className='grid size-10 shrink-0 place-items-center rounded-xl border bg-background text-primary shadow-sm'>
            <Icon size={19} />
          </div>
          <div className='min-w-0'>
            <h2 className='text-xl font-semibold tracking-tight'>{input.title}</h2>
            <p className='mt-0.5 text-sm text-muted-foreground'>{input.description}</p>
          </div>
        </div>
        {renderWorkflowControls(input.title, input.workflow)}
      </div>
    );
  };

  useEffect(() => {
    if (sdlcChatTab !== 'ai') return;
    // Legacy ?chat=ai deep link: the assistant is the global sidebar now, not
    // a panel tab. Open it once and strip the param — keeping the param made
    // this effect re-open the sidebar every time the user closed it.
    if (!channel) return;
    openSdlcAssistant();
    const next = new URLSearchParams(location.search);
    next.delete('chat');
    const search = next.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
  }, [channel, location.pathname, location.search, navigate, openSdlcAssistant, sdlcChatTab]);

  const clearArtifactDialogFields = (input?: {
    track?: { id: string; name: string } | null;
    relatedCanvasIds?: string[];
  }): void => {
    setArtifactTitle('');
    setArtifactAiPrompt('');
    setArtifactTrack(input?.track ?? null);
    setArtifactContextLocked(Boolean(input?.track));
    setRelatedCanvasIds(input?.relatedCanvasIds ?? []);
    setRelatedSearchQuery('');
    setRelatedSearchResults([]);
    setRelatedListOpen(false);
    setRelatedChipsExpanded(false);
    setArtifactFolderPath('');
  };

  const resetArtifactDialog = (): void => {
    setArtifactDialog(null);
    clearArtifactDialogFields();
    setPendingArtifactFolder(null);
  };

  /**
   * Closing the Add dialog, from wherever. Its `open` is derived from
   * addItemParent, and Radix reports only the dismissals it handles itself
   * (Esc, the overlay) — so the X and Cancel buttons have to run this too, or
   * the next folder's dialog opens holding the last one's files and link.
   */
  const closeAddItemDialog = (): void => {
    setAddItemParent(null);
    returnFocusToFinder();
    setPendingUploads([]);
    setRefusedUploads([]);
    setLinkUrl('');
    setLinkTitle('');
    setLinkPreview(null);
    resetArtifactDialog();
  };

  const relatedArtifactsForPayload = (): Array<{ canvasId: string; title: string }> =>
    relatedCanvasIds
      .map(id => canvases.find(canvas => canvas.id === id))
      .filter((canvas): canvas is (typeof canvases)[number] => Boolean(canvas))
      .map(canvas => ({ canvasId: canvas.id, title: canvas.title }));

  const createArtifact = (): void => {
    if (!channel || !artifactDialog || !canSubmitArtifactDialog) return;
    const title = artifactTitle.trim();
    const direction = artifactAiPrompt.trim();
    const folderPath = artifactFolderPath.trim();
    const related = relatedArtifactsForPayload();
    const query =
      artifactDialog.kind === 'wiki'
        ? buildSdlcWikiPageCreationPrompt({
            title,
            ...(wikiScopeRepo && { repositoryName: wikiScopeRepo.name, repoId: wikiScopeRepo.id }),
            ...(folderPath && { folderPath }),
            ...(direction && { direction }),
          })
        : buildSdlcArtifactCreationPrompt({
            typeLabel:
              artifactDialog.kind === 'knowledge' ? SDLC_HUB_KNOWLEDGE_FOLDER : artifactDialog.name,
            folderId: artifactDialog.id,
            title,
            ...(repo && artifactDialog.kind !== 'knowledge' && { repositoryName: repo.name }),
            ...(direction && { direction }),
            ...(related.length > 0 && { relatedArtifacts: related }),
            ...(artifactTrack && { track: artifactTrack }),
          });
    askSdlcAssistant(query, undefined, true);
    resetArtifactDialog();
  };

  const createTicketForArtifact = (canvas: { id: string; title: string }): void => {
    askSdlcAssistant(
      `Create an implementation ticket for the artifact "${canvas.title}"${repo ? ` in repository "${repo.name}"` : ''}. ` +
        `Call spaces-create-ticket with ${repo ? `sdlcRepoId ${repo.id} and ` : ''}sourceCanvasId ${canvas.id} so the ticket is linked to this artifact. ` +
        `Read the artifact first and derive the ticket title and description from it; ask me only if something essential is missing.`,
      { canvasId: canvas.id, title: canvas.title },
      true,
    );
  };

  const createBlankArtifact = async (): Promise<void> => {
    if (!channel || !artifactDialog || !canSubmitArtifactDialog) return;
    const folder = artifactDialog;
    const title = artifactTitle.trim();
    if (folder.kind === 'wiki') {
      const folderPath = artifactFolderPath.trim();
      const wikiResponse = await apiInstance.post<{ artifact: { canvasId: string } }>(
        '/sdlc/claw/artifacts',
        {
          artifactType: 'WIKI',
          channelId: channel.id,
          title,
          markdown: `# ${title}\n`,
          ...(wikiScopeRepo && { repoId: wikiScopeRepo.id }),
          ...(folderPath && { folderPath }),
        },
      );
      resetArtifactDialog();
      openWikiPage(wikiResponse.data.artifact.canvasId);
      return;
    }
    const response = await apiInstance.post<{ artifact: { canvasId: string } }>(
      '/sdlc/claw/artifacts',
      {
        ...(repo && { repoId: repo.id }),
        channelId: channel.id,
        folderId: folder.id,
        title,
        markdown: `# ${title}\n`,
        ...(artifactTrack && { trackId: artifactTrack.id }),
        ...(relatedCanvasIds.length > 0 && { relatedCanvasIds }),
      },
    );
    const fileIntoFolder = pendingArtifactFolder;
    resetArtifactDialog();
    setAddItemParent(null);
    const newCanvasId = response.data.artifact.canvasId;
    if (folder.kind === 'knowledge') {
      setRelatedSourceId(null);
      openCanvas(newCanvasId);
      return;
    }
    if (fileIntoFolder && channel) {
      await fileNewArtifactIntoFolder(newCanvasId, fileIntoFolder);
    }
    setRelatedSourceId(null);
    // Created from inside a folder, it opens as a tab there: leaving for the
    // artifacts section would close the folder you were working in.
    if (openFolderId) {
      openFolderPage(openFolderId, { kind: 'CANVAS', id: newCanvasId });
      return;
    }
    // Same search as opening an artifact from the list, so a new artifact lands
    // with its discussion open rather than only doing so once reopened.
    const search = canvasSearch(newCanvasId, true);
    search.set('type', folder.id);
    navigateWithinSdlc(`/sdlc/${channelId}/artifacts`, `?${search.toString()}`);
  };

  const createArtifactType = async (): Promise<void> => {
    if (!channel || !typeName.trim()) return;
    const response = await apiInstance.post<{ artifactType: { id: string; name: string } }>(
      '/sdlc/claw/artifact-types',
      { channelId: channel.id, name: typeName.trim() },
    );
    const created = response.data.artifactType;
    setTypeDialogOpen(false);
    setTypeName('');
    navigateWithinSdlc(`/sdlc/${channelId}/artifacts`, `?type=${encodeURIComponent(created.id)}`);
  };

  const renameArtifactType = async (folderId: string, name: string): Promise<void> => {
    if (!channel || !name.trim()) return;
    await apiInstance.patch(`/sdlc/claw/artifact-types/${folderId}`, {
      channelId: channel.id,
      name: name.trim(),
    });
    setRenameTypeId(null);
    setRenameTypeName('');
  };

  const linkPickedContext = (selections: ContextSelections): void => {
    if (!channelId || !relatedSourceId) return;
    const targets = [
      ...selections.channels.map(item => ({ type: 'CHANNEL', id: item.id })),
      ...selections.tickets.map(item => ({ type: 'TICKET', id: item.id })),
      ...selections.canvases.map(item => ({ type: 'CANVAS', id: item.canvasId || item.id })),
      ...selections.transcripts.map(item => ({ type: 'ATTACHMENT', id: item.id })),
      ...selections.recordings.map(item =>
        item.externalId
          ? { type: 'RECORDING', id: item.externalId }
          : { type: 'ATTACHMENT', id: item.id },
      ),
    ];
    void call(
      'link',
      async () => {
        await Promise.all(
          targets.map(target =>
            apiInstance.post('/sdlc/claw/links', {
              channelId,
              sourceType: 'CANVAS',
              sourceId: relatedSourceId,
              targetType: target.type,
              targetId: target.id,
              relationType: 'CONTEXT',
            }),
          ),
        );
        setLinkDialog(false);
      },
      `${targets.length} context item${targets.length === 1 ? '' : 's'} linked`,
    );
  };

  // A deleted hub keeps returning undefined, so 'complete' is what separates a
  // missing hub from one still loading.
  const hubLoading =
    Boolean(channelId) && channelRow === undefined && repoQueryDetails.type !== 'complete';
  if (channels === undefined || hubLoading) {
    return (
      <div className='h-full grid place-items-center text-muted-foreground'>
        <Loader2 className='animate-spin' />
      </div>
    );
  }

  // Before the empty state: a URL naming a hub that is gone is a 404, not an
  // invitation to create the first one.
  if (channelId && !channel) return <NotFoundScreen fallbackPath='/sdlc' />;

  if (!Array.isArray(channels) || channels.length === 0) {
    return (
      <div className='h-full bg-muted/30 grid place-items-center p-8'>
        <div className='max-w-lg rounded-2xl border bg-background p-10 text-center shadow-sm'>
          <div className='mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary'>
            <GitBranch size={26} />
          </div>
          <h1 className='text-2xl font-semibold'>No SDLC hubs yet</h1>
          <p className='mt-3 text-sm leading-6 text-muted-foreground'>
            A hub covers one or more repositories from a project. It stays private and never appears
            in Chat.
          </p>
          <Button
            className='mt-6'
            onClick={() => setHubDialog('create')}
            data-track-category='SdlcHub'
            data-track-name='FirstHubOpened'
          >
            <Plus />
            New hub
          </Button>
        </div>
        <SdlcHubDialog
          open={hubDialog !== null}
          onOpenChange={open => setHubDialog(open ? hubDialog : null)}
          onSaved={savedChannelId => void navigate(`/sdlc/${savedChannelId}/overview`)}
        />
      </div>
    );
  }

  // No hub in the URL yet: the redirect to the first one is a tick away.
  if (!channel) {
    return (
      <div className='h-full grid place-items-center text-muted-foreground'>
        <Loader2 className='animate-spin' />
      </div>
    );
  }

  const runTrackMutation = async (mutation: ReturnType<typeof zero.mutate>): Promise<void> => {
    const response = await mutation.server;
    if (response.type === 'error') throw new Error(response.error.message);
  };

  const createTrackAction = async (): Promise<void> => {
    if (!channel) return;
    const id = uuidv4();
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.createTrack({
          id,
          linkId: uuidv4(),
          channelId: channel.id,
          name: trackName.trim(),
          ...(trackDescription.trim() ? { description: trackDescription.trim() } : {}),
          timestamp: Date.now(),
        }),
      ),
    );
    setTrackDialog(false);
    setTrackName('');
    setTrackDescription('');
    navigateWithinSdlc(`/sdlc/${channelId}/tracks`, trackSearch(id));
  };

  const activeTrackOptions = tracks
    .filter(track => track.status !== 'ARCHIVED')
    .map(track => ({
      value: track.id,
      label: track.name,
      icon: <Layers className='size-4 text-muted-foreground' />,
    }));

  const openArtifactCreate = (folder: { id: string; name: string }): void => {
    clearArtifactDialogFields();
    setArtifactDialog({ id: folder.id, name: folder.name, kind: 'artifact' });
  };

  const openHubDocumentCreate = (kind: 'knowledge' | 'wiki'): void => {
    clearArtifactDialogFields();
    setArtifactDialog(
      kind === 'knowledge'
        ? { id: knowledgeFolderId ?? '', name: 'Hub Knowledge document', kind }
        : { id: wikiScope?.folderId ?? '', name: 'Wiki page', kind },
    );
  };

  const openArtifactCreateFrom = (
    folder: { id: string; name: string },
    sourceCanvasId: string,
  ): void => {
    clearArtifactDialogFields({
      track: trackByCanvasId.get(sourceCanvasId) ?? null,
      relatedCanvasIds: [sourceCanvasId],
    });
    setArtifactDialog({ id: folder.id, name: folder.name, kind: 'artifact' });
  };

  const renderArtifacts = (folder: (typeof typeFolders)[number]): ReactElement => {
    const list = folder.canvases;
    return (
      <section className='flex min-h-full flex-col'>
        <SectionHeader
          title={folder.name}
          description={`${folder.name} artifacts for this repository.`}
          action={
            <Button onClick={() => openArtifactCreate(folder)}>
              <Plus />
              New {folder.name}
            </Button>
          }
        />
        {list.length === 0 ? (
          <div className='flex flex-1 items-center justify-center pb-16'>
            <div className='flex flex-col items-center gap-2 text-center'>
              <div className='mb-0.5 flex size-[34px] items-center justify-center rounded-[9px] bg-muted text-muted-foreground/70'>
                <FileText size={17} strokeWidth={1.6} />
              </div>
              <span className='text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                No artifacts yet
              </span>
            </div>
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-4'>
            {list.map(canvas => {
              const cardMeta = [trackByCanvasId.get(canvas.id)?.name].filter(
                (value): value is string => Boolean(value),
              );
              return (
                <ArtifactCard
                  key={canvas.id}
                  title={canvas.title}
                  eyebrow={folder.name}
                  {...(cardMeta.length > 0 && { meta: cardMeta })}
                  onOpen={event => openCanvas(canvas.id, { event, withDiscussion: true })}
                  actionLabel='Create Artifact'
                  onAction={() => {
                    setDeriveTypeId(null);
                    setDeriveSource({ canvasId: canvas.id, title: canvas.title });
                  }}
                  onCreateTicket={() =>
                    createTicketForArtifact({ id: canvas.id, title: canvas.title })
                  }
                  createdBy={canvas.createdBy}
                  createdAt={canvas.createdAt}
                />
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const isDocumentWindow = isSdlcDocumentWindow();

  const setTrackStatusAction = async (trackId: string, status: string): Promise<void> => {
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.updateTrack({
          trackId,
          status: status as 'ACTIVE' | 'COMPLETED' | 'ARCHIVED',
          timestamp: Date.now(),
        }),
      ),
    );
  };

  const renameFolderAction = async (folderId: string, name: string): Promise<void> => {
    if (!channel) return;
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.renameSdlcFolder({
          folderId,
          channelId: channel.id,
          name,
          timestamp: Date.now(),
        }),
      ),
    );
    setFinderPath(finderPath.map(step => (step.id === folderId ? { ...step, name } : step)));
  };

  /**
   * The artifact is created over REST and filed over Zero, so its rows may not
   * have reached the sync replica yet. Both of these mean the same thing —
   * an edge this mutation needs has not arrived — and both clear on a retry:
   * the containment edge is missing, or the track's flat edge is.
   */
  const NOT_YET_SYNCED = [
    'Item is not filed anywhere',
    'An item can only be moved within its own track',
  ];

  const fileNewArtifactIntoFolder = async (canvasId: string, folderId: string): Promise<void> => {
    const attempts = 10;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await moveItemAction({ type: 'CANVAS', id: canvasId }, { type: 'FOLDER', id: folderId });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (attempt === attempts || !NOT_YET_SYNCED.some(known => message.includes(known))) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
  };

  const moveItemAction = async (
    item: { type: SdlcFinderNodeType; id: string },
    parent: { type: 'TRACK' | 'FOLDER'; id: string },
  ): Promise<void> => {
    if (!channel) return;
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.moveSdlcItem({
          linkId: uuidv4(),
          channelId: channel.id,
          itemType: item.type,
          itemId: item.id,
          parentType: parent.type,
          parentId: parent.id,
          timestamp: Date.now(),
        }),
      ),
    );
  };

  const createFolderAction = async (): Promise<void> => {
    if (!channel || !selectedTrack || !newFolderParent) return;
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.createSdlcFolder({
          id: uuidv4(),
          containmentLinkId: uuidv4(),
          flatLinkId: uuidv4(),
          channelId: channel.id,
          trackId: selectedTrack.id,
          parentType: newFolderParent.type,
          parentId: newFolderParent.id,
          name: newFolderName.trim(),
          timestamp: Date.now(),
        }),
      ),
    );
    setNewFolderParent(null);
    returnFocusToFinder();
    setNewFolderName('');
  };

  /**
   * The suggestion, not the answer: whatever the page says about itself fills the
   * title, and the reader can change it before it is saved. The favicon is taken
   * as found — there is nothing useful for a reader to edit about it.
   */
  const fetchLinkSuggestion = async (url: string): Promise<void> => {
    if (!url.trim()) return;
    setLinkLoading(true);
    try {
      const response = await apiInstance.post('/link-preview', { url: url.trim() });
      const envelope = response.data as {
        data?: { title?: string; description?: string; favicon?: string };
      };
      const preview = envelope.data ?? {};
      if (preview.title) setLinkTitle(preview.title);
      setLinkPreview({
        ...(preview.description !== undefined && { description: preview.description }),
        ...(preview.favicon !== undefined && { favicon: preview.favicon }),
      });
    } catch {
      // A page that will not describe itself is still worth linking; the reader
      // types a title instead.
      setLinkPreview(null);
    } finally {
      setLinkLoading(false);
    }
  };

  const openAddItemDialog = (tab: 'artifact' | 'upload' | 'link', parent: SdlcFinderStep): void => {
    // Adding to a level makes it the current one. Otherwise you add to a folder
    // while looking at one several columns deeper, and the new item lands
    // somewhere off to the left.
    const depth = finderPath.findIndex(step => step.id === parent.id);
    if (parent.type === 'TRACK') setFinderPath([]);
    else if (depth !== -1 && depth < finderPath.length - 1) {
      setFinderPath(finderPath.slice(0, depth + 1));
    }
    setPreviewCanvasId(null);
    setAddItemTab(tab);
    setAddItemParent(parent);
  };

  const addLinkAction = async (): Promise<void> => {
    if (!channel || !selectedTrack || !addItemParent) return;
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.addSdlcFolderItem({
          itemType: 'LINK',
          itemId: uuidv4(),
          containmentLinkId: uuidv4(),
          flatLinkId: uuidv4(),
          channelId: channel.id,
          trackId: selectedTrack.id,
          parentType: addItemParent.type,
          parentId: addItemParent.id,
          link: {
            url: linkUrl.trim(),
            title: linkTitle.trim() || linkUrl.trim(),
            ...(linkPreview?.description && { description: linkPreview.description }),
            ...(linkPreview?.favicon && { favicon: linkPreview.favicon }),
          },
          timestamp: Date.now(),
        }),
      ),
    );
    setAddItemParent(null);
    returnFocusToFinder();
    setLinkUrl('');
    setLinkTitle('');
    setLinkPreview(null);
  };

  const addBrowsedLink = (url: string, title: string): void => {
    if (!openFolder) return;
    setLinkUrl(url);
    setLinkTitle(title);
    setLinkPreview(null);
    openAddItemDialog('link', { type: 'FOLDER', id: openFolder.id, name: openFolder.name });
    // The page's own title is a decent first guess; the preview refines it and
    // brings the favicon, exactly as it does when a url is typed by hand.
    void fetchLinkSuggestion(url);
  };

  const stageUploads = (incoming: readonly File[]): void => {
    const allowed = incoming.filter(file => isAllowedSdlcUpload(file.name, file.type));
    const refused = incoming.filter(file => !isAllowedSdlcUpload(file.name, file.type));
    if (allowed.length > 0) setPendingUploads(current => [...current, ...allowed]);
    setRefusedUploads(refused.map(file => file.name));
  };

  const uploadFilesAction = async (files: readonly File[]): Promise<void> => {
    const parent = addItemParent;
    if (!channel || !selectedTrack || !parent || files.length === 0) return;
    const form = new FormData();
    form.append('entityType', 'SDLC_HUB');
    form.append('entityId', channel.id);
    // The upload files the attachment as it creates it. Placing it afterwards
    // through a mutator cannot work: the mutator reads the attachment row
    // through Zero, and the row this request just wrote has not synced yet.
    form.append('sdlcParentType', parent.type);
    form.append('sdlcParentId', parent.id);
    form.append('sdlcTrackId', selectedTrack.id);
    for (const file of files) form.append('files', file);
    await apiInstance.post('/attachments/upload', form);
    setPendingUploads([]);
    setRefusedUploads([]);
    setAddItemParent(null);
    returnFocusToFinder();
  };

  const setTrackNameAction = async (trackId: string, name: string): Promise<void> => {
    await runTrackMutation(
      zero.mutate(mutators.sdlc.updateTrack({ trackId, name, timestamp: Date.now() })),
    );
  };

  const setTrackDescriptionAction = async (trackId: string, description: string): Promise<void> => {
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.updateTrack({
          trackId,
          description: description.length > 0 ? description : null,
          timestamp: Date.now(),
        }),
      ),
    );
  };

  const artifactDialogKind: SdlcDocumentKind = artifactDialog?.kind ?? 'artifact';
  const addItemView = addItemParent ? addItemTab : 'artifact';
  // Only a type artifact belongs to a track; hub documents are hub-scoped.
  const canSubmitArtifactDialog =
    Boolean(artifactTitle.trim()) && (artifactDialogKind !== 'artifact' || Boolean(artifactTrack));

  const artifactDetailsStep = (
    <form
      className='flex flex-1 flex-col'
      onSubmit={event => {
        event.preventDefault();
        void call(
          'artifact',
          () => Promise.resolve(createArtifact()),
          'Creation request sent to Ask AI',
        );
      }}
    >
      <div className='flex flex-col gap-4 pb-5 pt-1'>
        <div className='flex flex-col gap-1.5'>
          <label htmlFor='sdlc-artifact-title' className='text-[12.5px] font-medium'>
            Title
          </label>
          <Input
            id='sdlc-artifact-title'
            autoFocus
            value={artifactTitle}
            onChange={event => setArtifactTitle(event.target.value)}
            className='h-[38px] text-[13.5px]'
            placeholder='Clear, outcome-focused title'
            data-track-category='SdlcHub'
            data-track-name='ArtifactTitleChanged'
          />
        </div>

        {artifactDialogKind === 'wiki' && (
          <div className='flex flex-col gap-1.5'>
            <div className='flex items-baseline gap-1.5'>
              <label htmlFor='sdlc-wiki-folder-path' className='text-[12.5px] font-medium'>
                Folder
              </label>
              <span className='text-xs text-muted-foreground'>optional</span>
            </div>
            <Input
              id='sdlc-wiki-folder-path'
              value={artifactFolderPath}
              onChange={event => setArtifactFolderPath(event.target.value)}
              maxLength={512}
              className='h-[38px] text-[13.5px]'
              placeholder='e.g. services/payments'
              data-track-category='SdlcHub'
              data-track-name='WikiFolderPathChanged'
            />
            <span className='text-xs text-muted-foreground'>
              Separate folders with &quot;/&quot;. Missing folders are created.
            </span>
          </div>
        )}

        {artifactDialogKind !== 'artifact' ? null : tracks.filter(
            track => track.status !== 'ARCHIVED',
          ).length > 0 ? (
          <div className='flex flex-col gap-1.5'>
            <div className='flex items-center gap-1.5'>
              <label htmlFor='sdlc-prd-track' className='text-[12.5px] font-medium'>
                Track
              </label>
              <span className='text-[12.5px] text-destructive'>required</span>
            </div>
            {/* Locked when a Tech Doc is derived from a PRD: the track comes with it. */}
            <div className={cn(artifactContextLocked && 'pointer-events-none opacity-60')}>
              <EntitySelector
                options={activeTrackOptions}
                selectedValue={artifactTrack?.id ?? null}
                onSelect={value => {
                  const track = tracks.find(item => item.id === value);
                  setArtifactTrack(track ? { id: track.id, name: track.name } : null);
                }}
                placeholder='Select a track'
                searchPlaceholder='Search tracks...'
                width='100%'
                matchTriggerWidth
              />
            </div>
          </div>
        ) : (
          <p className='rounded-lg border border-dashed p-3 text-sm text-muted-foreground'>
            Create a track first — every artifact belongs to a track.
          </p>
        )}

        <div className={cn('flex flex-col gap-1.5', artifactDialogKind !== 'artifact' && 'hidden')}>
          <div className='flex items-baseline gap-1.5'>
            <span className='text-[12.5px] font-medium'>Related artifacts</span>
            <span className='text-xs text-muted-foreground'>optional</span>
            <span className='ml-auto text-xs text-muted-foreground'>
              {relatedCanvasIds.length > 0 ? `${relatedCanvasIds.length} linked` : ''}
            </span>
            {relatedCanvasIds.length > 0 && (
              <button
                type='button'
                onClick={() => {
                  setRelatedCanvasIds([]);
                  setRelatedChipsExpanded(false);
                }}
                className='text-xs text-muted-foreground hover:text-foreground'
                data-track-category='SdlcHub'
                data-track-name='RelatedArtifactsCleared'
              >
                Clear
              </button>
            )}
          </div>
          {!artifactTrack ? (
            <p className='text-xs text-muted-foreground'>
              Choose a track first to attach related artifacts.
            </p>
          ) : (
            <>
              <div className='relative'>
                <div className='flex h-[38px] items-center gap-2 rounded-lg border bg-background px-3 focus-within:border-ring'>
                  <Search size={14} className='shrink-0 text-muted-foreground' />
                  <input
                    value={relatedSearchQuery}
                    onChange={event => setRelatedSearchQuery(event.target.value)}
                    onFocus={() => setRelatedListOpen(true)}
                    onBlur={() => setTimeout(() => setRelatedListOpen(false), 120)}
                    placeholder='Search artifacts in this track…'
                    className='h-6 min-w-0 flex-1 border-none bg-transparent text-[13.5px] outline-none'
                    data-track-category='SdlcHub'
                    data-track-name='RelatedArtifactSearch'
                  />
                </div>
                {relatedListOpen && relatedSearchQuery.trim().length >= 2 && (
                  <div className='absolute inset-x-0 top-[44px] z-30 max-h-[196px] overflow-auto rounded-[10px] border bg-background p-1 shadow-lg'>
                    {(() => {
                      const results = relatedSearchResults.filter(
                        result => !relatedCanvasIds.includes(result.id),
                      );
                      if (relatedSearching && results.length === 0) {
                        return (
                          <div className='px-2 py-2 text-[12.5px] text-muted-foreground'>
                            Searching…
                          </div>
                        );
                      }
                      if (results.length === 0) {
                        return (
                          <div className='px-2 py-2 text-[12.5px] text-muted-foreground'>
                            No matches in this track — pick another track or skip this.
                          </div>
                        );
                      }
                      return results.map(result => (
                        <button
                          key={result.id}
                          type='button'
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => {
                            setRelatedCanvasIds(prev => [...prev, result.id]);
                            setRelatedSearchQuery('');
                          }}
                          className='flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left hover:bg-muted'
                          data-track-category='SdlcHub'
                          data-track-name='RelatedArtifactAdded'
                        >
                          <FileText size={15} className='shrink-0 text-muted-foreground' />
                          <span className='flex-1 truncate text-[13px]'>{result.title}</span>
                          {folderNameByCanvasId.get(result.id) && (
                            <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
                              {folderNameByCanvasId.get(result.id)}
                            </span>
                          )}
                        </button>
                      ));
                    })()}
                  </div>
                )}
              </div>
              {relatedCanvasIds.length > 0 && (
                <div className='flex flex-wrap gap-1.5 pt-0.5'>
                  {(relatedChipsExpanded ? relatedCanvasIds : relatedCanvasIds.slice(0, 3)).map(
                    id => {
                      const title = canvases.find(canvas => canvas.id === id)?.title ?? 'Artifact';
                      return (
                        <span
                          key={id}
                          className='inline-flex h-[26px] items-center gap-1.5 rounded-md border bg-muted/60 pl-2.5 pr-1.5 text-[12.5px]'
                        >
                          <span className='max-w-[10rem] truncate'>{title}</span>
                          <button
                            type='button'
                            aria-label='Remove related artifact'
                            data-track-category='SdlcHub'
                            data-track-name='RelatedArtifactRemoved'
                            onClick={() =>
                              setRelatedCanvasIds(prev => prev.filter(existing => existing !== id))
                            }
                            className='flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground'
                          >
                            <X size={10} />
                          </button>
                        </span>
                      );
                    },
                  )}
                  {relatedCanvasIds.length > 3 && (
                    <button
                      type='button'
                      onClick={() => setRelatedChipsExpanded(prev => !prev)}
                      className='inline-flex h-[26px] items-center rounded-md border border-dashed px-2.5 text-[12.5px] text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                      data-track-category='SdlcHub'
                      data-track-name='RelatedArtifactsExpandToggled'
                    >
                      {relatedChipsExpanded ? 'Show less' : `+${relatedCanvasIds.length - 3} more`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className='flex flex-col gap-1.5'>
          <div className='flex items-baseline gap-1.5'>
            <label htmlFor='sdlc-artifact-ai-prompt' className='text-[12.5px] font-medium'>
              Direction for Ask AI
            </label>
            <span className='text-xs text-muted-foreground'>optional</span>
          </div>
          <Textarea
            id='sdlc-artifact-ai-prompt'
            value={artifactAiPrompt}
            onChange={event => setArtifactAiPrompt(event.target.value)}
            className='h-[74px] min-h-0 resize-none text-[13.5px]'
            placeholder='e.g. focus on retry semantics and the ledger contract; skip the mobile flow.'
            data-track-category='SdlcHub'
            data-track-name='ArtifactAiPromptChanged'
          />
          <span className='text-xs text-muted-foreground'>Ignored if you write it yourself.</span>
        </div>
      </div>

      <div className='sticky bottom-0 -mx-6 mt-auto flex items-center gap-2.5 rounded-b-lg border-t border-border bg-background px-6 py-3.5'>
        <button
          type='button'
          onClick={resetArtifactDialog}
          className='text-[12.5px] text-muted-foreground hover:text-foreground'
          data-track-category='SdlcHub'
          data-track-name='ArtifactDialogCancelled'
        >
          Cancel
        </button>
        <div className='ml-auto flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            className='h-[34px]'
            loading={busy === 'artifact-blank'}
            disabled={!canSubmitArtifactDialog}
            title='Create an empty document with just the title — no AI'
            onClick={() =>
              void call(
                'artifact-blank',
                createBlankArtifact,
                `${artifactDialog?.name ?? 'Artifact'} created`,
              )
            }
            data-track-category='SdlcHub'
            data-track-name='BlankArtifactCreated'
          >
            <Pencil />
            Write it myself
          </Button>
          <Button
            type='submit'
            className='h-[34px]'
            loading={busy === 'artifact'}
            disabled={!canSubmitArtifactDialog}
          >
            <Sparkles />
            Ask AI to create
          </Button>
        </div>
      </div>
    </form>
  );

  const renderTrack = (): ReactElement | null => {
    if (!selectedTrack) return null;
    const trackTickets = trackTicketList;
    const openTicketCount = trackTickets.filter(
      ticket =>
        ticket.statusV2 !== TicketStatusV2.COMPLETED &&
        ticket.statusV2 !== TicketStatusV2.CANCELLED,
    ).length;
    const unownedTicketCount = trackTickets.filter(ticket => !ticket.assignedTo).length;
    const ticketTally = `${openTicketCount} open · ${unownedTicketCount} unowned`;
    const finderCanvasById = folderPageCanvasById;
    return (
      <section>
        {/* Heading: what this track is, who owns it, and what it holds. */}
        <div className='mb-6 flex flex-wrap items-start gap-5'>
          <div className='min-w-[280px] flex-1'>
            <div className='mb-2 flex items-center gap-3'>
              <div className='grid size-[30px] shrink-0 place-items-center rounded-lg bg-primary/10'>
                <Layers className='size-4 text-primary' />
              </div>
              {/* Click the name to rename, the same way the description works. */}
              {nameDraft === null ? (
                <button
                  type='button'
                  onClick={() => {
                    nameAbandoned.current = false;
                    setNameDraft(selectedTrack.name);
                  }}
                  className='-mx-1 min-w-0 truncate rounded px-1 text-left text-[26px] font-bold leading-tight tracking-tight transition-colors hover:bg-muted/50'
                  title='Rename track'
                  data-track-category='SdlcHub'
                  data-track-name='TrackNameEditOpened'
                >
                  {selectedTrack.name}
                </button>
              ) : (
                <span className='relative inline-flex min-w-0 max-w-full items-center'>
                  {/* Mirrors the field's text and typography. Character counts
                      cannot size a proportional face — a space is far narrower
                      than a `ch`, so the slack piled up as you typed. */}
                  <span
                    aria-hidden='true'
                    data-name-mirror
                    className='pointer-events-none invisible absolute left-0 top-0 whitespace-pre px-1 text-[26px] font-bold leading-tight tracking-tight'
                  >
                    {nameDraft || ' '}
                  </span>
                  <input
                    autoFocus
                    value={nameDraft}
                    maxLength={TRACK_NAME_LIMIT}
                    onChange={event => setNameDraft(event.target.value)}
                    onFocus={event => {
                      sizeNameFieldToText(event.currentTarget);
                      event.target.setSelectionRange(
                        event.target.value.length,
                        event.target.value.length,
                      );
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Escape') {
                        nameAbandoned.current = true;
                        setNameDraft(null);
                      }
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    onBlur={() => {
                      if (nameAbandoned.current) {
                        nameAbandoned.current = false;
                        return;
                      }
                      const next = nameDraft.trim();
                      setNameDraft(null);
                      if (next.length > 0 && next !== selectedTrack.name) {
                        void call(
                          `track-name-${selectedTrack.id}`,
                          () => setTrackNameAction(selectedTrack.id, next),
                          'Track renamed',
                        );
                      }
                    }}
                    onInput={event => sizeNameFieldToText(event.currentTarget)}
                    className='-mx-1 min-w-0 max-w-full rounded border-0 bg-muted/40 px-1 text-[26px] font-bold leading-tight tracking-tight text-foreground outline-none ring-0 transition-colors duration-150 focus:bg-muted/60 focus:outline-none motion-reduce:transition-none'
                    data-track-category='SdlcHub'
                    data-track-name='TrackNameEdited'
                  />
                </span>
              )}
              <Popover
                open={trackStatusOpen}
                onOpenChange={setTrackStatusOpen}
                align='start'
                sideOffset={6}
                className='w-[168px] p-1'
                trigger={
                  <button
                    type='button'
                    className='flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11.5px] font-medium text-foreground ring-1 ring-inset ring-border transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    aria-label={`Track status: ${
                      TRACK_STATUS_OPTIONS.find(o => o.value === selectedTrack.status)?.label ??
                      selectedTrack.status
                    }. Change status`}
                    data-track-category='SdlcHub'
                    data-track-name='TrackStatusOpened'
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        TRACK_STATUS_DOT[selectedTrack.status] ?? TRACK_STATUS_DOT['ARCHIVED'],
                      )}
                      aria-hidden='true'
                    />
                    {TRACK_STATUS_OPTIONS.find(o => o.value === selectedTrack.status)?.label ??
                      selectedTrack.status}
                    <ChevronDown className='size-3 text-muted-foreground' />
                  </button>
                }
              >
                {TRACK_STATUS_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => {
                      setTrackStatusOpen(false);
                      if (option.value !== selectedTrack.status) {
                        void call(
                          `track-status-${selectedTrack.id}`,
                          () => setTrackStatusAction(selectedTrack.id, option.value),
                          `Track marked ${option.label.toLowerCase()}`,
                        );
                      }
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted/60',
                      option.value === selectedTrack.status && 'font-medium',
                    )}
                    data-track-category='SdlcHub'
                    data-track-name='TrackStatusChanged'
                    data-track-metadata={JSON.stringify({ status: option.value })}
                  >
                    <span className='flex items-center gap-2'>
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          TRACK_STATUS_DOT[option.value],
                        )}
                        aria-hidden='true'
                      />
                      {option.label}
                    </span>
                    {option.value === selectedTrack.status && (
                      <Check className='size-3.5 text-muted-foreground' />
                    )}
                  </button>
                ))}
              </Popover>
            </div>

            {/* Click the text to edit it, blur to save. No chrome: the field
                sits exactly where the description sits, at the same size, so
                editing looks like typing over what is already there. */}
            {descriptionDraft === null ? (
              <button
                type='button'
                onClick={() => {
                  descriptionAbandoned.current = false;
                  setDescriptionDraft(selectedTrack.description ?? '');
                }}
                className='-mx-1 block max-w-[918px] rounded px-1 text-left text-[13.5px] leading-relaxed text-muted-foreground transition-colors hover:bg-muted/50'
                data-track-category='SdlcHub'
                data-track-name='TrackDescriptionEditOpened'
              >
                {selectedTrack.description ? (
                  <span className='whitespace-pre-wrap'>{selectedTrack.description}</span>
                ) : (
                  <>
                    No description yet. <span className='text-primary'>Add one</span>
                  </>
                )}
              </button>
            ) : (
              <div className='max-w-[918px]'>
                <textarea
                  autoFocus
                  rows={1}
                  value={descriptionDraft}
                  maxLength={TRACK_DESCRIPTION_LIMIT}
                  onChange={event => {
                    setDescriptionDraft(event.target.value);
                    event.target.style.height = 'auto';
                    event.target.style.height = `${event.target.scrollHeight}px`;
                  }}
                  onFocus={event => {
                    event.target.style.height = 'auto';
                    event.target.style.height = `${event.target.scrollHeight}px`;
                    event.target.setSelectionRange(
                      event.target.value.length,
                      event.target.value.length,
                    );
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      descriptionAbandoned.current = true;
                      setDescriptionDraft(null);
                    }
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.currentTarget.blur();
                    }
                  }}
                  onBlur={() => {
                    if (descriptionAbandoned.current) {
                      descriptionAbandoned.current = false;
                      return;
                    }
                    const next = descriptionDraft.trim();
                    setDescriptionDraft(null);
                    if (next !== (selectedTrack.description ?? '')) {
                      void call(
                        `track-description-${selectedTrack.id}`,
                        () => setTrackDescriptionAction(selectedTrack.id, next),
                        'Description saved',
                      );
                    }
                  }}
                  placeholder='What is this track for?'
                  className='-mx-1 block w-[calc(100%+0.5rem)] resize-none overflow-hidden rounded border-0 bg-muted/40 px-1 py-0.5 text-[13.5px] leading-relaxed text-foreground outline-none ring-0 transition-[height,background-color] duration-150 ease-out placeholder:text-muted-foreground focus:bg-muted/60 focus:outline-none motion-reduce:transition-none'
                  data-track-category='SdlcHub'
                  data-track-name='TrackDescriptionEdited'
                />
                {/* Only speaks up near the cap; a counter on every edit is noise. */}
                {descriptionDraft.length > TRACK_DESCRIPTION_LIMIT - 200 && (
                  <div className='mt-1 text-[11px] tabular-nums text-muted-foreground'>
                    {TRACK_DESCRIPTION_LIMIT - descriptionDraft.length} characters left
                  </div>
                )}
              </div>
            )}

            <div className='mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground'>
              {/* The avatar and name both open the shared profile card on hover,
                  so the owner is reachable from here the way they are anywhere
                  else a person appears. */}
              <UserHoverWrapper userId={selectedTrack.createdBy}>
                <span className='flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground'>
                  <Avatar userId={selectedTrack.createdBy} size='xs' showActiveStatus={false} />
                  <span className='truncate'>
                    {trackOwner ? getUserDisplayName(trackOwner) : 'Unknown'} · owner
                  </span>
                </span>
              </UserHoverWrapper>
            </div>
          </div>
        </div>
        {/* The track's contents, browsed a level at a time. Each column is one
            live query for the children of its parent, so opening a folder costs
            one fetch and closing it drops one. The column headers name the path,
            so there is no separate breadcrumb above them. */}
        <div className='mb-6 overflow-hidden rounded-xl border border-border'>
          {/* Controls for the browser below, kept out of the columns so a column
              header stays the name of its level and nothing else. */}
          <div className='flex items-center gap-3 border-b border-border bg-foreground/[0.03] px-3 py-1.5'>
            <span className='text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground'>
              Group by
            </span>
            <div className='flex items-center gap-0.5 rounded-md border border-border p-0.5'>
              {(
                [
                  { value: 'none', label: 'None' },
                  { value: 'type', label: 'Type' },
                ] as const
              ).map(option => (
                <button
                  key={option.value}
                  type='button'
                  onClick={() => setUserPreference('sdlcFinderGroupBy', option.value)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11.5px] font-medium transition-colors',
                    finderGroupBy === option.value
                      ? 'bg-foreground/[0.08] text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  data-track-category='SdlcHub'
                  data-track-name='FinderGroupByChanged'
                  data-track-metadata={JSON.stringify({ groupBy: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {/* A fixed height, not a floor: min-h let a column grow with its contents and
              took the whole card — and the page — with it. Each column scrolls
              inside this instead, so the page only scrolls when the pointer is
              somewhere that has nothing of its own to scroll. */}
          <div ref={finderRef} className='scrollbar-none flex h-[520px] overflow-x-auto'>
            {(
              [
                { type: 'TRACK', id: selectedTrack.id, name: selectedTrack.name },
                ...finderPath,
              ] satisfies SdlcFinderStep[]
            ).map((step, index, steps) => (
              <SdlcFinderColumn
                key={step.id}
                channelId={channel.id}
                parent={step}
                selectedId={steps[index + 1]?.id ?? null}
                activeSelectionId={
                  previewCanvasId || previewItem ? null : (finderPath.at(-1)?.id ?? null)
                }
                canvasById={finderCanvasById}
                linkById={linkById}
                fileById={fileById}
                previewItemId={previewItem?.id ?? null}
                onPreviewItem={item => {
                  setFinderPath(steps.slice(1, index + 1));
                  setPreviewCanvasId(null);
                  setPreviewItem(item);
                }}
                isLast={index === steps.length - 1}
                onSelectFolder={folder => {
                  setPreviewCanvasId(null);
                  setPreviewItem(null);
                  // Re-selecting the folder that is already open below would
                  // rebuild the path from here and throw away every level under
                  // it, so the tree blinks shut and reopens one column deep.
                  if (steps[index + 1]?.id === folder.id) return;
                  setFinderPath([
                    ...steps.slice(1, index + 1),
                    { type: 'FOLDER', id: folder.id, name: folder.name },
                  ]);
                }}
                previewCanvasId={previewCanvasId}
                onSelectCanvas={canvasId => {
                  setFinderPath(steps.slice(1, index + 1));
                  setPreviewItem(null);
                  setPreviewCanvasId(canvasId);
                }}
                onOpenCanvas={(canvasId, event) =>
                  openCanvas(canvasId, event ? { event } : undefined)
                }
                onNewFolder={parent => {
                  finderFocusReturn.current = parent.id;
                  setNewFolderParent(parent);
                }}
                onUploadFile={parent => {
                  finderFocusReturn.current = parent.id;
                  openAddItemDialog('upload', parent);
                }}
                onAddLink={parent => {
                  finderFocusReturn.current = parent.id;
                  openAddItemDialog('link', parent);
                }}
                onNewArtifact={parent => {
                  finderFocusReturn.current = parent.id;
                  openAddItemDialog('artifact', parent);
                }}
                onOpenFolderPage={(folder, event) => openFolderPage(folder.id, null, event)}
                onOpenItem={(item, parent, event) => {
                  // It opens as a tab on the page of whatever holds it. A track
                  // holds its own page — the root folder, named after the track
                  // — so an item filed straight on the track opens there rather
                  // than being handed to the host with nowhere of its own to be.
                  openFolderPage(parent.id, { kind: item.kind, id: item.id }, event);
                }}
                onDiscussFolder={openFolderConversations}
                onDiscussTrack={() => openConversations()}
                onPreviewCanvas={canvasId => {
                  rememberFinderFocus();
                  setReaderCanvasId(canvasId);
                }}
                folderById={folderById}
                discussingFolderId={
                  showRightPanel && activeFolderDiscussion ? activeFolderDiscussion.id : null
                }
                onRenameFolder={(folderId, name) =>
                  void call(
                    `sdlc-folder-rename-${folderId}`,
                    () => renameFolderAction(folderId, name),
                    'Folder renamed',
                  )
                }
                draggingItem={draggingItem}
                onDragItem={setDraggingItem}
                onMoveItem={(item, parent) =>
                  void call(`sdlc-move-${item.id}`, () => moveItemAction(item, parent), 'Moved')
                }
              />
            ))}
            {previewItem?.kind === 'LINK' && linkById.get(previewItem.id) && (
              <SdlcFinderItemPreview
                item={{ kind: 'LINK', link: linkById.get(previewItem.id) as SdlcFinderLink }}
                onOpen={(_href, event) => openPreviewedItem('LINK', previewItem.id, event)}
                onDiscuss={openItemConversations}
              />
            )}
            {previewItem?.kind === 'ATTACHMENT' && fileById.get(previewItem.id) && (
              <SdlcFinderItemPreview
                item={{ kind: 'ATTACHMENT', file: fileById.get(previewItem.id) as SdlcFinderFile }}
                onOpen={(_href, event) => openPreviewedItem('ATTACHMENT', previewItem.id, event)}
                onDiscuss={openItemConversations}
              />
            )}
            {previewCanvasId && finderCanvasById.get(previewCanvasId) && (
              <SdlcFinderPreview
                canvas={finderCanvasById.get(previewCanvasId) as SdlcFinderCanvas}
                onOpen={(canvasId, event) => openCanvas(canvasId, event ? { event } : undefined)}
                onPreview={canvasId => {
                  rememberFinderFocus();
                  setReaderCanvasId(canvasId);
                }}
              />
            )}
          </div>
        </div>

        {/* Tickets under this track, below the browser. A flat list rather than
            columns: a ticket has no contents to step into. */}
        <div className='mb-4 flex flex-wrap items-center gap-3'>
          <span className='text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>
            Tickets
          </span>
          <span className='text-[11.5px] text-muted-foreground'>{ticketTally}</span>
          <div className='h-px min-w-[20px] flex-1 bg-border' aria-hidden='true' />
          <Button
            size='sm'
            onClick={() => {
              setCreateTicketSource('sdlc_track');
              setCreateTicketOpen(true);
            }}
            data-track-category='SdlcHub'
            data-track-name='TrackTicketCreateOpened'
            data-track-metadata={JSON.stringify({ source: 'sdlc_track' })}
          >
            <Plus />
            Create ticket
          </Button>
        </div>

        <div
          ref={ticketsRef}
          tabIndex={-1}
          onFocusCapture={() => setTicketsFocused(true)}
          onBlurCapture={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setTicketsFocused(false);
            }
          }}
          className='mb-6 overflow-hidden rounded-xl border border-border outline-none'
        >
          {trackTickets.length === 0 ? (
            <p className='px-4 py-8 text-center text-[12px] text-muted-foreground'>
              No tickets in this track yet.
            </p>
          ) : (
            trackTickets.map(ticket => (
              <button
                key={ticket.id}
                type='button'
                onClick={() => {
                  setFocusedTicketId(ticket.id);
                  setDiscussionUrl({
                    open: true,
                    conversationId: ticket.conversationId,
                    selectedTab: 'details',
                  });
                }}
                tabIndex={-1}
                data-ticket-row={ticket.id}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-border px-3.5 py-2 text-left outline-none transition-colors last:border-b-0 hover:bg-foreground/[0.04]',
                  ticketsFocused &&
                    focusedTicketId === ticket.id &&
                    'bg-foreground/[0.07] ring-2 ring-inset ring-foreground/40',
                )}
                data-track-category='SdlcHub'
                data-track-name='TrackTicketOpened'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id, source: 'sdlc_track' })}
              >
                <span className='shrink-0 font-mono text-[11px] text-muted-foreground'>
                  {ticket.xyneId}
                </span>
                <span className='min-w-[110px] flex-1 truncate text-[13px] font-medium tracking-[-0.01em]'>
                  {ticket.title}
                </span>
                {/* Where the ticket came from. Only shown when there is one — a
                    ticket raised on its own has nothing to point at. */}
                {artifactByTicketId.get(ticket.id) && (
                  <span className='flex min-w-0 shrink items-center gap-1.5 text-[11px] text-muted-foreground'>
                    <Link2 className='size-3 shrink-0' />
                    <span className='truncate'>{artifactByTicketId.get(ticket.id)}</span>
                  </span>
                )}
                {ticket.priority !== TicketPriority.LOW && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                      ticket.priority === TicketPriority.HIGH ||
                        ticket.priority === TicketPriority.CRITICAL
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-foreground/[0.07] text-muted-foreground',
                    )}
                  >
                    {TICKET_PRIORITY_LABEL[ticket.priority]}
                  </span>
                )}
                <span className='shrink-0 rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground'>
                  {ticket.stageName}
                </span>
                {ticket.assignedTo ? (
                  <Avatar userId={ticket.assignedTo} size='xs' showActiveStatus={false} />
                ) : (
                  <span
                    className='size-5 shrink-0 rounded-full border border-dashed border-border'
                    title='Unassigned'
                    aria-label='Unassigned'
                  />
                )}
                <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />
              </button>
            ))
          )}
        </div>
      </section>
    );
  };
  const openTrack = (
    trackId: string | null,
    event?: { metaKey: boolean; ctrlKey: boolean },
  ): void => {
    if (!channelId) return;
    if (trackId && shouldOpenInNewWindow(event) && openTrackInWindow(trackId)) return;
    navigateWithinSdlc(`/sdlc/${channelId}/tracks`, trackId ? trackSearch(trackId) : '');
  };

  const sectionNavRows = SECTIONS.map(item => {
    const Icon = item.icon;
    return (
      <div key={item.id} className='mb-0.5'>
        <button
          onClick={event => {
            navigateWithinSdlc(`/sdlc/${channelId}/${item.id}`);
            event.currentTarget.blur();
          }}
          {...(section === item.id && { 'aria-current': 'page' as const })}
          className={cn(
            'flex h-[32px] w-full items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-sidebar-foreground transition-colors',
            section === item.id ? 'bg-foreground/10 font-medium' : 'hover:bg-foreground/[0.06]',
          )}
          data-track-category='SdlcHub'
          data-track-name='SectionChanged'
          data-track-metadata={JSON.stringify({ section: item.id, channelId: channel.id })}
        >
          <Icon size={15} className='shrink-0 text-sidebar-foreground/70' />
          <span className='flex-1 truncate text-left'>{item.label}</span>
          <span className='text-xs tabular-nums text-sidebar-foreground/50'>
            {item.id === 'wiki'
              ? [...wikiPageCounts.values()].reduce((total, count) => total + count, 0)
              : item.id === 'knowledge'
                ? knowledgeDocs.length
                : item.id === 'tickets'
                  ? channelTicketCount
                  : ''}
          </span>
        </button>
      </div>
    );
  });

  return (
    <div className='flex h-full min-w-0 overflow-hidden bg-transparent'>
      {/* The rail is what the layout reserves; the panel inside is what is seen.
          While collapsed the panel floats above the page on hover, so widening
          it costs the content nothing. */}
      <aside
        className={cn('relative shrink-0', isDocumentWindow && 'hidden')}
        style={{ width: railCollapsed ? SIDEBAR_RAIL_WIDTH : railWidth }}
        onMouseEnter={() => railCollapsed && setRailHovered(true)}
        onMouseLeave={() => setRailHovered(false)}
        onFocusCapture={() => setSidebarFocused(true)}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setSidebarFocused(false);
          }
        }}
        ref={sidebarRef}
      >
        <div
          className={cn(
            'flex h-full flex-col overflow-x-hidden border-r border-sidebar-border-muted bg-sidebar text-sidebar-foreground',
            draggingWidth === null && 'transition-[width] duration-150',
            railCollapsed
              ? cn('absolute inset-y-0 left-0 z-30', railHovered && 'shadow-2xl')
              : 'w-full',
          )}
          style={{
            backdropFilter: 'blur(var(--sidebar-background-blur))',
            ...(railCollapsed
              ? { width: railHovered ? SIDEBAR_HOVER_WIDTH : SIDEBAR_RAIL_WIDTH }
              : {}),
          }}
        >
          {/* Folded, the rail carries one icon and nothing else — the navigator's
            own back, forward and refresh controls would not fit at this width and
            reading them squeezed against the edge was the point of folding away.
            The row keeps its height either way, so the toggle below it stays on
            the line it was on rather than jumping up as the sidebar folds. */}
          <div className='h-[52px] w-full shrink-0 overflow-hidden'>
            {railOpen && <AppNavigator />}
          </div>
          {/* Same 52px and 16px inset as the navigator above. */}
          <div
            className={cn(
              'flex h-[52px] shrink-0 items-center gap-1 border-t border-sidebar-border-muted',
              railOpen ? 'justify-between px-4' : 'justify-center px-2',
            )}
          >
            {/* The toggle leads, so that peeking at a collapsed sidebar puts it
              under the pointer and one click pins it open. */}
            <div className='flex min-w-0 items-center gap-1.5'>
              <button
                type='button'
                onClick={toggleRail}
                title={railCollapsed ? 'Pin the sidebar open' : 'Collapse to icons'}
                aria-label={railCollapsed ? 'Pin the sidebar open' : 'Collapse to icons'}
                className='-ml-1 shrink-0 rounded-md p-1 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
                data-track-category='SdlcHub'
                data-track-name='SidebarRailToggled'
              >
                <PanelLeft className='size-3.5' />
              </button>
              <div
                className={cn(
                  'min-w-0 truncate text-[10.5px] font-semibold uppercase tracking-[0.13em] text-sidebar-foreground/60',
                  !railOpen && 'sr-only',
                )}
              >
                SDLC Hub
              </div>
            </div>
            <div className='flex shrink-0 items-center gap-0.5'>
              {railOpen && (
                <button
                  type='button'
                  onClick={() => setHubDialog('create')}
                  title='New hub'
                  aria-label='New hub'
                  className='rounded-md p-1 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
                  data-track-category='SdlcHub'
                  data-track-name='NewHubOpened'
                >
                  <Plus className='size-3.5' />
                </button>
              )}
              {/* Escape hatch for a wedged frame; only meaningful when framed. */}
              {railOpen && isFramedSdlcSurface() && (
                <button
                  type='button'
                  onClick={requestSdlcFrameReset}
                  title='Reload SDLC Hub — discards this session and reloads the current page'
                  aria-label='Reload SDLC Hub'
                  className='rounded-md p-1 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
                  data-track-category='SdlcHub'
                  data-track-name='FrameReset'
                >
                  <RefreshCw className='h-3.5 w-3.5' aria-hidden='true' />
                </button>
              )}
            </div>
          </div>
          <div className={cn('flex items-center gap-1 px-2 pb-2', !railOpen && 'hidden')}>
            <div className='min-w-0 flex-1'>
              <SdlcHubPicker
                hubs={hubOptions}
                selectedHubId={channel.id}
                onSelect={nextChannelId => void navigate(`/sdlc/${nextChannelId}/overview`)}
              />
            </div>
            {/* Beside the hub it acts on, rather than in a header whose scope is
              whatever the reader has open. */}
            <button
              type='button'
              onClick={() => setMembersDialog(true)}
              title='Members'
              aria-label='Members'
              className='flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
              data-track-category='SdlcHub'
              data-track-name='HeaderMembersClicked'
              data-track-metadata={JSON.stringify({ place: 'hub-picker' })}
            >
              <Users className='size-4' />
            </button>
          </div>
          {railOpen ? (
            <SdlcSidebarFitSection id='sdlc-sidebar-hub' title='Hub'>
              {sectionNavRows}
            </SdlcSidebarFitSection>
          ) : null}
          {railOpen ? (
            <ResizableGroup
              orientation='vertical'
              onLayoutChanged={(_layout, meta) => persistSdlcSectionHeights(meta)}
              className={cn(
                'border-t border-sidebar-border-muted',
                foldedSidebarHeight === null ? 'min-h-0 flex-1' : 'mt-auto box-content shrink-0',
              )}
              {...(foldedSidebarHeight !== null && { style: { height: foldedSidebarHeight } })}
            >
              <SdlcSidebarSection
                id='sdlc-sidebar-tracks'
                title='Tracks'
                count={openTracks.length}
                action={{
                  label: 'New track',
                  trackName: 'NewTrackOpened',
                  onClick: () => setTrackDialog(true),
                }}
              >
                {openTracks.map(track => (
                  <button
                    key={track.id}
                    type='button'
                    onClick={event => openTrack(track.id, event)}
                    {...(selectedTrackId === track.id && { 'aria-current': 'page' as const })}
                    className={cn(
                      'mb-0.5 flex h-[32px] w-full items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-sidebar-foreground transition-colors',
                      selectedTrackId === track.id
                        ? 'bg-foreground/10 font-medium'
                        : 'hover:bg-foreground/[0.06]',
                    )}
                    title={track.description || track.name}
                    data-track-category='SdlcHub'
                    data-track-name='TrackOpened'
                    data-track-metadata={JSON.stringify({ trackId: track.id })}
                  >
                    <Layers size={15} className='shrink-0 text-sidebar-foreground/70' />
                    <span className='flex-1 truncate text-left'>{track.name}</span>
                  </button>
                ))}
                {openTracks.length === 0 && (
                  <p className='px-2 py-3 text-[12.5px] text-sidebar-foreground/50'>
                    No open tracks yet.
                  </p>
                )}
                {/* Finished work is out of the way but not gone — the same place it
                  would be looked for. */}
                {closedTracks.length > 0 && (
                  <>
                    <button
                      type='button'
                      onClick={() => setShowClosedTracks(!showClosedTracks)}
                      className='mt-1 w-full px-2 py-1.5 text-left text-[12px] text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/70'
                      data-track-category='SdlcHub'
                      data-track-name='ClosedTracksToggled'
                    >
                      {showClosedTracks
                        ? 'Hide completed & parked'
                        : `Show ${closedTracks.length} completed & parked`}
                    </button>
                    {showClosedTracks &&
                      closedTracks.map(track => (
                        <button
                          key={track.id}
                          type='button'
                          onClick={event => openTrack(track.id, event)}
                          {...(selectedTrackId === track.id && { 'aria-current': 'page' as const })}
                          className={cn(
                            'mb-0.5 flex h-[32px] w-full items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-sidebar-foreground/60 transition-colors',
                            selectedTrackId === track.id
                              ? 'bg-foreground/10 font-medium'
                              : 'hover:bg-foreground/[0.06]',
                          )}
                          title={track.description || track.name}
                          data-track-category='SdlcHub'
                          data-track-name='TrackOpened'
                          data-track-metadata={JSON.stringify({ trackId: track.id })}
                        >
                          <Layers size={15} className='shrink-0 text-sidebar-foreground/50' />
                          <span className='flex-1 truncate text-left'>{track.name}</span>
                        </button>
                      ))}
                  </>
                )}
              </SdlcSidebarSection>
              <SdlcSidebarSectionSeparator />
              <SdlcSidebarSection
                id='sdlc-sidebar-artifacts'
                title='Artifacts'
                count={typeFolders.length}
                action={{
                  label: 'New artifact type',
                  trackName: 'NewArtifactTypeClicked',
                  onClick: () => {
                    setTypeName('');
                    setTypeDialogOpen(true);
                  },
                }}
              >
                {typeFolders.map(folder => {
                  const isActive = section === 'artifacts' && activeTypeFolder?.id === folder.id;
                  const isRenaming = renameTypeId === folder.id;
                  return (
                    <div
                      key={folder.id}
                      className='group relative mb-0.5'
                      onMouseEnter={() => setHoveredTypeId(folder.id)}
                      onMouseLeave={() =>
                        setHoveredTypeId(current => (current === folder.id ? null : current))
                      }
                    >
                      {isRenaming ? (
                        <div className='flex h-[32px] w-full items-center gap-2.5 px-2'>
                          <Folder size={15} className='shrink-0 text-sidebar-foreground/70' />
                          <input
                            autoFocus
                            onFocus={event => event.currentTarget.select()}
                            value={renameTypeName}
                            onChange={event => setRenameTypeName(event.target.value)}
                            onBlur={() => void renameArtifactType(folder.id, renameTypeName)}
                            onKeyDown={event => {
                              if (event.key === 'Enter')
                                void renameArtifactType(folder.id, renameTypeName);
                              if (event.key === 'Escape') {
                                setRenameTypeId(null);
                                setRenameTypeName('');
                              }
                            }}
                            className='h-6 min-w-0 flex-1 rounded-[6px] border border-sidebar-accent-ring bg-background px-1.5 text-[13.5px] outline-none'
                            data-track-category='SdlcHub'
                            data-track-name='ArtifactTypeRenamed'
                          />
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() =>
                              navigateWithinSdlc(
                                `/sdlc/${channelId}/artifacts`,
                                `?type=${encodeURIComponent(folder.id)}`,
                              )
                            }
                            className={cn(
                              'flex h-[32px] w-full items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-sidebar-foreground transition-colors',
                              isActive
                                ? 'bg-foreground/10 font-medium'
                                : 'group-hover:bg-foreground/[0.06]',
                            )}
                            data-track-category='SdlcHub'
                            data-track-name='SectionChanged'
                            data-track-metadata={JSON.stringify({
                              type: folder.id,
                              channelId: channel.id,
                            })}
                          >
                            <Folder size={15} className='shrink-0 text-sidebar-foreground/70' />
                            <span className='flex-1 truncate text-left'>{folder.name}</span>
                            <span className='w-6 text-right text-xs tabular-nums text-sidebar-foreground/50 transition-opacity group-hover:opacity-0'>
                              {folder.canvases.length}
                            </span>
                          </button>
                          <button
                            type='button'
                            title='Rename (F2)'
                            aria-label={`Rename ${folder.name}`}
                            onClick={event => {
                              event.stopPropagation();
                              setRenameTypeId(folder.id);
                              setRenameTypeName(folder.name);
                            }}
                            className='absolute right-1.5 top-1/2 hidden size-[22px] -translate-y-1/2 items-center justify-center rounded-[5px] text-sidebar-foreground/70 hover:bg-foreground/10 hover:text-sidebar-foreground group-hover:flex'
                            data-track-category='SdlcHub'
                            data-track-name='ArtifactTypeRenameStarted'
                          >
                            <Pencil size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </SdlcSidebarSection>
              <SdlcSidebarSectionSeparator />
              <SdlcSidebarSection
                id='sdlc-sidebar-repositories'
                title='Repositories'
                count={channelRepos.length}
                action={{
                  label: 'Manage repositories',
                  trackName: 'HubRepositoriesOpened',
                  icon: <Settings className='size-3.5' />,
                  onClick: () => setHubDialog('manage'),
                }}
              >
                {channelRepos.map(repository => (
                  <a
                    key={repository.id}
                    href={repository.canonicalUrl || repository.url}
                    target='_blank'
                    rel='noreferrer'
                    className='mb-0.5 flex h-[32px] w-full items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-sidebar-foreground transition-colors hover:bg-foreground/[0.06]'
                    title={repository.canonicalUrl || repository.url}
                    data-track-category='SdlcHub'
                    data-track-name='HubRepositoryOpened'
                    data-track-metadata={JSON.stringify({ repoId: repository.id })}
                  >
                    <GitBranch size={15} className='shrink-0 text-sidebar-foreground/70' />
                    <span className='flex-1 truncate text-left'>{repository.name}</span>
                  </a>
                ))}
                {channelRepos.length === 0 && (
                  <p className='px-2 py-3 text-[12.5px] text-sidebar-foreground/50'>
                    No repositories yet.
                  </p>
                )}
              </SdlcSidebarSection>
              {/* Slack. Panels have to fill the group, so without something here to
                take the leftover height the group refuses to collapse the last
                open section — every section closed is a perfectly reasonable
                thing to want, and this is what allows it.
  
                It claims the whole group by default so that the leftover is *its*
                to give up: with no size of its own it was allotted nothing, and
                the sections above grew to fill the sidebar instead of keeping the
                heights they were told to take. */}
              <Panel id='sdlc-sidebar-slack' minSize='0px' defaultSize='100%' />
            </ResizableGroup>
          ) : null}
        </div>
        {!railCollapsed && (
          <div
            role='separator'
            aria-orientation='vertical'
            aria-label='Resize sidebar'
            onPointerDown={startRailResize}
            className='group absolute inset-y-0 -right-1 z-40 w-2 cursor-col-resize'
            data-track-category='SdlcHub'
            data-track-name='SidebarResized'
          >
            <div
              className={cn(
                'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-primary to-transparent transition-opacity duration-150',
                draggingWidth === null ? 'opacity-0 group-hover:opacity-70' : 'opacity-100',
              )}
              aria-hidden='true'
            />
          </div>
        )}
      </aside>

      <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
        {/* Same 52px band as the sidebar's navigator and hub rows, so the page
            title sits on the line the sidebar headers already establish. */}
        <ResizableGroup
          orientation='horizontal'
          className='min-h-0 flex-1 overflow-hidden'
          autoSaveId='sdlc-chat-shell'
          panelIds={sdlcRightPanelIds(rightPanelOpen)}
        >
          <Panel
            id={SDLC_MAIN_PANEL_ID}
            defaultSize={showRightPanel ? '62%' : '100%'}
            minSize='45%'
            className='flex min-w-0 flex-col overflow-hidden'
          >
            <header className='z-10 flex h-[52px] shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-5 backdrop-blur'>
              <div className='flex min-w-0 flex-1 items-center gap-2'>
                {section === 'wiki' && wikiScope ? (
                  <>
                    <button
                      type='button'
                      onClick={() => navigateWithinSdlc(`/sdlc/${channelId}/wiki`)}
                      className='shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground'
                      data-track-category='SdlcHub'
                      data-track-name='WikiRepositoriesOpened'
                    >
                      Wiki
                    </button>
                    <ChevronRight size={15} className='shrink-0 text-muted-foreground' />
                  </>
                ) : null}
                {section === 'tracks' && openFolder ? (
                  <>
                    <button
                      type='button'
                      onClick={closeFolderPage}
                      title={`Back to ${selectedTrack?.name ?? 'the track'}`}
                      aria-label={`Back to ${selectedTrack?.name ?? 'the track'}`}
                      className='-ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                      data-track-category='SdlcHub'
                      data-track-name='FolderPageClosed'
                    >
                      <ChevronRight size={16} className='rotate-180' />
                    </button>
                    <div
                      ref={setFolderTabsSlot}
                      className='-mr-[10px] flex h-[52px] min-w-0 flex-1 items-stretch'
                    />
                  </>
                ) : selectedCanvasId ? (
                  <>
                    <button
                      type='button'
                      onClick={closeCanvas}
                      className='shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground'
                      data-track-category='SdlcHub'
                      data-track-name='CanvasClosedInline'
                      data-track-metadata={JSON.stringify({ canvasId: selectedCanvasId })}
                    >
                      {section === 'wiki' && wikiScope
                        ? wikiScope.name
                        : (selectedCanvasTypeFolder?.name ??
                          (section === 'artifacts'
                            ? (activeTypeFolder?.name ?? 'Artifacts')
                            : (SECTIONS.find(item => item.id === section)?.label ?? 'Overview')))}
                    </button>
                    <ChevronRight size={15} className='shrink-0 text-muted-foreground' />
                    {section === 'wiki'
                      ? selectedWikiPage?.folderPath
                          .split('/')
                          .filter(Boolean)
                          .map((folder, index) => (
                            <Fragment key={index}>
                              <span className='truncate text-sm text-muted-foreground'>
                                {folder}
                              </span>
                              <ChevronRight size={15} className='shrink-0 text-muted-foreground' />
                            </Fragment>
                          ))
                      : null}
                    <h1 className='truncate font-semibold'>
                      {selectedCanvas?.title ?? selectedWikiPage?.title ?? 'Canvas'}
                    </h1>
                  </>
                ) : section === 'tracks' && selectedTrack ? (
                  <h1 className='truncate font-semibold'>{selectedTrack.name}</h1>
                ) : section === 'wiki' && wikiScope ? (
                  <h1 className='truncate font-semibold'>{wikiScope.name}</h1>
                ) : (
                  <h1 className='font-semibold'>
                    {section === 'artifacts'
                      ? (activeTypeFolder?.name ?? 'Artifacts')
                      : (SECTIONS.find(item => item.id === section)?.label ?? 'Overview')}
                  </h1>
                )}
              </div>
              <div className='flex shrink-0 items-center gap-1.5'>
                {selectedCanvasId && !openFolder && isElectronApp() && !isDocumentWindow ? (
                  <Button
                    size='icon'
                    variant='ghost'
                    className='size-7 rounded-lg'
                    aria-label='Open in new window'
                    title='Open in new window'
                    onClick={() => openCanvasInWindow(selectedCanvasId, true)}
                    data-track-category='SdlcHub'
                    data-track-name='ArtifactOpenedInWindow'
                  >
                    <SquareArrowOutUpRight className='size-4' />
                  </Button>
                ) : null}
                {chatPanelAvailable && !showRightPanel ? (
                  <Button
                    size='icon'
                    variant='ghost'
                    className='size-7 rounded-lg'
                    aria-label='Chat'
                    title='Chat'
                    onClick={() => openConversations()}
                    data-track-category='SdlcHub'
                    data-track-name='OpenSdlcChat'
                    data-track-metadata={JSON.stringify({
                      ownerKind: discussionOwner?.kind ?? null,
                    })}
                  >
                    <MessageCircle className='size-4' />
                  </Button>
                ) : null}
                {/* While the conversation panel is open these live in its own
                    header, beside the conversation they act on. */}
                {showRightPanel ? null : (
                  <div className='flex min-w-0 items-center gap-1.5 overflow-hidden [&_button]:!size-7 [&_button]:!rounded-lg'>
                    {panelScopeActions('header')}
                  </div>
                )}
                {/* Closes the right panel, and only that. Its label and action never
                    depend on whether a thread is open, so the bar does not change
                    under the reader — the thread's own cross lives in the panel. */}
              </div>
            </header>
            <main className='flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
              {openFolder && channel ? (
                <SdlcFolderPage
                  key={openFolder.id}
                  channelId={channel.id}
                  folder={openFolder}
                  rootType={openFolderIsTrack ? 'TRACK' : 'FOLDER'}
                  maps={folderPageMaps}
                  activeTab={activeFolderTab}
                  onOpenTab={tab => openFolderPage(openFolder.id, tab)}
                  onDiscuss={item => {
                    // The chat icon means the same thing on every row: open this
                    // and show its conversations.
                    if (item.type === 'FOLDER') {
                      // The root row of a track's page is the track itself, and
                      // a track's conversations are not a folder's.
                      if (item.id === selectedTrackId) {
                        openConversations();
                        return;
                      }
                      openItemConversations({ type: 'FOLDER', id: item.id, name: item.name });
                      return;
                    }
                    const kind = item.type;
                    openFolderPage(openFolder.id, { kind, id: item.id }, undefined, true);
                  }}
                  discussingId={
                    showRightPanel
                      ? (activeFolderDiscussion?.id ?? discussionOwner?.canvasId ?? null)
                      : null
                  }
                  onNewFolder={parent => setNewFolderParent(folderPageParent(parent))}
                  onAddItem={(tab, parent) => openAddItemDialog(tab, folderPageParent(parent))}
                  tabsContainer={folderTabsSlot}
                  onAddLink={addBrowsedLink}
                  parentFolderOf={parentFolderOf}
                  onMoveItem={(item, parentFolderId) =>
                    void call(
                      `sdlc-move-${item.id}`,
                      () =>
                        moveItemAction(
                          item,
                          parentFolderId === selectedTrackId
                            ? { type: 'TRACK', id: parentFolderId }
                            : { type: 'FOLDER', id: parentFolderId },
                        ),
                      'Moved',
                    )
                  }
                  renderCanvas={canvasId => (
                    <StableCanvasScreen
                      key={canvasId}
                      canvasId={canvasId}
                      showAskAiAction={false}
                    />
                  )}
                />
              ) : selectedCanvasId ? (
                <div className='min-h-0 flex-1 overflow-hidden bg-background'>
                  <StableCanvasScreen
                    key={selectedCanvasId}
                    canvasId={selectedCanvasId}
                    showAskAiAction={false}
                  />
                </div>
              ) : section === 'workflows' ? (
                <div className='min-h-0 flex-1 overflow-hidden bg-background'>
                  <SdlcWorkflowsSection />
                </div>
              ) : (
                <div className='min-h-0 flex-1 overflow-auto bg-background p-7'>
                  {section === 'overview' && (
                    <section>
                      <h1 className='mb-5 text-2xl font-semibold tracking-tight'>{channel.name}</h1>
                      {showAccessWarning && (
                        <div className='mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-foreground'>
                          <CircleAlert className='mt-0.5 size-4 shrink-0 text-amber-500' />
                          <div className='min-w-0'>
                            <h2 className='text-sm font-semibold'>{accessWarning.title}</h2>
                            <p className='mt-0.5 text-sm leading-5 text-muted-foreground'>
                              {accessWarning.description}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className='rounded-xl border bg-background p-5'>
                        <div className='flex items-center justify-between gap-6'>
                          <div className='min-w-0'>
                            <h2 className='text-base font-semibold'>Hub Knowledge</h2>
                            <p className='mt-1 text-sm text-muted-foreground'>
                              Create and approve repository guides used by SDLC Assistant.
                            </p>
                            <p className='mt-2 text-xs text-muted-foreground'>
                              {readyCount} document{readyCount === 1 ? '' : 's'} ready
                            </p>
                          </div>
                          {renderWorkflowControls('Hub Knowledge', state)}
                        </div>
                      </div>
                      <div className='mt-5 grid grid-cols-2 divide-x overflow-hidden rounded-xl border bg-background'>
                        <Metric
                          label='Hub Knowledge ready'
                          value={String(readyCount)}
                          icon={ShieldCheck}
                        />
                        <Metric
                          label='Tickets'
                          value={String(channelTicketCount)}
                          icon={CircleDot}
                        />
                      </div>
                      <SdlcActivityPreview key={channel.id} channelId={channel.id} />
                    </section>
                  )}

                  {section === 'tracks' && renderTrack()}

                  {section === 'knowledge' && (
                    <section className='mx-auto max-w-5xl'>
                      {renderWorkflowHeader({
                        icon: ShieldCheck,
                        title: 'Hub Knowledge',
                        description:
                          'Given to SDLC Assistant in every chat. Admins edit; members read.',
                        workflow: state,
                      })}
                      <div className='mb-4 flex items-center justify-between gap-3'>
                        <Checkbox
                          size='sm'
                          label='Show archived'
                          checked={showArchivedKnowledge}
                          onChange={setShowArchivedKnowledge}
                          data-track-category='SdlcHub'
                          data-track-name='HubKnowledgeArchivedToggled'
                        />
                        {isHubAdmin && knowledgeFolderId && (
                          <Button
                            type='button'
                            size='sm'
                            onClick={() => openHubDocumentCreate('knowledge')}
                            data-track-category='SdlcHub'
                            data-track-name='HubKnowledgeDocCreateOpened'
                          >
                            <Plus size={15} />
                            New document
                          </Button>
                        )}
                      </div>
                      <div className='grid grid-cols-2 gap-4'>
                        {knowledgeDocs.map(canvas => {
                          const generating = canvas.sdlcArtifact?.artifactStatus === 'DRAFT';
                          const archived = canvas.sdlcArtifact?.artifactStatus === 'ARCHIVED';
                          return (
                            <div
                              key={canvas.id}
                              role='button'
                              tabIndex={0}
                              onClick={() => openCanvas(canvas.id)}
                              data-track-category='SdlcHub'
                              data-track-name='HubKnowledgeCanvasOpened'
                              data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                              onKeyDown={event => {
                                // The archive menu lives inside this card.
                                if (event.target !== event.currentTarget) return;
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openCanvas(canvas.id);
                                }
                              }}
                              className={cn(
                                'group cursor-pointer rounded-xl border bg-background p-5 transition-colors hover:border-primary/35 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                archived && 'opacity-60',
                              )}
                            >
                              <div className='flex items-start justify-between gap-2'>
                                <div className='grid size-9 place-items-center rounded-lg bg-primary/10 text-primary'>
                                  <BookOpen size={18} />
                                </div>
                                <div className='flex items-start gap-1'>
                                  {archived ? (
                                    <span className='rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground'>
                                      Archived
                                    </span>
                                  ) : generating ? (
                                    <span className='rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700'>
                                      Generating
                                    </span>
                                  ) : (
                                    <span className='flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300'>
                                      <Check size={12} />
                                      Ready
                                    </span>
                                  )}
                                  {isHubAdmin && (
                                    <SdlcArchiveMenu
                                      title={canvas.title}
                                      archived={archived}
                                      trackingScope='HubKnowledge'
                                      className='-mr-1'
                                      onToggle={next => archiveArtifact(canvas.id, next)}
                                    />
                                  )}
                                </div>
                              </div>
                              <h3 className='mt-4 font-semibold'>{canvas.title}</h3>
                              <p className='mt-1 text-xs text-muted-foreground'>
                                Updated {updatedAtLabel(canvas.lastEditedAt ?? canvas.updatedAt)}
                                {' · '}
                                {typeof canvas.sdlcArtifact?.generationCommit === 'string'
                                  ? canvas.sdlcArtifact.generationCommit.slice(0, 8)
                                  : 'repository HEAD'}
                              </p>
                              <div className='mt-5 flex items-center justify-between gap-3'>
                                <span className='text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground'>
                                  Open document
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        {knowledgeDocs.length === 0 && (
                          <EmptyCard
                            text={
                              knowledgeRunning
                                ? 'Hub Knowledge generation is in progress.'
                                : isHubAdmin
                                  ? 'Start the Hub Knowledge workflow, or add a document yourself.'
                                  : 'Start the Hub Knowledge workflow to generate these documents.'
                            }
                          />
                        )}
                      </div>
                    </section>
                  )}

                  {section === 'wiki' && (
                    <SdlcWikiSection
                      key={wikiScope?.folderId ?? 'repositories'}
                      header={renderWorkflowHeader({
                        icon: BookOpen,
                        title: 'Wiki',
                        description:
                          'A Wiki for each repository, plus Relationships for how they connect.',
                        workflow: wikiState,
                      })}
                      scopes={wikiScopeList}
                      scope={wikiScope}
                      pageCounts={wikiPageCounts}
                      pages={wikiPages}
                      showArchived={showArchivedWiki}
                      onSelectScope={folderId =>
                        navigateWithinSdlc(
                          `/sdlc/${channelId}/wiki`,
                          `?wiki=${encodeURIComponent(folderId)}`,
                        )
                      }
                      onAddRepository={() => setHubDialog('manage')}
                      onShowArchivedChange={setShowArchivedWiki}
                      onOpen={page => openWikiPage(page.canvasId)}
                      canManage={isHubAdmin}
                      onCreatePage={() => openHubDocumentCreate('wiki')}
                      onArchivePage={(page, archived) => archiveArtifact(page.canvasId, archived)}
                    />
                  )}

                  {section === 'artifacts' &&
                    (activeTypeFolder ? (
                      renderArtifacts(activeTypeFolder)
                    ) : (
                      <EmptyCard text='Select an artifact type from the sidebar.' />
                    ))}
                  {section === 'tickets' && (
                    <div className='relative h-[calc(100vh-8rem)] min-h-[36rem]'>
                      <KanbanBoardScreen channelId={channel.id} />
                    </div>
                  )}
                </div>
              )}
            </main>
          </Panel>

          {showRightPanel ? (
            <>
              <Separator className='group flex w-[2px] cursor-col-resize items-center justify-center transition-colors hover:bg-primary/20 active:bg-primary/30'>
                <div className='h-8 w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-primary group-active:bg-primary' />
              </Separator>
              <Panel id={SDLC_CHAT_PANEL_ID} defaultSize='38%' minSize='360px' maxSize='55%'>
                <EntityLinkContext.Provider value={entityLinkScope}>
                  {activeFolderDiscussion ? (
                    <SdlcChatPanel
                      key={`item-${activeFolderDiscussion.type}-${activeFolderDiscussion.id}`}
                      channelId={channel.id}
                      discussion={{
                        ...(repo && { repoId: repo.id }),
                        ownerType: activeFolderDiscussion.type,
                        ownerId: activeFolderDiscussion.id,
                      }}
                      conversationIds={folderConversationIds}
                      selectedConversationId={renderedConversationId}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      onClose={closeConversations}
                      listActions={panelScopeActions('panel')}
                      title={activeFolderDiscussion.name}
                      scopeHeader={{
                        name: activeFolderDiscussion.name,
                        icon: discussionScopeIcon(activeFolderDiscussion),
                        // Only a folder was reached from the track's list, so
                        // only a folder has somewhere to go back to.
                        ...(activeFolderDiscussion.type === 'FOLDER'
                          ? { onExit: () => setFolderDiscussion(null) }
                          : {}),
                      }}
                    />
                  ) : discussionOwner && discussionSurface ? (
                    <SdlcChatPanel
                      key={`discussion-${discussionOwner.canvasId}`}
                      channelId={channel.id}
                      discussion={{
                        ...(repo && { repoId: repo.id }),
                        ownerType: 'CANVAS',
                        ownerId: discussionOwner.canvasId,
                        surfaceType: discussionSurface.type,
                        surfaceId: discussionSurface.id,
                      }}
                      conversationIds={discussionConversationIds}
                      selectedConversationId={renderedConversationId}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      onClose={closeConversations}
                      listActions={panelScopeActions('panel')}
                      title={discussionOwner.title}
                    />
                  ) : section === 'tracks' && selectedTrack ? (
                    <SdlcChatPanel
                      key={`track-${selectedTrack.id}`}
                      channelId={channel.id}
                      discussion={{
                        ...(repo && { repoId: repo.id }),
                        ownerType: 'TRACK',
                        ownerId: selectedTrack.id,
                      }}
                      conversationIds={trackConversationIds}
                      selectedConversationId={renderedConversationId}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      onClose={closeConversations}
                      listActions={panelScopeActions('panel')}
                      title={selectedTrack.name}
                      renderConversationBadge={renderFolderConversationBadge}
                    />
                  ) : null}
                </EntityLinkContext.Provider>
              </Panel>
            </>
          ) : null}
        </ResizableGroup>
      </div>

      {createTicketOpen ? (
        <EntityLinkContext.Provider value={entityLinkScope}>
          <CreateTicketModal
            isOpen={createTicketOpen}
            onClose={() => setCreateTicketOpen(false)}
            channelId={channel.id}
            projectId={channel.projectId ?? repo?.project?.id ?? ''}
            trackSource={createTicketSource}
            onTicketCreated={() => setCreateTicketOpen(false)}
          />
        </EntityLinkContext.Provider>
      ) : null}

      <Dialog
        open={trackDialog}
        onOpenChange={open => !open && setTrackDialog(false)}
        title='New Track'
      >
        <form
          className='p-6'
          onSubmit={event => {
            event.preventDefault();
            void call('track-create', createTrackAction, 'Track created');
          }}
        >
          <h2 className='text-lg font-semibold'>New Track</h2>
          <label htmlFor='sdlc-track-name' className='mt-5 block text-sm font-medium'>
            Name
          </label>
          <input
            id='sdlc-track-name'
            autoFocus
            value={trackName}
            onChange={event => setTrackName(event.target.value)}
            maxLength={120}
            className='mt-2 h-10 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring'
            placeholder='e.g. Payments revamp'
            data-track-category='SdlcHub'
            data-track-name='TrackNameChanged'
          />
          <label htmlFor='sdlc-track-description' className='mt-4 block text-sm font-medium'>
            Description <span className='font-normal text-muted-foreground'>(optional)</span>
          </label>
          <textarea
            id='sdlc-track-description'
            value={trackDescription}
            onChange={event => setTrackDescription(event.target.value)}
            maxLength={2000}
            className='mt-2 min-h-24 w-full rounded-md border bg-background p-3 outline-none focus:ring-2 focus:ring-ring'
            placeholder='What is this workstream about?'
            data-track-category='SdlcHub'
            data-track-name='TrackDescriptionChanged'
          />
          <div className='mt-6 flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={() => setTrackDialog(false)}>
              Cancel
            </Button>
            <Button
              type='submit'
              loading={busy === 'track-create'}
              disabled={!trackName.trim()}
              data-track-category='SdlcHub'
              data-track-name='TrackCreated'
            >
              Create Track
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deriveSource !== null}
        onOpenChange={open => {
          if (!open) {
            setDeriveSource(null);
            setDeriveTypeId(null);
          }
        }}
        title='Create an artifact'
        className='max-w-[520px]'
      >
        <div>
          <div className='flex items-start gap-3 px-6 pb-4 pt-5'>
            <div className='flex flex-1 flex-col gap-0.5'>
              <span className='text-[17px] font-semibold tracking-[-0.01em]'>
                Create an artifact
              </span>
              <span className='text-[12.5px] text-muted-foreground'>
                {channel.name} · {typeFolders.length} types
              </span>
            </div>
            <button
              type='button'
              title='Close'
              aria-label='Close'
              onClick={() => {
                setDeriveSource(null);
                setDeriveTypeId(null);
              }}
              className='flex size-7 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-muted hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='DeriveTypePickerClosed'
            >
              <X size={15} />
            </button>
          </div>
          <div className='h-[280px] overflow-y-auto px-6 pb-3.5'>
            <div className='grid grid-cols-2 gap-2'>
              {typeFolders.map(folder => {
                const picked = deriveTypeId === folder.id;
                return (
                  <button
                    key={folder.id}
                    type='button'
                    onClick={() => setDeriveTypeId(folder.id)}
                    className={cn(
                      'flex h-10 items-center gap-2 rounded-[9px] border px-3 text-left transition-colors',
                      picked ? 'border-primary bg-muted' : 'hover:border-foreground/25',
                    )}
                    data-track-category='SdlcHub'
                    data-track-name='DeriveTypeChosen'
                    data-track-metadata={JSON.stringify({ folderId: folder.id })}
                  >
                    <span className='min-w-0 flex-1 truncate text-[13.5px] font-medium'>
                      {folder.name}
                    </span>
                    {picked && (
                      <span className='flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'>
                        <Check size={9} strokeWidth={3.4} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className='flex items-center gap-2.5 border-t px-6 py-3.5'>
            <span
              className={cn(
                'text-[12.5px]',
                deriveTypeId ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {typeFolders.find(folder => folder.id === deriveTypeId)?.name ??
                'Pick a type to continue'}
            </span>
            <div className='ml-auto flex items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                className='h-[34px]'
                onClick={() => {
                  setDeriveSource(null);
                  setDeriveTypeId(null);
                }}
                data-track-category='SdlcHub'
                data-track-name='DeriveTypePickerCancelled'
              >
                Cancel
              </Button>
              <Button
                type='button'
                className='h-[34px]'
                disabled={!deriveTypeId}
                onClick={() => {
                  const folder = typeFolders.find(item => item.id === deriveTypeId);
                  if (!deriveSource || !folder) return;
                  const source = deriveSource;
                  setDeriveSource(null);
                  setDeriveTypeId(null);
                  openArtifactCreateFrom(folder, source.canvasId);
                }}
                data-track-category='SdlcHub'
                data-track-name='DeriveTypeContinue'
              >
                Continue
                <ArrowRight />
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      <SdlcHubDialog
        projectId={channel.projectId}
        open={hubDialog === 'create'}
        onOpenChange={open => setHubDialog(open ? 'create' : null)}
        onSaved={savedChannelId => void navigate(`/sdlc/${savedChannelId}/overview`)}
      />
      <SdlcHubRepositoriesDialog
        open={hubDialog === 'manage'}
        onOpenChange={open => setHubDialog(open ? 'manage' : null)}
        channelId={channel.id}
        projectId={channel.projectId}
        repositories={channelRepos.map(item => ({
          id: item.id,
          name: item.name,
          url: item.canonicalUrl || item.url,
        }))}
      />

      <Dialog
        open={typeDialogOpen}
        onOpenChange={open => {
          if (!open) {
            setTypeDialogOpen(false);
            setTypeName('');
          }
        }}
        title='New artifact type'
      >
        <form
          className='p-6'
          onSubmit={event => {
            event.preventDefault();
            void call('artifact-type', createArtifactType, 'Artifact type created');
          }}
        >
          <h2 className='text-lg font-semibold'>New artifact type</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Adds a folder to this repo under which you can create artifacts.
          </p>
          <label htmlFor='sdlc-type-name' className='mt-5 block text-sm font-medium'>
            Name
          </label>
          <Input
            id='sdlc-type-name'
            autoFocus
            value={typeName}
            onChange={event => setTypeName(event.target.value)}
            className='mt-2 h-10'
            placeholder='e.g. API Spec, RFC, Runbook'
          />
          <div className='mt-6 flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setTypeDialogOpen(false);
                setTypeName('');
              }}
            >
              Cancel
            </Button>
            <Button type='submit' loading={busy === 'artifact-type'} disabled={!typeName.trim()}>
              <Plus />
              Create type
            </Button>
          </div>
        </form>
      </Dialog>

      {/* One way in for everything a folder can hold. The three journeys differ
          enough to need their own space but not enough to be three doors. */}
      <Dialog
        open={addItemParent !== null || artifactDialog !== null}
        onOpenChange={open => {
          if (!open) closeAddItemDialog();
        }}
        title={addItemParent ? 'Add to folder' : `New ${artifactDialog?.name ?? 'document'}`}
        className='max-w-[860px]'
      >
        <div className='flex max-h-[78vh] min-h-[440px] flex-col'>
          <div className='flex items-center gap-2.5 px-6 pt-5'>
            {!addItemParent ? (
              <AddItemHeaderIcon kind={artifactDialogKind} />
            ) : addItemParent.type === 'FOLDER' ? (
              <Folder className='size-5 shrink-0 fill-primary/25 text-primary/70' />
            ) : (
              <Layers className='size-5 shrink-0 text-muted-foreground' />
            )}
            <div className='min-w-0 flex-1'>
              <h2 className='truncate text-[17px] font-semibold leading-tight tracking-[-0.01em]'>
                {!addItemParent
                  ? `New ${artifactDialog?.name ?? 'document'}`
                  : addItemParent.type === 'FOLDER'
                    ? addItemParent.name
                    : (selectedTrack?.name ?? 'Track')}
              </h2>
              <p className='truncate text-[11.5px] text-muted-foreground'>
                {!addItemParent
                  ? HUB_DOCUMENT_HINT[artifactDialogKind]
                  : addItemParent.type === 'FOLDER'
                    ? `Adding to this folder in ${selectedTrack?.name ?? 'the track'}`
                    : 'Adding to this track'}
              </p>
            </div>
            <button
              type='button'
              title='Close'
              aria-label='Close'
              onClick={closeAddItemDialog}
              className='flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-muted hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='AddItemDialogClosed'
            >
              <X size={15} />
            </button>
          </div>
          {addItemParent && (
            <Tabs
              className='border-b border-border px-6 pb-2.5 pt-4'
              items={[
                { id: 'artifact', label: 'Artifact' },
                { id: 'upload', label: 'Upload files' },
                { id: 'link', label: 'Link' },
              ]}
              activeId={addItemTab}
              onSelect={(id: string) => setAddItemTab(id as 'artifact' | 'upload' | 'link')}
              trackCategory='SdlcHub'
              trackPrefix='AddItemTab'
            />
          )}

          <div className='flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-5'>
            {addItemView === 'artifact' && artifactDialog && (
              <div className='flex flex-1 flex-col'>
                {addItemParent && (
                  <button
                    type='button'
                    onClick={() => resetArtifactDialog()}
                    className='mb-3 flex items-center gap-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground'
                    data-track-category='SdlcHub'
                    data-track-name='ArtifactTypeReopened'
                  >
                    <ChevronRight className='size-3.5 rotate-180' />
                    {artifactDialog.name}
                  </button>
                )}
                {artifactDetailsStep}
              </div>
            )}

            {addItemView === 'artifact' && !artifactDialog && (
              <div className='flex flex-1 flex-col pb-5'>
                <p className='mb-3 text-sm text-muted-foreground'>
                  Choose a type. The details come next.
                </p>
                <div className='grid grid-cols-2 gap-2'>
                  {typeFolders.map(folder => (
                    <button
                      key={folder.id}
                      type='button'
                      onClick={() => {
                        const parent = addItemParent;
                        setPendingArtifactFolder(parent?.type === 'FOLDER' ? parent.id : null);
                        if (selectedTrack) {
                          clearArtifactDialogFields({
                            track: { id: selectedTrack.id, name: selectedTrack.name },
                          });
                        }
                        setArtifactDialog({ id: folder.id, name: folder.name, kind: 'artifact' });
                      }}
                      className='flex w-full items-center gap-3 rounded-xl border border-border px-4 py-3.5 text-left text-sm transition-colors hover:border-foreground/20 hover:bg-muted'
                      data-track-category='SdlcHub'
                      data-track-name='NewArtifactTypeChosen'
                      data-track-metadata={JSON.stringify({ typeId: folder.id })}
                    >
                      <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]'>
                        <FileText className='size-4 text-muted-foreground' />
                      </span>
                      <span className='min-w-0 truncate font-medium'>{folder.name}</span>
                    </button>
                  ))}
                </div>
                {typeFolders.length === 0 && (
                  <p className='py-4 text-center text-sm text-muted-foreground'>
                    No artifact types yet.
                  </p>
                )}
              </div>
            )}

            {addItemView === 'upload' && (
              <div className='flex flex-1 flex-col'>
                <div className='flex flex-1 flex-col pb-5'>
                  <label
                    htmlFor='sdlc-upload-input'
                    className='flex min-h-[240px] flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:bg-foreground/[0.03]'
                    onDragOver={event => event.preventDefault()}
                    onDrop={event => {
                      event.preventDefault();
                      stageUploads(Array.from(event.dataTransfer.files));
                    }}
                  >
                    <Upload className='size-5 text-muted-foreground' />
                    <span className='text-sm font-medium'>Drop files here, or choose them</span>
                    <span className='text-[11.5px] text-muted-foreground'>
                      Documents, spreadsheets, slides, images and video
                    </span>
                  </label>
                  <input
                    id='sdlc-upload-input'
                    type='file'
                    multiple
                    accept={SDLC_UPLOAD_ACCEPT}
                    className='hidden'
                    onChange={event => {
                      const picked = event.target.files;
                      if (picked) stageUploads(Array.from(picked));
                      event.target.value = '';
                    }}
                    data-track-category='SdlcHub'
                    data-track-name='UploadFilesPicked'
                  />
                  {refusedUploads.length > 0 && (
                    <p className='mt-3 text-[11.5px] text-destructive'>
                      {refusedUploads.join(', ')} cannot be added to a hub. Archives, programs and
                      other binaries are not accepted.
                    </p>
                  )}
                  {pendingUploads.length > 0 && (
                    <ul className='mt-3 space-y-1'>
                      {pendingUploads.map((file, index) => (
                        <li
                          key={`${file.name}-${index}`}
                          className='flex items-center gap-2 rounded-md bg-foreground/[0.05] px-2.5 py-1.5 text-[12.5px]'
                        >
                          <FileText className='size-3.5 shrink-0 text-muted-foreground' />
                          <span className='min-w-0 flex-1 truncate'>{file.name}</span>
                          <button
                            type='button'
                            onClick={() =>
                              setPendingUploads(current => current.filter((_, i) => i !== index))
                            }
                            className='shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground'
                            aria-label={`Remove ${file.name}`}
                            data-track-category='SdlcHub'
                            data-track-name='UploadFileRemoved'
                          >
                            <X className='size-3.5' />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className='sticky bottom-0 -mx-6 mt-auto flex justify-end gap-2 rounded-b-lg border-t border-border bg-background px-6 py-3.5'>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={closeAddItemDialog}
                    data-track-category='SdlcHub'
                    data-track-name='UploadCancelled'
                  >
                    Cancel
                  </Button>
                  <Button
                    type='button'
                    disabled={pendingUploads.length === 0}
                    onClick={() =>
                      void call('sdlc-upload', () => uploadFilesAction(pendingUploads), 'Uploaded')
                    }
                    data-track-category='SdlcHub'
                    data-track-name='UploadConfirmed'
                  >
                    {pendingUploads.length > 1 ? `Upload ${pendingUploads.length} files` : 'Upload'}
                  </Button>
                </div>
              </div>
            )}

            {addItemView === 'link' && (
              <form
                className='flex flex-1 flex-col'
                onSubmit={event => {
                  event.preventDefault();
                  if (!linkUrl.trim()) return;
                  void call('sdlc-add-link', addLinkAction, 'Link added');
                }}
              >
                <div className='pb-5'>
                  <label className='mb-1.5 block text-[12.5px] font-medium' htmlFor='sdlc-link-url'>
                    URL
                  </label>
                  <input
                    id='sdlc-link-url'
                    autoFocus
                    value={linkUrl}
                    onChange={event => setLinkUrl(event.target.value)}
                    onBlur={event => void fetchLinkSuggestion(event.target.value)}
                    placeholder='https://'
                    className='mb-4 h-9 w-full rounded-md border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring'
                    data-track-category='SdlcHub'
                    data-track-name='LinkUrlEntered'
                  />
                  <label
                    className='mb-1.5 block text-[12.5px] font-medium'
                    htmlFor='sdlc-link-title'
                  >
                    Title
                  </label>
                  <input
                    id='sdlc-link-title'
                    value={linkTitle}
                    onChange={event => setLinkTitle(event.target.value)}
                    placeholder={linkLoading ? 'Reading the page…' : 'What this link is'}
                    className='h-9 w-full rounded-md border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring'
                    data-track-category='SdlcHub'
                    data-track-name='LinkTitleEdited'
                  />
                  <p className='mt-2 text-[11.5px] text-muted-foreground'>
                    Suggested from the page, and yours to change.
                  </p>
                  {(linkLoading || linkPreview?.favicon || linkPreview?.description) && (
                    <div className='mt-4 flex items-start gap-3 rounded-lg border border-border bg-foreground/[0.03] p-3'>
                      {linkPreview?.favicon ? (
                        <img
                          src={linkPreview.favicon}
                          alt=''
                          className='mt-0.5 size-5 shrink-0 rounded'
                          onError={event => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <Link2 className='mt-0.5 size-5 shrink-0 text-muted-foreground' />
                      )}
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-[13px] font-medium'>
                          {linkTitle || (linkLoading ? 'Reading the page…' : 'Untitled')}
                        </p>
                        <p className='truncate text-[11.5px] text-muted-foreground'>{linkUrl}</p>
                        {linkPreview?.description && (
                          <p className='mt-1 line-clamp-2 text-[11.5px] text-muted-foreground'>
                            {linkPreview.description}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className='flex-1' />
                <div className='sticky bottom-0 -mx-6 mt-auto flex justify-end gap-2 rounded-b-lg border-t border-border bg-background px-6 py-3.5'>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={closeAddItemDialog}
                    data-track-category='SdlcHub'
                    data-track-name='AddLinkCancelled'
                  >
                    Cancel
                  </Button>
                  <Button
                    type='submit'
                    disabled={!linkUrl.trim()}
                    data-track-category='SdlcHub'
                    data-track-name='LinkAdded'
                  >
                    Add link
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={newFolderParent !== null}
        onOpenChange={open => {
          if (!open) {
            setNewFolderParent(null);
            returnFocusToFinder();
            setNewFolderName('');
          }
        }}
        title='New folder'
      >
        <form
          className='p-6'
          onSubmit={event => {
            event.preventDefault();
            void call('sdlc-folder', createFolderAction, 'Folder created');
          }}
        >
          <h2 className='text-lg font-semibold'>New folder</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            {newFolderParent?.type === 'TRACK'
              ? `Groups artifacts at the top of ${newFolderParent.name}.`
              : `Nested inside ${newFolderParent?.name ?? ''}.`}
          </p>
          <label htmlFor='sdlc-folder-name' className='mt-5 block text-sm font-medium'>
            Name
          </label>
          <Input
            id='sdlc-folder-name'
            autoFocus
            value={newFolderName}
            onChange={event => setNewFolderName(event.target.value)}
            className='mt-2 h-10'
            placeholder='e.g. Hub split, Approved, Archive'
            maxLength={TRACK_NAME_LIMIT}
          />
          <div className='mt-6 flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setNewFolderParent(null);
                returnFocusToFinder();
                setNewFolderName('');
              }}
              data-track-category='SdlcHub'
              data-track-name='NewFolderCancelled'
            >
              Cancel
            </Button>
            <Button
              type='submit'
              loading={busy === 'sdlc-folder'}
              disabled={!newFolderName.trim()}
              data-track-category='SdlcHub'
              data-track-name='NewFolderCreated'
            >
              <Plus />
              Create folder
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Reading an artifact without leaving the browser. Two thirds of the width,
          so the columns stay visible and the reader is still a comfortable
          measure. */}
      {readerCanvasId && (
        <div className='fixed inset-0 z-50 flex' role='dialog' aria-modal='true'>
          <button
            type='button'
            aria-label='Close preview'
            onClick={closeReader}
            className={cn(
              'flex-1 bg-black/50 backdrop-blur-sm duration-200',
              readerClosing ? 'animate-out fade-out' : 'animate-in fade-in',
            )}
            data-track-category='SdlcHub'
            data-track-name='ArtifactReaderDismissed'
          />
          <div
            className={cn(
              'flex h-full w-2/3 min-w-[520px] flex-col border-l border-border bg-background shadow-2xl duration-200 ease-out motion-reduce:animate-none',
              readerClosing ? 'animate-out slide-out-to-right' : 'animate-in slide-in-from-right',
            )}
          >
            <div className='flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4'>
              <span className='min-w-0 flex-1 truncate text-[13px] font-semibold'>
                {canvases.find(canvas => canvas.id === readerCanvasId)?.title ?? 'Artifact'}
              </span>
              {/* Icons: this bar sits directly above the canvas's own toolbar, and
                  two worded buttons made the two rows compete. */}
              <button
                type='button'
                onClick={event => {
                  const id = readerCanvasId;
                  closeReader();
                  openCanvas(id, { event });
                }}
                title='Open in a new window'
                aria-label='Open in a new window'
                className='rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                data-track-category='SdlcHub'
                data-track-name='ArtifactReaderOpenedInWindow'
              >
                <ExternalLink className='size-4' />
              </button>
              <button
                type='button'
                onClick={() => {
                  const id = readerCanvasId;
                  closeReader();
                  openCanvas(id);
                }}
                title='Open the artifact'
                aria-label='Open the artifact'
                className='rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                data-track-category='SdlcHub'
                data-track-name='ArtifactReaderOpened'
              >
                <Maximize2 className='size-4' />
              </button>
              <button
                type='button'
                onClick={closeReader}
                aria-label='Close'
                className='-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                data-track-category='SdlcHub'
                data-track-name='ArtifactReaderClosed'
              >
                <X className='size-4' />
              </button>
            </div>
            <div className='min-h-0 flex-1 overflow-hidden'>
              <StableCanvasScreen
                key={readerCanvasId}
                canvasId={readerCanvasId}
                showAskAiAction={false}
              />
            </div>
          </div>
        </div>
      )}

      <Dialog open={linkDialog} onOpenChange={setLinkDialog} title='Link context'>
        <div className='p-6'>
          <h2 className='text-lg font-semibold'>Link related context</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Search existing Xyne context. Only accessible entities are accepted.
          </p>
          <div className='mt-5 rounded-lg border bg-muted/30 px-3 py-2'>
            <div className='text-xs text-muted-foreground'>Linking to</div>
            <div className='mt-0.5 truncate text-sm font-medium'>
              {relatedCanvas?.title || 'Selected canvas'}
            </div>
          </div>
          <div className={cn('mt-4', !relatedSourceId && 'pointer-events-none opacity-50')}>
            <ContextPickerPanel
              initialSelections={EMPTY_CONTEXT_SELECTIONS}
              onConfirm={linkPickedContext}
              onClose={() => setLinkDialog(false)}
            />
          </div>
          <details className='mt-4 rounded-lg border p-3'>
            <summary className='cursor-pointer text-sm font-medium'>
              Link by stable entity ID
            </summary>
            <form
              className='mt-3'
              onSubmit={event => {
                event.preventDefault();
                if (!relatedSourceId || !linkTargetId) return;
                void call(
                  'link',
                  async () => {
                    await apiInstance.post('/sdlc/claw/links', {
                      channelId,
                      sourceType: 'CANVAS',
                      sourceId: relatedSourceId,
                      targetType: linkTargetType,
                      targetId: linkTargetId,
                      relationType: 'CONTEXT',
                    });
                    setLinkDialog(false);
                    setLinkTargetId('');
                  },
                  'Context linked',
                );
              }}
            >
              <label htmlFor='sdlc-link-target-type' className='block text-sm font-medium'>
                Context type
              </label>
              <select
                id='sdlc-link-target-type'
                value={linkTargetType}
                onChange={event => setLinkTargetType(event.target.value)}
                className='mt-2 h-10 w-full rounded-md border bg-background px-3'
                data-track-category='SdlcHub'
                data-track-name='LinkTypeChanged'
              >
                {[
                  'MESSAGE',
                  'CONVERSATION',
                  'EMAIL',
                  'CALL',
                  'RECORDING',
                  'ATTACHMENT',
                  'CANVAS',
                  'TICKET',
                  'CHANNEL',
                  'PULL_REQUEST',
                ].map(type => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <label htmlFor='sdlc-link-target-id' className='mt-4 block text-sm font-medium'>
                Entity ID
              </label>
              <input
                id='sdlc-link-target-id'
                value={linkTargetId}
                onChange={event => setLinkTargetId(event.target.value)}
                className='mt-2 h-10 w-full rounded-md border bg-background px-3'
                placeholder='Paste stable entity ID'
                data-track-category='SdlcHub'
                data-track-name='LinkTargetChanged'
              />
              <div className='mt-4 flex justify-end'>
                <Button
                  type='submit'
                  loading={busy === 'link'}
                  disabled={!relatedSourceId || !linkTargetId}
                >
                  Link ID
                </Button>
              </div>
            </form>
          </details>
        </div>
      </Dialog>

      <Dialog
        open={membersDialog}
        onOpenChange={setMembersDialog}
        title='Repository members'
        className='max-w-2xl'
      >
        <Info
          channel={channel as unknown as VisibleChannel}
          defaultTab='members'
          onClose={() => setMembersDialog(false)}
        />
      </Dialog>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactElement | undefined;
}): ReactElement {
  return (
    <div className='mb-6 flex items-end justify-between'>
      <div>
        <h2 className='text-2xl font-semibold'>{title}</h2>
        <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
      </div>
      {action}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: typeof Boxes;
}): ReactElement {
  const Icon = icon;
  return (
    <div className='p-4'>
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <Icon size={15} />
        <span className='truncate'>{label}</span>
      </div>
      <div className='mt-2 text-2xl font-semibold'>{value}</div>
    </div>
  );
}

const WORKFLOW_PHASE_LABEL: Record<HubWorkflowPhase, string> = {
  NOT_CONFIGURED: 'Not set up',
  NOT_STARTED: 'Not run yet',
  RUNNING: 'Running',
  READY: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

function WorkflowStatusIcon({
  workflow,
}: {
  workflow: Pick<HubWorkflow, 'phase' | 'updatedAt'>;
}): ReactElement {
  const { phase, updatedAt } = workflow;
  const Icon =
    phase === 'RUNNING'
      ? Loader2
      : phase === 'READY'
        ? Check
        : phase === 'FAILED'
          ? CircleAlert
          : CircleDot;
  const label =
    typeof updatedAt === 'number'
      ? `${WORKFLOW_PHASE_LABEL[phase]} · ${formatRelativeTime(updatedAt)}`
      : WORKFLOW_PHASE_LABEL[phase];
  return (
    <Tooltip content={label}>
      <span
        role='img'
        aria-label={label}
        className={cn(
          'grid size-8 place-items-center rounded-full',
          phase === 'RUNNING'
            ? 'text-amber-600'
            : phase === 'READY'
              ? 'text-emerald-600'
              : phase === 'FAILED'
                ? 'text-destructive'
                : 'text-muted-foreground',
        )}
      >
        <Icon size={16} className={cn(phase === 'RUNNING' && 'animate-spin')} />
      </span>
    </Tooltip>
  );
}

function EmptyCard({ text }: { text: string }): ReactElement {
  return (
    <div className='col-span-2 rounded-xl border border-dashed bg-background p-10 text-center text-sm text-muted-foreground'>
      {text}
    </div>
  );
}

function ArtifactCard({
  title,
  eyebrow,
  meta,
  onOpen,
  onAction,
  onCreateTicket,
  actionLabel,
  createdBy,
  createdAt,
}: {
  title: string;
  eyebrow: string;
  meta?: string[];
  onOpen: (event?: ReactMouseEvent) => void;
  onAction: () => void;
  onCreateTicket: () => void;
  actionLabel: string;
  createdBy: string;
  createdAt: number;
}): ReactElement {
  const creator = useUser(createdBy);
  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onOpen}
      data-track-category='SdlcHub'
      data-track-name='ArtifactCanvasOpened'
      data-track-metadata={JSON.stringify({ title, artifactKind: eyebrow })}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className='group cursor-pointer rounded-xl border bg-background p-5 transition-colors hover:border-primary/35 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      {/* Ancestry breadcrumb: Track (always) • PRD (when present) • current type. */}
      <div className='flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em]'>
        {meta?.map(segment => (
          <span key={segment} className='flex min-w-0 items-center gap-2'>
            <span className='max-w-[220px] truncate text-muted-foreground' title={segment}>
              {segment}
            </span>
            <span aria-hidden='true' className='text-muted-foreground'>
              •
            </span>
          </span>
        ))}
        <span className='shrink-0 text-primary'>{eyebrow}</span>
      </div>
      <h3 className='mt-3 font-semibold'>{title}</h3>
      <div className='mt-2 flex items-center gap-1.5 text-xs text-muted-foreground'>
        <Avatar userId={createdBy} size='xs' showActiveStatus={false} />
        <span className='truncate'>{creator?.name ?? 'Unknown'}</span>
        <span aria-hidden='true'>·</span>
        <span className='shrink-0'>created {formatRelativeTime(createdAt)}</span>
      </div>
      <div className='mt-6 flex items-center justify-between gap-3'>
        <span className='text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground'>
          Open document
        </span>
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            onKeyDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onCreateTicket();
            }}
          >
            Create Ticket
          </Button>
          <Button
            size='sm'
            onKeyDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onAction();
            }}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
