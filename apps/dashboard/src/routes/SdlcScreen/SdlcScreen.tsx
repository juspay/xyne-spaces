import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
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
} from '@xyne/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Bug,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDot,
  FileText,
  Folder,
  GitBranch,
  Layers,
  Loader2,
  MessageCircle,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import NotFoundScreen from '../NotFoundScreen/NotFoundScreen';
import { SdlcHubDialog } from './SdlcHubDialog';
import { SdlcHubPicker, SdlcHubRepositories } from './SdlcHubSidebar';
import {
  isFramedSdlcSurface,
  isSdlcDocumentWindow,
  requestSdlcFrameReset,
} from './useSdlcFrameBridge';
import { toast } from 'sonner';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { Button } from '../../components/ui/Button';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import { Panel, ResizableGroup, Separator } from '../../components/ui/Resizable/Resizable';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
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
import {
  discussionConversationIds as discussionIdsForOwner,
  ownerHasConversations as sdlcOwnerHasConversations,
  resolveCanvasDiscussionOwner,
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
  shouldShowSdlcRelatedLink,
} from './sdlcChatPolicy';
import { formatRelativeTime } from '../../utils/dateUtils';
import Avatar from '../../components/ui/Avatar/Avatar';
import { useUser } from '../../hooks/useUsers';
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
  { id: 'tracks', label: 'Tracks', icon: Layers },
  { id: 'tickets', label: 'Tickets', icon: CircleDot },
];
const SECTION_IDS: ReadonlySet<string> = new Set<string>([...SECTIONS.map(s => s.id), 'artifacts']);

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
            createdAt: number;
            updatedAt: number;
          }>)
        : [],
    [trackRows],
  );
  const selectedTrackId = routeSearchParams.get('track');
  const selectedTrack = tracks.find(track => track.id === selectedTrackId);
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
  const trackPrdIdsByTrack = useMemo(() => {
    const byTrack = new Map<string, Set<string>>();
    for (const link of links) {
      if (
        link.sourceType === 'TRACK' &&
        link.targetType === 'CANVAS' &&
        link.relationType === 'TRACK_ITEM'
      ) {
        const set = byTrack.get(link.sourceId) ?? new Set<string>();
        set.add(link.targetId);
        byTrack.set(link.sourceId, set);
      }
    }
    return byTrack;
  }, [links]);
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
  const trackByCanvasId = useMemo(() => {
    const nameById = new Map(tracks.map(track => [track.id, track.name]));
    const byCanvas = new Map<string, { id: string; name: string }>();
    for (const link of links) {
      if (
        link.sourceType === 'TRACK' &&
        link.targetType === 'CANVAS' &&
        link.relationType === 'TRACK_ITEM'
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
        ? links
            .filter(
              link =>
                link.sourceType === 'TRACK' &&
                link.sourceId === selectedTrackId &&
                link.targetType === 'CONVERSATION' &&
                link.relationType === 'DISCUSSION',
            )
            .map(link => link.targetId)
        : [],
    [links, selectedTrackId],
  );
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
  const selectedCanvasConversationLinkIds = useMemo(
    () =>
      selectedCanvas
        ? links.flatMap(link => {
            if (link.sourceId === selectedCanvas.id && link.targetType === 'CONVERSATION') {
              return [link.targetId];
            }
            if (link.targetId === selectedCanvas.id && link.sourceType === 'CONVERSATION') {
              return [link.sourceId];
            }
            return [];
          })
        : [],
    [links, selectedCanvas],
  );
  const [selectedCanvasRelatedConversations] = useCachedQuery(
    queries.sdlcRelatedConversations({ conversationIds: selectedCanvasConversationLinkIds }),
  );
  const relatedConversationChannels = useMemo(
    () =>
      new Map(
        (Array.isArray(selectedCanvasRelatedConversations)
          ? selectedCanvasRelatedConversations
          : []
        ).map(conversation => [conversation.conversationId, conversation.channelId]),
      ),
    [selectedCanvasRelatedConversations],
  );
  const selectedTicketId = routeSearchParams.get('ticket');
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

  useEffect(() => {
    if (
      !shouldCloseInvalidSdlcConversationDeepLink({
        repoQueryComplete: repoQueryDetails.type === 'complete',
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
    const search = next.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
  }, [
    discussionContext,
    discussionOpen,
    location.pathname,
    location.search,
    navigate,
    repoQueryDetails.type,
    section,
    selectedDiscussionConversationId,
    selectedTrackId,
  ]);
  const discussionOwner = discussionContext?.owner ?? null;
  const discussionSurface = discussionContext?.surface ?? null;
  const chatPanelAvailable =
    Boolean(discussionOwner && discussionSurface) || Boolean(section === 'tracks' && selectedTrack);
  const showRightPanel = rightPanelMode === 'debugger' || (rightPanelOpen && chatPanelAvailable);
  const discussionConversationIds = useMemo(
    () => discussionIdsForOwner(discussionOwner?.canvasId ?? null, links),
    [discussionOwner, links],
  );
  const relatedCanvas = canvases.find(canvas => canvas.id === relatedSourceId);
  const selectedCanvasRelatedLinks = selectedCanvas
    ? links.filter(link => {
        if (link.sourceId !== selectedCanvas.id && link.targetId !== selectedCanvas.id) {
          return false;
        }
        const selectedIsSource = link.sourceId === selectedCanvas.id;
        const entityId = selectedIsSource ? link.targetId : link.sourceId;
        const entityType = selectedIsSource ? link.targetType : link.sourceType;
        const repositoryChannelId = repo ? repo.channelId : null;
        return shouldShowSdlcRelatedLink({
          relationType: link.relationType,
          entityType,
          entityChannelId: relatedConversationChannels.get(entityId) ?? null,
          repositoryChannelId,
        });
      })
    : [];
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

  const ownerHasConversations = useCallback(
    (ownerCanvasId: string | null): boolean => sdlcOwnerHasConversations(ownerCanvasId, links),
    [links],
  );

  const navigateWithinSdlc = useCallback(
    (pathname: string, destinationSearch = '', ownerCanvasId: string | null = null): void => {
      const search = sdlcChatNavigationSearch({
        currentSearch: location.search,
        destinationSearch,
        destinationHasConversations: ownerHasConversations(ownerCanvasId),
      });
      void navigate(`${pathname}${search}`);
    },
    [location.search, navigate, ownerHasConversations],
  );

  interface OpenCanvasOptions {
    event?: ReactMouseEvent | undefined;
    withDiscussion?: boolean;
  }

  const canvasSearch = (canvasId: string, withDiscussion: boolean): URLSearchParams => {
    const search = new URLSearchParams({ canvas: canvasId });
    if (
      withDiscussion &&
      ownerHasConversations(resolveCanvasDiscussionOwner(canvasId, canvases)?.canvasId ?? null)
    ) {
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
    navigateWithinSdlc(
      `/sdlc/${channelId}/${section}`,
      `?${search.toString()}`,
      resolveCanvasDiscussionOwner(canvasId, canvases)?.canvasId ?? null,
    );
  };

  const openArtifactCanvas = (canvasId: string, event?: ReactMouseEvent): void => {
    if (!repoId) return;
    const folder = typeFolders.find(item => item.canvases.some(canvas => canvas.id === canvasId));
    const search = canvasSearch(canvasId, true);
    if (folder) search.set('type', folder.id);

    if (shouldOpenInNewWindow(event) && openWindowForCanvas('artifacts', canvasId, search)) {
      return;
    }

    setRelatedSourceId(null);
    navigateWithinSdlc(
      `/sdlc/${channelId}/artifacts`,
      `?${search.toString()}`,
      resolveCanvasDiscussionOwner(canvasId, canvases)?.canvasId ?? null,
    );
  };

  const openWikiPage = (page: SdlcWikiPage): void => {
    if (!repoId) return;
    setRelatedSourceId(null);
    navigateWithinSdlc(
      `/sdlc/${channelId}/wiki`,
      `?canvas=${encodeURIComponent(page.canvasId)}`,
      page.canvasId,
    );
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
    (input: { open: boolean; conversationId?: string | null; ticketId?: string | null }): void => {
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
      if (input.ticketId) next.set('ticket', input.ticketId);
      const search = next.toString();
      void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  const openConversations = useCallback(
    (ticketId?: string): void => {
      closeExternalDebugger();
      setDiscussionUrl({
        open: true,
        conversationId: null,
        ticketId: ticketId ?? null,
      });
    },
    [closeExternalDebugger, setDiscussionUrl],
  );

  const closeConversations = useCallback((): void => {
    setDiscussionUrl({ open: false, conversationId: null });
    if (xyneAIActor.getSnapshot().matches('open')) xyneAIActor.send({ type: 'CLOSE' });
  }, [setDiscussionUrl]);

  const selectDiscussionConversation = useCallback(
    (conversationId: string | null): void => {
      setDiscussionUrl({ open: true, conversationId });
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
    setRelatedSourceId(null);
    navigateWithinSdlc(
      `/sdlc/${channelId}/artifacts`,
      `?type=${encodeURIComponent(folder.id)}&canvas=${encodeURIComponent(newCanvasId)}`,
      null,
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
    navigateWithinSdlc(
      `/sdlc/${channelId}/artifacts`,
      `?type=${encodeURIComponent(created.id)}`,
      null,
    );
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

  const openTrack = (trackId: string | null): void => {
    if (!repoId) return;
    navigateWithinSdlc(
      `/sdlc/${channelId}/tracks`,
      trackId ? `?track=${encodeURIComponent(trackId)}` : '',
    );
  };

  const TRACK_STATUS_STYLES: Record<string, string> = {
    ACTIVE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    COMPLETED: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    ARCHIVED: 'bg-muted text-muted-foreground',
  };

  const renderTracks = (): ReactElement => {
    if (selectedTrack) {
      const trackItemIds = trackPrdIdsByTrack.get(selectedTrack.id) ?? new Set<string>();
      const trackTicketIds = trackTicketIdsByTrack.get(selectedTrack.id) ?? new Set<string>();
      const trackTypeSections = typeFolders.map(folder => ({
        folder,
        canvases: folder.canvases
          .filter(item => trackItemIds.has(item.id))
          .sort((left, right) => left.createdAt - right.createdAt),
      }));
      const trackArtifactCount = trackTypeSections.reduce(
        (total, section) => total + section.canvases.length,
        0,
      );
      const trackTickets = tickets.filter(ticket => trackTicketIds.has(ticket.id));
      return (
        <section>
          {selectedTrack.description ? (
            <p className='mb-4 text-sm text-muted-foreground'>{selectedTrack.description}</p>
          ) : null}
          {trackArtifactCount === 0 ? (
            <>
              <SectionHeader
                title='Artifacts in this track'
                description='Artifacts grouped under this workstream.'
              />
              <EmptyCard text='No artifacts in this track yet. Create one to get started.' />
            </>
          ) : (
            trackTypeSections
              .filter(section => section.canvases.length > 0)
              .map((section, index) => (
                <div key={section.folder.id} className={index > 0 ? 'mt-6' : undefined}>
                  <SectionHeader
                    title={`${section.folder.name} in this track`}
                    description={`${section.folder.name} artifacts grouped under this workstream.`}
                  />
                  <div>
                    {section.canvases.map(canvas => (
                      <button
                        type='button'
                        key={canvas.id}
                        className='group mb-1.5 flex w-full items-start gap-3 rounded-xl bg-primary/5 px-3 py-3 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        onClick={event => openArtifactCanvas(canvas.id, event)}
                        data-track-category='SdlcHub'
                        data-track-name='TrackArtifactOpened'
                        data-track-metadata={JSON.stringify({
                          canvasId: canvas.id,
                          folderId: section.folder.id,
                        })}
                      >
                        <span className='grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'>
                          <FileText size={18} />
                        </span>
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate text-sm font-semibold'>
                            {canvas.title}
                          </span>
                          <span className='mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                            <span className='font-medium text-primary/80'>
                              {section.folder.name}
                            </span>
                            <span aria-hidden='true'>·</span>
                            <span>created {formatRelativeTime(canvas.createdAt)}</span>
                          </span>
                        </span>
                        <ChevronRight className='mt-1 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground' />
                      </button>
                    ))}
                  </div>
                </div>
              ))
          )}
          <div className='mt-6'>
            <SectionHeader
              title='Tickets in this track'
              description='Implementation tickets created under this workstream.'
            />
            <div>
              {trackTickets.length === 0 ? (
                <EmptyCard text='No tickets in this track yet.' />
              ) : (
                trackTickets.map(ticket => (
                  <button
                    type='button'
                    key={ticket.id}
                    className='group mb-1.5 flex w-full items-start gap-3 rounded-xl bg-primary/5 px-3 py-3 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    onClick={() => navigateWithinSdlc(`/sdlc/${channelId}/tickets`)}
                    data-track-category='SdlcHub'
                    data-track-name='TrackTicketOpened'
                    data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                  >
                    <span className='grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'>
                      <CircleDot size={18} />
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm font-semibold'>{ticket.title}</span>
                      <span className='mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                        <span className='font-medium text-primary/80'>{ticket.xyneId}</span>
                        <span aria-hidden='true'>·</span>
                        <span>{ticket.stageName}</span>
                      </span>
                    </span>
                    <ChevronRight className='mt-1 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground' />
                  </button>
                ))
              )}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section>
        <SectionHeader
          title='Tracks'
          description='Workstreams that group PRDs and their conversations.'
          action={
            <Button
              onClick={() => setTrackDialog(true)}
              data-track-category='SdlcHub'
              data-track-name='NewTrackOpened'
            >
              <Plus />
              New Track
            </Button>
          }
        />
        <div className='grid grid-cols-2 gap-4'>
          {tracks.map(track => {
            return (
              <div
                key={track.id}
                role='button'
                tabIndex={0}
                onClick={event => {
                  const target = event.target as HTMLElement;
                  if (target.closest('[data-status-select], [role="listbox"], [role="option"]'))
                    return;
                  openTrack(track.id);
                }}
                onKeyDown={event => {
                  const target = event.target as HTMLElement;
                  if (target.closest('[data-status-select], [role="listbox"], [role="option"]'))
                    return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openTrack(track.id);
                  }
                }}
                className='group cursor-pointer rounded-xl border bg-background p-5 transition-colors hover:border-primary/35 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                data-track-category='SdlcHub'
                data-track-name='TrackOpened'
                data-track-metadata={JSON.stringify({ trackId: track.id })}
              >
                <div className='flex items-start justify-between'>
                  <div className='grid size-9 place-items-center rounded-lg bg-primary/10 text-primary'>
                    <Layers size={18} />
                  </div>
                  <div data-status-select=''>
                    <Select
                      value={track.status}
                      onValueChange={value =>
                        void call(
                          `track-status-${track.id}`,
                          () => setTrackStatusAction(track.id, value),
                          'Track updated',
                        )
                      }
                    >
                      <SelectTrigger
                        className={cn(
                          'h-7 w-auto gap-1 rounded-full border-none px-2.5 text-xs font-medium shadow-none focus:ring-0',
                          TRACK_STATUS_STYLES[track.status] ?? TRACK_STATUS_STYLES['ACTIVE'],
                        )}
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => event.stopPropagation()}
                        data-track-category='SdlcHub'
                        data-track-name='TrackStatusChanged'
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='ACTIVE'>Active</SelectItem>
                        <SelectItem value='COMPLETED'>Completed</SelectItem>
                        <SelectItem value='ARCHIVED'>Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <h3 className='mt-4 truncate font-semibold'>{track.name}</h3>
                <p className='mt-1 line-clamp-2 min-h-4 text-xs text-muted-foreground'>
                  {track.description || 'No description yet.'}
                </p>
              </div>
            );
          })}
          {tracks.length === 0 && (
            <EmptyCard text='No tracks yet. Create one to group PRDs and conversations for a workstream.' />
          )}
        </div>
      </section>
    );
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

  return (
    <div className='flex h-full min-w-0 overflow-hidden bg-transparent'>
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-sidebar-border-muted bg-sidebar text-sidebar-foreground',
          selectedWikiPage ||
            (section === 'baseline' && selectedCanvas) ||
            (section === 'tracks' && selectedTrack)
            ? 'w-72'
            : 'w-[260px]',
          isDocumentWindow && 'hidden',
        )}
        style={{ backdropFilter: 'blur(var(--sidebar-background-blur))' }}
      >
        <div className='h-[52px] w-full shrink-0'>
          <AppNavigator />
        </div>
        <div className='border-b border-t border-sidebar-border-muted px-3 py-3'>
          <div className='flex items-center justify-between gap-2 px-1'>
            <div className='text-[10.5px] font-semibold uppercase tracking-[0.13em] text-sidebar-foreground/60'>
              SDLC Hub
            </div>
            {/* Escape hatch for a wedged frame; only meaningful when framed. */}
            {isFramedSdlcSurface() && (
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
          </div>
          <div className='mt-2 flex items-center gap-1.5'>
            <div className='min-w-0 flex-1'>
              <SdlcHubPicker
                hubs={hubOptions}
                selectedHubId={channel.id}
                onSelect={nextChannelId => void navigate(`/sdlc/${nextChannelId}/overview`)}
              />
            </div>
            <button
              type='button'
              className='grid size-[34px] shrink-0 place-items-center rounded-[8px] border border-sidebar-border-muted bg-foreground/[0.03] text-sidebar-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
              onClick={() => setHubDialog('create')}
              title='New hub'
              aria-label='New hub'
              data-track-category='SdlcHub'
              data-track-name='NewHubOpened'
            >
              <Plus className='size-3.5' />
            </button>
          </div>
        </div>
        <nav className='shrink-0 px-2 pt-2'>
          {SECTIONS.map(item => {
            const Icon = item.icon;
            return (
              <div key={item.id} className='mb-0.5'>
                <button
                  onClick={() => navigateWithinSdlc(`/sdlc/${channelId}/${item.id}`)}
                  className={cn(
                    'flex h-[34px] w-full items-center gap-2.5 rounded-[7px] px-2 text-[13.5px] text-sidebar-foreground transition-colors',
                    section === item.id
                      ? 'bg-foreground/10 font-medium'
                      : 'hover:bg-foreground/[0.06]',
                  )}
                  data-track-category='SdlcHub'
                  data-track-name='SectionChanged'
                  data-track-metadata={JSON.stringify({ section: item.id, repoId: repo.id })}
                >
                  <Icon size={16} className='shrink-0 text-sidebar-foreground/70' />
                  <span className='flex-1 truncate text-left'>{item.label}</span>
                  <span className='text-xs tabular-nums text-sidebar-foreground/50'>
                    {item.id === 'wiki'
                      ? section === 'wiki'
                        ? wikiPages.length
                        : ''
                      : item.id === 'baseline'
                        ? baseline.length
                        : item.id === 'tickets'
                          ? tickets.length
                          : item.id === 'tracks'
                            ? tracks.filter(track => track.status === 'ACTIVE').length
                            : ''}
                  </span>
                </button>
              </div>
            );
          })}

          <div
            className='-mx-2 mb-1 mt-3 border-t border-sidebar-border-muted'
            aria-hidden='true'
          />
          <div className='flex items-center justify-between px-2 pb-2.5 pt-3'>
            <span className='text-[10.5px] font-bold uppercase tracking-[0.13em] text-foreground/45'>
              Artifacts
            </span>
            <button
              type='button'
              title='New artifact type'
              onClick={() => {
                setTypeName('');
                setTypeDialogOpen(true);
              }}
              className='-mr-[7px] flex size-[22px] items-center justify-center rounded-[5px] text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='NewArtifactTypeClicked'
            >
              <Plus size={14} />
            </button>
          </div>
        </nav>
        <div className='min-h-[108px] flex-[0_1_auto] overflow-y-auto px-2 pb-2'>
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
                  <div className='flex h-[34px] w-full items-center gap-2.5 px-2'>
                    <Folder size={16} className='shrink-0 text-sidebar-foreground/70' />
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
                        'flex h-[34px] w-full items-center gap-2.5 rounded-[7px] px-2 text-[13.5px] text-sidebar-foreground transition-colors',
                        isActive
                          ? 'bg-foreground/10 font-medium'
                          : 'group-hover:bg-foreground/[0.06]',
                      )}
                      data-track-category='SdlcHub'
                      data-track-name='SectionChanged'
                      data-track-metadata={JSON.stringify({ type: folder.id, repoId: repo.id })}
                    >
                      <Folder size={16} className='shrink-0 text-sidebar-foreground/70' />
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
        </div>
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
        {section === 'tracks' && selectedTrack && (
          <div className='min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border-muted p-3'>
            <div className='px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70'>
              Tracks
            </div>
            <div className='mt-2 space-y-1'>
              {tracks.map(track => (
                <button
                  key={track.id}
                  type='button'
                  onClick={() => openTrack(track.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-ring',
                    track.id === selectedTrack.id
                      ? 'bg-sidebar-accent/70 font-medium text-sidebar-accent-foreground'
                      : 'hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                  )}
                  data-track-category='SdlcHub'
                  data-track-name='SidebarTrackOpened'
                  data-track-metadata={JSON.stringify({ trackId: track.id })}
                >
                  <Layers className='size-3.5 shrink-0 text-sidebar-foreground/60' />
                  <span className='min-w-0 flex-1 truncate'>{track.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {selectedCanvas && section !== 'baseline' && (
          <div className='max-h-[32vh] min-h-[72px] flex-[0_1_auto] overflow-y-auto border-t border-sidebar-border-muted p-3'>
            <div className='flex items-center justify-between gap-2 px-1'>
              <div className='min-w-0'>
                <div className='text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70'>
                  Related
                </div>
                <div className='mt-1 truncate text-xs font-medium'>{selectedCanvas.title}</div>
              </div>
              <Button
                variant='ghost'
                size='iconSm'
                aria-label='Add related context'
                title='Add related context'
                onClick={() => {
                  setRelatedSourceId(selectedCanvas.id);
                  setLinkDialog(true);
                }}
              >
                <Plus />
              </Button>
            </div>
            <div className='mt-3 space-y-1.5'>
              {selectedCanvasRelatedLinks.map(link => {
                const selectedIsSource = link.sourceId === selectedCanvas.id;
                const entityId = selectedIsSource ? link.targetId : link.sourceId;
                const entityType = selectedIsSource ? link.targetType : link.sourceType;
                const canvas = canvases.find(item => item.id === entityId);
                const ticket = tickets.find(item => item.id === entityId);
                const pullRequest = tickets
                  .flatMap(item => item.pullRequests ?? [])
                  .find(item => item.id === entityId);
                const label =
                  canvas?.title ||
                  (ticket ? `${ticket.xyneId} · ${ticket.title}` : undefined) ||
                  (pullRequest ? `PR #${pullRequest.prId}` : undefined) ||
                  entityId;
                return (
                  <div
                    key={link.id}
                    className='group flex items-center gap-2 rounded-lg border border-sidebar-border-muted bg-sidebar-accent/20 px-2.5 py-2'
                  >
                    <Network size={13} className='shrink-0 text-sidebar-foreground/60' />
                    <div className='min-w-0 flex-1'>
                      <div className='truncate text-xs font-medium'>{label}</div>
                      <div className='mt-0.5 text-[10px] uppercase tracking-wide text-sidebar-foreground/60'>
                        {String(entityType).replaceAll('_', ' ')}
                      </div>
                    </div>
                    <Button
                      variant='ghost'
                      size='iconSm'
                      className='opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
                      aria-label='Remove related context'
                      loading={busy === `unlink-${link.id}`}
                      onClick={() =>
                        void call(
                          `unlink-${link.id}`,
                          () =>
                            apiInstance.delete(`/sdlc/repositories/${repo.id}/links/${link.id}`),
                          'Link removed',
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
              {selectedCanvasRelatedLinks.length === 0 && (
                <div className='rounded-lg border border-dashed border-sidebar-border-muted px-3 py-4 text-center text-xs text-sidebar-foreground/60'>
                  No related context
                </div>
              )}
            </div>
          </div>
        )}
        <div className='mt-auto border-t border-sidebar-border-muted p-4 text-xs text-sidebar-foreground'>
          <div className='space-y-1'>
            {repo.project && (
              <button
                type='button'
                onClick={() => void navigate(`/listProjects/${repo.project!.id}`)}
                className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-ring'
                aria-label={`Open project ${repo.project.name}`}
                data-track-category='SdlcHub'
                data-track-name='ProjectOpened'
                data-track-metadata={JSON.stringify({ projectId: repo.project.id })}
              >
                <Boxes className='size-4 shrink-0 text-sidebar-foreground/65' />
                <span className='min-w-0 flex-1'>
                  <span className='block text-[10px] uppercase tracking-wide text-sidebar-foreground/55'>
                    Project
                  </span>
                  <span className='block truncate font-medium'>{repo.project.name}</span>
                </span>
                <ChevronRight className='size-3.5 shrink-0 text-sidebar-foreground/55' />
              </button>
            )}
            <SdlcHubRepositories
              repositories={channelRepos}
              onManage={() => setHubDialog('manage')}
            />
          </div>
        </div>
      </aside>

      <ResizableGroup
        orientation='horizontal'
        className='min-w-0 flex-1 overflow-hidden'
        autoSaveId='sdlc-chat-shell'
        panelIds={sdlcRightPanelIds(rightPanelMode)}
      >
        <Panel id={SDLC_MAIN_PANEL_ID} defaultSize={showRightPanel ? '62%' : '100%'} minSize='45%'>
          <main className='flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
            <header className='z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-5 backdrop-blur'>
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
                  <>
                    <button
                      type='button'
                      onClick={() => openTrack(null)}
                      className='shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground'
                      data-track-category='SdlcHub'
                      data-track-name='TrackDetailBack'
                    >
                      Tracks
                    </button>
                    <ChevronRight size={15} className='shrink-0 text-muted-foreground' />
                    <h1 className='truncate font-semibold'>{selectedTrack.name}</h1>
                  </>
                ) : (
                  <h1 className='font-semibold'>
                    {section === 'artifacts'
                      ? (activeTypeFolder?.name ?? 'Artifacts')
                      : (SECTIONS.find(item => item.id === section)?.label ?? 'Overview')}
                  </h1>
                )}
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {selectedCanvasId && isElectronApp() && !isDocumentWindow ? (
                  <Button
                    size='icon'
                    variant='ghost'
                    aria-label='Open in new window'
                    title='Open in new window'
                    onClick={() => openCanvasInWindow(selectedCanvasId, true)}
                    data-track-category='SdlcHub'
                    data-track-name='ArtifactOpenedInWindow'
                  >
                    <SquareArrowOutUpRight className='size-4' />
                  </Button>
                ) : null}
                {chatPanelAvailable ? (
                  <Button
                    size='icon'
                    variant='ghost'
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
                <Button
                  size='icon'
                  variant='ghost'
                  aria-label='Members'
                  title='Members'
                  onClick={() => setMembersDialog(true)}
                >
                  <Users className='size-4' />
                </Button>
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
            </header>

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
                      <Metric label='Tickets' value={String(tickets.length)} icon={CircleDot} />
                    </div>
                    {repo.channelId ? (
                      <SdlcActivityPreview key={repo.channelId} channelId={repo.channelId} />
                    ) : null}
                  </section>
                )}

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
                              Updated {setupUpdatedAtLabel(canvas.lastEditedAt ?? canvas.updatedAt)}
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
                {section === 'tracks' && renderTracks()}
                {section === 'tickets' && repo.channelId && (
                  <div className='h-[calc(100vh-8rem)] min-h-[36rem]'>
                    <KanbanBoardScreen channelId={repo.channelId} />
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
              {rightPanelMode === 'debugger' ? (
                <SdlcDebuggerPanel />
              ) : discussionOwner && discussionSurface && repo.channelId ? (
                <SdlcChatPanel
                  key={`discussion-${discussionOwner.canvasId}`}
                  channelId={repo.channelId}
                  title={discussionOwner.title}
                  discussion={{
                    repoId: repo.id,
                    ownerType: 'CANVAS',
                    ownerId: discussionOwner.canvasId,
                    surfaceType: discussionSurface.type,
                    surfaceId: discussionSurface.id,
                  }}
                  conversationIds={discussionConversationIds}
                  selectedConversationId={selectedDiscussionConversationId}
                  onSelectConversation={selectDiscussionConversation}
                  onClose={closeConversations}
                  onAskAI={openSdlcAssistant}
                />
              ) : section === 'tracks' && selectedTrack && repo.channelId ? (
                <SdlcChatPanel
                  key={`track-${selectedTrack.id}`}
                  channelId={repo.channelId}
                  title={selectedTrack.name}
                  discussion={{
                    repoId: repo.id,
                    ownerType: 'TRACK',
                    ownerId: selectedTrack.id,
                  }}
                  conversationIds={trackConversationIds}
                  selectedConversationId={selectedDiscussionConversationId}
                  onSelectConversation={selectDiscussionConversation}
                  onClose={closeConversations}
                  onAskAI={openSdlcAssistant}
                />
              ) : null}
            </Panel>
          </>
        ) : null}
      </ResizableGroup>

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
