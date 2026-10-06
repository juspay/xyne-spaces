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
import {
  ChannelRole,
  ChannelType,
  SDLC_HUB_KNOWLEDGE_FOLDER,
  SDLC_WIKI_FOLDER,
  type SdlcCallLink,
  SDLC_UPLOAD_ACCEPT,
  isAllowedSdlcUpload,
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
  Phone,
  Link2,
  Loader2,
  Maximize2,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  Upload,
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
  SdlcHubHeader,
  SdlcSidebarAddRow,
  SdlcSidebarGroup,
  SdlcSidebarRow,
  SdlcSidebarRowIcon,
  sdlcSidebarRowClass,
} from './SdlcHubSidebar';
import { SdlcHubSwitcher } from './SdlcHubSwitcher';
import { setUserPreference, useUserPreference } from '../../machines/userPreferencesMachine';
import { isSdlcDocumentWindow } from './useSdlcFrameBridge';
import { toast } from 'sonner';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { FolderDefault, PhoneDefault, TicketToken } from '@xyne/icons';
import { IconPicker } from '../../components/AppIcon/IconPicker';
import { AppIcon } from '../../components/AppIcon/AppIcon';
import { TRACK_ICON_GROUPS } from './trackIcons';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { CreateTicketModal } from '../../components/Tickets/CreateTicketModal/CreateTicketModal';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import { Panel, ResizableGroup, Separator } from '../../components/ui/Resizable/Resizable';
import { v4 as uuidv4 } from 'uuid';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAllVisibleChannels } from '../../hooks/useChannels';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { SdlcChatPanel } from './SdlcChatPanel';
import { CallParticipantsSelectionModal } from '../../components/Call/CallParticipantsSelectionModal';
import { useAuthContextValues } from '../../hooks/useAuth';
import { xyneAIActor, type ThreadInfo } from '../../machines/xyneAIMachine';
import { apiInstance } from '../../services/clients/apiClient';
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
import { useSdlcWikiData } from './useSdlcWikiData';
import SdlcWorkflowsSection from './SdlcWorkflowsSection';
import { SdlcReleases } from './SdlcReleases/SdlcReleases';
import { SdlcReleaseBreadcrumb, SdlcReleaseThread } from './SdlcReleases/SdlcReleaseDetail';
import { useReleaseThreadAccess } from './SdlcReleases/useSdlcReleases';
import { ThreadNavigationContext } from '../../components/Chat/ThreadNavigationContext';
import { SdlcActivityPreview } from './SdlcActivityPreview';
import { EntityLinkContext, type EntityLinkScope } from '../../contexts/EntityLinkContext';
import { useScope, useShortcutById } from '../../shortcuts';
import { resolveSdlcDiscussionContext, type HubArtifactSummary } from './sdlcDiscussionModel';
import type { ConversationBadgeSubject } from '../../components/Chat/ConversationPannel/ConversationBadgeContext';
import type { DiscussionScope } from '../../components/Chat/ConversationPannel/DiscussionListContext';
import {
  SDLC_CHAT_PANEL_ID,
  SDLC_MAIN_PANEL_ID,
  sdlcChatLayout,
  sdlcChatNavigationSearch,
  parseSdlcDiscussionItem,
  SDLC_ABOUT_PARAM,
  SDLC_THREAD_ONLY_PARAM,
  sdlcDiscussionItemParam,
  sdlcRightPanelIds,
  shouldCloseInvalidSdlcConversationDeepLink,
  type SdlcDiscussionItemRef,
  shouldStartFreshSdlcAssistant,
} from './sdlcChatPolicy';
import { formatRelativeTime } from '../../utils/dateUtils';
import Avatar from '../../components/ui/Avatar/Avatar';
import { useUser } from '../../hooks/useUsers';
import { Popover } from '../../components/ui/Popover';
import { Tooltip } from '../../components/ui/Tooltip';
import { fileKind } from './fileKind';
import { FileTypeIcon } from './FileTypeIcon';
import { getLastSdlcLocation, sdlcHubIdOf } from './lastSdlcLocation';
import { SdlcFolderPage, SCRATCH_TAB_ID, type FolderTab } from './SdlcFolderPage';
import { setSdlcCommentContext } from './sdlcCommentStore';
import { publishPendingPassage, registerSelectionSink } from '../../components/workspaceItems';

/** What in a track a conversation can be filed against, beside the track itself. */
interface SdlcItemDiscussion {
  type: 'FOLDER' | 'LINK' | 'ATTACHMENT' | 'CANVAS';
  id: string;
  name: string;
}
/** What a call is started in, and its name in the picker: nothing in scope is the hub. */
interface SdlcCallScope {
  link: SdlcCallLink | null;
  name: string;
}
const DISCUSSION_OWNER_TYPES = ['CANVAS', 'TRACK', 'FOLDER', 'ATTACHMENT', 'LINK'] as const;
type DiscussionOwnerType = (typeof DISCUSSION_OWNER_TYPES)[number];
const isDiscussionOwnerType = (value: string): value is DiscussionOwnerType =>
  DISCUSSION_OWNER_TYPES.some(type => type === value);

/**
 * The fields of a canvas row the screen reads. getCanvas comes back untyped — its
 * visibility filter is typed loosely — so its row is checked rather than trusted.
 */
function canvasRowOf(row: unknown): { id: string; title: string; folderId: string | null } | null {
  if (typeof row !== 'object' || row === null) return null;
  if (!('id' in row) || typeof row.id !== 'string') return null;
  if (!('title' in row) || typeof row.title !== 'string') return null;
  const folderId = 'folderId' in row && typeof row.folderId === 'string' ? row.folderId : null;
  return { id: row.id, title: row.title, folderId };
}

/** An item's mark where a discussion names it: its chosen icon, favicon or file type. */
function discussedItemIcon(item: SdlcTrackItem, className: string): ReactNode {
  if (item.kind === 'FOLDER') {
    return item.icon ? (
      <AppIcon name={item.icon} size={11} aria-hidden='true' />
    ) : (
      <Folder className={`${className} fill-primary/25 text-primary/70`} />
    );
  }
  if (item.kind === 'LINK') {
    return item.favicon ? (
      <img src={item.favicon} alt='' className={`${className} rounded-[2px]`} />
    ) : (
      <Link2 className={className} />
    );
  }
  if (item.kind === 'ATTACHMENT') {
    return <FileTypeIcon kind={fileKind(item.mimetype, item.name)} bare className={className} />;
  }
  return <FileText className={`${className} text-muted-foreground`} />;
}
/** Named by kind until the item itself has loaded. */
const DISCUSSION_ITEM_FALLBACK_NAME: Record<SdlcItemDiscussion['type'], string> = {
  FOLDER: 'Folder',
  LINK: 'Link',
  ATTACHMENT: 'File',
  CANVAS: 'Artifact',
};
/** A scope nothing belongs to, for a panel whose subject hasn't resolved yet. */
const NO_DISCUSSIONS: DiscussionScope = { ownerIds: [] };
import { SdlcFileList } from './SdlcFileList';
import { SdlcCalls } from './SdlcCalls';
import { ActivityPill, isPartOfCall, type SdlcLiveCalls } from './ActivityPill';
import {
  SDLC_FILES_FOLDER_PARAM,
  sdlcItemName,
  sdlcItemPlacement,
  sourceItemOf,
  targetItemOf,
  type SdlcFilesLocation,
  type SdlcItemKind,
  type SdlcSourceLink,
  type SdlcTrackItem,
} from './sdlcItems';
import { type HubWorkflow, type HubWorkflowPhase, useHubWorkflow } from './hubWorkflowRunPolicy';

type Section =
  | 'overview'
  | 'wiki'
  | 'knowledge'
  | 'tracks'
  | 'tickets'
  | 'calls'
  | 'releases'
  | 'artifacts'
  | 'workflows';

const StableCanvasScreen = memo(CanvasScreen);

const SECTIONS: Array<{ id: Exclude<Section, 'artifacts'>; label: string; icon: typeof Boxes }> = [
  { id: 'overview', label: 'Overview', icon: Boxes },
  { id: 'wiki', label: 'Wiki', icon: BookOpen },
  { id: 'knowledge', label: 'Hub Knowledge', icon: ShieldCheck },
  { id: 'tickets', label: 'Issues', icon: CircleDot },
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'releases', label: 'Releases', icon: Rocket },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
];

function sizeNameFieldToText(input: HTMLInputElement): void {
  const mirror = input.parentElement?.querySelector('[data-name-mirror]');
  if (!(mirror instanceof HTMLElement)) return;
  mirror.textContent = input.value || ' ';
  input.style.width = `${Math.ceil(mirror.getBoundingClientRect().width) + 2}px`;
}

const READER_EXIT_MS = 200;

const TRACK_NAME_LIMIT = 120;

