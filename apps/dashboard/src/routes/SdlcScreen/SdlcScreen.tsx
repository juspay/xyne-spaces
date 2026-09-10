import {
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
  isBaselineCanvasType,
  SDLC_BASELINE_COUNT,
  SDLC_ENTITY_TYPES,
  SDLC_RELATION_TYPES,
  type SdlcEntityType,
  type SdlcRelationType,
  type SdlcSetupStatus,
  type SdlcCallLink,
  SDLC_TRACK_FLAT_RELATION,
  TicketStatusV2,
  TicketPriority,
} from '@xyne/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  FileText,
  Folder,
  ExternalLink,
  Maximize2,
  GitBranch,
  Layers,
  Link2,
  PanelLeft,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  Users,
  X,
} from 'lucide-react';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import NotFoundScreen from '../NotFoundScreen/NotFoundScreen';
import { SdlcHubDialog } from './SdlcHubDialog';
import {
  SdlcHubPicker,
  persistSdlcSectionHeights,
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
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { TicketToken } from '@xyne/icons';
import { CreateTicketModal } from '../../components/Tickets/CreateTicketModal/CreateTicketModal';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import { Panel, ResizableGroup, Separator } from '../../components/ui/Resizable/Resizable';
import {} from '../../components/ui/Select';
import { v4 as uuidv4 } from 'uuid';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { SdlcChatPanel } from './SdlcChatPanel';
import { CallTriggerModal } from '../../components/Call/CallTriggerModal/CallTriggerModal';
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
import { useExternalDebuggerStore } from '../../store/useExternalDebuggerStore';
import CanvasScreen from '../../components/Canvas/CanvasScreen';
import ThreadMessages from '../../components/Chat/ThreadPannel';
import {
  isElectronApp,
  openStandaloneWindow,
  shouldOpenInNewWindow,
} from '../../utils/electronApp';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import KanbanBoardScreen from '../KanbanBoardScreen/KanbanBoardScreen';
import { buildSdlcArtifactCreationPrompt } from './artifactCreationPrompt';
import { shouldLoadSdlcWikiPages, shouldLoadSdlcWikiRun } from './sdlcWikiQueryPolicy';
import {
  SdlcWikiSection,
  SdlcWikiSidebarTree,
  type SdlcWikiPage,
  type SdlcWikiRun,
  type SdlcWikiStartInput,
} from './SdlcWikiSection';
import { SdlcDebuggerPanel } from './SdlcDebuggerPanel';
import { SdlcActivityPreview } from './SdlcActivityPreview';
import { EntityLinkContext, type EntityLinkScope } from '../../contexts/EntityLinkContext';
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
  sdlcRightPanelMode,
  shouldCloseInvalidSdlcConversationDeepLink,
  shouldStartFreshSdlcAssistant,
} from './sdlcChatPolicy';
import { formatRelativeTime } from '../../utils/dateUtils';
import Avatar from '../../components/ui/Avatar/Avatar';
import { UserHoverWrapper } from '../../components/ui/UserMentionPopover/UserMentionPopover';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { Popover } from '../../components/ui/Popover';
import {
  SdlcFinderColumn,
  SdlcFinderPreview,
  type SdlcFinderCanvas,
  type SdlcFinderStep,
} from './SdlcFinder';
import { type SdlcTicket } from './ticketPolicy';
import { linkedTicketIds } from './artifactTicketPolicy';
import {
  canDebugRepoKnowledge,
  isRepoKnowledgeRunning,
  repoKnowledgeAction,
  repoKnowledgeControl,
  repoKnowledgeState,
  type RepoKnowledgeControl,
} from './repoKnowledgePolicy';

type Section = 'overview' | 'wiki' | 'baseline' | 'tracks' | 'tickets' | 'artifacts';

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
  { id: 'baseline', label: 'Repo Knowledge', icon: ShieldCheck },
  // Tracks are the sidebar's own list now, not a page, so they leave this nav.
  { id: 'tickets', label: 'Issues', icon: CircleDot },
];

// Artifacts and tracks have no row in the nav above — both are reached from the
// sidebar's own lists — but their URLs still have to resolve. An id missing here
// silently falls back to Overview rather than erroring.
/** How wide the sidebar may be dragged, and the point below which it folds. */
/**
 * Sizes the rename field to the text it holds, measured rather than estimated.
 * The mirror's content is set here instead of waiting for React so the width
 * tracks the keystroke that caused it.
 */
function sizeNameFieldToText(input: HTMLInputElement): void {
  const mirror = input.parentElement?.querySelector('[data-name-mirror]');
  if (!(mirror instanceof HTMLElement)) return;
  mirror.textContent = input.value || ' ';
  input.style.width = `${Math.ceil(mirror.getBoundingClientRect().width) + 2}px`;
}

/** Match the updateTrack mutator's own caps. */
/** Only priorities worth interrupting a row for; LOW is the default and stays quiet. */
const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'Low',
  [TicketPriority.MEDIUM]: 'Medium',
  [TicketPriority.HIGH]: 'High',
  [TicketPriority.CRITICAL]: 'Critical',
};

/** Matches the reader's exit animation, so it unmounts as the panel leaves. */
const READER_EXIT_MS = 200;

const TRACK_NAME_LIMIT = 120;
const TRACK_DESCRIPTION_LIMIT = 2000;

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 360;
/** Drag narrower than this and the sidebar folds to its rail instead of resisting. */
const SIDEBAR_COLLAPSE_AT = 150;
/** Width of the folded rail, and of the panel it floats out on hover. Both are
 *  fixed: a rail that inherited a 480px drag would cover half the page to show a
 *  few icons' worth of lists. */
const SIDEBAR_RAIL_WIDTH = 52;
const SIDEBAR_HOVER_WIDTH = 260;

/** Track status, as the heading pill presents it. */
const TRACK_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ARCHIVED', label: 'Archived' },
] as const;

/**
 * Status colour rides on a dot, not the label. The status tokens are plain hex
 * variables, so Tailwind cannot tint them per theme, and a coloured label ends up
 * either washed out on dark or short of contrast on light. A dot in the token
 * colour beside a `text-foreground` label reads clearly in both, and keeps the
 * status legible without relying on colour to carry it.
 */
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

const BASELINE_LABELS: Record<string, string> = {
  CORE_CODE_MAP: 'Core Code Map',
  FRONTEND_DESIGN_SYSTEM: 'Frontend Design System',
  BACKEND_DESIGN_SYSTEM: 'Backend Design System',
  CODE_LINT_STANDARDS: 'Code & Lint Standards',
  COMMIT_STANDARDS: 'Commit Standards',
  RUN_GUIDE: 'Run Guide',
  TEST_GUIDE: 'Test Guide',
};

const EMPTY_CONTEXT_SELECTIONS: ContextSelections = {
  channels: [],
  tickets: [],
  canvases: [],
  transcripts: [],
  recordings: [],
};

