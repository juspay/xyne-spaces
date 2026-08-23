import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
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
  BookOpen,
  Boxes,
  Bug,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Layers,
  Loader2,
  MessageCircle,
  Network,
  Plus,
  RefreshCw,
  Rocket,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { isFramedSdlcSurface, requestSdlcFrameReset } from './useSdlcFrameBridge';
import { toast } from 'sonner';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { Button } from '../../components/ui/Button';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
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
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import KanbanBoardScreen from '../KanbanBoardScreen/KanbanBoardScreen';
import { artifactCta } from './artifactCtaPolicy';
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
import { latestTicketPullRequest, ticketTraceValue, type SdlcTicket } from './ticketPolicy';
import {
  linkedTicketIds,
  relatedTicketsForArtifact,
  startWorkPrompt,
} from './artifactTicketPolicy';
import {
  canDebugRepoKnowledge,
  isRepoKnowledgeRunning,
  repoKnowledgeAction,
  repoKnowledgeControl,
  repoKnowledgeState,
  type RepoKnowledgeControl,
} from './repoKnowledgePolicy';

type Section = 'overview' | 'wiki' | 'baseline' | 'prds' | 'tech-docs' | 'tracks' | 'tickets';
type ArtifactKind = 'PRD' | 'TECH_DOC';

const StableCanvasScreen = memo(CanvasScreen);

const SDLC_ENTITY_TYPE_SET: ReadonlySet<string> = new Set(SDLC_ENTITY_TYPES);
const SDLC_RELATION_TYPE_SET: ReadonlySet<string> = new Set(SDLC_RELATION_TYPES);
const isSdlcEntityType = (value: string): value is SdlcEntityType =>
  SDLC_ENTITY_TYPE_SET.has(value);