/** A track's page is split the way a channel's is: one tab per kind of thing it holds. */
const TRACK_TABS = [
  { value: 'files', label: 'Files', icon: <FolderDefault size={14} /> },
  { value: 'tickets', label: 'Tickets', icon: <TicketToken size={14} /> },
  { value: 'calls', label: 'Calls', icon: <PhoneDefault size={14} /> },
] as const;
type TrackTab = (typeof TRACK_TABS)[number]['value'];

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COLLAPSE_AT = 150;
const SIDEBAR_RAIL_WIDTH = 52;
const SIDEBAR_HOVER_WIDTH = 280;

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
  const openReleaseId = section === 'releases' ? routeSearchParams.get('release') : null;
  // In the URL, as a channel's tab is, so a link or a reload lands on the same tab. Not
  // `tab`: the channel's conversation panel beside it reads that one.
  const trackTab: TrackTab =
    TRACK_TABS.find(tab => tab.value === routeSearchParams.get('trackTab'))?.value ?? 'files';
  const openTrackTab = (tab: TrackTab): void => {
    const next = new URLSearchParams(location.search);
    // Files is where a track opens, so it needs no param.
    if (tab === 'files') next.delete('trackTab');
    else next.set('trackTab', tab);
    const search = next.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`);
  };
  // Your hubs: the channels the app loaded at start, so no query of their own.
  const visibleChannels = useAllVisibleChannels();
  const channels = useMemo(
    () =>
      visibleChannels
        .filter(item => item.type === ChannelType.SDLC && !item.isArchived)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [visibleChannels],
  );
  const [channelRow, repoQueryDetails] = useCachedQuery(
    queries.getSdlcHub({ channelId: channelId || '' }),
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
  const hubOptions = useMemo(
    () => channels.map(item => ({ id: item.id, name: item.name, visibility: item.visibility })),
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
  // Each with its title, from the search hit or the artifact it was started from.
  const [relatedCanvases, setRelatedCanvases] = useState<Array<{ id: string; title: string }>>([]);
  const relatedCanvasIds = useMemo(
    () => relatedCanvases.map(canvas => canvas.id),
    [relatedCanvases],
  );
  const [relatedSearchQuery, setRelatedSearchQuery] = useState('');
  // What the search found, before the track filter: which track each is in comes from
  // looking them up by id.
  const [relatedSearchHits, setRelatedSearchHits] = useState<Array<{ id: string; title: string }>>(
    [],
  );
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
  const [hubSwitcherOpen, setHubSwitcherOpen] = useState(false);
  const setShowClosedTracks = (next: boolean): void =>
    setUserPreference('sdlcShowClosedTracks', next);
  const railCollapsed = useUserPreference('sdlcSidebarCollapsed');
  const storedRailWidth = useUserPreference('sdlcSidebarWidth');
  const [railHovered, setRailHovered] = useState(false);
  const fileListRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [sidebarFocused, setSidebarFocused] = useState(false);
  // A dialog or the reader opened from the file list hands the keyboard back to it
  // when it closes, so the cursor is where it was.
  const fileListFocusReturn = useRef(false);
  const rememberFileListFocus = (): void => {
    fileListFocusReturn.current = fileListRef.current?.contains(document.activeElement) ?? false;
  };
  const returnFocusToFileList = (): void => {
    if (!fileListFocusReturn.current) return;
    fileListFocusReturn.current = false;
    requestAnimationFrame(() => fileListRef.current?.focus());
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
  // ⌘J; ⌘K stays the app's global search.
  useShortcutById('sdlc.switchHub', () => setHubSwitcherOpen(open => !open));
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
  const focusFileList = (): void => {
    fileListRef.current?.focus();
  };
  // The file list and the tickets are on different tabs of a track. The tickets
  // shortcut opens their tab; the files one also puts the keyboard on the list, once
  // it is drawn.
  const pendingTrackTabFocus = useRef<TrackTab | null>(null);
  const onATrack = section === 'tracks' && routeSearchParams.has('track');
  useShortcutById('sdlc.focusTickets', () => {
    if (onATrack && trackTab !== 'tickets') openTrackTab('tickets');
  });
  useShortcutById('sdlc.focusFiles', () => {
    if (onATrack && trackTab !== 'files') {
      pendingTrackTabFocus.current = 'files';
      openTrackTab('files');
      return;
    }
    focusFileList();
  });
  useEffect(() => {
    if (pendingTrackTabFocus.current !== trackTab) return;
    pendingTrackTabFocus.current = null;
    if (trackTab === 'files') focusFileList();
    // Only a tab change can land a pending focus; the helpers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackTab]);
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
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameAbandoned = useRef(false);
  // The track page's tab row has no rule until the tab's content scrolls under it.
  const [trackPageScrolled, setTrackPageScrolled] = useState(false);
  const [readerCanvasId, setReaderCanvasId] = useState<string | null>(null);
  // Its title, from the file list row it was opened from.
  const [readerTitle, setReaderTitle] = useState('');
  const [readerClosing, setReaderClosing] = useState(false);

  const closeReader = (): void => {
    setReaderClosing(true);
    window.setTimeout(() => {
      setReaderCanvasId(null);
      setReaderClosing(false);
      returnFocusToFileList();
    }, READER_EXIT_MS);
  };
  useShortcutById('files.closePreview', () => closeReader(), {
    enabled: readerCanvasId !== null && !readerClosing,
  });
  // A folder, link or file whose conversations the panel shows — from the url, so a
  // reload or a new tab opens on the same ones. Its name comes once the items load.
  const discussionItemRef = useMemo(
    () => parseSdlcDiscussionItem(routeSearchParams.get(SDLC_ABOUT_PARAM)),
    [routeSearchParams],
  );
  const [newFolderParent, setNewFolderParent] = useState<SdlcFilesLocation | null>(null);
  // An item being opened from a discussion about it, until the lookup says where it is.
  const [pendingOpen, setPendingOpen] = useState<{
    item: SdlcDiscussionItemRef;
    name: string;
    /** The conversation on show, kept open beside the item. */
    conversationId: string | null;
  } | null>(null);
  const [addItemParent, setAddItemParent] = useState<SdlcFilesLocation | null>(null);
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
  // State, not a ref: the folder page only portals its tabs once the node exists.
  const [folderTabsSlot, setFolderTabsSlot] = useState<HTMLElement | null>(null);
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  // The call being set up, and where: fixed when the picker opens, so what's on screen
  // moving underneath it can't change where the call goes.
  const [callPicker, setCallPicker] = useState<SdlcCallScope | null>(null);
  // Which surface opened the create form; rides on CREATE_TICKET_SUCCEEDED.
  const [createTicketSource, setCreateTicketSource] = useState('sdlc_header');
  const [relatedSourceId, setRelatedSourceId] = useState<string | null>(null);
  const [linkTargetType, setLinkTargetType] = useState('MESSAGE');
  const [linkTargetId, setLinkTargetId] = useState('');
  const automaticAccessChecksRef = useRef(new Set<string>());
  const { selectedAgentSlug, setSelectedAgentSlug } = useSelectedAgent();

  useEffect(() => {
    if (channelId || !workspaceId) return;
    const fallbackId = channels[0]?.id;
    if (!fallbackId) return;
    const storedPath = getLastSdlcLocation(workspaceId);
    const stored = channels.find(item => item.id === (storedPath ? sdlcHubIdOf(storedPath) : null));
    void navigate(`/sdlc/${stored?.id ?? fallbackId}/overview`, { replace: true });
  }, [navigate, channelId, channels, workspaceId]);

  const selectedDiscussionConversationId = routeSearchParams.get('conversation');
  const threadOnly = Boolean(
    selectedDiscussionConversationId && routeSearchParams.get(SDLC_THREAD_ONLY_PARAM),
  );
  // The open conversation, as the panel loads it, with the item it is filed on — the
  // same query, so it is fetched once.
  const [selectedConversationRow, selectedConversationDetails] = useCachedQuery(
    queries.sdlcDiscussionConversation({
      channelId: channelId || '',
      conversationId: selectedDiscussionConversationId || '',
    }),
    { enabled: Boolean(channelId && selectedDiscussionConversationId) },
  );
  const conversationOwner = selectedConversationRow?.sdlcEntityLinks[0] ?? null;
  const knowledgeFolderId = useMemo(
    () =>
      (channel?.canvasFolders ?? []).find(folder => folder.name === SDLC_HUB_KNOWLEDGE_FOLDER)
        ?.id ?? null,
    [channel],
  );
  const selectedCanvasId = routeSearchParams.get('canvas');
  const activeTypeFolderId = routeSearchParams.get('type');
  // The hub's artifacts load a folder at a time, with the page that shows them. Hub
  // Knowledge's load on its own page and the Overview, which counts those ready.
  const knowledgeShown = section === 'knowledge' || section === 'overview';
  const [knowledgeRows] = useCachedQuery(
    queries.getSdlcFolderCanvases({
      channelId: channelId || '',
      folderId: knowledgeFolderId || '',
    }),
    { enabled: Boolean(channelId && knowledgeFolderId) && knowledgeShown },
  );
  const [typeFolderRows, typeFolderDetails] = useCachedQuery(
    queries.getSdlcFolderCanvases({
      channelId: channelId || '',
      folderId: activeTypeFolderId || '',
    }),
    { enabled: Boolean(channelId && activeTypeFolderId) && section === 'artifacts' },
  );
  const typeFolderCanvases = useMemo(
    () => (activeTypeFolderId && Array.isArray(typeFolderRows) ? typeFolderRows : []),
    [activeTypeFolderId, typeFolderRows],
  );
  const canvases = useMemo(() => {
    const byId = new Map<string, (typeof typeFolderCanvases)[number]>();
    for (const rows of [knowledgeShown ? knowledgeRows : [], typeFolderCanvases]) {
      for (const canvas of Array.isArray(rows) ? rows : []) byId.set(canvas.id, canvas);
    }
    return [...byId.values()];
  }, [knowledgeShown, knowledgeRows, typeFolderCanvases]);
  // What kind of document each of the hub's folders holds. A canvas is one of the hub's
  // artifacts when it is filed in one of them.
  const hubFolderKinds = useMemo(
    () =>
      new Map(
        (channel?.canvasFolders ?? []).map(
          folder =>
            [
              folder.id,
              folder.name === SDLC_HUB_KNOWLEDGE_FOLDER
                ? 'HUB_KNOWLEDGE'
                : folder.name === SDLC_WIKI_FOLDER
                  ? 'WIKI'
                  : 'PIPELINE',
            ] as const,
        ),
      ),
    [channel],
  );
  const hubArtifactOf = useCallback(
    (
      canvas: { id: string; title: string; folderId?: string | null } | null | undefined,
    ): (HubArtifactSummary & { folderId: string }) | null => {
      const kind = canvas?.folderId ? hubFolderKinds.get(canvas.folderId) : undefined;
      return canvas?.folderId && kind
        ? { id: canvas.id, title: canvas.title, kind, folderId: canvas.folderId }
        : null;
    },
    [hubFolderKinds],
  );
  // The open canvas, from the query its editor runs for it anyway.
  const [openCanvasRow] = useCachedQuery(queries.getCanvas({ canvasId: selectedCanvasId || '' }), {
    enabled: Boolean(selectedCanvasId),
  });
  const selectedCanvas = useMemo(() => {
    const row = canvasRowOf(openCanvasRow);
    return row && row.id === selectedCanvasId ? (hubArtifactOf(row) ?? undefined) : undefined;
  }, [openCanvasRow, selectedCanvasId, hubArtifactOf]);
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
  const [trackRows] = useCachedQuery(queries.getSdlcTracks({ channelId: channelId || '' }), {
    enabled: Boolean(channelId),
  });
  // The hub's calls in progress, whatever page is open: the live marks on tracks,
  // folders and items come from here.
  const [activeCallRows] = useCachedQuery(
    queries.getSdlcActiveCalls({ channelId: channelId || '' }),
    { enabled: Boolean(channelId) },
  );
  /**
   * The calls in progress in each track, folder and item: the ones started on it, and
   * the ones started on something under it. A call on a file two folders deep is the
   * file's own, and inside both folders and the track.
   */
  const liveCallCounts = useMemo(() => {
    const counts = new Map<string, SdlcLiveCalls>();
    const count = (id: string, where: 'own' | 'inside', mine: boolean): void => {
      const live = counts.get(id) ?? { own: 0, inside: 0, ownMine: 0, insideMine: 0 };
      live[where] += 1;
      if (mine) live[where === 'own' ? 'ownMine' : 'insideMine'] += 1;
      counts.set(id, live);
    };
    for (const call of Array.isArray(activeCallRows) ? activeCallRows : []) {
      // Only your own participant row comes with it.
      const mine = isPartOfCall(call.participants?.[0]);
      const owners = new Set<string>();
      const above = new Set<string>();
      for (const link of call.sdlcEntityLinks ?? []) {
        owners.add(link.sourceId);
        // Where it sits: its track, and every folder above it.
        for (const edge of link.sourceItemLinks ?? []) above.add(edge.sourceId);
      }
      for (const id of owners) count(id, 'own', mine);
      for (const id of above) if (!owners.has(id)) count(id, 'inside', mine);
    }
    return counts;
  }, [activeCallRows]);
  /** Every call going on in the hub, and how many you are part of: the Calls row's pill. */
  const hubLiveCalls = useMemo<SdlcLiveCalls>(() => {
    const calls = Array.isArray(activeCallRows) ? activeCallRows : [];
    return {
      own: calls.length,
      ownMine: calls.filter(call => isPartOfCall(call.participants?.[0])).length,
      inside: 0,
      insideMine: 0,
    };
  }, [activeCallRows]);
  const tracks = useMemo(
    () =>
      Array.isArray(trackRows)
        ? (trackRows as Array<{
            id: string;
            name: string;
            description: string | null;
            icon: string | null;
            status: string;
            createdBy: string;
            createdAt: number;
            updatedAt: number;
          }>)
        : [],
    [trackRows],
  );
  // The hub's tracks by id, for the Calls page to say which one each call is in.
  const trackNames = useMemo(
    () => new Map(tracks.map(track => [track.id, track.name] as const)),
    [tracks],
  );
  const selectedTrackId = routeSearchParams.get('track');
  const openFolderId = routeSearchParams.get('folder');
  const browsingScratchTab = routeSearchParams.get('browse') === '1';
  const openFileId = routeSearchParams.get('file');
  const openLinkId = routeSearchParams.get('link');
  const selectedTrack = tracks.find(track => track.id === selectedTrackId);

  /** `?in=`: the folder the track's file list is showing; absent at its top level. */
  const filesFolderId = selectedTrackId ? routeSearchParams.get(SDLC_FILES_FOLDER_PARAM) : null;
  const openTracks = useMemo(
    () => tracks.filter(track => track.status !== 'COMPLETED' && track.status !== 'ARCHIVED'),
    [tracks],
  );
  const closedTracks = useMemo(
    () => tracks.filter(track => track.status === 'COMPLETED' || track.status === 'ARCHIVED'),
    [tracks],
  );
  // The Wiki page's data, loaded only while it is open; see useSdlcWikiData.
  const {
    scopes: wikiScopeList,
    pageCounts: wikiPageCounts,
    scope: wikiScope,
    scopeRepo: wikiScopeRepo,
    pages: wikiPages,
    showArchived: showArchivedWiki,
    setShowArchived: setShowArchivedWiki,
    selectedPage: selectedWikiPage,
    workflow: wikiState,
  } = useSdlcWikiData({
    channelId: channelId ?? null,
    enabled: section === 'wiki',
    repos: channelRepos,
    scopeParam: routeSearchParams.get('wiki'),
    selectedCanvasId,
  });
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
          // Only the open folder's are loaded; the others list nothing until opened.
          canvases: folder.id === activeTypeFolderId ? typeFolderCanvases : [],
        })),
    [folders, activeTypeFolderId, typeFolderCanvases],
  );
  const activeTypeFolder = useMemo(
    () => typeFolders.find(folder => folder.id === activeTypeFolderId) ?? null,
    [typeFolders, activeTypeFolderId],
  );
  // An artifact row says which folder it is in.
  const selectedCanvasTypeFolder = useMemo(
    () =>
      selectedCanvas?.folderId
        ? (typeFolders.find(folder => folder.id === selectedCanvas.folderId) ?? null)
        : null,
    [typeFolders, selectedCanvas?.folderId],
  );
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
  // Artifact id -> the track it belongs to, for card metadata, the related-artifact
  // search and a Tech Doc started from a PRD.
  const trackByCanvasId = useMemo(() => {
    const nameById = new Map(tracks.map(track => [track.id, track.name]));
    const byCanvas = new Map<string, { id: string; name: string }>();
    for (const canvas of canvases) {
      // Each artifact row brings the track edge pointing at it.
      const edge = canvas.sdlcEntityLinks?.[0];
      const name = edge ? nameById.get(edge.sourceId) : undefined;
      if (edge && name) byCanvas.set(canvas.id, { id: edge.sourceId, name });
    }
    return byCanvas;
  }, [canvases, tracks]);

  useEffect(() => {
    const query = relatedSearchQuery.trim();
    if (!artifactTrack || !channel || query.length < 2) {
      setRelatedSearchHits([]);
      setRelatedSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    setRelatedSearching(true);
    const timer = setTimeout(() => {
      void searchService
        .vespaSearch({ query, apps: 'file', subApp: 'canvas', limit: 25 }, controller.signal)
        .then(response => {
          setRelatedSearchHits(
            response.results.map(result => ({
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
  }, [relatedSearchQuery, artifactTrack, channel]);
  // Which track each hit is in, and its type, looked up for the hits alone: the list
  // offers only the chosen track's artifacts.
  const hitRefs = useMemo(
    () => relatedSearchHits.slice(0, 100).map(hit => ({ type: 'CANVAS' as const, id: hit.id })),
    [relatedSearchHits],
  );
  const [hitRows, hitDetails] = useCachedQuery(
    queries.getSdlcTrackItems({ channelId: channelId || '', items: hitRefs }),
    { enabled: Boolean(channelId) && hitRefs.length > 0 },
  );
  const hitPlaces = useMemo(() => {
    const rows = hitRefs.length > 0 && Array.isArray(hitRows) ? hitRows : [];
    const items = rows.map(row => targetItemOf(row));
    return new Map(
      hitRefs.map(ref => {
        const item = items.find(found => found?.kind === 'CANVAS' && found.id === ref.id);
        return [
          ref.id,
          {
            trackId: sdlcItemPlacement(rows, ref).trackId,
            typeName: item?.kind === 'CANVAS' ? item.typeName : null,
          },
        ] as const;
      }),
    );
  }, [hitRefs, hitRows]);
  const relatedSearchResults = useMemo(
    () =>
      artifactTrack
        ? relatedSearchHits.filter(hit => hitPlaces.get(hit.id)?.trackId === artifactTrack.id)
        : [],
    [artifactTrack, relatedSearchHits, hitPlaces],
  );
  // Still searching while the hits' tracks are being looked up.
  const relatedSearchPending =
    relatedSearching || (hitRefs.length > 0 && hitDetails.type !== 'complete');
  // Which discussions each panel lists, joined in the list's queries rather than
  // gathered here as ids: the track's (its own, its items' and its artifacts'), or one
  // item's. Memoised on their ids, so they stay the same query between renders.
  const trackDiscussionScope = useMemo<DiscussionScope | null>(
    () => (selectedTrackId ? { trackId: selectedTrackId } : null),
    [selectedTrackId],
  );
  const itemDiscussionScope = useMemo<DiscussionScope | null>(
    () =>
      !discussionItemRef
        ? null
        : // A folder's take in everything under it, however deep.
          discussionItemRef.type === 'FOLDER'
          ? { folderId: discussionItemRef.id }
          : { ownerIds: [discussionItemRef.id] },
    [discussionItemRef],
  );
  // What the page names by id — the folder it is open on, the folder its file list
  // is in, and the item its panel is about — looked up by those ids alone rather than
  // found among every folder, link and file in the hub.
  const pageItemRefs = useMemo(
    () => [
      ...(openFolderId && openFolderId !== selectedTrackId
        ? [{ type: 'FOLDER' as const, id: openFolderId }]
        : []),
      ...(filesFolderId ? [{ type: 'FOLDER' as const, id: filesFolderId }] : []),
      ...(discussionItemRef ? [{ type: discussionItemRef.type, id: discussionItemRef.id }] : []),
      ...(pendingOpen ? [{ type: pendingOpen.item.type, id: pendingOpen.item.id }] : []),
    ],
    [openFolderId, selectedTrackId, filesFolderId, discussionItemRef, pendingOpen],
  );
  const [pageItemRows, pageItemDetails] = useCachedQuery(
    queries.getSdlcTrackItems({ channelId: channelId || '', items: pageItemRefs }),
    { enabled: Boolean(channelId) && pageItemRefs.length > 0 },
  );
  const pageItemList = useMemo(
    () => (pageItemRefs.length > 0 && Array.isArray(pageItemRows) ? pageItemRows : []),
    [pageItemRefs.length, pageItemRows],
  );
  // By `KIND:id`.
  const pageItems = useMemo<ReadonlyMap<string, SdlcTrackItem>>(
    () =>
      new Map(
        pageItemList.flatMap(row => {
          const item = targetItemOf(row);
          return item ? [[`${item.kind}:${item.id}`, item] as const] : [];
        }),
      ),
    [pageItemList],
  );
  const folderDiscussion = useMemo<SdlcItemDiscussion | null>(() => {
    if (!discussionItemRef) return null;
    const { type, id } = discussionItemRef;
    const item = pageItems.get(`${type}:${id}`);
    return { type, id, name: item ? sdlcItemName(item) : DISCUSSION_ITEM_FALLBACK_NAME[type] };
  }, [discussionItemRef, pageItems]);
  // The file list's path: the folders from the top of the track down to `?in=`. The
  // lookup gives it however the folder was reached. The path the list itself just
  // walked stands in until then, so the crumbs don't blink on every step.
  const [walkedPath, setWalkedPath] = useState<SdlcFilesLocation[]>([]);
  const filesPath = useMemo<SdlcFilesLocation[]>(() => {
    if (!filesFolderId) return [];
    const walked = walkedPath.at(-1)?.id === filesFolderId ? walkedPath : null;
    const folder = pageItems.get(`FOLDER:${filesFolderId}`);
    if (!folder) return walked ?? [];
    const placement = sdlcItemPlacement(pageItemList, { type: 'FOLDER', id: filesFolderId });
    // Another track's folder isn't this list's to show.
    if (placement.trackId && placement.trackId !== selectedTrackId) return [];
    if (!placement.complete && walked) return walked;
    return [
      ...placement.folders,
      {
        type: 'FOLDER',
        id: folder.id,
        name: sdlcItemName(folder),
        icon: folder.kind === 'FOLDER' ? folder.icon : null,
      },
    ];
  }, [filesFolderId, walkedPath, pageItems, pageItemList, selectedTrackId]);
  const setFilesPath = useCallback(
    (next: SdlcFilesLocation[], options?: { replace?: boolean }): void => {
      setWalkedPath(next);
      const params = new URLSearchParams(location.search);
      const folderId = next.at(-1)?.id;
      if (folderId) params.set(SDLC_FILES_FOLDER_PARAM, folderId);
      else params.delete(SDLC_FILES_FOLDER_PARAM);
      const search = params.toString();
      // A step of its own, so Back goes back up.
      void navigate(
        `${location.pathname}${search ? `?${search}` : ''}`,
        options?.replace ? { replace: true } : undefined,
      );
    },
    [location.pathname, location.search, navigate],
  );

  const chatLayout = sdlcChatLayout({
    chatParam: routeSearchParams.get('chat'),
    discussionParam: routeSearchParams.get('discussion'),
  });
  const sdlcChatTab = chatLayout.activeTab;
  const discussionOpen = chatLayout.panelOpen && sdlcChatTab === 'conversations';
  const rightPanelOpen = chatLayout.panelOpen;
  // The artifacts a discussion panel can be about: the open one, and an open
  // conversation's, which its owner link brings.
  const discussionCanvases = useMemo(
    () =>
      [selectedCanvas, hubArtifactOf(conversationOwner?.sourceCanvas)].filter(
        (canvas): canvas is HubArtifactSummary & { folderId: string } => Boolean(canvas),
      ),
    [selectedCanvas, conversationOwner, hubArtifactOf],
  );
  const discussionContext = useMemo(
    () =>
      resolveSdlcDiscussionContext({
        selectedCanvasId: selectedCanvas?.id ?? null,
        selectedWikiPage: selectedWikiPage ?? null,
        selectedConversationId: selectedDiscussionConversationId,
        canvases: discussionCanvases,
        conversationOwner,
      }),
    [
      discussionCanvases,
      conversationOwner,
      selectedCanvas?.id,
      selectedDiscussionConversationId,
      selectedWikiPage,
    ],
  );

  useEffect(() => {
    if (
      !shouldCloseInvalidSdlcConversationDeepLink({
        // Waits for the open conversation's owner too, or a valid link would close
        // before it is known whose it is.
        dataLoaded:
          repoQueryDetails.type === 'complete' &&
          (!selectedDiscussionConversationId || selectedConversationDetails.type === 'complete'),
        discussionOpen,
        selectedConversationId: selectedDiscussionConversationId,
        discussionContextResolved:
          Boolean(discussionContext) ||
          Boolean(section === 'tracks' && selectedTrackId) ||
          (section === 'calls' && Boolean(conversationOwner)),
      })
    ) {
      return;
    }
    const next = new URLSearchParams(location.search);
    next.delete('discussion');
    next.delete('chat');
    next.delete('conversation');
    next.delete('selectedTab');
    next.delete(SDLC_THREAD_ONLY_PARAM);
    const search = next.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
  }, [
    conversationOwner,
    discussionContext,
    discussionOpen,
    location.pathname,
    location.search,
    navigate,
    repoQueryDetails.type,
    selectedConversationDetails.type,
    section,
    selectedDiscussionConversationId,
    selectedTrackId,
  ]);
  const discussionOwner = discussionContext?.owner ?? null;
  const discussionSurface = discussionContext?.surface ?? null;
  // On the hub's Calls page, a call's discussion opens beside the list on its own.
  const hubCallThreadOwner =
    section === 'calls' && conversationOwner && isDiscussionOwnerType(conversationOwner.sourceType)
      ? { type: conversationOwner.sourceType, id: conversationOwner.sourceId }
      : null;
  const releaseThreadId = selectedCanvasId ? null : openReleaseId;
  const releaseThreadAvailable = useReleaseThreadAccess(releaseThreadId);
  const chatPanelAvailable =
    Boolean(discussionOwner && discussionSurface) ||
    Boolean(section === 'tracks' && selectedTrack) ||
    Boolean(hubCallThreadOwner) ||
    releaseThreadAvailable;
  const showRightPanel = rightPanelOpen && chatPanelAvailable;
  const canvasDiscussionScope = useMemo<DiscussionScope | null>(
    () => (discussionOwner ? { ownerIds: [discussionOwner.canvasId] } : null),
    [discussionOwner],
  );
  const activeFolderDiscussion =
    folderDiscussion && section === 'tracks' && selectedTrack ? folderDiscussion : null;
  const entityLinkScope = useMemo<EntityLinkScope | null>(() => {
    // An artifact's are its own, as on its page; they reach the track's list without a
    // roll-up. A folder's, link's or file's roll up to the track.
    if (activeFolderDiscussion?.type === 'CANVAS') {
      return { sourceType: 'CANVAS', sourceId: activeFolderDiscussion.id };
    }
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
  // Hub Knowledge's workflow, which only Overview and Hub Knowledge show.
  const knowledgeWorkflowShown = section === 'overview' || section === 'knowledge';
  const [hubWorkflowLink] = useCachedQuery(
    queries.getSdlcHubWorkflow({ channelId: channelId || '' }),
    { enabled: Boolean(channelId) && knowledgeWorkflowShown },
  );
  const hubWorkflowId = knowledgeWorkflowShown ? (hubWorkflowLink?.workflow?.id ?? null) : null;
  const state = useHubWorkflow(hubWorkflowId);
  const knowledgeRunning = state.phase === 'RUNNING';

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
    (pathname: string, destinationSearch = '', state?: { returnToUrl: string }): void => {
      const search = sdlcChatNavigationSearch({
        currentSearch: location.search,
        destinationSearch,
      });
      void navigate(`${pathname}${search}`, state ? { state } : undefined);
    },
    [location.search, navigate],
  );

  interface OpenCanvasOptions {
    event?: { metaKey: boolean; ctrlKey: boolean } | undefined;
    withDiscussion?: boolean;
  }

  const openReleaseTicket = useCallback(
    (ticketId: string): void =>
      navigateWithinSdlc(`/sdlc/${channelId}/tickets/${ticketId}`, '', {
        returnToUrl: `${location.pathname}${location.search}`,
      }),
    [channelId, location.pathname, location.search, navigateWithinSdlc],
  );

  const openReleaseCanvas = useCallback(
    (canvasId: string): void => {
      setRelatedSourceId(null);
      const search = new URLSearchParams({ canvas: canvasId });
      if (openReleaseId) search.set('release', openReleaseId);
      navigateWithinSdlc(`/sdlc/${channelId}/releases`, `?${search.toString()}`);
    },
    [channelId, openReleaseId, navigateWithinSdlc],
  );

  const releaseThreadNavigation = useMemo(
    () => ({ openTicket: openReleaseTicket, openCanvas: openReleaseCanvas }),
    [openReleaseTicket, openReleaseCanvas],
  );

  const openRelease = (releaseId: string): void => {
    navigateWithinSdlc(
      `/sdlc/${channelId}/releases`,
      `?${new URLSearchParams({ release: releaseId, discussion: '1', chat: 'conversations' }).toString()}`,
    );
  };

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

  const openFolderItem = openFolderId ? pageItems.get(`FOLDER:${openFolderId}`) : undefined;
  // A track's own page shows the track's icon at the root, as the sidebar does.
  const openFolder = openFolderId
    ? selectedTrack && openFolderId === selectedTrack.id
      ? {
          id: selectedTrack.id,
          name: selectedTrack.name,
          icon: selectedTrack.icon,
        }
      : openFolderItem
        ? {
            id: openFolderItem.id,
            name: sdlcItemName(openFolderItem),
            icon: openFolderItem.kind === 'FOLDER' ? openFolderItem.icon : null,
          }
        : // Named once it arrives. One that isn't there falls back to the track's page.
          pageItemDetails.type === 'complete'
          ? null
          : { id: openFolderId, name: '', icon: null }
    : null;
  /** True while the page open is the track's own, rather than a folder inside it. */
  const openFolderIsTrack = Boolean(openFolder && openFolder.id === selectedTrackId);
  /** A track's own page, which its name heads from the top bar. */
  const onTrackPage =
    section === 'tracks' && Boolean(selectedTrack) && !openFolder && !selectedCanvasId;
  // Opening an item's discussions brings the item into view in the file list: into
  // the folder that holds it, when the list is showing another. Once per item, so
  // browsing on from there is never pulled back.
  const revealedItemRef = useRef<string | null>(null);
  useEffect(() => {
    if (!discussionItemRef) {
      revealedItemRef.current = null;
      return;
    }
    if (!onTrackPage || trackTab !== 'files') return;
    const key = `${discussionItemRef.type}:${discussionItemRef.id}`;
    if (revealedItemRef.current === key) return;
    const placement = sdlcItemPlacement(pageItemList, discussionItemRef);
    // Where it sits arrives with the lookup.
    if (!placement.parent) return;
    revealedItemRef.current = key;
    if (placement.trackId !== selectedTrackId) return;
    // The folder the list is in, or one above it, is already on screen in the path.
    if (filesPath.some(step => step.id === discussionItemRef.id)) return;
    const holder = placement.parent.type === 'FOLDER' ? placement.parent.id : null;
    if (holder === filesFolderId) return;
    // A folder whose own folders aren't known can't be opened with its path.
    if (holder && placement.folders.at(-1)?.id !== holder) return;
    setFilesPath(holder ? placement.folders : [], { replace: true });
  }, [
    discussionItemRef,
    onTrackPage,
    trackTab,
    pageItemList,
    selectedTrackId,
    filesPath,
    filesFolderId,
    setFilesPath,
  ]);

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
    const found = pageItems.get(`${item.type}:${item.id}`);
    if (item.type === 'FOLDER') {
      return found?.kind === 'FOLDER' && found.icon ? (
        <AppIcon name={found.icon} size={14} className='shrink-0' aria-hidden='true' />
      ) : (
        <Folder className={`${className} text-muted-foreground`} />
      );
    }
    if (item.type === 'LINK') {
      const favicon = found?.kind === 'LINK' ? found.favicon : null;
      return favicon ? (
        <img src={favicon} alt='' className={`${className} rounded-[2px]`} />
      ) : (
        <Link2 className={className} />
      );
    }
    if (item.type === 'CANVAS') {
      return <FileText className={`${className} text-muted-foreground`} />;
    }
    if (found?.kind !== 'ATTACHMENT') return <Paperclip className={className} />;
    return (
      <FileTypeIcon kind={fileKind(found.mimetype, found.name)} size='sm' className='size-3.5' />
    );
  };

  // What a call started from the conversation panel is for: the track, item or artifact
  // the panel is about. It is named after it and becomes a discussion there; with
  // nothing in scope it is a call in the hub.
  const callScope: SdlcCallScope = {
    link: entityLinkScope
      ? { ownerType: entityLinkScope.sourceType, ownerId: entityLinkScope.sourceId }
      : null,
    name:
      activeFolderDiscussion?.name ??
      discussionOwner?.title ??
      (entityLinkScope?.sourceType === 'TRACK' ? selectedTrack?.name : undefined) ??
      channel?.name ??
      'this hub',
  };
  // The header's call is for the page on screen: the artifact or wiki page open, else
  // the track, else the hub. The item the panel was last about stays in the url while
  // the panel is shut, so a call from the header leaves it out.
  const pageOwner = selectedCanvas || selectedWikiPage ? discussionOwner : null;
  const pageCallScope: SdlcCallScope = pageOwner
    ? { link: { ownerType: 'CANVAS', ownerId: pageOwner.canvasId }, name: pageOwner.title }
    : section === 'tracks' && selectedTrack
      ? { link: { ownerType: 'TRACK', ownerId: selectedTrack.id }, name: selectedTrack.name }
      : { link: null, name: channel?.name ?? 'this hub' };
  const isHubMember = Boolean(
    channel?.participants?.some(participant => participant.userId === auth.userID),
  );

  const panelScopeActions = (place: 'header' | 'panel'): ReactNode => {
    if (!channel) return null;
    const scope = place === 'header' ? pageCallScope : callScope;
    const onReleasePage = place === 'header' && section === 'releases' && !selectedCanvasId;
    return (
      <>
        {/* Ask AI, then call, then ticket: the order a thread's own actions take, so
            opening one leaves these where they were. */}
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
        {!onReleasePage && (
          <>
            {/* Only the people picked are invited, and the call becomes a discussion in
              what it is for — never a call the whole hub is rung for. */}
            <Button
              size='icon'
              variant='ghost'
              aria-label={`Start a call in ${scope.name}`}
              title={isHubMember ? `Start a call in ${scope.name}` : 'Join the hub to start a call'}
              disabled={!isHubMember}
              onClick={() => setCallPicker(scope)}
              data-track-category='SdlcHub'
              data-track-name='StartCallOpened'
              data-track-metadata={JSON.stringify({
                place,
                scope: scope.link?.ownerType ?? 'HUB',
              })}
            >
              <PhoneDefault size={16} />
            </Button>
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
          </>
        )}
      </>
    );
  };

  /** A track's own page, with its conversations alongside it. */
  const trackSearch = (trackId: string, filesFolder: string | null = null): string => {
    const search = new URLSearchParams({ track: trackId });
    if (filesFolder) search.set(SDLC_FILES_FOLDER_PARAM, filesFolder);
    search.set('discussion', '1');
    search.set('chat', 'conversations');
    return `?${search.toString()}`;
  };

  const folderPageSearch = (
    folderId: string,
    tab: FolderTab | null,
    withDiscussion = false,
    /** Another track's folder, reached from outside its page. */
    trackId: string | null = selectedTrackId,
  ): string => {
    const search = new URLSearchParams();
    if (trackId) search.set('track', trackId);
    // Kept for when the page closes, back to the file list where it was left.
    if (filesFolderId && trackId === selectedTrackId) {
      search.set(SDLC_FILES_FOLDER_PARAM, filesFolderId);
    }
    search.set('folder', folderId);
    if (tab?.kind === 'CANVAS') search.set('canvas', tab.id);
    if (tab?.kind === 'ATTACHMENT') search.set('file', tab.id);
    if (tab?.kind === 'LINK') search.set('link', tab.id);
    if (tab?.kind === 'BROWSER') search.set('browse', '1');
    // The panel's subject: a link or file tab is its own, and the folder itself is
    // when no tab is open. An artifact carries its own through the canvas.
    const about: SdlcDiscussionItemRef | null =
      tab?.kind === 'LINK' || tab?.kind === 'ATTACHMENT'
        ? { type: tab.kind, id: tab.id }
        : !tab && folderId !== trackId
          ? { type: 'FOLDER', id: folderId }
          : null;
    if (about) search.set(SDLC_ABOUT_PARAM, sdlcDiscussionItemParam(about));
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

  /**
   * ⌘/Ctrl-click in the file list. The desktop app gives the item a window of its
   * own, as it does elsewhere in the hub; on the web it opens in a new browser tab,
   * at the address it would have had here. False when nothing opened, so the
   * caller opens it in place.
   */
  const openInNewTab = (
    event: { metaKey: boolean; ctrlKey: boolean } | undefined,
    search: string,
    inWindow: () => boolean,
  ): boolean => {
    if (!event || !(event.metaKey || event.ctrlKey) || !workspaceId || !channelId) return false;
    if (shouldOpenInNewWindow(event)) return inWindow();
    window.open(`/${workspaceId}/sdlc/${channelId}/tracks?${search}`, '_blank', 'noopener');
    return true;
  };

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
    navigateWithinSdlc(
      `/sdlc/${channelId}/tracks`,
      `?${folderPageSearch(folderId, tab, withDiscussion)}`,
    );
  };

  /**
   * Opens an item from a discussion about it, as double-clicking it in the file list
   * would: a folder on its own page, anything else as a tab on the page of what holds
   * it. Where that is comes from looking the item up; the conversation on show stays
   * open beside it.
   */
  const openDiscussedItem = (item: SdlcDiscussionItemRef, name: string): void => {
    setPendingOpen({ item, name, conversationId: selectedDiscussionConversationId });
  };
  useEffect(() => {
    if (!pendingOpen || !channelId) return;
    const { item, conversationId } = pendingOpen;
    const placement = sdlcItemPlacement(pageItemList, item);
    // Where it sits arrives with the lookup.
    if (!placement.parent) return;
    setPendingOpen(null);
    const pageId = item.type === 'FOLDER' ? item.id : placement.parent.id;
    const tab: FolderTab | null = item.type === 'FOLDER' ? null : { kind: item.type, id: item.id };
    const search = new URLSearchParams(
      folderPageSearch(pageId, tab, true, placement.trackId ?? selectedTrackId),
    );
    if (conversationId) search.set('conversation', conversationId);
    // Straight there rather than through navigateWithinSdlc, which lets go of the
    // open conversation.
    void navigate(`/sdlc/${channelId}/tracks?${search.toString()}`);
    // folderPageSearch reads the page's params; the lookup is what this waits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen, pageItemList, channelId]);
  // One the lookup can't place — deleted, or not in a track — says so rather than
  // leaving the click unanswered.
  useEffect(() => {
    if (!pendingOpen) return undefined;
    const timer = window.setTimeout(() => {
      toast.error(`Couldn't open ${pendingOpen.name}`);
      setPendingOpen(null);
    }, 8000);
    return (): void => window.clearTimeout(timer);
  }, [pendingOpen]);
  /** Whether an item is what the page already has open: its folder page, or its tab. */
  const isOpenOnPage = (item: SdlcDiscussionItemRef): boolean =>
    (item.type === 'FOLDER' && openFolderId === item.id && !activeFolderTab) ||
    (activeFolderTab?.kind === item.type && activeFolderTab.id === item.id);
  // The open conversation's item, for the thread to name and open. One on the track
  // itself names nothing: the track is already the page.
  const threadSubjectItem =
    conversationOwner && conversationOwner.sourceType !== 'TRACK'
      ? sourceItemOf(conversationOwner)
      : null;
  // Off the track's own page — the hub's Calls — a call on a track names the track.
  const threadSubjectTrackId =
    conversationOwner?.sourceType === 'TRACK' && !onTrackPage ? conversationOwner.sourceId : null;
  const threadSubject: { name: string; icon: ReactNode; onOpen: () => void } | null =
    threadSubjectTrackId
      ? {
          name: trackNames.get(threadSubjectTrackId) ?? 'Track',
          icon: <Layers className='size-3 shrink-0' />,
          onOpen: () => openTrack(threadSubjectTrackId),
        }
      : threadSubjectItem &&
          !isOpenOnPage({ type: threadSubjectItem.kind, id: threadSubjectItem.id })
        ? {
            name: sdlcItemName(threadSubjectItem),
            icon: discussedItemIcon(threadSubjectItem, 'size-3 shrink-0'),
            onOpen: () =>
              openDiscussedItem(
                { type: threadSubjectItem.kind, id: threadSubjectItem.id },
                sdlcItemName(threadSubjectItem),
              ),
          }
        : null;

  const closeFolderPage = (): void => {
    if (!channelId) return;
    navigateWithinSdlc(
      `/sdlc/${channelId}/tracks`,
      selectedTrackId ? trackSearch(selectedTrackId, filesFolderId) : '',
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
    if (section === 'releases' && openReleaseId) {
      openRelease(openReleaseId);
      return;
    }
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
      /** The item the panel is about; left as it is when not given. */
      about?: SdlcDiscussionItemRef | null;
      /** Marks the conversation as opened from outside the list; kept while it stays open. */
      threadOnly?: boolean;
      /** A step of its own in history, which the browser's Back undoes. */
      push?: boolean;
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
      if (input.about === null) next.delete(SDLC_ABOUT_PARAM);
      else if (input.about) next.set(SDLC_ABOUT_PARAM, sdlcDiscussionItemParam(input.about));
      if (!input.conversationId || input.threadOnly === false) next.delete(SDLC_THREAD_ONLY_PARAM);
      else if (input.threadOnly) next.set(SDLC_THREAD_ONLY_PARAM, '1');
      const search = next.toString();
      const url = `${location.pathname}${search ? `?${search}` : ''}`;
      void navigate(url, { replace: !input.push });
    },
    [location.pathname, location.search, navigate],
  );

  const openConversations = useCallback((): void => {
    setDiscussionUrl({ open: true, conversationId: null, about: null });
  }, [setDiscussionUrl]);

  const openItemConversations = useCallback(
    (item: SdlcItemDiscussion): void => {
      setDiscussionUrl({
        open: true,
        conversationId: null,
        about: { type: item.type, id: item.id },
      });
    },
    [setDiscussionUrl],
  );

  const describeDiscussionOwner = useCallback(
    (found: SdlcSourceLink): ReactNode => {
      const iconClass = 'size-[11px] shrink-0';
      // Every discussion in a track's list says where it is happening. One on the
      // track itself names the track, and goes nowhere: the list is already its.
      if (found.sourceType === 'TRACK') {
        if (!selectedTrack) return null;
        const trackIcon = selectedTrack.icon;
        return (
          <span
            title={`On ${selectedTrack.name}`}
            className='inline-flex min-w-[3.75rem] max-w-[9rem] shrink items-center gap-1 rounded bg-foreground/[0.06] px-1 py-px text-[10.5px] font-medium text-muted-foreground'
          >
            {trackIcon ? (
              <AppIcon name={trackIcon} size={11} aria-hidden='true' />
            ) : (
              <Layers className={iconClass} />
            )}
            <span className='truncate'>{selectedTrack.name}</span>
          </span>
        );
      }
      // Any other subject is one of the track's items, joined to the link by the list.
      const item = sourceItemOf(found);
      if (!item) return null;
      const name = sdlcItemName(item);
      const icon = discussedItemIcon(item, iconClass);
      return (
        <button
          type='button'
          onClick={() => openItemConversations({ type: item.kind, id: item.id, name })}
          title={`Conversations on ${name}`}
          aria-label={`Conversations on ${name}`}
          className='inline-flex min-w-[3.75rem] max-w-[9rem] shrink items-center gap-1 rounded bg-foreground/[0.06] px-1 py-px text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.11] hover:text-foreground'
          data-track-category='SdlcHub'
          data-track-name='FolderConversationsOpenedFromList'
          data-track-metadata={JSON.stringify({ ownerType: item.kind })}
        >
          {icon}
          <span className='truncate'>{name}</span>
        </button>
      );
    },
    [openItemConversations, selectedTrack],
  );
  // Each discussion in the list arrives with its DISCUSSION link, so its badge needs no
  // lookup of its own.
  const renderFolderConversationBadge = useCallback(
    (conversation: ConversationBadgeSubject): ReactNode => {
      const owner = conversation.sdlcEntityLinks?.[0];
      return owner ? describeDiscussionOwner(owner) : null;
    },
    [describeDiscussionOwner],
  );
  // An item's list says where each discussion is only when it can be somewhere else:
  // a folder's takes in everything under it. Those on the item itself go without.
  const discussionItemId = discussionItemRef?.id ?? null;
  const renderItemConversationBadge = useCallback(
    (conversation: ConversationBadgeSubject): ReactNode => {
      const owner = conversation.sdlcEntityLinks?.[0];
      return owner && owner.sourceId !== discussionItemId ? describeDiscussionOwner(owner) : null;
    },
    [describeDiscussionOwner, discussionItemId],
  );

  const closeConversations = useCallback((): void => {
    setDiscussionUrl({ open: false, conversationId: null });
  }, [setDiscussionUrl]);

  // Toggles the panel without disturbing its scope: the url already says what it
  // is showing, the open conversation included, so only the open flag moves.
  useShortcutById('sdlc.toggleConversations', () => {
    if (!chatPanelAvailable) return;
    setDiscussionUrl({
      open: !rightPanelOpen,
      conversationId: selectedDiscussionConversationId,
      selectedTab: routeSearchParams.get('selectedTab') === 'details' ? 'details' : null,
    });
  });

  const selectDiscussionConversation = useCallback(
    (conversationId: string | null, options?: { selectedTab?: 'details' }): void => {
      // Leaving never steps history back: the frame shares it with the host app, so
      // the previous entry can be a screen outside SDLC.
      setDiscussionUrl({
        open: true,
        conversationId,
        selectedTab: options?.selectedTab ?? null,
        push: conversationId !== null,
      });
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
    relatedCanvases?: Array<{ id: string; title: string }>;
  }): void => {
    setArtifactTitle('');
    setArtifactAiPrompt('');
    setArtifactTrack(input?.track ?? null);
    setArtifactContextLocked(Boolean(input?.track));
    setRelatedCanvases(input?.relatedCanvases ?? []);
    setRelatedSearchQuery('');
    setRelatedSearchHits([]);
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
    returnFocusToFileList();
    setPendingUploads([]);
    setRefusedUploads([]);
    setLinkUrl('');
    setLinkTitle('');
    setLinkPreview(null);
    resetArtifactDialog();
  };

  const relatedArtifactsForPayload = (): Array<{ canvasId: string; title: string }> =>
    relatedCanvases.map(canvas => ({ canvasId: canvas.id, title: canvas.title }));

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
  if (hubLoading) {
    return (
      <div className='h-full grid place-items-center text-muted-foreground'>
        <Loader2 className='animate-spin' />
      </div>
    );
  }

  // Before the empty state: a URL naming a hub that is gone is a 404, not an
  // invitation to create the first one.
  if (channelId && !channel) return <NotFoundScreen fallbackPath='/sdlc' />;

  // Only with no hub open: an open hub is one, and the list fills a moment after the
  // app's own start-up.
  if (!channelId && channels.length === 0) {
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
      icon: track.icon ? (
        <AppIcon name={track.icon} size={16} className='text-muted-foreground' aria-hidden='true' />
      ) : (
        <Layers className='size-4 text-muted-foreground' />
      ),
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
    source: { canvasId: string; title: string },
  ): void => {
    clearArtifactDialogFields({
      track: trackByCanvasId.get(source.canvasId) ?? null,
      relatedCanvases: [{ id: source.canvasId, title: source.title }],
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
        {list.length === 0 && typeFolderDetails.type !== 'complete' ? null : list.length === 0 ? (
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
    setWalkedPath(path => path.map(step => (step.id === folderId ? { ...step, name } : step)));
  };

  const setFolderIconAction = async (folderId: string, icon: string | null): Promise<void> => {
    if (!channel) return;
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.setSdlcFolderIcon({
          folderId,
          channelId: channel.id,
          icon,
          timestamp: Date.now(),
        }),
      ),
    );
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
    item: { type: SdlcItemKind; id: string },
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
    returnFocusToFileList();
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

  const openAddItemDialog = (
    tab: 'artifact' | 'upload' | 'link',
    parent: SdlcFilesLocation,
  ): void => {
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
    returnFocusToFileList();
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
    returnFocusToFileList();
  };

  const setTrackNameAction = async (trackId: string, name: string): Promise<void> => {
    await runTrackMutation(
      zero.mutate(mutators.sdlc.updateTrack({ trackId, name, timestamp: Date.now() })),
    );
  };

  /** Everyone in the hub sees a track's icon; null goes back to the track mark. */
  const setTrackIcon = (trackId: string, icon: string | null): void => {
    void call(
      `sdlc-track-icon-${trackId}`,
      () =>
        runTrackMutation(
          zero.mutate(mutators.sdlc.updateTrack({ trackId, icon, timestamp: Date.now() })),
        ),
      icon ? 'Track icon changed' : 'Track icon removed',
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
                  setRelatedCanvases([]);
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
                      if (relatedSearchPending && results.length === 0) {
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
                            setRelatedCanvases(prev => [
                              ...prev,
                              { id: result.id, title: result.title },
                            ]);
                            setRelatedSearchQuery('');
                          }}
                          className='flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left hover:bg-muted'
                          data-track-category='SdlcHub'
                          data-track-name='RelatedArtifactAdded'
                        >
                          <FileText size={15} className='shrink-0 text-muted-foreground' />
                          <span className='flex-1 truncate text-[13px]'>{result.title}</span>
                          {hitPlaces.get(result.id)?.typeName && (
                            <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
                              {hitPlaces.get(result.id)?.typeName}
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
                  {(relatedChipsExpanded ? relatedCanvases : relatedCanvases.slice(0, 3)).map(
                    ({ id, title }) => {
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
                              setRelatedCanvases(prev =>
                                prev.filter(existing => existing.id !== id),
                              )
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

  /** The track's name, which heads its page. Click it to rename, the same way the
   *  description works. */
  const renderTrackName = (track: { id: string; name: string }): ReactElement =>
    nameDraft === null ? (
      <button
        type='button'
        onClick={() => {
          nameAbandoned.current = false;
          setNameDraft(track.name);
        }}
        className='-mx-1 min-w-0 truncate rounded px-1 text-left text-xl font-semibold leading-8 tracking-tight transition-colors hover:bg-muted/50'
        title='Rename track'
        data-track-category='SdlcHub'
        data-track-name='TrackNameEditOpened'
      >
        {track.name}
      </button>
    ) : (
      // No percentage caps here: the heading is only as wide as this field, so a cap
      // "100% of the heading" pointed back at the field and cut off its last letters.
      // The field has a fixed-length cap instead; past it, a long name scrolls.
      <span className='relative -mx-1 inline-flex min-w-0 items-center'>
        {/* Mirrors the field's text and typography. Character counts
            cannot size a proportional face — a space is far narrower
            than a `ch`, so the slack piled up as you typed. */}
        <span
          aria-hidden='true'
          data-name-mirror
          className='pointer-events-none invisible absolute left-0 top-0 whitespace-pre px-1 text-xl font-semibold leading-8 tracking-tight'
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
            event.target.setSelectionRange(event.target.value.length, event.target.value.length);
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
            if (next.length > 0 && next !== track.name) {
              void call(
                `track-name-${track.id}`,
                () => setTrackNameAction(track.id, next),
                'Track renamed',
              );
            }
          }}
          onInput={event => sizeNameFieldToText(event.currentTarget)}
          className='min-w-0 max-w-[min(48rem,55vw)] rounded border-0 bg-muted/40 px-1 text-xl font-semibold leading-8 tracking-tight text-foreground outline-none ring-0 transition-colors duration-150 focus:bg-muted/60 focus:outline-none motion-reduce:transition-none'
          data-track-category='SdlcHub'
          data-track-name='TrackNameEdited'
        />
      </span>
    );

  /** The track's status, beside its name: the one fact about it worth a glance every time. */
  const renderTrackStatus = (track: { id: string; status: string }): ReactElement => {
    return (
      <Popover
        open={trackStatusOpen}
        onOpenChange={setTrackStatusOpen}
        align='start'
        sideOffset={6}
        className='w-[168px] p-1'
        trigger={
          <button
            type='button'
            className='flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            aria-label={`Track status: ${
              TRACK_STATUS_OPTIONS.find(o => o.value === track.status)?.label ?? track.status
            }. Change status`}
            data-track-category='SdlcHub'
            data-track-name='TrackStatusOpened'
          >
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                TRACK_STATUS_DOT[track.status] ?? TRACK_STATUS_DOT['ARCHIVED'],
              )}
              aria-hidden='true'
            />
            {TRACK_STATUS_OPTIONS.find(o => o.value === track.status)?.label ?? track.status}
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
              if (option.value !== track.status) {
                void call(
                  `track-status-${track.id}`,
                  () => setTrackStatusAction(track.id, option.value),
                  `Track marked ${option.label.toLowerCase()}`,
                );
              }
            }}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted/60',
              option.value === track.status && 'font-medium',
            )}
            data-track-category='SdlcHub'
            data-track-name='TrackStatusChanged'
            data-track-metadata={JSON.stringify({ status: option.value })}
          >
            <span className='flex items-center gap-2'>
              <span
                className={cn('size-1.5 shrink-0 rounded-full', TRACK_STATUS_DOT[option.value])}
                aria-hidden='true'
              />
              {option.label}
            </span>
            {option.value === track.status && <Check className='size-3.5 text-muted-foreground' />}
          </button>
        ))}
      </Popover>
    );
  };

  /** The track's tabs, drawn as a channel's are: an icon and a label, the open one filled. */
  const renderTrackTabs = (): ReactElement => (
    <TabsPrimitive.Root
      value={trackTab}
      onValueChange={value => {
        const tab = TRACK_TABS.find(item => item.value === value);
        if (tab) openTrackTab(tab.value);
      }}
      activationMode='manual'
    >
      <TabsPrimitive.List aria-label='Track' className='flex items-center gap-0.5'>
        {TRACK_TABS.map(tab => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              trackTab === tab.value
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
            data-track-category='SdlcHub'
            data-track-name='TrackTabOpened'
            data-track-metadata={JSON.stringify({ tab: tab.value })}
          >
            <span className='shrink-0'>{tab.icon}</span>
            <span className='text-sm font-medium tracking-[-0.28px]'>{tab.label}</span>
            {/* Every call going on in the track, as its sidebar row counts them. */}
            {tab.value === 'calls' && selectedTrack && (
              <ActivityPill
                live={liveCallCounts.get(selectedTrack.id)}
                rollUp
                place={selectedTrack.name}
                size='sm'
              />
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );

  const renderTrack = (): ReactElement | null => {
    if (!selectedTrack) return null;
    // Each tab fills the page and scrolls its own contents.
    return trackTab === 'files' ? (
      <section className='flex min-h-0 flex-1 flex-col'>
        <SdlcFileList
          liveCallCounts={liveCallCounts}
          key={selectedTrack.id}
          channelId={channel.id}
          track={selectedTrack}
          path={filesPath}
          onNavigate={setFilesPath}
          onOpenItem={(item, parent, event) => {
            // It opens as a tab on the page of whatever holds it. A track holds its
            // own page — the root folder, named after the track — so an item filed
            // straight on the track opens there.
            const tab: FolderTab = { kind: item.kind, id: item.id };
            const search = folderPageSearch(parent.id, tab, true);
            if (openInNewTab(event, search, () => openFolderInWindow(parent.id, tab))) return;
            openFolderPage(parent.id, tab);
          }}
          onOpenFolderPage={(folder, event) => {
            const search = folderPageSearch(folder.id, null, true);
            if (openInNewTab(event, search, () => openFolderInWindow(folder.id))) return;
            openFolderPage(folder.id);
          }}
          onPreviewCanvas={(canvasId, title) => {
            rememberFileListFocus();
            setReaderCanvasId(canvasId);
            setReaderTitle(title);
          }}
          onNewFolder={parent => {
            rememberFileListFocus();
            setNewFolderParent(parent);
          }}
          onNewArtifact={parent => {
            rememberFileListFocus();
            openAddItemDialog('artifact', parent);
          }}
          onUploadFile={parent => {
            rememberFileListFocus();
            openAddItemDialog('upload', parent);
          }}
          onAddLink={parent => {
            rememberFileListFocus();
            openAddItemDialog('link', parent);
          }}
          // Every row's discussions open beside the list, an artifact's too; opening
          // the artifact itself is what a double-click does.
          onDiscussItem={item =>
            openItemConversations({ type: item.kind, id: item.id, name: item.name })
          }
          onDiscussTrack={() => openConversations()}
          {...(isHubMember && {
            onStartCall: item =>
              setCallPicker({ link: { ownerType: item.kind, ownerId: item.id }, name: item.name }),
          })}
          // The track itself counts as discussed while the panel shows its own
          // conversations — no item's, and no artifact's.
          discussingId={
            showRightPanel
              ? (activeFolderDiscussion?.id ?? (discussionOwner ? null : selectedTrack.id))
              : null
          }
          onRenameFolder={(folderId, name) =>
            void call(
              `sdlc-folder-rename-${folderId}`,
              () => renameFolderAction(folderId, name),
              'Folder renamed',
            )
          }
          onSetFolderIcon={(folderId, icon) =>
            void call(
              `sdlc-folder-icon-${folderId}`,
              () => setFolderIconAction(folderId, icon),
              icon ? 'Folder icon changed' : 'Folder icon removed',
            )
          }
          onMoveItems={(items, parent) =>
            void call(
              `sdlc-move-${parent.id}`,
              async () => {
                for (const item of items) await moveItemAction(item, parent);
              },
              items.length === 1 ? 'Moved' : `Moved ${items.length} items`,
            )
          }
          listRef={fileListRef}
        />
      </section>
    ) : trackTab === 'calls' ? (
      <section className='flex min-h-0 flex-1 flex-col'>
        <SdlcCalls
          key={selectedTrack.id}
          channelId={channel.id}
          track={selectedTrack}
          hubName={channel.name}
          trackNames={trackNames}
          openConversationId={showRightPanel ? selectedDiscussionConversationId : null}
          // As a ticket does: with the panel closed there is no list behind the call's
          // discussion, so it opens on its own and closing it closes the panel.
          onOpenCall={conversationId =>
            setDiscussionUrl({
              open: true,
              conversationId,
              threadOnly: !showRightPanel || threadOnly,
              push: true,
            })
          }
          onDiscussTrack={openConversations}
          {...(isHubMember && { onStartCall: () => setCallPicker(pageCallScope) })}
        />
      </section>
    ) : (
      // The channel's ticket board — kanban and table, search, filters, grouping —
      // over only this track's tickets, from every board they are on. A ticket
      // created here is filed under the track.
      <section className='flex min-h-0 flex-1 flex-col'>
        <EntityLinkContext.Provider value={{ sourceType: 'TRACK', sourceId: selectedTrack.id }}>
          <KanbanBoardScreen
            channelId={channel.id}
            trackId={selectedTrack.id}
            // The track's discussions, beside New ticket as Chat sits beside New on the
            // Files tab — the one way to them from here once the panel is closed.
            headerEndSlot={
              <button
                type='button'
                aria-pressed={showRightPanel && !activeFolderDiscussion && !discussionOwner}
                onClick={openConversations}
                className={cn(
                  'ml-0.5 flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted',
                  showRightPanel && !activeFolderDiscussion && !discussionOwner && 'bg-muted',
                )}
                data-track-category='SdlcHub'
                data-track-name='TrackTicketsChatOpened'
              >
                <MessageCircle className='size-[14px]' />
                Discussions
              </button>
            }
            // A ticket opens beside the track, in its conversation's details, rather
            // than taking you to the hub's Issues page.
            onOpenTicket={ticket =>
              // With the panel closed there is no list behind the ticket, so it
              // opens on its own and closing it closes the panel.
              setDiscussionUrl({
                open: true,
                conversationId: ticket.conversationId,
                selectedTab: 'details',
                threadOnly: !showRightPanel || threadOnly,
                push: true,
              })
            }
          />
        </EntityLinkContext.Provider>
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

  const sectionNavRows = SECTIONS.map(item => (
    <SdlcSidebarRow
      key={item.id}
      icon={item.icon}
      label={item.label}
      emphasis
      active={section === item.id}
      {...(item.id === 'calls' && { liveCalls: hubLiveCalls })}
      onClick={event => {
        navigateWithinSdlc(`/sdlc/${channelId}/${item.id}`);
        event.currentTarget.blur();
      }}
      trackName='SectionChanged'
      trackMetadata={{ section: item.id, channelId: channel.id }}
    />
  ));
  const openNewArtifactType = (): void => {
    setTypeName('');
    setTypeDialogOpen(true);
  };

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
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col border-t border-sidebar-border-muted pt-3',
              railOpen ? 'px-3' : 'px-2',
            )}
          >
            <SdlcHubHeader
              open={railOpen}
              collapsed={railCollapsed}
              hubName={channel.name}
              onToggleRail={toggleRail}
              onOpenSwitcher={() => setHubSwitcherOpen(true)}
              onAddMembers={() => setMembersDialog(true)}
            />
            {railOpen && (
              // The hub's pages stay put; Tracks and Artifacts share what is left, each
              // scrolling on its own once they don't both fit.
              <nav
                aria-label='Hub'
                className='no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-0.5 pb-3'
              >
                <div className='shrink-0'>{sectionNavRows}</div>
                <div className='h-5 shrink-0' />
                <div className='flex min-h-0 flex-1 flex-col gap-3'>
                  <SdlcSidebarGroup
                    id='sdlc-sidebar-tracks'
                    title='Tracks'
                    count={openTracks.length}
                    rows={
                      Math.max(openTracks.length, 1) +
                      (closedTracks.length > 0 ? 1 : 0) +
                      (showClosedTracks ? closedTracks.length : 0)
                    }
                    action={{
                      label: 'New track',
                      trackName: 'NewTrackOpened',
                      onClick: () => setTrackDialog(true),
                    }}
                  >
                    {openTracks.map(track => (
                      <SdlcSidebarRow
                        key={track.id}
                        icon={Layers}
                        appIcon={track.icon}
                        liveCalls={liveCallCounts.get(track.id)}
                        label={track.name}
                        active={selectedTrackId === track.id}
                        title={track.description || track.name}
                        onClick={event => openTrack(track.id, event)}
                        trackName='TrackOpened'
                        trackMetadata={{ trackId: track.id }}
                      />
                    ))}
                    {openTracks.length === 0 && (
                      <SdlcSidebarAddRow
                        label='New track'
                        onClick={() => setTrackDialog(true)}
                        trackName='NewTrackOpened'
                      />
                    )}
                    {/* Finished work is out of the way but not gone — the same place it
                      would be looked for. */}
                    {closedTracks.length > 0 && (
                      <>
                        <button
                          type='button'
                          onClick={() => setShowClosedTracks(!showClosedTracks)}
                          className='flex h-8 w-full items-center rounded-[10px] px-3 text-left text-xs text-sidebar-foreground/60 transition-colors hover:text-sidebar-accent-foreground'
                          data-track-category='SdlcHub'
                          data-track-name='ClosedTracksToggled'
                        >
                          {showClosedTracks
                            ? 'Hide completed & parked'
                            : `Show ${closedTracks.length} completed & parked`}
                        </button>
                        {showClosedTracks &&
                          closedTracks.map(track => (
                            <SdlcSidebarRow
                              key={track.id}
                              icon={Layers}
                              appIcon={track.icon}
                              liveCalls={liveCallCounts.get(track.id)}
                              label={track.name}
                              muted
                              active={selectedTrackId === track.id}
                              title={track.description || track.name}
                              onClick={event => openTrack(track.id, event)}
                              trackName='TrackOpened'
                              trackMetadata={{ trackId: track.id }}
                            />
                          ))}
                      </>
                    )}
                  </SdlcSidebarGroup>
                  <SdlcSidebarGroup
                    id='sdlc-sidebar-artifacts'
                    title='Artifacts'
                    count={typeFolders.length}
                    rows={Math.max(typeFolders.length, 1)}
                    action={{
                      label: 'New artifact type',
                      trackName: 'NewArtifactTypeClicked',
                      onClick: openNewArtifactType,
                    }}
                  >
                    {typeFolders.map(folder => {
                      const isActive =
                        section === 'artifacts' && activeTypeFolder?.id === folder.id;
                      const isRenaming = renameTypeId === folder.id;
                      return (
                        <div
                          key={folder.id}
                          className='group relative'
                          onMouseEnter={() => setHoveredTypeId(folder.id)}
                          onMouseLeave={() =>
                            setHoveredTypeId(current => (current === folder.id ? null : current))
                          }
                        >
                          {isRenaming ? (
                            <div className='flex h-9 w-full items-center gap-3 rounded-[10px] border border-sidebar-border bg-sidebar-accent px-3'>
                              <SdlcSidebarRowIcon icon={Folder} />
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
                                className='h-6 min-w-0 flex-1 rounded-[6px] border border-sidebar-accent-ring bg-background px-1.5 text-sm outline-none'
                                data-track-category='SdlcHub'
                                data-track-name='ArtifactTypeRenamed'
                              />
                            </div>
                          ) : (
                            <>
                              <button
                                type='button'
                                onClick={() =>
                                  navigateWithinSdlc(
                                    `/sdlc/${channelId}/artifacts`,
                                    `?type=${encodeURIComponent(folder.id)}`,
                                  )
                                }
                                {...(isActive && { 'aria-current': 'page' as const })}
                                className={cn(
                                  sdlcSidebarRowClass(isActive),
                                  !isActive &&
                                    'group-hover:bg-sidebar-accent group-hover:text-sidebar-accent-foreground',
                                )}
                                data-track-category='SdlcHub'
                                data-track-name='SectionChanged'
                                data-track-metadata={JSON.stringify({
                                  type: folder.id,
                                  channelId: channel.id,
                                })}
                              >
                                <SdlcSidebarRowIcon icon={Folder} />
                                <span className='min-w-0 flex-1 truncate text-left'>
                                  {folder.name}
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
                                className='absolute right-2 top-1/2 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-border hover:text-sidebar-accent-foreground group-hover:flex'
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
                    {typeFolders.length === 0 && (
                      <SdlcSidebarAddRow
                        label='New artifact type'
                        onClick={openNewArtifactType}
                        trackName='NewArtifactTypeClicked'
                      />
                    )}
                  </SdlcSidebarGroup>
                </div>
              </nav>
            )}
          </div>
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
            <header
              className={cn(
                'z-10 flex h-[52px] shrink-0 items-center justify-between gap-4 border-b bg-background/95 backdrop-blur',
                // On a track's page the bar is the page's heading, so it lines up with
                // the page, and the tab row under it draws the rule.
                onTrackPage ? 'border-transparent px-7' : 'px-5',
              )}
            >
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
                ) : section === 'releases' && openReleaseId ? (
                  <SdlcReleaseBreadcrumb
                    releaseId={openReleaseId}
                    canvasId={selectedCanvasId}
                    onBack={() => navigateWithinSdlc(`/sdlc/${channelId}/releases`)}
                    onOpenRelease={() => openRelease(openReleaseId)}
                  />
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
                  // A track's page starts with its name, and its status beside it: the
                  // bar is its heading.
                  <div className='flex min-w-0 flex-1 items-center gap-2'>
                    <IconPicker
                      value={selectedTrack.icon}
                      onChange={icon => setTrackIcon(selectedTrack.id, icon)}
                      size={18}
                      className='-ml-1.5'
                      subject='track'
                      hint='Shown beside the track’s name.'
                      placeholder={<Layers className='size-[18px]' aria-hidden='true' />}
                      trackCategory='SdlcHub'
                      trackPrefix='Track'
                      groups={TRACK_ICON_GROUPS}
                    />
                    <h1 className='flex min-w-0 items-center'>{renderTrackName(selectedTrack)}</h1>
                    {renderTrackStatus(selectedTrack)}
                  </div>
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
                {/* A track's page has its own Chat beside New in the file list. */}
                {chatPanelAvailable && !showRightPanel && !onTrackPage ? (
                  <Button
                    size='icon'
                    variant='ghost'
                    className='size-7 rounded-lg'
                    aria-label='Discussions'
                    title='Discussions'
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
                    header, beside the conversation they act on. The hub's Calls page
                    has none: it starts calls itself, and a ticket or Ask AI there
                    would be about nothing on it. */}
                {showRightPanel || section === 'calls' ? null : (
                  <div className='flex min-w-0 items-center gap-1.5 overflow-hidden [&_button]:!size-7 [&_button]:!rounded-lg'>
                    {panelScopeActions('header')}
                  </div>
                )}
              </div>
            </header>
            <main className='flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
              {openFolder && channel ? (
                <SdlcFolderPage
                  liveCallCounts={liveCallCounts}
                  key={openFolder.id}
                  channelId={channel.id}
                  folder={openFolder}
                  rootType={openFolderIsTrack ? 'TRACK' : 'FOLDER'}
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
              ) : section === 'releases' ? (
                <SdlcReleases
                  projectId={channel.projectId ?? null}
                  repositories={channelRepos}
                  openReleaseId={openReleaseId}
                  onOpenRelease={openRelease}
                  onOpenTicket={openReleaseTicket}
                  onOpenCanvas={openReleaseCanvas}
                  onConnectRepository={() => setHubDialog('manage')}
                />
              ) : (
                <>
                  {onTrackPage && selectedTrack && (
                    // Under the name, its tabs: one per kind of thing it holds, as a
                    // channel's are under its name. Out of the scroll, so they stay in
                    // view as a tab scrolls.
                    <div
                      className={cn(
                        'shrink-0 border-b px-7 pb-2 transition-colors',
                        trackPageScrolled ? 'border-border' : 'border-transparent',
                      )}
                    >
                      {renderTrackTabs()}
                    </div>
                  )}
                  <div
                    onScroll={event => setTrackPageScrolled(event.currentTarget.scrollTop > 0)}
                    className={cn(
                      'min-h-0 flex-1 overflow-auto bg-background p-7',
                      // Under the tabs. Files fills the tab and scrolls its own rows,
                      // which fade out at the bottom edge, so no gap is left under it.
                      onTrackPage && 'flex flex-col pt-4',
                      onTrackPage && (trackTab === 'files' || trackTab === 'calls') && 'pb-0',
                      // The ticket board brings its own header, padding and scrolling.
                      onTrackPage && trackTab === 'tickets' && 'p-0',
                      // The hub's calls fill the page and scroll their own rows.
                      section === 'calls' && 'flex flex-col pb-0',
                    )}
                  >
                    {section === 'overview' && (
                      <section>
                        <h1 className='mb-5 text-2xl font-semibold tracking-tight'>
                          {channel.name}
                        </h1>
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
                        <div className='mt-5 overflow-hidden rounded-xl border bg-background'>
                          <Metric
                            label='Hub Knowledge ready'
                            value={String(readyCount)}
                            icon={ShieldCheck}
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
                    {section === 'calls' && (
                      // Every call in the hub, as a track's Calls tab lists its own. A
                      // call's discussion opens beside the list on its own: the hub has
                      // no list of discussions to go back to.
                      <SdlcCalls
                        channelId={channel.id}
                        track={null}
                        hubName={channel.name}
                        trackNames={trackNames}
                        openConversationId={
                          showRightPanel ? selectedDiscussionConversationId : null
                        }
                        onOpenCall={conversationId =>
                          setDiscussionUrl({
                            open: true,
                            conversationId,
                            threadOnly: true,
                            push: true,
                          })
                        }
                        {...(isHubMember && { onStartCall: () => setCallPicker(pageCallScope) })}
                      />
                    )}
                  </div>
                </>
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
                      discussionScope={itemDiscussionScope ?? NO_DISCUSSIONS}
                      selectedConversationId={selectedDiscussionConversationId}
                      threadOnly={threadOnly}
                      headerRule={!onTrackPage}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      onClose={closeConversations}
                      listActions={panelScopeActions('panel')}
                      title={activeFolderDiscussion.name}
                      renderConversationBadge={renderItemConversationBadge}
                      scopeHeader={{
                        name: activeFolderDiscussion.name,
                        icon: discussionScopeIcon(activeFolderDiscussion),
                        // Every item's conversations sit inside the track's, however
                        // they were reached, so each has the same way back out.
                        onExit: openConversations,
                        ...(!isOpenOnPage(activeFolderDiscussion) && {
                          onOpen: () =>
                            openDiscussedItem(activeFolderDiscussion, activeFolderDiscussion.name),
                        }),
                      }}
                      threadSubject={threadSubject}
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
                      discussionScope={canvasDiscussionScope ?? NO_DISCUSSIONS}
                      selectedConversationId={selectedDiscussionConversationId}
                      threadOnly={threadOnly}
                      headerRule={!onTrackPage}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      onClose={closeConversations}
                      listActions={panelScopeActions('panel')}
                      title={discussionOwner.title}
                      threadSubject={threadSubject}
                    />
                  ) : hubCallThreadOwner ? (
                    <SdlcChatPanel
                      key='hub-call'
                      channelId={channel.id}
                      discussion={{
                        ...(repo && { repoId: repo.id }),
                        ownerType: hubCallThreadOwner.type,
                        ownerId: hubCallThreadOwner.id,
                      }}
                      discussionScope={NO_DISCUSSIONS}
                      selectedConversationId={selectedDiscussionConversationId}
                      threadOnly
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      onClose={closeConversations}
                      title={channel.name}
                      threadSubject={threadSubject}
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
                      discussionScope={trackDiscussionScope ?? NO_DISCUSSIONS}
                      selectedConversationId={selectedDiscussionConversationId}
                      threadOnly={threadOnly}
                      headerRule={!onTrackPage}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      onClose={closeConversations}
                      listActions={panelScopeActions('panel')}
                      title={selectedTrack.name}
                      renderConversationBadge={renderFolderConversationBadge}
                      threadSubject={threadSubject}
                    />
                  ) : releaseThreadAvailable && releaseThreadId ? (
                    <ThreadNavigationContext.Provider value={releaseThreadNavigation}>
                      <SdlcReleaseThread releaseId={releaseThreadId} onClose={closeConversations} />
                    </ThreadNavigationContext.Provider>
                  ) : null}
                </EntityLinkContext.Provider>
              </Panel>
            </>
          ) : null}
        </ResizableGroup>
      </div>

      {callPicker ? (
        <CallParticipantsSelectionModal
          isOpen
          onClose={() => setCallPicker(null)}
          channelId={channel.id}
          callDisplayName={callPicker.name}
          {...(callPicker.link ? { sdlcLink: callPicker.link } : {})}
        />
      ) : null}

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
                  openArtifactCreateFrom(folder, source);
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
      <SdlcHubSwitcher
        open={hubSwitcherOpen}
        onOpenChange={setHubSwitcherOpen}
        hubs={hubOptions}
        currentHubId={channel.id}
        onSelect={nextChannelId => void navigate(`/sdlc/${nextChannelId}/overview`)}
        onNewHub={() => setHubDialog('create')}
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
            returnFocusToFileList();
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
                returnFocusToFileList();
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
                {readerTitle || 'Artifact'}
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