function setupUpdatedAtLabel(value?: number): string {
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
  } = useParams<{
    workspaceId?: string;
    channelId?: string;
    section?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthContextValues();
  const section: Section = (
    routeSection && SECTION_IDS.has(routeSection) ? routeSection : 'overview'
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
  // Repositories in a hub coexist; there is no selection. Repo Knowledge and Wiki
  // still address one repository and read the first until they cover all of them.
  const selectedRepo = channelRepos[0];
  const repo = useMemo(
    () =>
      selectedRepo && channel ? { ...selectedRepo, channel, channelId: channel.id } : undefined,
    [selectedRepo, channel],
  );
  const repoId = repo?.id;
  const zero = useZero();
  const [busy, setBusy] = useState<string | null>(null);
  const [artifactDialog, setArtifactDialog] = useState<{ id: string; name: string } | null>(null);
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
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeName, setTypeName] = useState('');
  const [renameTypeId, setRenameTypeId] = useState<string | null>(null);
  const [renameTypeName, setRenameTypeName] = useState('');
  const [hoveredTypeId, setHoveredTypeId] = useState<string | null>(null);
  const [trackDialog, setTrackDialog] = useState(false);
  // Sidebar shape is the reader's preference, not the workspace's, so it lives
  // in the preferences machine and comes back from IndexedDB on their next visit.
  const showClosedTracks = useUserPreference('sdlcShowClosedTracks');
  const setShowClosedTracks = (next: boolean): void =>
    setUserPreference('sdlcShowClosedTracks', next);
  // Collapsed to a rail of icons. Hovering floats the full sidebar over the page
  // rather than widening the layout, so the reading area keeps every pixel.
  const finderGroupBy = useUserPreference('sdlcFinderGroupBy');
  const railCollapsed = useUserPreference('sdlcSidebarCollapsed');
  const storedRailWidth = useUserPreference('sdlcSidebarWidth');
  const [railHovered, setRailHovered] = useState(false);
  // Live width while a drag is in flight; the preference is written once, on
  // release, so a drag is one stored value rather than one per pointer move.
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
      // Dragged in past the fold point, the sidebar gets out of the way rather
      // than sitting at a width too narrow to read.
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

    // The pointer leaves the handle almost immediately, so the cursor is held on
    // the body for the length of the drag.
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
  /** Null when not editing; the draft text while the description is being written. */
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  /** Set when Escape closes the editor, so the blur that follows does not save. */
  const descriptionAbandoned = useRef(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameAbandoned = useRef(false);
  /**
   * The open path down the folder tree, below the track. Column n renders the
   * children of step n, so this array is both the breadcrumb and the set of
   * live queries.
   */
  /** The artifact a single click is previewing, if any. */
  const [previewCanvasId, setPreviewCanvasId] = useState<string | null>(null);
  /** The artifact being read in the side panel, if any. */
  const [readerCanvasId, setReaderCanvasId] = useState<string | null>(null);
  /** True while the reader plays its exit; it stays mounted until that finishes. */
  const [readerClosing, setReaderClosing] = useState(false);

  /**
   * Dismissing has to outlive the click: unmounting on the spot removes the
   * element before its exit animation can run, which is why closing used to snap
   * while opening slid.
   */
  const closeReader = (): void => {
    setReaderClosing(true);
    window.setTimeout(() => {
      setReaderCanvasId(null);
      setReaderClosing(false);
    }, READER_EXIT_MS);
  };
  /**
   * The folder whose conversations the right panel is showing, if any. Folder
   * discussions share the track's panel rather than opening a surface of their
   * own, so this is what decides which of the two the panel is bound to.
   */
  const [folderDiscussion, setFolderDiscussion] = useState<{ id: string; name: string } | null>(
    null,
  );
  /** Set to the parent a new folder is being created under; null when closed. */
  const [newFolderParent, setNewFolderParent] = useState<SdlcFinderStep | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  /** Where a new artifact should land; null when the type chooser is closed. */
  const [newArtifactParent, setNewArtifactParent] = useState<SdlcFinderStep | null>(null);
  /** A folder a just-created artifact must be filed into, applied after creation. */
  const [pendingArtifactFolder, setPendingArtifactFolder] = useState<string | null>(null);
  /** The row currently being dragged in the finder, if any. */
  const [draggingItem, setDraggingItem] = useState<{
    type: 'FOLDER' | 'CANVAS';
    id: string;
  } | null>(null);
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [relatedSourceId, setRelatedSourceId] = useState<string | null>(null);
  const [linkTargetType, setLinkTargetType] = useState('MESSAGE');
  const [linkTargetId, setLinkTargetId] = useState('');
  const automaticAccessChecksRef = useRef(new Set<string>());
  const externalDebuggerTarget = useExternalDebuggerStore(state => state.target);
  const openExternalDebugger = useExternalDebuggerStore(state => state.open);
  const updateExternalDebugger = useExternalDebuggerStore(state => state.update);
  const closeExternalDebugger = useExternalDebuggerStore(state => state.close);
  const { selectedAgentSlug, setSelectedAgentSlug } = useSelectedAgent();

  useEffect(() => {
    if (!channelId && Array.isArray(channels) && channels[0]) {
      void navigate(`/sdlc/${channels[0].id}/overview`, { replace: true });
    }
  }, [navigate, channelId, channels]);

  const canvases = useMemo(() => {
    if (!channel) return [];
    return (channel.canvasFolders ?? []).flatMap(folder => folder.canvases ?? []);
  }, [channel]);
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
  const selectedTrack = tracks.find(track => track.id === selectedTrackId);
  // Hooks cannot run inside renderTrack, which is only called on the track page,
  // so the owner is looked up here and read there.
  const trackOwner = useUser(selectedTrack?.createdBy ?? '');

  const finderPathByTrack = useUserPreference('sdlcFinderPathByTrack');
  const finderPath: SdlcFinderStep[] = selectedTrackId
    ? (finderPathByTrack[selectedTrackId] ?? [])
    : [];
  /** Stored per track, so each one remembers where it was left open. */
  const setFinderPath = (next: SdlcFinderStep[]): void => {
    if (!selectedTrackId) return;
    setUserPreference('sdlcFinderPathByTrack', { ...finderPathByTrack, [selectedTrackId]: next });
  };
  // The preview is per visit, not per track: an artifact selected last time is
  // not what you asked to see now. The folder path is remembered; this is not.
  useEffect(() => {
    setPreviewCanvasId(null);
  }, [selectedTrackId]);
  // What the sidebar shows standing: work in flight, with anything finished or
  // parked folded behind a toggle rather than dropped.
  const openTracks = useMemo(
    () => tracks.filter(track => track.status !== 'COMPLETED' && track.status !== 'ARCHIVED'),
    [tracks],
  );
  const closedTracks = useMemo(
    () => tracks.filter(track => track.status === 'COMPLETED' || track.status === 'ARCHIVED'),
    [tracks],
  );
  const wikiQuery = useQuery({
    queryKey: ['sdlc-wiki-pages', repoId],
    queryFn: async () => {
      const response = await apiInstance.get<{ success: boolean; pages: SdlcWikiPage[] }>(
        `/sdlc/repositories/${encodeURIComponent(repoId!)}/wiki`,
      );
      return response.data.pages;
    },
    enabled: Boolean(repoId && shouldLoadSdlcWikiPages(section)),
  });
  const wikiRunQuery = useQuery({
    queryKey: ['sdlc-wiki-run', repoId],
    queryFn: async () => {
      const response = await apiInstance.get<{ success: boolean; run: SdlcWikiRun | null }>(
        `/sdlc/repositories/${encodeURIComponent(repoId!)}/wiki/run`,
      );
      return response.data.run;
    },
    enabled: Boolean(repoId && shouldLoadSdlcWikiRun(section)),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: query => {
      const phase = query.state.data?.phase;
      const knowledgePhase = query.state.data?.knowledge?.phase;
      return (phase &&
        ['QUEUED', 'PREPARING', 'BOOTSTRAPPING', 'PROCESSING', 'VALIDATING', 'CORRECTING'].includes(
          phase,
        )) ||
        (knowledgePhase && ['QUEUED', 'GENERATING'].includes(knowledgePhase))
        ? 2_000
        : false;
    },
  });
  const wikiPages = wikiQuery.data ?? [];
  const refetchWikiPages = wikiQuery.refetch;
  const wikiRunUpdatedAt = wikiRunQuery.data?.updatedAt;
  useEffect(() => {
    if (!wikiRunUpdatedAt || section !== 'wiki') return;
    void refetchWikiPages();
  }, [refetchWikiPages, section, wikiRunUpdatedAt]);
  const selectedWikiPage = wikiPages.find(page => page.canvasId === selectedCanvasId);
  const assistantCanvas = useMemo(
    () =>
      selectedCanvas
        ? { canvasId: selectedCanvas.id, title: selectedCanvas.title }
        : selectedWikiPage
          ? { canvasId: selectedWikiPage.canvasId, title: selectedWikiPage.title }
          : null,
    [selectedCanvas, selectedWikiPage],
  );
  const baseline = useMemo(
    () =>
      canvases.filter(
        canvas =>
          isBaselineCanvasType(canvas.sdlcArtifact?.artifactType) &&
          canvas.sdlcArtifact?.artifactStatus !== 'REFRESH_CANDIDATE',
      ),
    [canvases],
  );
  const baselineSidebarPages = useMemo<SdlcWikiPage[]>(
    () =>
      baseline.map(canvas => {
        const title = BASELINE_LABELS[canvas.sdlcArtifact?.artifactType ?? ''] || canvas.title;
        return {
          canvasId: canvas.id,
          title,
          path: title,
          folderPath: '',
          syncedAt: new Date(canvas.updatedAt).toISOString(),
          updatedAt: new Date(canvas.lastEditedAt ?? canvas.updatedAt).toISOString(),
        };
      }),
    [baseline],
  );
  const folders = useMemo(() => (repo ? (repo.channel?.canvasFolders ?? []) : []), [repo]);
  const typeFolders = useMemo(
    () =>
      folders
        .filter(folder => folder.name !== 'Baseline')
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
    const repoLoaded = !!repo;
    const query = relatedSearchQuery.trim();
    if (!artifactTrack || !repoLoaded || query.length < 2) {
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
  }, [relatedSearchQuery, artifactTrack, repo, trackByCanvasId]);
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
                    // Both edges count: the track's own discussions, and the flat
                    // rows folders inside it file so their conversations roll up.
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
                link.sourceType === 'FOLDER' &&
                link.sourceId === folderDiscussion.id &&
                link.targetType === 'CONVERSATION' &&
                link.relationType === 'DISCUSSION',
            )
            .map(link => link.targetId)
        : [],
    [links, folderDiscussion],
  );
  /**
   * Every folder in the hub, once. This replaces the per-open-column lookup the
   * finder used to run, and is what lets a conversation in the track's list name
   * the folder it came from without a fetch of its own.
   */
  const [hubFolderRows] = useCachedQuery(
    queries.getSdlcFoldersByChannel({ channelId: channelId || '' }),
    { enabled: Boolean(channelId) },
  );
  const folderById = useMemo(
    () => new Map((hubFolderRows ?? []).map(row => [row.id, { id: row.id, name: row.name }])),
    [hubFolderRows],
  );
  /** Which folder each conversation was started in, for the list's marker. */
  const folderIdByConversationId = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of links) {
      if (
        link.sourceType === 'FOLDER' &&
        link.targetType === 'CONVERSATION' &&
        link.relationType === 'DISCUSSION'
      ) {
        map.set(link.targetId, link.sourceId);
      }
    }
    return map;
  }, [links]);
  // A folder belongs to one track, so switching tracks cannot keep its binding.
  useEffect(() => {
    setFolderDiscussion(null);
  }, [selectedTrackId]);
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
  const [channelTicketRows] = useCachedQuery(
    queries.sdlcTicketsByChannel({ channelId: channel?.id ?? '' }),
    { enabled: Boolean(channel?.id) },
  );
  const channelTicketCount = Array.isArray(channelTicketRows) ? channelTicketRows.length : 0;
  const selectedTicketId = routeSearchParams.get('ticket');
  // ThreadMessages keys off the conversation, so a `?ticket=` deep link has to
  // read the row to find one.
  const [selectedTicketRow] = useCachedQuery(
    queries.ticketRowById({ ticketId: selectedTicketId ?? '' }),
    { enabled: Boolean(selectedTicketId) },
  );
  const closeTicketPanel = useCallback((): void => {
    const next = new URLSearchParams(location.search);
    next.delete('ticket');
    const search = next.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
  }, [location.pathname, location.search, navigate]);
  const [renderedConversationId, setRenderedConversationId] = useState<string | null>(null);
  const chatLayout = sdlcChatLayout({
    chatParam: routeSearchParams.get('chat'),
    discussionParam: routeSearchParams.get('discussion'),
  });
  const sdlcChatTab = chatLayout.activeTab;
  const discussionOpen =
    routeSearchParams.get('discussion') === '1' && sdlcChatTab === 'conversations';
  const rightPanelMode = sdlcRightPanelMode({
    chatOpen: chatLayout.panelOpen,
    debuggerOpen: externalDebuggerTarget?.repoId === repoId,
  });
  const rightPanelOpen = rightPanelMode !== 'closed';
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
        selectedTicketId,
        selectedConversationId: selectedDiscussionConversationId,
        ticketIds: tickets.map(ticket => ticket.id),
        canvases,
        links,
      }),
    [
      canvases,
      links,
      selectedCanvas?.id,
      selectedDiscussionConversationId,
      selectedTicketId,
      selectedWikiPage,
      tickets,
    ],
  );

  // Converting a discussion to a ticket leaves the artifact link on the
  // conversation, not on the ticket, so the ticket alone resolves to nothing.
  const ticketDiscussion = useMemo(() => {
    const conversationId = selectedTicketRow?.conversationId;
    if (!selectedTicketId || !conversationId) return null;
    const canvasId = links.find(
      link =>
        link.sourceType === 'CANVAS' &&
        link.targetType === 'CONVERSATION' &&
        link.relationType === 'DISCUSSION' &&
        link.targetId === conversationId,
    )?.sourceId;
    return canvasId ? { canvasId, conversationId } : null;
  }, [links, selectedTicketId, selectedTicketRow]);

  // A deep link names a conversation or a ticket, not a place. Both hang off an
  // artifact, so open that one — a ticket with none stays on the board.
  const canvasSectionFix = useMemo(() => {
    const canvasId =
      selectedCanvasId ?? discussionContext?.owner.canvasId ?? ticketDiscussion?.canvasId ?? null;
    if (!canvasId) return null;
    const canvas = canvases.find(item => item.id === canvasId);
    if (!canvas) return null;
    const artifactType = canvas.sdlcArtifact?.artifactType;
    const target = isBaselineCanvasType(artifactType)
      ? { section: 'baseline', type: null }
      : artifactType === 'WIKI'
        ? { section: 'wiki', type: null }
        : { section: 'artifacts', type: canvas.folderId ?? null };
    const settled =
      section === target.section &&
      selectedCanvasId === canvasId &&
      (target.type === null || activeTypeFolderId === target.type);
    return settled ? null : { ...target, canvasId, discussion: ticketDiscussion };
  }, [
    activeTypeFolderId,
    canvases,
    discussionContext,
    section,
    selectedCanvasId,
    ticketDiscussion,
  ]);

  useEffect(() => {
    if (!canvasSectionFix) return;
    const search = new URLSearchParams(location.search);
    search.set('canvas', canvasSectionFix.canvasId);
    if (canvasSectionFix.type) search.set('type', canvasSectionFix.type);
    else search.delete('type');
    if (canvasSectionFix.discussion) {
      // The ticket has served its purpose; its thread is what to show.
      search.delete('ticket');
      search.set('discussion', '1');
      search.set('chat', 'conversations');
      search.set('conversation', canvasSectionFix.discussion.conversationId);
    }
    void navigate(
      `/sdlc/${channelId}/${canvasSectionFix.section}?${search.toString()}${location.hash}`,
      { replace: true },
    );
  }, [canvasSectionFix, channelId, location.hash, location.search, navigate]);

  // A track discussion has no canvas owner, so it would be stripped below.
  const deepLinkedTrackId = useMemo(() => {
    if (!selectedDiscussionConversationId || discussionContext) return null;
    return (
      links.find(
        link =>
          link.sourceType === 'TRACK' &&
          link.targetType === 'CONVERSATION' &&
          // The flat row too, so a link to a conversation started in a folder
          // still lands on the track that folder belongs to.
          (link.relationType === 'DISCUSSION' || link.relationType === SDLC_TRACK_FLAT_RELATION) &&
          link.targetId === selectedDiscussionConversationId,
      )?.sourceId ?? null
    );
  }, [links, selectedDiscussionConversationId, discussionContext]);

  useEffect(() => {
    if (!deepLinkedTrackId || deepLinkedTrackId === selectedTrackId) return;
    const search = new URLSearchParams(location.search);
    search.set('track', deepLinkedTrackId);
    void navigate(`/sdlc/${channelId}/tracks?${search.toString()}${location.hash}`, {
      replace: true,
    });
  }, [channelId, deepLinkedTrackId, location.hash, location.search, navigate, selectedTrackId]);

  useEffect(() => {
    if (
      !shouldCloseInvalidSdlcConversationDeepLink({
        dataLoaded: repoQueryDetails.type === 'complete' && linkRows !== undefined,
        discussionOpen,
        selectedConversationId: selectedDiscussionConversationId,
        discussionContextResolved:
          Boolean(discussionContext) ||
          Boolean(deepLinkedTrackId) ||
          Boolean(section === 'tracks' && selectedTrackId),
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
    deepLinkedTrackId,
  ]);
  const discussionOwner = discussionContext?.owner ?? null;
  const discussionSurface = discussionContext?.surface ?? null;
  const chatPanelAvailable =
    Boolean(discussionOwner && discussionSurface) || Boolean(section === 'tracks' && selectedTrack);
  const showRightPanel = rightPanelMode === 'debugger' || (rightPanelOpen && chatPanelAvailable);
  const chatPanelShowing = rightPanelMode === 'chat' && rightPanelOpen && chatPanelAvailable;
  const discussionConversationIds = useMemo(
    () => discussionIdsForOwner(discussionOwner?.canvasId ?? null, links),
    [discussionOwner, links],
  );
  /**
   * The folder binding only holds while the track page is what is on screen: an
   * open artifact owns the panel itself, and leaving the track drops the folder.
   */
  const activeFolderDiscussion =
    folderDiscussion && !discussionOwner && section === 'tracks' && selectedTrack
      ? folderDiscussion
      : null;
  const entityLinkScope = useMemo<EntityLinkScope | null>(() => {
    if (discussionOwner) return { sourceType: 'CANVAS', sourceId: discussionOwner.canvasId };
    if (section === 'tracks' && selectedTrack) {
      // A folder conversation is filed on the folder and, so the track's list
      // stays complete, on the track as well.
      return activeFolderDiscussion
        ? {
            sourceType: 'FOLDER',
            sourceId: activeFolderDiscussion.id,
            rollUpTrackId: selectedTrack.id,
          }
        : { sourceType: 'TRACK', sourceId: selectedTrack.id };
    }
    return null;
  }, [activeFolderDiscussion, discussionOwner, section, selectedTrack]);
  const relatedCanvas = canvases.find(canvas => canvas.id === relatedSourceId);
  const state = repoKnowledgeState(repo ? repo.setupExecution : null);
  const setupRunning = isRepoKnowledgeRunning(state.phase);

  useEffect(() => {
    if (!repoId || externalDebuggerTarget?.repoId !== repoId) return;
    if (repo && externalDebuggerTarget.executionId === repo.setupExecution?.id) {
      updateExternalDebugger(repoId, {
        conversationId: state.conversationId || externalDebuggerTarget.conversationId,
        sessionId: state.sessionId || externalDebuggerTarget.sessionId,
        running: setupRunning,
      });
      return;
    }
    if (wikiRunQuery.data && externalDebuggerTarget.executionId === wikiRunQuery.data.executionId) {
      updateExternalDebugger(repoId, {
        conversationId: wikiRunQuery.data.conversationId || externalDebuggerTarget.conversationId,
        sessionId: wikiRunQuery.data.sessionId,
        running: [
          'QUEUED',
          'PREPARING',
          'BOOTSTRAPPING',
          'PROCESSING',
          'VALIDATING',
          'CORRECTING',
        ].includes(wikiRunQuery.data.phase),
      });
      return;
    }
  }, [
    externalDebuggerTarget,
    repo,
    repoId,
    setupRunning,
    state.conversationId,
    state.sessionId,
    updateExternalDebugger,
    wikiRunQuery.data,
  ]);

  const readyCount = new Set(
    baseline
      .filter(canvas => canvas.sdlcArtifact?.artifactStatus === 'ACTIVE')
      .map(canvas => canvas.sdlcArtifact?.artifactType),
  ).size;
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
  const showAccessWarning = !readReady || !writeReady;
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
  const isAdmin = Boolean(
    repo &&
    repo.channel?.participants?.some(
      participant => participant.userId === auth.userID && participant.role === ChannelRole.ADMIN,
    ),
  );

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

  const callWikiAction = async (
    key: string,
    path: 'generate' | 'refresh' | 'retry' | 'cancel',
    body: unknown,
    success: string,
  ): Promise<void> => {
    await call(
      key,
      async () => {
        await apiInstance.post(`/sdlc/repositories/${repoId!}/wiki/${path}`, body);
        await Promise.all([
          wikiRunQuery.refetch(),
          ...(section === 'wiki' ? [wikiQuery.refetch()] : []),
        ]);
      },
      success,
    );
  };

  const generateWiki = (input: SdlcWikiStartInput): Promise<void> =>
    callWikiAction('wiki-generate', 'generate', input, 'Wiki generation started');
  const refreshWiki = (input: Pick<SdlcWikiStartInput, 'chunkSize' | 'quality'>): Promise<void> =>
    callWikiAction('wiki-refresh', 'refresh', input, 'Wiki refresh started');
  const runKnowledgeControl = (control: RepoKnowledgeControl): Promise<void> => {
    const action = repoKnowledgeAction(control);
    return call(
      action.key,
      () => apiInstance.post(`/sdlc/repositories/${repoId!}/${action.path}`),
      action.success,
    );
  };
  const retryKnowledge = (): Promise<void> => runKnowledgeControl('RETRY');
  const callWikiExecutionAction = (action: 'retry' | 'cancel', success: string): Promise<void> => {
    const executionId = wikiRunQuery.data?.executionId;
    if (!executionId) return Promise.resolve();
    return call(
      `wiki-${action}`,
      async () => {
        await apiInstance.post(
          `/sdlc/repositories/${repoId!}/wiki/runs/${encodeURIComponent(executionId)}/${action}`,
        );
        await Promise.all([
          wikiRunQuery.refetch(),
          ...(section === 'wiki' ? [wikiQuery.refetch()] : []),
        ]);
      },
      success,
    );
  };
  const retryWiki = (): Promise<void> => callWikiExecutionAction('retry', 'Wiki run resumed');
  const cancelWiki = (): Promise<void> => callWikiExecutionAction('cancel', 'Wiki run cancelled');
  const selectedKnowledgeControl = repoKnowledgeControl(state.phase);

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
    event?: ReactMouseEvent | undefined;
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
    if (!repoId) return;

    const withDiscussion = Boolean(options?.withDiscussion);
    if (shouldOpenInNewWindow(options?.event) && openCanvasInWindow(canvasId, withDiscussion)) {
      return;
    }

    setRelatedSourceId(null);
    const search = canvasSearch(canvasId, withDiscussion);
    navigateWithinSdlc(`/sdlc/${channelId}/${section}`, `?${search.toString()}`);
  };

  const openWikiPage = (page: SdlcWikiPage): void => {
    if (!repoId) return;
    setRelatedSourceId(null);
    navigateWithinSdlc(`/sdlc/${channelId}/wiki`, `?canvas=${encodeURIComponent(page.canvasId)}`);
  };

  const closeCanvas = (): void => {
    if (!repoId) return;
    const typeFolder =
      selectedCanvasTypeFolder ?? (section === 'artifacts' ? activeTypeFolder : null);
    if (typeFolder) {
      navigateWithinSdlc(
        `/sdlc/${channelId}/artifacts`,
        `?type=${encodeURIComponent(typeFolder.id)}`,
      );
      return;
    }
    navigateWithinSdlc(`/sdlc/${channelId}/${section}`);
  };

  const setDiscussionUrl = useCallback(
    (input: {
      open: boolean;
      conversationId?: string | null;
      ticketId?: string | null;
      selectedTab?: 'details' | null;
    }): void => {
      const next = new URLSearchParams(location.search);
      if (input.open) {
        next.set('discussion', '1');
        next.set('chat', 'conversations');
      } else {
        next.delete('discussion');
        next.delete('chat');
      }
      if (input.conversationId) next.set('conversation', input.conversationId);
      else next.delete('conversation');
      if (input.conversationId && input.selectedTab) next.set('selectedTab', input.selectedTab);
      else next.delete('selectedTab');
      if (input.ticketId) next.set('ticket', input.ticketId);
      const search = next.toString();
      void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  const openConversations = useCallback(
    (ticketId?: string): void => {
      closeExternalDebugger();
      // The header button is the track's, so it drops any folder binding.
      setFolderDiscussion(null);
      setDiscussionUrl({
        open: true,
        conversationId: null,
        ticketId: ticketId ?? null,
      });
    },
    [closeExternalDebugger, setDiscussionUrl],
  );

  const openFolderConversations = useCallback(
    (folder: { id: string; name: string }): void => {
      closeExternalDebugger();
      setFolderDiscussion(folder);
      setDiscussionUrl({ open: true, conversationId: null });
    },
    [closeExternalDebugger, setDiscussionUrl],
  );

  /**
   * The mark on a conversation in the track's list saying which folder it came
   * from, and taking you to that folder's conversations. Both halves come from
   * data the page already holds.
   */
  const renderFolderConversationBadge = useCallback(
    (conversationId: string): ReactNode => {
      const folderId = folderIdByConversationId.get(conversationId);
      const name = folderId ? folderById.get(folderId)?.name : undefined;
      if (!folderId || !name) return null;
      return (
        // A floor so it never collapses in the sender's line, a ceiling so a long
        // name cannot push the timestamp out of it, an ellipsis in between.
        <button
          type='button'
          onClick={() => openFolderConversations({ id: folderId, name })}
          title={`Conversations in ${name}`}
          aria-label={`Conversations in ${name}`}
          className='inline-flex min-w-[3.75rem] max-w-[9rem] shrink items-center gap-1 rounded bg-foreground/[0.06] px-1 py-px text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.11] hover:text-foreground'
          data-track-category='SdlcHub'
          data-track-name='FolderConversationsOpenedFromList'
        >
          <Folder className='size-[11px] shrink-0 fill-primary/25 text-primary/70' />
          <span className='truncate'>{name}</span>
        </button>
      );
    },
    [folderById, folderIdByConversationId, openFolderConversations],
  );

  const closeConversations = useCallback((): void => {
    setDiscussionUrl({ open: false, conversationId: null });
  }, [setDiscussionUrl]);

  const selectDiscussionConversation = useCallback(
    (conversationId: string | null, options?: { selectedTab?: 'details' }): void => {
      setDiscussionUrl({ open: true, conversationId, selectedTab: options?.selectedTab ?? null });
    },
    [setDiscussionUrl],
  );

  const openSdlcAssistant = useCallback(
    (threadInfo?: ThreadInfo): void => {
      if (!repo) return;
      closeExternalDebugger();
      // Ask AI renders inside the SDLC lane itself (the framed bundle's own
      // XyneAISidebar), so Ask AI changes ship with this lane and never need a
      // parent redeploy.
      const assistantState = xyneAIActor.getSnapshot();
      const actorResearchContext = assistantState.context.researchContext;
      const startFreshChat = shouldStartFreshSdlcAssistant({
        actorOpen: assistantState.matches('open'),
        selectedAgentSlug,
        actorChannelId: assistantState.context.channelId,
        repositoryChannelId: repo.channelId,
        actorRepositoryId:
          actorResearchContext?.type === 'repository' ? actorResearchContext.id : null,
        repositoryId: repo.id,
      });
      setSelectedAgentSlug('sdlc-agent');
      xyneAIActor.send({
        type: 'OPEN',
        contextType: 'chat',
        contextId: repo.channelId,
        channelId: repo.channelId,
        startFreshChat,
        ...(assistantCanvas && { canvasInfo: assistantCanvas }),
        ...(threadInfo && { threadInfo }),
        researchContext: { type: 'repository', id: repo.id, name: repo.name },
      });
    },
    [assistantCanvas, closeExternalDebugger, repo, selectedAgentSlug, setSelectedAgentSlug],
  );

  const askSdlcAssistant = useCallback(
    (query: string, canvas?: { canvasId: string; title: string }, forceFreshChat = false): void => {
      if (!repo) return;
      closeExternalDebugger();
      const assistantState = xyneAIActor.getSnapshot();
      const pinnedContext = assistantState.context.researchContext;
      const needsFreshChat =
        forceFreshChat ||
        !assistantState.matches('open') ||
        selectedAgentSlug !== 'sdlc-agent' ||
        assistantState.context.channelId !== repo.channelId ||
        pinnedContext?.type !== 'repository' ||
        pinnedContext.id !== repo.id;
      setSelectedAgentSlug('sdlc-agent');
      xyneAIActor.send({
        type: 'OPEN',
        contextType: 'chat',
        contextId: repo.channelId,
        channelId: repo.channelId,
        startFreshChat: needsFreshChat,
        ...(canvas && { canvasInfo: canvas }),
        researchContext: { type: 'repository', id: repo.id, name: repo.name },
        initialQuery: query,
      });
    },
    [closeExternalDebugger, repo, selectedAgentSlug, setSelectedAgentSlug],
  );

  const openSdlcDebugger = useCallback(
    (target: Parameters<typeof openExternalDebugger>[0]): void => {
      if (xyneAIActor.getSnapshot().matches('open')) xyneAIActor.send({ type: 'CLOSE' });
      closeConversations();
      openExternalDebugger(target);
    },
    [closeConversations, openExternalDebugger],
  );

  const renderRepoKnowledgeControls = (compact = false): ReactElement | undefined => {
    if (!isAdmin || !repo) return undefined;
    const controlPresentation = {
      GENERATE: {
        icon: Rocket,
        variant: 'default' as const,
      },
      CANCEL: {
        icon: X,
        variant: 'destructive' as const,
      },
      RETRY: {
        icon: RefreshCw,
        variant: 'default' as const,
      },
      REFRESH: {
        icon: RefreshCw,
        variant: 'default' as const,
      },
    }[selectedKnowledgeControl];
    const action = repoKnowledgeAction(selectedKnowledgeControl);
    const Icon = controlPresentation.icon;
    const debugAvailable = canDebugRepoKnowledge({
      isAdmin,
      executionId: repo.setupExecution?.id,
      conversationId: state.conversationId,
    });
    const requiresReadAccess =
      selectedKnowledgeControl === 'GENERATE' || selectedKnowledgeControl === 'REFRESH';

    return (
      <div className='flex items-center gap-2'>
        {debugAvailable && (
          <Button
            variant='ghost'
            size='iconSm'
            className='text-muted-foreground'
            title='Debug generation'
            aria-label='Debug generation'
            data-track-category='SdlcHub'
            data-track-name='RepoKnowledgeDebuggerOpened'
            onClick={() => {
              openSdlcDebugger({
                source: 'sdlc',
                repoId: repo.id,
                executionId: repo.setupExecution!.id,
                conversationId: state.conversationId!,
                sessionId: state.sessionId || null,
                running: setupRunning,
              });
            }}
          >
            <Bug />
          </Button>
        )}
        <Button
          size={compact ? 'sm' : 'default'}
          variant={controlPresentation.variant}
          loading={busy === action.key}
          disabled={busy !== null || (requiresReadAccess && !readReady)}
          onClick={() => void runKnowledgeControl(selectedKnowledgeControl)}
          data-track-category='SdlcHub'
          data-track-name={`RepoKnowledge${selectedKnowledgeControl}Clicked`}
        >
          <Icon size={compact ? 14 : 16} />
          {action.label}
        </Button>
      </div>
    );
  };

  useEffect(() => {
    if (sdlcChatTab !== 'ai') return;
    // Legacy ?chat=ai deep link: the assistant is the global sidebar now, not
    // a panel tab. Open it once and strip the param — keeping the param made
    // this effect re-open the sidebar every time the user closed it.
    if (!repo) return;
    openSdlcAssistant();
    const next = new URLSearchParams(location.search);
    next.delete('chat');
    const search = next.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
  }, [location.pathname, location.search, navigate, openSdlcAssistant, repo, sdlcChatTab]);

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
  };

  const resetArtifactDialog = (): void => {
    setArtifactDialog(null);
    clearArtifactDialogFields();
  };

  const relatedArtifactsForPayload = (): Array<{ canvasId: string; title: string }> =>
    relatedCanvasIds
      .map(id => canvases.find(canvas => canvas.id === id))
      .filter((canvas): canvas is (typeof canvases)[number] => Boolean(canvas))
      .map(canvas => ({ canvasId: canvas.id, title: canvas.title }));

  const createArtifact = (): void => {
    if (!repoId || !repo || !artifactDialog || !artifactTitle.trim() || !artifactTrack) return;
    const related = relatedArtifactsForPayload();
    const query = buildSdlcArtifactCreationPrompt({
      typeLabel: artifactDialog.name,
      folderId: artifactDialog.id,
      title: artifactTitle.trim(),
      repositoryName: repo.name,
      ...(artifactAiPrompt.trim() && { direction: artifactAiPrompt.trim() }),
      ...(related.length > 0 && { relatedArtifacts: related }),
      track: artifactTrack,
    });
    askSdlcAssistant(query, undefined, true);
    resetArtifactDialog();
  };

  const createTicketForArtifact = (canvas: { id: string; title: string }): void => {
    if (!repo) return;
    askSdlcAssistant(
      `Create an implementation ticket for the artifact "${canvas.title}" in repository "${repo.name}". ` +
        `Call spaces-create-ticket with sdlcRepoId ${repo.id} and sourceCanvasId ${canvas.id} so the ticket is linked to this artifact. ` +
        `Read the artifact first and derive the ticket title and description from it; ask me only if something essential is missing.`,
      { canvasId: canvas.id, title: canvas.title },
      true,
    );
  };

  const createBlankArtifact = async (): Promise<void> => {
    if (!repo || !channel || !artifactDialog || !artifactTitle.trim() || !artifactTrack) return;
    const folder = artifactDialog;
    const title = artifactTitle.trim();
    const response = await apiInstance.post<{ artifact: { canvasId: string } }>(
      '/sdlc/claw/artifacts',
      {
        repoId: repo.id,
        channelId: channel.id,
        folderId: folder.id,
        title,
        markdown: `# ${title}\n`,
        trackId: artifactTrack.id,
        ...(relatedCanvasIds.length > 0 && { relatedCanvasIds }),
      },
    );
    resetArtifactDialog();
    const newCanvasId = response.data.artifact.canvasId;
    // Creation always files an artifact at the track's root, so one started from
    // inside a folder is moved there straight after.
    if (pendingArtifactFolder && channel) {
      await moveItemAction(
        { type: 'CANVAS', id: newCanvasId },
        { type: 'FOLDER', id: pendingArtifactFolder },
      );
      setPendingArtifactFolder(null);
    }
    setRelatedSourceId(null);
    navigateWithinSdlc(
      `/sdlc/${channelId}/artifacts`,
      `?type=${encodeURIComponent(folder.id)}&canvas=${encodeURIComponent(newCanvasId)}`,
    );
  };

  const createArtifactType = async (): Promise<void> => {
    if (!repo || !channel || !typeName.trim()) return;
    const response = await apiInstance.post<{ artifactType: { id: string; name: string } }>(
      '/sdlc/claw/artifact-types',
      { repoId: repo.id, channelId: channel.id, name: typeName.trim() },
    );
    const created = response.data.artifactType;
    setTypeDialogOpen(false);
    setTypeName('');
    navigateWithinSdlc(`/sdlc/${channelId}/artifacts`, `?type=${encodeURIComponent(created.id)}`);
  };

  const renameArtifactType = async (folderId: string, name: string): Promise<void> => {
    if (!repo || !name.trim()) return;
    await apiInstance.patch(`/sdlc/claw/artifact-types/${folderId}`, {
      repoId: repo.id,
      name: name.trim(),
    });
    setRenameTypeId(null);
    setRenameTypeName('');
  };

  const linkPickedContext = (selections: ContextSelections): void => {
    if (!repoId || !relatedSourceId) return;
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
            apiInstance.post(`/sdlc/repositories/${repoId}/links`, {
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

  if (!repo) {
    return (
      <div className='h-full grid place-items-center p-8 text-center text-muted-foreground'>
        <div>
          <p className='text-sm'>This hub has no repositories.</p>
          <p className='mt-1 text-xs'>
            A hub always keeps at least one, so this should not happen.
          </p>
        </div>
      </div>
    );
  }

  const runTrackMutation = async (mutation: ReturnType<typeof zero.mutate>): Promise<void> => {
    const response = await mutation.server;
    if (response.type === 'error') throw new Error(response.error.message);
  };

  const createTrackAction = async (): Promise<void> => {
    if (!repo || !channel) return;
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
    if (repoId) {
      navigateWithinSdlc(`/sdlc/${channelId}/tracks`, `?track=${encodeURIComponent(id)}`);
    }
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
    setArtifactDialog({ id: folder.id, name: folder.name });
  };

  const openArtifactCreateFrom = (
    folder: { id: string; name: string },
    sourceCanvasId: string,
  ): void => {
    clearArtifactDialogFields({
      track: trackByCanvasId.get(sourceCanvasId) ?? null,
      relatedCanvasIds: [sourceCanvasId],
    });
    setArtifactDialog({ id: folder.id, name: folder.name });
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

  /**
   * The page for one track: its artifacts and issues, reached by selecting the
   * track in the sidebar. The list of tracks that used to sit alongside it is
   * gone — the sidebar is the list now, so the page only ever shows the one
   * track that is selected.
   */
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
    // The stored path carries names for the column headers, so a rename has to
    // reach it too or the breadcrumb keeps the old one until a reload.
    setFinderPath(finderPath.map(step => (step.id === folderId ? { ...step, name } : step)));
  };

  const moveItemAction = async (
    item: { type: 'FOLDER' | 'CANVAS'; id: string },
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
    setNewFolderName('');
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
          // Cleared to null rather than an empty string, so "no description" is
          // one value and the heading has one thing to test.
          description: description.length > 0 ? description : null,
          timestamp: Date.now(),
        }),
      ),
    );
  };

  const renderTrack = (): ReactElement | null => {
    if (!selectedTrack) return null;
    const trackTicketIds = trackTicketIdsByTrack.get(selectedTrack.id) ?? new Set<string>();
    const trackTickets = tickets.filter(ticket => trackTicketIds.has(ticket.id));
    const openTicketCount = trackTickets.filter(
      ticket =>
        ticket.statusV2 !== TicketStatusV2.COMPLETED &&
        ticket.statusV2 !== TicketStatusV2.CANCELLED,
    ).length;
    const unownedTicketCount = trackTickets.filter(ticket => !ticket.assignedTo).length;
    const ticketTally = `${openTicketCount} open · ${unownedTicketCount} unowned`;
    const finderCanvasById = new Map<string, SdlcFinderCanvas>(
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
    );
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
                  onClick={() => setNameDraft(selectedTrack.name)}
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
                      // One line, so Enter is the natural way to finish.
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    onBlur={() => {
                      if (nameAbandoned.current) {
                        nameAbandoned.current = false;
                        return;
                      }
                      const next = nameDraft.trim();
                      setNameDraft(null);
                      // A track has to be called something; an empty box reverts
                      // rather than writing a nameless track.
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
                onClick={() => setDescriptionDraft(selectedTrack.description ?? '')}
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
                    // Grow with the text rather than scrolling inside a fixed box.
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
                      // Leave without writing; the blur that follows must not save.
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
          <div className='flex shrink-0 items-center gap-2'>
            <Button
              variant='outline'
              onClick={() =>
                setNewFolderParent(
                  finderPath.at(-1) ?? {
                    type: 'TRACK',
                    id: selectedTrack.id,
                    name: selectedTrack.name,
                  },
                )
              }
              data-track-category='SdlcHub'
              data-track-name='NewFolderOpened'
            >
              <Plus />
              New folder
            </Button>
            <Button
              onClick={() =>
                setNewArtifactParent(
                  finderPath.at(-1) ?? {
                    type: 'TRACK',
                    id: selectedTrack.id,
                    name: selectedTrack.name,
                  },
                )
              }
              data-track-category='SdlcHub'
              data-track-name='NewArtifactOpened'
            >
              <Plus />
              New artifact
            </Button>
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
          <div className='scrollbar-none flex h-[520px] overflow-x-auto'>
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
                activeSelectionId={previewCanvasId ? null : (finderPath.at(-1)?.id ?? null)}
                canvasById={finderCanvasById}
                isLast={index === steps.length - 1}
                onSelectFolder={folder => {
                  setPreviewCanvasId(null);
                  setFinderPath([
                    ...steps.slice(1, index + 1),
                    { type: 'FOLDER', id: folder.id, name: folder.name },
                  ]);
                }}
                previewCanvasId={previewCanvasId}
                onSelectCanvas={canvasId => {
                  // Selecting a file closes everything to the right of its own
                  // column: those levels were reached through a folder that is no
                  // longer what is selected, and the preview belongs immediately
                  // after the column the file is in.
                  setFinderPath(steps.slice(1, index + 1));
                  setPreviewCanvasId(canvasId);
                }}
                onOpenCanvas={(canvasId, event) =>
                  openCanvas(canvasId, event ? { event } : undefined)
                }
                onNewFolder={parent => setNewFolderParent(parent)}
                onNewArtifact={parent => setNewArtifactParent(parent)}
                onDiscussFolder={openFolderConversations}
                folderById={folderById}
                discussingFolderId={
                  chatPanelShowing && activeFolderDiscussion ? activeFolderDiscussion.id : null
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
            {previewCanvasId && finderCanvasById.get(previewCanvasId) && (
              <SdlcFinderPreview
                canvas={finderCanvasById.get(previewCanvasId) as SdlcFinderCanvas}
                onOpen={(canvasId, event) => openCanvas(canvasId, event ? { event } : undefined)}
                onPreview={setReaderCanvasId}
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
            onClick={() => setCreateTicketOpen(true)}
            data-track-category='SdlcHub'
            data-track-name='TrackTicketCreateOpened'
          >
            <Plus />
            Create ticket
          </Button>
        </div>

        <div className='mb-6 overflow-hidden rounded-xl border border-border'>
          {trackTickets.length === 0 ? (
            <p className='px-4 py-8 text-center text-[12px] text-muted-foreground'>
              No tickets in this track yet.
            </p>
          ) : (
            trackTickets.map(ticket => (
              <button
                key={ticket.id}
                type='button'
                // The ticket's own conversation, not just the panel: openConversations
                // passes a null conversation, which leaves the reader on whichever
                // thread was last selected rather than the ticket they clicked.
                onClick={() =>
                  setDiscussionUrl({
                    open: true,
                    conversationId: ticket.conversationId,
                    ticketId: ticket.id,
                    // Clicking a ticket is a request to see the ticket, so it
                    // lands on Details rather than the thread. Details is a
                    // properties view with no composer — switching to Messages
                    // brings the reply box back, and the panel remembers that.
                    selectedTab: 'details',
                  })
                }
                className='flex w-full items-center gap-3 border-b border-border px-3.5 py-2 text-left transition-colors last:border-b-0 hover:bg-foreground/[0.04]'
                data-track-category='SdlcHub'
                data-track-name='TrackTicketOpened'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
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
                  // An unowned ticket is worth seeing at a glance, so the gap
                  // where an owner would be is drawn rather than left blank.
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
  const openTrack = (trackId: string | null): void => {
    if (!repoId) return;
    navigateWithinSdlc(
      `/sdlc/${channelId}/tracks`,
      trackId ? `?track=${encodeURIComponent(trackId)}` : '',
    );
  };

  const sectionNavRows = SECTIONS.map(item => {
    const Icon = item.icon;
    return (
      <div key={item.id} className='mb-0.5'>
        <button
          onClick={() => navigateWithinSdlc(`/sdlc/${channelId}/${item.id}`)}
          className={cn(
            'flex h-[32px] w-full items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-sidebar-foreground transition-colors',
            section === item.id ? 'bg-foreground/10 font-medium' : 'hover:bg-foreground/[0.06]',
          )}
          data-track-category='SdlcHub'
          data-track-name='SectionChanged'
          data-track-metadata={JSON.stringify({ section: item.id, repoId: repo.id })}
        >
          <Icon size={15} className='shrink-0 text-sidebar-foreground/70' />
          <span className='flex-1 truncate text-left'>{item.label}</span>
          <span className='text-xs tabular-nums text-sidebar-foreground/50'>
            {item.id === 'wiki'
              ? section === 'wiki'
                ? wikiPages.length
                : ''
              : item.id === 'baseline'
                ? baseline.length
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
        className={cn(
          // One width for every view. It used to widen for the pages that hung an
          // extra tree or panel under the lists, but a sidebar that changes size
          // as you move between pages reads as a glitch, and the content it was
          // making room for now fits.
          'relative shrink-0',
          isDocumentWindow && 'hidden',
        )}
        style={{ width: railCollapsed ? SIDEBAR_RAIL_WIDTH : railWidth }}
        onMouseEnter={() => railCollapsed && setRailHovered(true)}
        onMouseLeave={() => setRailHovered(false)}
      >
        <div
          className={cn(
            'flex h-full flex-col overflow-x-hidden border-r border-sidebar-border-muted bg-sidebar text-sidebar-foreground',
            // No width animation mid-drag: the panel has to track the pointer.
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
            <div
              className={cn(
                'min-w-0 truncate text-[10.5px] font-semibold uppercase tracking-[0.13em] text-sidebar-foreground/60',
                !railOpen && 'sr-only',
              )}
            >
              SDLC Hub
            </div>
            {/* The toggle sits last so it lands hard against the sidebar's right
              edge when open, and is the only thing left when folded. */}
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
                  title='Reload SDLC Hub — discards this session and starts fresh at the hub root'
                  aria-label='Reload SDLC Hub'
                  className='rounded-md p-1 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
                  data-track-category='SdlcHub'
                  data-track-name='FrameReset'
                >
                  <RefreshCw className='h-3.5 w-3.5' aria-hidden='true' />
                </button>
              )}
              <button
                type='button'
                onClick={toggleRail}
                title={railCollapsed ? 'Pin the sidebar open' : 'Collapse to icons'}
                aria-label={railCollapsed ? 'Pin the sidebar open' : 'Collapse to icons'}
                className='-mr-1 rounded-md p-1 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
                data-track-category='SdlcHub'
                data-track-name='SidebarRailToggled'
              >
                <PanelLeft className='size-3.5' />
              </button>
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
          </div>
          {/* Every list in the sidebar folds to its header and drags against its
            neighbours — the hub's own pages included, since a reader who lives
            in one section should be able to put the rest away. Heights are
            remembered per reader in the preferences machine rather than by the
            group, so there is one place a sidebar setting lives. */}
          {railOpen ? (
            <ResizableGroup
              orientation='vertical'
              onLayoutChanged={(_layout, meta) => persistSdlcSectionHeights(meta)}
              className='min-h-0 flex-1'
            >
              <SdlcSidebarSection id='sdlc-sidebar-hub' title='Hub'>
                {sectionNavRows}
              </SdlcSidebarSection>
              <SdlcSidebarSectionSeparator />
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
                    onClick={() => openTrack(track.id)}
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
                          onClick={() => openTrack(track.id)}
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
                              repoId: repo.id,
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
                  label: 'Add a repository',
                  trackName: 'HubRepositoriesOpened',
                  onClick: () => setHubDialog('manage'),
                }}
              >
                {channelRepos.map(repository => (
                  <a
                    key={repository.id}
                    href={repository.canonicalUrl || repository.url}
                    target='_blank'
                    rel='noreferrer'
                    className='mb-0.5 flex h-[32px] w-full items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-sidebar-foreground transition-colors hover:bg-foreground/[0.06]'
                    data-track-category='SdlcHub'
                    data-track-name='HubRepositoryOpened'
                  >
                    <GitBranch size={15} className='shrink-0 text-sidebar-foreground/70' />
                    <span className='min-w-0 flex-1 truncate text-left'>{repository.name}</span>
                    <ExternalLink size={12} className='shrink-0 text-sidebar-foreground/45' />
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
          {section === 'wiki' && selectedWikiPage && (
            <div className='min-h-0 flex-1 border-t border-sidebar-border-muted'>
              <SdlcWikiSidebarTree
                pages={wikiPages}
                loading={wikiQuery.isLoading}
                error={wikiQuery.isError}
                selectedCanvasId={selectedCanvasId}
                onRetry={() => void wikiQuery.refetch()}
                onOpen={openWikiPage}
              />
            </div>
          )}
          {section === 'baseline' && selectedCanvas && (
            <div className='min-h-0 flex-1 border-t border-sidebar-border-muted'>
              <SdlcWikiSidebarTree
                pages={baselineSidebarPages}
                loading={false}
                error={false}
                selectedCanvasId={selectedCanvasId}
                variant='repo-knowledge'
                onRetry={() => undefined}
                onOpen={page => openCanvas(page.canvasId)}
              />
            </div>
          )}
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
        <header className='z-10 flex h-[52px] shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-5 backdrop-blur'>
          <div className='flex min-w-0 items-center gap-2'>
            {selectedCanvasId ? (
              <>
                <button
                  type='button'
                  onClick={closeCanvas}
                  className='shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground'
                  data-track-category='SdlcHub'
                  data-track-name='CanvasClosedInline'
                  data-track-metadata={JSON.stringify({ canvasId: selectedCanvasId })}
                >
                  {selectedCanvasTypeFolder?.name ??
                    (section === 'artifacts'
                      ? (activeTypeFolder?.name ?? 'Artifacts')
                      : (SECTIONS.find(item => item.id === section)?.label ?? 'Overview'))}
                </button>
                <ChevronRight size={15} className='shrink-0 text-muted-foreground' />
                <h1 className='truncate font-semibold'>
                  {selectedCanvas?.title ?? selectedWikiPage?.title ?? 'Canvas'}
                </h1>
              </>
            ) : section === 'tracks' && selectedTrack ? (
              // Tracks left the nav, so the lookup below cannot name this page.
              // There is no list to go back to either, so the track names itself.
              <h1 className='truncate font-semibold'>{selectedTrack.name}</h1>
            ) : (
              <h1 className='font-semibold'>
                {section === 'artifacts'
                  ? (activeTypeFolder?.name ?? 'Artifacts')
                  : (SECTIONS.find(item => item.id === section)?.label ?? 'Overview')}
              </h1>
            )}
          </div>
          <div className='flex shrink-0 items-center'>
            {selectedCanvasId && isElectronApp() && !isDocumentWindow ? (
              <Button
                size='icon'
                variant='ghost'
                className='mr-1.5 size-7 rounded-lg'
                aria-label='Open in new window'
                title='Open in new window'
                onClick={() => openCanvasInWindow(selectedCanvasId, true)}
                data-track-category='SdlcHub'
                data-track-name='ArtifactOpenedInWindow'
              >
                <SquareArrowOutUpRight className='size-4' />
              </Button>
            ) : null}
            {chatPanelAvailable && !chatPanelShowing ? (
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
            <Button
              size='icon'
              variant='ghost'
              aria-label='Members'
              title='Members'
              className='ml-1.5 size-7 rounded-lg'
              onClick={() => setMembersDialog(true)}
            >
              <Users className='size-4' />
            </Button>
            <div className='flex min-w-0 items-center gap-1.5 overflow-hidden pl-1.5 [&_button]:!size-7 [&_button]:!rounded-lg'>
              {chatPanelAvailable && repo.channelId ? (
                <CallTriggerModal
                  channelId={repo.channelId}
                  {...(repo.channel?.scopeType && { scopeType: repo.channel.scopeType })}
                  channelName={repo.name}
                  participantCount={repo.channel?.channelStats?.participantCount ?? 0}
                  callDisplayName={repo.name}
                  isMember={Boolean(
                    repo.channel?.participants?.some(
                      participant => participant.userId === auth.userID,
                    ),
                  )}
                  {...((): { sdlcLink?: SdlcCallLink } => {
                    if (discussionOwner) {
                      return {
                        sdlcLink: {
                          ownerType: 'CANVAS',
                          ownerId: discussionOwner.canvasId,
                        },
                      };
                    }
                    if (section === 'tracks' && selectedTrack) {
                      return {
                        sdlcLink: {
                          ownerType: 'TRACK',
                          ownerId: selectedTrack.id,
                        },
                      };
                    }
                    return {};
                  })()}
                />
              ) : null}
              {chatPanelAvailable && repo.channelId ? (
                <Button
                  size='icon'
                  variant='ghost'
                  aria-label='Create ticket'
                  title='Create ticket'
                  onClick={() => setCreateTicketOpen(true)}
                  data-track-category='SdlcHub'
                  data-track-name='HeaderCreateTicketClicked'
                >
                  <TicketToken size={16} />
                </Button>
              ) : null}
              <Button
                size='icon'
                variant='ghost'
                aria-label='Ask AI'
                title='Ask AI'
                onClick={() => openSdlcAssistant()}
                data-track-category='SdlcHub'
                data-track-name='HeaderAskAiClicked'
              >
                <XyneAIStar />
              </Button>
            </div>
            {/* Closes the right panel, and only that. Its label and action never
                depend on whether a thread is open, so the bar does not change
                under the reader — the thread's own cross lives in the panel. */}
            <div
              className={cn(
                'grid transition-[grid-template-columns] duration-300 ease-out',
                chatPanelShowing ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]',
              )}
            >
              <div className='flex min-w-0 items-center overflow-hidden'>
                <Button
                  size='icon'
                  variant='ghost'
                  aria-label='Close chat'
                  title='Close chat'
                  className='ml-1.5 size-7 rounded-lg'
                  tabIndex={chatPanelShowing ? 0 : -1}
                  onClick={closeConversations}
                >
                  <X className='size-4' />
                </Button>
              </div>
            </div>
          </div>
        </header>
        <ResizableGroup
          orientation='horizontal'
          className='min-h-0 flex-1 overflow-hidden'
          autoSaveId='sdlc-chat-shell'
          panelIds={sdlcRightPanelIds(rightPanelMode)}
        >
          <Panel
            id={SDLC_MAIN_PANEL_ID}
            defaultSize={showRightPanel ? '62%' : '100%'}
            minSize='45%'
          >
            <main className='flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
              {selectedCanvasId ? (
                <div className='min-h-0 flex-1 overflow-hidden bg-background'>
                  <StableCanvasScreen
                    key={selectedCanvasId}
                    canvasId={selectedCanvasId}
                    showAskAiAction={false}
                  />
                </div>
              ) : (
                <div className='min-h-0 flex-1 overflow-auto bg-background p-7'>
                  {section === 'overview' && (
                    <section>
                      <h1 className='mb-5 text-2xl font-semibold tracking-tight'>{repo.name}</h1>
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
                            <h2 className='text-base font-semibold'>Repo Knowledge</h2>
                            <p className='mt-1 text-sm text-muted-foreground'>
                              Create and approve repository guides used by SDLC Assistant.
                            </p>
                            <p className='mt-2 text-xs text-muted-foreground'>
                              {state.currentBaselineKind
                                ? `Current: ${BASELINE_LABELS[state.currentBaselineKind] || state.currentBaselineKind}`
                                : 'No document currently running'}
                              {' · '}
                              {state.completedCount}/{SDLC_BASELINE_COUNT} generated
                              {' · '}
                              Updated {setupUpdatedAtLabel(state.updatedAt)}
                            </p>
                            {state.error && (
                              <p className='mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
                                {state.error}
                              </p>
                            )}
                          </div>
                          <div className='flex shrink-0 items-center gap-2'>
                            <StatusPill phase={state.phase} />
                            {renderRepoKnowledgeControls()}
                            {!isAdmin && state.phase === 'NOT_STARTED' ? (
                              <span className='max-w-40 text-right text-xs text-muted-foreground'>
                                Repository admin must generate Repo Knowledge.
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className='mt-5 grid grid-cols-2 divide-x overflow-hidden rounded-xl border bg-background'>
                        <Metric
                          label='Repo Knowledge ready'
                          value={`${readyCount}/${SDLC_BASELINE_COUNT}`}
                          icon={ShieldCheck}
                        />
                        <Metric
                          label='Tickets'
                          value={String(channelTicketCount)}
                          icon={CircleDot}
                        />
                      </div>
                      {repo.channelId ? (
                        <SdlcActivityPreview key={repo.channelId} channelId={repo.channelId} />
                      ) : null}
                    </section>
                  )}

                  {section === 'tracks' && renderTrack()}

                  {section === 'baseline' && (
                    <section>
                      <SectionHeader
                        title='Repo Knowledge'
                        description='Generate or refresh from repository history. Admins edit; members read.'
                        action={renderRepoKnowledgeControls(true)}
                      />
                      <div className='grid grid-cols-2 gap-4'>
                        {baseline.map(canvas => {
                          const generating = canvas.sdlcArtifact?.artifactStatus === 'DRAFT';
                          return (
                            <div
                              key={canvas.id}
                              role='button'
                              tabIndex={0}
                              onClick={() => openCanvas(canvas.id)}
                              data-track-category='SdlcHub'
                              data-track-name='BaselineCanvasOpened'
                              data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                              onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openCanvas(canvas.id);
                                }
                              }}
                              className='group cursor-pointer rounded-xl border bg-background p-5 transition-colors hover:border-primary/35 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                            >
                              <div className='flex items-start justify-between'>
                                <div className='grid size-9 place-items-center rounded-lg bg-primary/10 text-primary'>
                                  <BookOpen size={18} />
                                </div>
                                {generating ? (
                                  <span className='rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700'>
                                    Generating
                                  </span>
                                ) : (
                                  <span className='flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300'>
                                    <Check size={12} />
                                    Ready
                                  </span>
                                )}
                              </div>
                              <h3 className='mt-4 font-semibold'>
                                {BASELINE_LABELS[canvas.sdlcArtifact?.artifactType ?? ''] ||
                                  canvas.title}
                              </h3>
                              <p className='mt-1 text-xs text-muted-foreground'>
                                Updated{' '}
                                {setupUpdatedAtLabel(canvas.lastEditedAt ?? canvas.updatedAt)}
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
                        {baseline.length === 0 && (
                          <EmptyCard
                            text={
                              setupRunning
                                ? 'Repo Knowledge generation is in progress.'
                                : 'Generate Repo Knowledge directly from the repository.'
                            }
                          />
                        )}
                      </div>
                    </section>
                  )}

                  {section === 'wiki' && (
                    <SdlcWikiSection
                      pages={wikiPages}
                      loading={wikiQuery.isLoading}
                      error={wikiQuery.isError}
                      onRetry={() => void wikiQuery.refetch()}
                      onOpen={openWikiPage}
                      run={wikiRunQuery.data ?? null}
                      isAdmin={isAdmin}
                      actionPending={
                        (busy?.startsWith('wiki-') || busy?.startsWith('knowledge-')) ?? false
                      }
                      onGenerate={generateWiki}
                      onRefresh={refreshWiki}
                      onRetryRun={retryWiki}
                      onRetryKnowledge={retryKnowledge}
                      onCancelRun={cancelWiki}
                      onDebugRun={() => {
                        const run = wikiRunQuery.data;
                        if (!run?.conversationId) return;
                        openSdlcDebugger({
                          source: 'sdlc',
                          repoId: repo.id,
                          executionId: run.executionId,
                          conversationId: run.conversationId,
                          sessionId: run.sessionId,
                          running: [
                            'QUEUED',
                            'PREPARING',
                            'BOOTSTRAPPING',
                            'PROCESSING',
                            'VALIDATING',
                            'CORRECTING',
                          ].includes(run.phase),
                        });
                      }}
                    />
                  )}

                  {section === 'artifacts' &&
                    (activeTypeFolder ? (
                      renderArtifacts(activeTypeFolder)
                    ) : (
                      <EmptyCard text='Select an artifact type from the sidebar.' />
                    ))}
                  {section === 'tickets' && repo.channelId && (
                    <div className='relative h-[calc(100vh-8rem)] min-h-[36rem]'>
                      <KanbanBoardScreen channelId={repo.channelId} />
                      {selectedTicketRow?.conversationId && (
                        <div className='absolute bottom-4 right-4 top-4 z-20 flex w-[480px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl'>
                          <ThreadMessages
                            ticketId={selectedTicketRow.id}
                            channelId={selectedTicketRow.channelId ?? repo.channelId}
                            conversationId={selectedTicketRow.conversationId}
                            skipInputAutoFocus
                            onClose={closeTicketPanel}
                          />
                        </div>
                      )}
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
                  {rightPanelMode === 'debugger' ? (
                    <SdlcDebuggerPanel />
                  ) : discussionOwner && discussionSurface && repo.channelId ? (
                    <SdlcChatPanel
                      key={`discussion-${discussionOwner.canvasId}`}
                      channelId={repo.channelId}
                      discussion={{
                        repoId: repo.id,
                        ownerType: 'CANVAS',
                        ownerId: discussionOwner.canvasId,
                        surfaceType: discussionSurface.type,
                        surfaceId: discussionSurface.id,
                      }}
                      conversationIds={discussionConversationIds}
                      selectedConversationId={renderedConversationId}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      title={discussionOwner.title}
                    />
                  ) : activeFolderDiscussion && repo.channelId ? (
                    <SdlcChatPanel
                      key={`folder-${activeFolderDiscussion.id}`}
                      channelId={repo.channelId}
                      discussion={{
                        repoId: repo.id,
                        ownerType: 'FOLDER',
                        ownerId: activeFolderDiscussion.id,
                      }}
                      conversationIds={folderConversationIds}
                      selectedConversationId={renderedConversationId}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
                      title={activeFolderDiscussion.name}
                      scopeHeader={{
                        name: activeFolderDiscussion.name,
                        onExit: () => setFolderDiscussion(null),
                      }}
                    />
                  ) : section === 'tracks' && selectedTrack && repo.channelId ? (
                    <SdlcChatPanel
                      key={`track-${selectedTrack.id}`}
                      channelId={repo.channelId}
                      discussion={{
                        repoId: repo.id,
                        ownerType: 'TRACK',
                        ownerId: selectedTrack.id,
                      }}
                      conversationIds={trackConversationIds}
                      selectedConversationId={renderedConversationId}
                      onSelectConversation={selectDiscussionConversation}
                      onAskAI={openSdlcAssistant}
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

      {repo.channelId && createTicketOpen ? (
        <EntityLinkContext.Provider value={entityLinkScope}>
          <CreateTicketModal
            isOpen={createTicketOpen}
            onClose={() => setCreateTicketOpen(false)}
            channelId={repo.channelId}
            projectId={repo.project?.id ?? ''}
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
                {repo.name} · {typeFolders.length} types
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

      <Dialog
        open={artifactDialog !== null}
        onOpenChange={open => {
          if (!open) resetArtifactDialog();
        }}
        title={`New ${artifactDialog?.name ?? 'Artifact'}`}
        className='max-w-[520px]'
      >
        <form
          onSubmit={event => {
            event.preventDefault();
            void call(
              'artifact',
              () => Promise.resolve(createArtifact()),
              'Creation request sent to Ask AI',
            );
          }}
        >
          <div className='flex items-start gap-3 px-6 pb-4 pt-5'>
            <div className='flex flex-1 flex-col gap-0.5'>
              <span className='text-[17px] font-semibold tracking-[-0.01em]'>
                New {artifactDialog?.name}
              </span>
              <span className='text-[12.5px] text-muted-foreground'>
                in {artifactDialog?.name}
                {artifactTrack ? ` · will be added to the ${artifactTrack.name} track` : ''}
              </span>
            </div>
            <button
              type='button'
              title='Close'
              aria-label='Close'
              onClick={resetArtifactDialog}
              className='flex size-7 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-muted hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='ArtifactDialogClosed'
            >
              <X size={15} />
            </button>
          </div>

          <div className='flex flex-col gap-4 px-6 pb-5'>
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

            {tracks.filter(track => track.status !== 'ARCHIVED').length > 0 ? (
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

            <div className='flex flex-col gap-1.5'>
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
                          const title =
                            canvases.find(canvas => canvas.id === id)?.title ?? 'Artifact';
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
                                  setRelatedCanvasIds(prev =>
                                    prev.filter(existing => existing !== id),
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
                          {relatedChipsExpanded
                            ? 'Show less'
                            : `+${relatedCanvasIds.length - 3} more`}
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
              <span className='text-xs text-muted-foreground'>
                Ignored if you write it yourself.
              </span>
            </div>
          </div>

          <div className='flex items-center gap-2.5 border-t px-6 py-3.5'>
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
                disabled={!artifactTitle.trim() || !artifactTrack}
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
                disabled={!artifactTitle.trim() || !artifactTrack}
              >
                <Sparkles />
                Ask AI to create
              </Button>
            </div>
          </div>
        </form>
      </Dialog>

      <SdlcHubDialog
        projectId={channel.projectId}
        open={hubDialog !== null}
        onOpenChange={open => setHubDialog(open ? hubDialog : null)}
        {...(hubDialog === 'manage'
          ? { hub: { channelId: channel.id, repoIds: channelRepos.map(item => item.id) } }
          : {})}
        onSaved={savedChannelId => {
          if (savedChannelId !== channelId) void navigate(`/sdlc/${savedChannelId}/overview`);
        }}
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

      <Dialog
        open={newFolderParent !== null}
        onOpenChange={open => {
          if (!open) {
            setNewFolderParent(null);
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

      <Dialog
        open={newArtifactParent !== null}
        onOpenChange={open => {
          if (!open) setNewArtifactParent(null);
        }}
        title='New artifact'
      >
        <div className='p-6'>
          <h2 className='text-lg font-semibold'>New artifact</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            {newArtifactParent?.type === 'FOLDER'
              ? `Choose a type. It will be filed in ${newArtifactParent.name}.`
              : 'Choose a type to create.'}
          </p>
          <div className='mt-4 space-y-1'>
            {typeFolders.map(folder => (
              <button
                key={folder.id}
                type='button'
                onClick={() => {
                  const parent = newArtifactParent;
                  setNewArtifactParent(null);
                  setPendingArtifactFolder(parent?.type === 'FOLDER' ? parent.id : null);
                  if (selectedTrack) {
                    clearArtifactDialogFields({
                      track: { id: selectedTrack.id, name: selectedTrack.name },
                    });
                  }
                  setArtifactDialog({ id: folder.id, name: folder.name });
                }}
                className='flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted'
                data-track-category='SdlcHub'
                data-track-name='NewArtifactTypeChosen'
                data-track-metadata={JSON.stringify({ typeId: folder.id })}
              >
                <FileText className='size-4 shrink-0 text-muted-foreground' />
                {folder.name}
              </button>
            ))}
            {typeFolders.length === 0 && (
              <p className='py-4 text-center text-sm text-muted-foreground'>
                No artifact types yet.
              </p>
            )}
          </div>
        </div>
      </Dialog>

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
                    await apiInstance.post(`/sdlc/repositories/${repo.id}/links`, {
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
          channel={repo.channel as unknown as VisibleChannel}
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

function StatusPill({ phase }: { phase: SdlcSetupStatus }): ReactElement {
  const running = [
    'QUEUED',
    'CLONING',
    'GENERATING',
    'RUNNING',
    'IMPLEMENTING',
    'PUSHING',
  ].includes(phase);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
        phase === 'PARTIALLY_FAILED' || phase === 'CANCELLED'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'bg-background',
      )}
    >
      {running ? <Loader2 size={12} className='animate-spin' /> : <CircleDot size={12} />}
      {phase.replaceAll('_', ' ')}
    </span>
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