const isSdlcRelationType = (value: string): value is SdlcRelationType =>
  SDLC_RELATION_TYPE_SET.has(value);

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Boxes }> = [
  { id: 'overview', label: 'Overview', icon: Boxes },
  { id: 'wiki', label: 'Wiki', icon: BookOpen },
  { id: 'baseline', label: 'Repo Knowledge', icon: ShieldCheck },
  { id: 'tracks', label: 'Tracks', icon: Layers },
  { id: 'prds', label: 'PRDs', icon: ScrollText },
  { id: 'tech-docs', label: 'Tech Docs', icon: Network },
  { id: 'tickets', label: 'Tickets', icon: CircleDot },
];

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
  const { repoId, section: routeSection } = useParams<{ repoId?: string; section?: Section }>();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthContextValues();
  const section = SECTIONS.some(item => item.id === routeSection) ? routeSection! : 'overview';
  const [repos] = useCachedQuery(queries.getSdlcRepos());
  const [repo, repoQueryDetails] = useCachedQuery(
    queries.getSdlcRepoById({ repoId: repoId || '' }),
    {
      enabled: Boolean(repoId),
    },
  );
  const zero = useZero();
  const [busy, setBusy] = useState<string | null>(null);
  const [artifactDialog, setArtifactDialog] = useState<ArtifactKind | null>(null);
  const [trackDialog, setTrackDialog] = useState(false);
  const [trackName, setTrackName] = useState('');
  const [trackDescription, setTrackDescription] = useState('');
  const [artifactTrack, setArtifactTrack] = useState<{ id: string; name: string } | null>(null);
  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactAiPrompt, setArtifactAiPrompt] = useState('');
  const [parentCanvasId, setParentCanvasId] = useState('');
  // Tech Doc dialog opened from a PRD card: track + parent PRD are fixed by that
  // context, so both fields are pre-filled and locked.
  const [artifactContextLocked, setArtifactContextLocked] = useState(false);
  const [startWorkPicker, setStartWorkPicker] = useState<{
    artifact: { id: string; title: string; kind: ArtifactKind };
    tickets: SdlcTicket[];
  } | null>(null);
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
    if (!repoId && Array.isArray(repos) && repos[0]) {
      void navigate(`/sdlc/${repos[0].id}/overview`, { replace: true });
    }
  }, [navigate, repoId, repos]);

  const canvases = useMemo(() => {
    if (!repo || repo instanceof Error) return [];
    return (repo.channel?.canvasFolders ?? []).flatMap(folder => folder.canvases ?? []);
  }, [repo]);
  const routeSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const selectedCanvasId = routeSearchParams.get('canvas');
  const selectedCanvas = canvases.find(canvas => canvas.id === selectedCanvasId);
  const [trackRows] = useCachedQuery(queries.getSdlcTracks({ repoId: repoId || '' }), {
    enabled: Boolean(repoId),
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
  const prds = useMemo(
    () => canvases.filter(canvas => canvas.sdlcArtifact?.artifactType === 'PRD'),
    [canvases],
  );
  const prdOptions = useMemo<SelectorOption[]>(
    () =>
      prds.map(canvas => ({
        value: canvas.id,
        label: canvas.title,
        icon: <ScrollText size={14} className='text-muted-foreground' />,
      })),
    [prds],
  );
  const techDocs = useMemo(
    () => canvases.filter(canvas => canvas.sdlcArtifact?.artifactType === 'TECH_DOC'),
    [canvases],
  );
  const links = useMemo(
    () =>
      repo && !(repo instanceof Error)
        ? (repo.sdlcEntityLinks ?? []).flatMap(link =>
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
    [repo],
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
  // tech doc canvas id -> its parent PRD title (from PRD -> TECH_DOC links).
  const parentPrdTitleByCanvasId = useMemo(() => {
    const titleById = new Map(prds.map(prd => [prd.id, prd.title]));
    const byTechDoc = new Map<string, string>();
    for (const link of links) {
      if (
        link.relationType === 'TECH_DOC' &&
        link.sourceType === 'CANVAS' &&
        link.targetType === 'CANVAS'
      ) {
        const title = titleById.get(link.sourceId);
        if (title) byTechDoc.set(link.targetId, title);
      }
    }
    return byTechDoc;
  }, [links, prds]);
  // Tech Doc's parent PRD is chosen from the PRDs in the selected track only.
  const artifactTrackPrdOptions = useMemo<SelectorOption[]>(() => {
    if (!artifactTrack) return [];
    const ids = trackPrdIdsByTrack.get(artifactTrack.id) ?? new Set<string>();
    return prdOptions.filter(option => ids.has(option.value));
  }, [artifactTrack, trackPrdIdsByTrack, prdOptions]);
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
        const repositoryChannelId = repo && !(repo instanceof Error) ? repo.channelId : null;
        return shouldShowSdlcRelatedLink({
          relationType: link.relationType,
          entityType,
          entityChannelId: relatedConversationChannels.get(entityId) ?? null,
          repositoryChannelId,
        });
      })
    : [];
  const selectedArtifactKindValue = selectedCanvas
    ? (selectedCanvas.sdlcArtifact?.artifactType ?? null)
    : null;
  const selectedArtifactKind: ArtifactKind | null =
    selectedArtifactKindValue === 'PRD' || selectedArtifactKindValue === 'TECH_DOC'
      ? selectedArtifactKindValue
      : null;
  const selectedArtifactTickets =
    selectedCanvas && selectedArtifactKind && repo && !(repo instanceof Error) && repo.project?.id
      ? relatedTicketsForArtifact({
          canvasId: selectedCanvas.id,
          projectId: repo.project.id,
          links,
          tickets,
        })
      : [];
  const traceRows = useMemo(
    () =>
      prds.map(prd => {
        const techDocLink = links.find(
          link => link.sourceId === prd.id && link.relationType === 'TECH_DOC',
        );
        const techDoc = techDocs.find(item => item.id === techDocLink?.targetId);
        const ticket =
          repo && !(repo instanceof Error) && repo.project?.id
            ? (relatedTicketsForArtifact({
                canvasId: prd.id,
                projectId: repo.project.id,
                links,
                tickets,
              })[0] ?? null)
            : null;
        const pullRequest = ticket
          ? latestTicketPullRequest(ticket)
          : prds.length === 1
            ? latestTicketPullRequest({
                pullRequests: tickets.flatMap(item => item.pullRequests ?? []),
              })
            : null;
        return {
          prd,
          techDoc,
          ticket,
          ticketValue: ticketTraceValue(ticket, prds.length === 1 ? tickets.length : 0),
          pullRequest,
        };
      }),
    [links, prds, repo, techDocs, tickets],
  );
  const state = repoKnowledgeState(repo && !(repo instanceof Error) ? repo.setupExecution : null);
  const setupRunning = isRepoKnowledgeRunning(state.phase);

  useEffect(() => {
    if (!repoId || externalDebuggerTarget?.repoId !== repoId) return;
    if (
      repo &&
      !(repo instanceof Error) &&
      externalDebuggerTarget.executionId === repo.setupExecution?.id
    ) {
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
  const accessRepoId = repo && !(repo instanceof Error) ? repo.id : '';
  const accessCapabilities =
    repo && !(repo instanceof Error) && Array.isArray(repo.accessCapabilities)
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
    !(repo instanceof Error) &&
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

  const openCanvas = (canvasId: string): void => {
    if (!repoId) return;
    setRelatedSourceId(null);
    navigateWithinSdlc(
      `/sdlc/${repoId}/${section}`,
      `?canvas=${encodeURIComponent(canvasId)}`,
      resolveCanvasDiscussionOwner(canvasId, canvases, links)?.canvasId ?? null,
    );
  };

  const openArtifactCanvas = (canvasId: string): void => {
    if (!repoId) return;
    const canvas = canvases.find(item => item.id === canvasId);
    const targetSection = canvas?.sdlcArtifact?.artifactType === 'TECH_DOC' ? 'tech-docs' : 'prds';
    setRelatedSourceId(null);
    navigateWithinSdlc(
      `/sdlc/${repoId}/${targetSection}`,
      `?canvas=${encodeURIComponent(canvasId)}`,
      resolveCanvasDiscussionOwner(canvasId, canvases, links)?.canvasId ?? null,
    );
  };

  const openWikiPage = (page: SdlcWikiPage): void => {
    if (!repoId) return;
    setRelatedSourceId(null);
    navigateWithinSdlc(
      `/sdlc/${repoId}/wiki`,
      `?canvas=${encodeURIComponent(page.canvasId)}`,
      page.canvasId,
    );
  };

  const closeCanvas = (): void => {
    if (!repoId) return;
    navigateWithinSdlc(`/sdlc/${repoId}/${section}`);
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
      if (!repo || repo instanceof Error || !repo.channelId) return;
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
      if (!repo || repo instanceof Error || !repo.channelId) return;
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
    if (!isAdmin || !repo || repo instanceof Error) return undefined;
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
    if (!repo || repo instanceof Error || !repo.channelId) return;
    openSdlcAssistant();
    const next = new URLSearchParams(location.search);
    next.delete('chat');
    const search = next.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
  }, [location.pathname, location.search, navigate, openSdlcAssistant, repo, sdlcChatTab]);

  const createArtifact = (): void => {
    if (!repoId || !repo || repo instanceof Error || !artifactDialog || !artifactTitle.trim())
      return;
    const parentPrd =
      artifactDialog === 'TECH_DOC' ? prds.find(prd => prd.id === parentCanvasId) : undefined;
    const query = buildSdlcArtifactCreationPrompt({
      kind: artifactDialog,
      title: artifactTitle.trim(),
      repositoryName: repo.name,
      ...(artifactAiPrompt.trim() && { direction: artifactAiPrompt.trim() }),
      ...(parentPrd && {
        parentPrd: { canvasId: parentPrd.id, title: parentPrd.title },
      }),
      ...((artifactDialog === 'PRD' || artifactDialog === 'TECH_DOC') && artifactTrack
        ? { track: artifactTrack }
        : {}),
    });
    askSdlcAssistant(
      query,
      parentPrd ? { canvasId: parentPrd.id, title: parentPrd.title } : undefined,
      true,
    );
    setArtifactDialog(null);
    setArtifactTitle('');
    setArtifactAiPrompt('');
    setParentCanvasId('');
    setArtifactTrack(null);
    setArtifactContextLocked(false);
  };

  const createBlankArtifact = async (): Promise<void> => {
    if (!repo || repo instanceof Error || !artifactDialog || !artifactTitle.trim()) return;
    const kind = artifactDialog;
    const title = artifactTitle.trim();
    const response = await apiInstance.post<{ artifact: { canvasId: string } }>(
      '/sdlc/claw/artifacts',
      {
        repoId: repo.id,
        kind: artifactDialog,
        title,
        markdown: `# ${title}\n`,
        ...(artifactDialog === 'TECH_DOC' && parentCanvasId ? { parentCanvasId } : {}),
        ...((artifactDialog === 'PRD' || artifactDialog === 'TECH_DOC') && artifactTrack
          ? { trackId: artifactTrack.id }
          : {}),
      },
    );
    setArtifactDialog(null);
    setArtifactTitle('');
    setArtifactAiPrompt('');
    setParentCanvasId('');
    setArtifactTrack(null);
    setArtifactContextLocked(false);
    // Open in the artifact's own section (Tech Doc / PRD), not whatever section the
    // dialog was launched from — the new canvas isn't in `canvases` yet, so navigate
    // by the known kind rather than a lookup.
    const newCanvasId = response.data.artifact.canvasId;
    const targetSection = kind === 'TECH_DOC' ? 'tech-docs' : 'prds';
    setRelatedSourceId(null);
    navigateWithinSdlc(
      `/sdlc/${repoId}/${targetSection}`,
      `?canvas=${encodeURIComponent(newCanvasId)}`,
      null,
    );
  };

  const sendStartWork = useCallback(
    (artifact: { id: string; title: string; kind: ArtifactKind }, ticket: SdlcTicket): void => {
      if (!repo || repo instanceof Error || !repo.channelId) return;
      setStartWorkPicker(null);
      setDiscussionUrl({ open: false, conversationId: null });
      closeExternalDebugger();
      const canvasInfo = { canvasId: artifact.id, title: artifact.title };
      const initialContextSelections = {
        canvases: [{ id: artifact.id, canvasId: artifact.id, title: artifact.title }],
        tickets: [
          {
            id: ticket.id,
            title: ticket.title,
            xyneId: ticket.xyneId,
            status: ticket.stageName,
          },
        ],
        recordings: [],
      };
      const initialQuery = startWorkPrompt({
        repositoryName: repo.name,
        artifactKind: artifact.kind,
        artifactTitle: artifact.title,
        ticket,
      });
      setSelectedAgentSlug('sdlc-agent');
      xyneAIActor.send({
        type: 'OPEN',
        contextType: 'chat',
        contextId: repo.channelId,
        channelId: repo.channelId,
        startFreshChat: true,
        canvasInfo,
        initialContextSelections,
        researchContext: { type: 'repository', id: repo.id, name: repo.name },
        initialQuery,
      });
    },
    [closeExternalDebugger, repo, setDiscussionUrl, setSelectedAgentSlug],
  );

  const startArtifactWork = useCallback(
    (
      artifact: { id: string; title: string; kind: ArtifactKind },
      candidates: SdlcTicket[],
    ): void => {
      if (candidates.length === 1) {
        sendStartWork(artifact, candidates[0]!);
        return;
      }
      if (candidates.length > 1) setStartWorkPicker({ artifact, tickets: candidates });
    },
    [sendStartWork],
  );

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

  if (repos === undefined || (repoId && repo === undefined)) {
    return (
      <div className='h-full grid place-items-center text-muted-foreground'>
        <Loader2 className='animate-spin' />
      </div>
    );
  }

  if (!Array.isArray(repos) || repos.length === 0) {
    return (
      <div className='h-full bg-muted/30 grid place-items-center p-8'>
        <div className='max-w-lg rounded-2xl border bg-background p-10 text-center shadow-sm'>
          <div className='mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary'>
            <GitBranch size={26} />
          </div>
          <h1 className='text-2xl font-semibold'>Your SDLC hubs start with a repository</h1>
          <p className='mt-3 text-sm leading-6 text-muted-foreground'>
            Open a project from List Projects and attach its first repository. Xyne will create a
            private, repo-scoped hub without exposing it in Chat.
          </p>
          <Button className='mt-6' onClick={() => void navigate('/listProjects')}>
            Choose project
          </Button>
        </div>
      </div>
    );
  }

  if (!repo || repo instanceof Error) {
    return (
      <div className='h-full grid place-items-center text-muted-foreground'>
        Repository not found.
      </div>
    );
  }

  const runTrackMutation = async (mutation: ReturnType<typeof zero.mutate>): Promise<void> => {
    const response = await mutation.server;
    if (response.type === 'error') throw new Error(response.error.message);
  };

  const createTrackAction = async (): Promise<void> => {
    if (!repo || repo instanceof Error) return;
    const id = uuidv4();
    await runTrackMutation(
      zero.mutate(
        mutators.sdlc.createTrack({
          id,
          repoId: repo.id,
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
      navigateWithinSdlc(`/sdlc/${repoId}/tracks`, `?track=${encodeURIComponent(id)}`);
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
      `/sdlc/${repoId}/tracks`,
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
      const trackPrds = prds
        .filter(item => trackItemIds.has(item.id))
        .sort((left, right) => left.createdAt - right.createdAt);
      const trackTechDocs = techDocs
        .filter(item => trackItemIds.has(item.id))
        .sort((left, right) => left.createdAt - right.createdAt);
      const trackTickets = tickets.filter(ticket => trackTicketIds.has(ticket.id));
      return (
        <section>
          {selectedTrack.description ? (
            <p className='mb-4 text-sm text-muted-foreground'>{selectedTrack.description}</p>
          ) : null}
          <SectionHeader
            title='PRDs in this track'
            description='Product documents grouped under this workstream.'
          />
          <div>
            {trackPrds.length === 0 ? (
              <EmptyCard text='No PRDs in this track yet. Create one to get started.' />
            ) : (
              trackPrds.map(canvas => (
                <button
                  type='button'
                  key={canvas.id}
                  className='group mb-1.5 flex w-full items-start gap-3 rounded-xl bg-primary/5 px-3 py-3 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  onClick={() => openArtifactCanvas(canvas.id)}
                  data-track-category='SdlcHub'
                  data-track-name='TrackPrdOpened'
                  data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                >
                  <span className='grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'>
                    <ScrollText size={18} />
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate text-sm font-semibold'>{canvas.title}</span>
                    <span className='mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                      <span className='font-medium text-primary/80'>PRD</span>
                      <span aria-hidden='true'>·</span>
                      <span>created {formatRelativeTime(canvas.createdAt)}</span>
                    </span>
                  </span>
                  <ChevronRight className='mt-1 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground' />
                </button>
              ))
            )}
          </div>
          <div className='mt-6'>
            <SectionHeader
              title='Tech Docs in this track'
              description='Technical designs grouped under this workstream.'
            />
            <div>
              {trackTechDocs.length === 0 ? (
                <EmptyCard text='No Tech Docs in this track yet.' />
              ) : (
                trackTechDocs.map(canvas => (
                  <button
                    type='button'
                    key={canvas.id}
                    className='group mb-1.5 flex w-full items-start gap-3 rounded-xl bg-primary/5 px-3 py-3 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    onClick={() => openArtifactCanvas(canvas.id)}
                    data-track-category='SdlcHub'
                    data-track-name='TrackTechDocOpened'
                    data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                  >
                    <span className='grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'>
                      <Network size={18} />
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm font-semibold'>{canvas.title}</span>
                      <span className='mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                        <span className='font-medium text-primary/80'>Tech Doc</span>
                        <span aria-hidden='true'>·</span>
                        <span>created {formatRelativeTime(canvas.createdAt)}</span>
                      </span>
                    </span>
                    <ChevronRight className='mt-1 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground' />
                  </button>
                ))
              )}
            </div>
          </div>
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
                    onClick={() => navigateWithinSdlc(`/sdlc/${repo.id}/tickets`)}
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

  const renderArtifacts = (kind: ArtifactKind): ReactElement => {
    const list = kind === 'PRD' ? prds : techDocs;
    return (
      <section>
        <SectionHeader
          title={kind === 'PRD' ? 'PRDs' : 'Tech Docs'}
          description={
            kind === 'PRD'
              ? 'Product intent and acceptance criteria.'
              : 'Technical design tied to one PRD.'
          }
          action={
            <Button
              onClick={() => {
                setArtifactContextLocked(false);
                setArtifactTrack(null);
                setParentCanvasId('');
                setArtifactDialog(kind);
              }}
            >
              <Plus />
              New {kind === 'PRD' ? 'PRD' : 'Tech Doc'}
            </Button>
          }
        />
        <div className='grid grid-cols-2 gap-4'>
          {list.map(canvas => {
            const artifactTickets = repo.project?.id
              ? relatedTicketsForArtifact({
                  canvasId: canvas.id,
                  projectId: repo.project.id,
                  links,
                  tickets,
                })
              : [];
            const linkedTargetId =
              kind === 'PRD'
                ? (links.find(
                    link => link.relationType === 'TECH_DOC' && link.sourceId === canvas.id,
                  )?.targetId ?? null)
                : (artifactTickets[0]?.id ?? null);
            const cta = artifactCta(kind, linkedTargetId);
            const cardMeta = [
              trackByCanvasId.get(canvas.id)?.name,
              kind === 'TECH_DOC' ? parentPrdTitleByCanvasId.get(canvas.id) : undefined,
            ].filter((value): value is string => Boolean(value));
            return (
              <ArtifactCard
                key={canvas.id}
                title={canvas.title}
                eyebrow={kind === 'PRD' ? 'PRD' : 'Tech Doc'}
                {...(cardMeta.length > 0 && { meta: cardMeta })}
                onOpen={() => openCanvas(canvas.id)}
                actionLabel={cta.label}
                {...(kind === 'PRD' &&
                  artifactTickets.length > 0 && {
                    onStartWork: (): void =>
                      startArtifactWork(
                        { id: canvas.id, title: canvas.title, kind },
                        artifactTickets,
                      ),
                  })}
                onAction={() => {
                  if (cta.action === 'VIEW_TECH_DOC') {
                    openArtifactCanvas(cta.targetId);
                    return;
                  }
                  if (cta.action === 'START_WORK') {
                    startArtifactWork(
                      { id: canvas.id, title: canvas.title, kind },
                      artifactTickets,
                    );
                    return;
                  }
                  if (cta.action === 'CREATE_TECH_DOC') {
                    // Same dialog as "New Tech Doc", but track + parent PRD come from
                    // this PRD card and are locked.
                    const prdTrack = trackByCanvasId.get(canvas.id);
                    setArtifactTitle('');
                    setArtifactAiPrompt('');
                    setParentCanvasId(canvas.id);
                    setArtifactTrack(prdTrack ? { id: prdTrack.id, name: prdTrack.name } : null);
                    setArtifactContextLocked(true);
                    setArtifactDialog('TECH_DOC');
                    return;
                  }
                  const query = `Create an implementation ticket for the Tech Doc "${canvas.title}" (canvas ID: ${canvas.id}) in repository "${repo.name}".`;
                  askSdlcAssistant(query, { canvasId: canvas.id, title: canvas.title });
                }}
              />
            );
          })}
          {list.length === 0 && (
            <EmptyCard text={`No ${kind === 'PRD' ? 'PRDs' : 'Tech Docs'} yet.`} />
          )}
        </div>
      </section>
    );
  };

  return (
    <div className='flex h-full min-w-0 overflow-hidden bg-transparent'>
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-sidebar-border-muted bg-sidebar text-sidebar-foreground',
          selectedWikiPage ||
            (section === 'baseline' && selectedCanvas) ||
            (section === 'tracks' && selectedTrack)
            ? 'w-72'
            : 'w-60',
        )}
        style={{ backdropFilter: 'blur(var(--sidebar-background-blur))' }}
      >
        <div className='h-[52px] w-full shrink-0'>
          <AppNavigator />
        </div>
        <div className='border-b border-t border-sidebar-border-muted p-4'>
          <div className='flex items-center justify-between gap-2'>
            <div className='text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground'>
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
          <Select
            value={repo.id}
            onValueChange={nextRepoId => void navigate(`/sdlc/${nextRepoId}/overview`)}
          >
            <SelectTrigger
              className='mt-2 h-10 w-full rounded-[10px] border-sidebar-border-muted bg-sidebar-accent/40 px-3 font-medium text-sidebar-accent-foreground shadow-none hover:bg-sidebar-accent/60 focus-visible:border-sidebar-accent-ring focus-visible:ring-sidebar-accent-ring/30'
              aria-label='Repository'
              data-track-category='SdlcHub'
              data-track-name='RepositoryChanged'
            >
              <span className='flex min-w-0 items-center gap-2'>
                <GitBranch className='size-4 shrink-0 text-sidebar-foreground/70' />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {repos.map(item => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <nav className='shrink-0 p-2'>
          {SECTIONS.map(item => {
            const Icon = item.icon;
            return (
              <div key={item.id} className='mb-1'>
                <button
                  onClick={() => navigateWithinSdlc(`/sdlc/${repo.id}/${item.id}`)}
                  className={cn(
                    'flex h-10 w-full items-center gap-3 rounded-[10px] border px-3 text-sm transition-colors',
                    section === item.id
                      ? 'border-transparent bg-sidebar-accent/70 font-medium text-sidebar-accent-foreground'
                      : 'border-transparent text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                  )}
                  data-track-category='SdlcHub'
                  data-track-name='SectionChanged'
                  data-track-metadata={JSON.stringify({ section: item.id, repoId: repo.id })}
                >
                  <Icon size={17} />
                  {item.label}
                  <span className='ml-auto text-xs'>
                    {item.id === 'wiki'
                      ? section === 'wiki'
                        ? wikiPages.length
                        : ''
                      : item.id === 'baseline'
                        ? baseline.length
                        : item.id === 'prds'
                          ? prds.length
                          : item.id === 'tech-docs'
                            ? techDocs.length
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
        </nav>
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
          <div className='border-t border-sidebar-border-muted p-3'>
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
            <a
              href={repo.canonicalUrl || repo.url}
              target='_blank'
              rel='noreferrer'
              className='flex w-full items-center gap-2 rounded-lg px-2 py-2 font-medium transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-ring'
              aria-label={`Open ${repo.name} repository`}
            >
              <GitBranch className='size-4 shrink-0 text-sidebar-foreground/65' />
              <span className='min-w-0 flex-1 truncate'>Open repository</span>
              <ExternalLink className='size-3.5 shrink-0 text-sidebar-foreground/55' />
            </a>
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
                      {SECTIONS.find(item => item.id === section)?.label ?? 'Overview'}
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
                    {SECTIONS.find(item => item.id === section)?.label ?? 'Overview'}
                  </h1>
                )}
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {selectedCanvas && selectedArtifactKind && selectedArtifactTickets.length > 0 && (
                  <Button
                    variant='outline'
                    onClick={() =>
                      startArtifactWork(
                        {
                          id: selectedCanvas.id,
                          title: selectedCanvas.title,
                          kind: selectedArtifactKind,
                        },
                        selectedArtifactTickets,
                      )
                    }
                  >
                    <Rocket className='size-4' />
                    Start work
                  </Button>
                )}
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
                            repoId: repo.id,
                            ownerId: discussionOwner.canvasId,
                          },
                        };
                      }
                      if (section === 'tracks' && selectedTrack) {
                        return {
                          sdlcLink: {
                            ownerType: 'TRACK',
                            repoId: repo.id,
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
                    <div className='mt-5 grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-background sm:grid-cols-4 sm:divide-y-0'>
                      <Metric
                        label='Repo Knowledge ready'
                        value={`${readyCount}/${SDLC_BASELINE_COUNT}`}
                        icon={ShieldCheck}
                      />
                      <Metric label='PRDs' value={String(prds.length)} icon={ScrollText} />
                      <Metric label='Tech Docs' value={String(techDocs.length)} icon={Network} />
                      <Metric label='Tickets' value={String(tickets.length)} icon={CircleDot} />
                    </div>
                    <div className='mt-5 rounded-xl border bg-background p-5'>
                      <div className='flex items-center justify-between'>
                        <div>
                          <h3 className='font-semibold'>Lifecycle trace</h3>
                          <p className='mt-1 text-sm text-muted-foreground'>
                            PRD → Tech Doc → Ticket → Pull Request
                          </p>
                        </div>
                        <GitBranch className='text-muted-foreground' />
                      </div>
                      <div className='mt-5 space-y-3'>
                        {traceRows.map(row => {
                          const nodes = [
                            { label: 'PRD', value: row.prd.title },
                            { label: 'Tech Doc', value: row.techDoc?.title },
                            {
                              label: 'Ticket',
                              value: row.ticketValue,
                            },
                            {
                              label: 'Pull Request',
                              value: row.pullRequest
                                ? `#${row.pullRequest.prId}${
                                    row.pullRequest.status
                                      ? ` · ${row.pullRequest.status.toLowerCase().replaceAll('_', ' ')}`
                                      : ''
                                  }`
                                : undefined,
                              href: row.pullRequest?.prUrl ?? undefined,
                            },
                          ];
                          return (
                            <div key={row.prd.id} className='flex items-center gap-3'>
                              {nodes.map((node, index) => (
                                <div key={node.label} className='contents'>
                                  <div
                                    className={cn(
                                      'min-w-0 flex-1 rounded-xl border p-4',
                                      node.value ? 'bg-muted/30' : 'border-dashed bg-background',
                                    )}
                                  >
                                    <div className='text-xs text-muted-foreground'>
                                      {node.label}
                                    </div>
                                    <div
                                      className={cn(
                                        'mt-1 truncate text-sm font-medium',
                                        !node.value && 'text-muted-foreground',
                                      )}
                                    >
                                      {node.href && node.value ? (
                                        <a
                                          href={node.href}
                                          target='_blank'
                                          rel='noreferrer'
                                          onClick={event => event.stopPropagation()}
                                          className='inline-flex max-w-full items-center gap-1.5 text-primary hover:underline'
                                          data-track-category='SdlcHub'
                                          data-track-name='PullRequestOpened'
                                        >
                                          <GitPullRequest size={14} className='shrink-0' />
                                          <span className='truncate'>{node.value}</span>
                                        </a>
                                      ) : (
                                        node.value || 'Not linked'
                                      )}
                                    </div>
                                  </div>
                                  {index < 3 && (
                                    <ChevronRight
                                      className='shrink-0 text-muted-foreground'
                                      size={18}
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {traceRows.length === 0 && (
                          <div className='rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground'>
                            Create a PRD to begin the trace.
                          </div>
                        )}
                      </div>
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

                {section === 'prds' && renderArtifacts('PRD')}
                {section === 'tech-docs' && renderArtifacts('TECH_DOC')}
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
        open={artifactDialog !== null}
        onOpenChange={open => {
          if (!open) {
            setArtifactDialog(null);
            setArtifactTrack(null);
            setArtifactContextLocked(false);
          }
        }}
        title={`New ${artifactDialog}`}
      >
        <form
          className='p-6'
          onSubmit={event => {
            event.preventDefault();
            void call(
              'artifact',
              () => Promise.resolve(createArtifact()),
              'Creation request sent to Ask AI',
            );
          }}
        >
          <h2 className='text-lg font-semibold'>
            New {artifactDialog === 'PRD' ? 'PRD' : 'Tech Doc'}
          </h2>
          <label htmlFor='sdlc-artifact-title' className='mt-5 block text-sm font-medium'>
            Title
          </label>
          <Input
            id='sdlc-artifact-title'
            autoFocus
            value={artifactTitle}
            onChange={event => setArtifactTitle(event.target.value)}
            className='mt-2 h-10'
            placeholder='Clear, outcome-focused title'
            data-track-category='SdlcHub'
            data-track-name='ArtifactTitleChanged'
          />
          {(artifactDialog === 'PRD' || artifactDialog === 'TECH_DOC') &&
            (tracks.filter(track => track.status !== 'ARCHIVED').length > 0 ? (
              <>
                <label htmlFor='sdlc-prd-track' className='mt-4 block text-sm font-medium'>
                  Track <span className='text-destructive'>*</span>
                </label>
                <select
                  id='sdlc-prd-track'
                  disabled={artifactContextLocked}
                  value={artifactTrack?.id ?? ''}
                  onChange={event => {
                    const track = tracks.find(item => item.id === event.target.value);
                    setArtifactTrack(track ? { id: track.id, name: track.name } : null);
                    setParentCanvasId('');
                  }}
                  className={cn(
                    'mt-2 h-10 w-full rounded-md border bg-background px-3',
                    artifactContextLocked && 'cursor-not-allowed opacity-60',
                  )}
                  data-track-category='SdlcHub'
                  data-track-name='PrdTrackChanged'
                >
                  <option value='' disabled>
                    Select a track
                  </option>
                  {tracks
                    .filter(track => track.status !== 'ARCHIVED')
                    .map(track => (
                      <option key={track.id} value={track.id}>
                        {track.name}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <p className='mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground'>
                Create a track first — every PRD and Tech Doc belongs to a track.
              </p>
            ))}
          {artifactDialog === 'TECH_DOC' && (
            <>
              {/* Not a <label htmlFor>: EntitySelector owns its trigger internally */}
              <span className='mt-4 block text-sm font-medium'>
                PRD <span className='font-normal text-muted-foreground'>(optional)</span>
              </span>
              {/* Rendered always, but disabled until a track is chosen — its PRD
                  list is scoped to the selected track. */}
              <div
                className={cn(
                  'mt-2',
                  (!artifactTrack || artifactContextLocked) && 'pointer-events-none opacity-50',
                )}
                aria-disabled={!artifactTrack || artifactContextLocked}
                title={!artifactTrack ? 'Select a track first' : undefined}
                data-track-category='SdlcHub'
                data-track-name='TechDocPRDChanged'
              >
                <EntitySelector
                  options={artifactTrackPrdOptions}
                  selectedValue={parentCanvasId || null}
                  onSelect={value => setParentCanvasId(value ?? '')}
                  placeholder={
                    !artifactTrack
                      ? 'Select a track first'
                      : artifactTrackPrdOptions.length === 0
                        ? 'No PRDs in this track'
                        : 'No PRD'
                  }
                  searchPlaceholder='Search PRDs...'
                  width='100%'
                  showUnassignOption
                  unassignLabel='No PRD'
                  virtualize
                  testId='sdlc-techDoc-prd'
                />
              </div>
            </>
          )}
          <label htmlFor='sdlc-artifact-ai-prompt' className='mt-4 block text-sm font-medium'>
            Direction{' '}
            <span className='font-normal text-muted-foreground'>(optional, used by Ask AI)</span>
          </label>
          <Textarea
            id='sdlc-artifact-ai-prompt'
            value={artifactAiPrompt}
            onChange={event => setArtifactAiPrompt(event.target.value)}
            className='mt-2 min-h-24'
            placeholder='What should Ask AI emphasize?'
            data-track-category='SdlcHub'
            data-track-name='ArtifactAiPromptChanged'
          />
          <div className='mt-6 flex items-center justify-between gap-2'>
            <Button
              type='button'
              variant='ghost'
              loading={busy === 'artifact-blank'}
              disabled={
                !artifactTitle.trim() ||
                ((artifactDialog === 'PRD' || artifactDialog === 'TECH_DOC') && !artifactTrack)
              }
              title='Create an empty document with just the title — no AI'
              onClick={() =>
                void call(
                  'artifact-blank',
                  createBlankArtifact,
                  `${artifactDialog === 'PRD' ? 'PRD' : 'Tech Doc'} created`,
                )
              }
              data-track-category='SdlcHub'
              data-track-name='BlankArtifactCreated'
            >
              Write it myself
            </Button>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  setArtifactDialog(null);
                  setArtifactContextLocked(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type='submit'
                loading={busy === 'artifact'}
                disabled={
                  !artifactTitle.trim() ||
                  ((artifactDialog === 'PRD' || artifactDialog === 'TECH_DOC') && !artifactTrack)
                }
              >
                <Sparkles />
                Ask AI to create
              </Button>
            </div>
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
        open={startWorkPicker !== null}
        onOpenChange={open => {
          if (!open) setStartWorkPicker(null);
        }}
        title='Choose a ticket'
      >
        <div className='p-6'>
          <h2 className='text-lg font-semibold'>Choose a ticket</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            This artifact is linked to multiple tickets. Select the one the AI should start.
          </p>
          <div className='mt-5 grid gap-2'>
            {startWorkPicker?.tickets.map(ticket => (
              <button
                key={ticket.id}
                type='button'
                className='rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                onClick={() => sendStartWork(startWorkPicker.artifact, ticket)}
                data-track-category='SdlcHub'
                data-track-name='StartWorkTicketSelected'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
              >
                <span className='block text-xs font-semibold text-primary'>{ticket.xyneId}</span>
                <span className='mt-1 block text-sm font-medium'>{ticket.title}</span>
              </button>
            ))}
          </div>
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
  onStartWork,
  actionLabel,
}: {
  title: string;
  eyebrow: string;
  meta?: string[];
  onOpen: () => void;
  onAction: () => void;
  onStartWork?: () => void;
  actionLabel: string;
}): ReactElement {
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
      <div className='mt-6 flex items-center justify-between gap-3'>
        <span className='text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground'>
          Open document
        </span>
        <div className='flex items-center gap-2'>
          {onStartWork && (
            <Button
              size='sm'
              variant='outline'
              onKeyDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                onStartWork();
              }}
            >
              <Rocket className='size-4' />
              Start work
            </Button>
          )}
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
