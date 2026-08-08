import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ChannelRole, SDLC_SETUP_STATUSES, type SdlcSetupStatus } from '@xyne/shared';
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
  Loader2,
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
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../hooks/useAuth';
import { xyneAIActor } from '../../machines/xyneAIMachine';
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
import {
  claimSdlcAssistantAutoOpen,
  shouldOpenSdlcAssistantForRepository,
} from './sdlcAssistantAutoOpen';
import { SdlcTicketsBoard } from './SdlcTicketsBoard';
import { artifactCta } from './artifactCtaPolicy';
import { baselineApprovalAction } from './baselinePolicy';
import { shouldRequestAutomaticAccessCheck } from './accessCheckClientPolicy';
import { SdlcWikiSection, SdlcWikiSidebarTree, type SdlcWikiPage } from './SdlcWikiSection';
import {
  filterTickets,
  latestTicketPullRequest,
  linkedTicketForCanvasChain,
  ticketDebugContext,
  ticketTraceValue,
  type SdlcTicket,
  type TicketExecution,
} from './ticketPolicy';

type Section = 'overview' | 'wiki' | 'baseline' | 'prds' | 'tech-docs' | 'tickets';
type ArtifactKind = 'PRD' | 'TECH_DOC';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Boxes }> = [
  { id: 'overview', label: 'Overview', icon: Boxes },
  { id: 'wiki', label: 'Wiki', icon: BookOpen },
  { id: 'baseline', label: 'Repo Knowledge', icon: ShieldCheck },
  { id: 'prds', label: 'PRDs', icon: ScrollText },
  { id: 'tech-docs', label: 'Tech Docs', icon: Network },
  { id: 'tickets', label: 'Tickets', icon: CircleDot },
];

const BASELINE_LABELS: Record<string, string> = {
  CORE_CODE_MAP: 'Core Code Map',
  FRONTEND_DESIGN_SYSTEM: 'Frontend Design System',
  CODE_LINT_STANDARDS: 'Code & Lint Standards',
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

function metadataOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isSetupStatus(value: unknown): value is SdlcSetupStatus {
  return typeof value === 'string' && SDLC_SETUP_STATUSES.includes(value as SdlcSetupStatus);
}

function setupState(
  execution:
    | { status?: string; context?: string | null; updatedAt?: number | null }
    | null
    | undefined,
): {
  phase: SdlcSetupStatus;
  error?: string;
  conversationId?: string;
  sessionId?: string;
  currentBaselineKind?: string;
  completedCount: number;
  updatedAt?: number;
} {
  if (!execution) return { phase: 'NOT_STARTED', completedCount: 0 };
  try {
    const context = JSON.parse(execution.context || '{}') as {
      phase?: unknown;
      error?: string;
      conversationId?: string;
      sessionId?: string;
      currentBaselineKind?: string;
      completedBaselineKinds?: unknown;
    };
    const phase =
      execution.status === 'FAILURE'
        ? 'PARTIALLY_FAILED'
        : execution.status === 'CANCELLED'
          ? 'CANCELLED'
          : isSetupStatus(context.phase)
            ? context.phase
            : execution.status === 'SUCCESS'
              ? 'READY_FOR_REVIEW'
              : execution.status === 'RUNNING'
                ? 'GENERATING'
                : 'QUEUED';
    return {
      phase,
      completedCount: Array.isArray(context.completedBaselineKinds)
        ? context.completedBaselineKinds.length
        : 0,
      ...((context.error || execution.status === 'FAILURE') && {
        error: context.error || 'Setup failed. Retry the run.',
      }),
      ...(context.conversationId && { conversationId: context.conversationId }),
      ...(context.sessionId && { sessionId: context.sessionId }),
      ...(context.currentBaselineKind && { currentBaselineKind: context.currentBaselineKind }),
      ...(typeof execution.updatedAt === 'number' && { updatedAt: execution.updatedAt }),
    };
  } catch {
    return {
      phase:
        execution.status === 'FAILURE'
          ? 'PARTIALLY_FAILED'
          : execution.status === 'CANCELLED'
            ? 'CANCELLED'
            : execution.status === 'SUCCESS'
              ? 'READY_FOR_REVIEW'
              : execution.status === 'RUNNING'
                ? 'GENERATING'
                : 'QUEUED',
      completedCount: 0,
      ...(typeof execution.updatedAt === 'number' && { updatedAt: execution.updatedAt }),
    };
  }
}

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
  const [repo] = useCachedQuery(queries.getSdlcRepoById({ repoId: repoId || '' }), {
    enabled: Boolean(repoId),
  });
  const sdlcBoardId = repo && !(repo instanceof Error) ? (repo.project?.sdlcBoard?.id ?? '') : '';
  const [sdlcBoardDetail] = useCachedQuery(queries.boardDetailById({ boardId: sdlcBoardId }), {
    enabled: Boolean(sdlcBoardId),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [artifactDialog, setArtifactDialog] = useState<ArtifactKind | null>(null);
  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactAiDraft, setArtifactAiDraft] = useState(false);
  const [artifactAiPrompt, setArtifactAiPrompt] = useState('');
  const [parentCanvasId, setParentCanvasId] = useState('');
  const [ticketDialog, setTicketDialog] = useState(false);
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketSourceId, setTicketSourceId] = useState('');
  const [linkDialog, setLinkDialog] = useState(false);
  const [membersDialog, setMembersDialog] = useState(false);
  const [relatedSourceId, setRelatedSourceId] = useState<string | null>(null);
  const [linkTargetType, setLinkTargetType] = useState('MESSAGE');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [pendingArtifactExecutionId, setPendingArtifactExecutionId] = useState<string | null>(null);
  const automaticAccessChecksRef = useRef(new Set<string>());
  const assistantRepositoryScopeRef = useRef<string | null>(null);
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
  const selectedCanvasId = useMemo(
    () => new URLSearchParams(location.search).get('canvas'),
    [location.search],
  );
  const selectedCanvas = canvases.find(canvas => canvas.id === selectedCanvasId);
  const wikiQuery = useQuery({
    queryKey: ['sdlc-wiki-pages', repoId],
    queryFn: async () => {
      const response = await apiInstance.get<{ success: boolean; pages: SdlcWikiPage[] }>(
        `/sdlc/repositories/${encodeURIComponent(repoId!)}/wiki`,
      );
      return response.data.pages;
    },
    enabled: Boolean(repoId && section === 'wiki'),
  });
  const wikiPages = wikiQuery.data ?? [];
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
  useEffect(() => {
    if (!pendingArtifactExecutionId) return;
    const created = canvases.find(
      canvas => metadataOf(canvas.metadata)['workflowExecutionId'] === pendingArtifactExecutionId,
    );
    if (!created) return;
    setPendingArtifactExecutionId(null);
    toast.success('Claw created the editable SDLC canvas');
    void navigate(`/sdlc/${repoId}/${section}?canvas=${encodeURIComponent(created.id)}`);
  }, [canvases, navigate, pendingArtifactExecutionId, repoId, section]);
  const baseline = useMemo(
    () => canvases.filter(canvas => metadataOf(canvas.metadata)['artifactKind'] === 'BASELINE'),
    [canvases],
  );
  const prds = useMemo(
    () => canvases.filter(canvas => metadataOf(canvas.metadata)['artifactKind'] === 'PRD'),
    [canvases],
  );
  const techDocs = useMemo(
    () => canvases.filter(canvas => metadataOf(canvas.metadata)['artifactKind'] === 'TECH_DOC'),
    [canvases],
  );
  const sdlcBoard = repo && !(repo instanceof Error) ? repo.project?.sdlcBoard : undefined;
  const rawTickets: readonly SdlcTicket[] =
    repo && !(repo instanceof Error)
      ? ((repo.channel?.tickets ?? []) as unknown as readonly SdlcTicket[])
      : [];
  const tickets = useMemo(
    () =>
      repo && !(repo instanceof Error) && repo.channelId && sdlcBoard?.id
        ? filterTickets(rawTickets, {
            repoId: repo.id,
            boardId: sdlcBoard.id,
            channelId: repo.channelId,
          })
        : [],
    [rawTickets, repo, sdlcBoard?.id],
  );
  const links = repo && !(repo instanceof Error) ? (repo.sdlcEntityLinks ?? []) : [];
  const relatedCanvas = canvases.find(canvas => canvas.id === relatedSourceId);
  const selectedCanvasRelatedLinks = selectedCanvas
    ? links.filter(
        link => link.sourceId === selectedCanvas.id || link.targetId === selectedCanvas.id,
      )
    : [];
  const traceRows = useMemo(
    () =>
      prds.map(prd => {
        const techDocLink = links.find(
          link => link.sourceId === prd.id && link.relationType === 'TECH_DOC',
        );
        const techDoc = techDocs.find(item => item.id === techDocLink?.targetId);
        const ticket = linkedTicketForCanvasChain(
          tickets,
          links,
          [prd.id, techDoc?.id ?? ''].filter(Boolean),
        );
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
    [links, prds, techDocs, tickets],
  );
  const state = setupState(repo && !(repo instanceof Error) ? repo.setupExecution : null);
  const setupRunning = ['QUEUED', 'CLONING', 'GENERATING'].includes(state.phase);

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
    const ticketExecution = tickets
      .flatMap(ticket => ticket.workflows ?? [])
      .flatMap(workflow => workflow.workflowExecutions ?? [])
      .find(execution => execution.id === externalDebuggerTarget.executionId);
    if (!ticketExecution) return;
    const debugContext = ticketDebugContext(ticketExecution);
    updateExternalDebugger(repoId, {
      ...(debugContext && {
        conversationId: debugContext.conversationId,
        sessionId: debugContext.sessionId,
      }),
      running: ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING'].includes(ticketExecution.status),
    });
  }, [
    externalDebuggerTarget,
    repo,
    repoId,
    setupRunning,
    state.conversationId,
    state.sessionId,
    tickets,
    updateExternalDebugger,
  ]);

  const approvedCount = baseline.filter(
    canvas => typeof metadataOf(canvas.metadata)['approvedAt'] === 'string',
  ).length;
  const accessStatus = repo && !(repo instanceof Error) ? repo.accessCheckStatus : 'NOT_CHECKED';
  const accessRepoId = repo && !(repo instanceof Error) ? repo.id : '';
  const accessErrorCode = repo && !(repo instanceof Error) ? repo.accessErrorCode : null;
  const accessCredentialRevision =
    repo && !(repo instanceof Error) ? repo.accessCredentialRevision : null;
  const accessCheckStartedAt = repo && !(repo instanceof Error) ? repo.accessCheckStartedAt : null;
  const accessCapabilities =
    repo && !(repo instanceof Error) && Array.isArray(repo.accessCapabilities)
      ? (repo.accessCapabilities as Array<{ capability?: string; state?: string; detail?: string }>)
      : [];
  const capabilityReady = (capability: string, states: string[]): boolean =>
    accessCapabilities.some(
      item => item.capability === capability && states.includes(item.state || ''),
    );
  const readReady = accessStatus === 'READY' && capabilityReady('READ_REPOSITORY', ['PROVEN']);
  const artifactsUnlocked = readReady && approvedCount === 5;
  const writeReady =
    capabilityReady('PUSH_BRANCH', ['PROVEN', 'INFERRED']) &&
    capabilityReady('CREATE_PULL_REQUEST', ['PROVEN', 'INFERRED']);
  const accessChecking = ['QUEUED', 'CHECKING'].includes(accessStatus);
  const showAccessWarning = !accessChecking && (!readReady || !writeReady);
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

  useEffect(() => {
    if (!accessRepoId) return;
    if (
      !shouldRequestAutomaticAccessCheck({
        status: accessStatus,
        errorCode: accessErrorCode,
      })
    ) {
      return;
    }
    const fingerprint = [
      accessRepoId,
      accessStatus,
      accessErrorCode ?? '',
      accessCredentialRevision ?? '',
      accessCheckStartedAt ?? '',
    ].join(':');
    if (automaticAccessChecksRef.current.has(fingerprint)) return;
    automaticAccessChecksRef.current.add(fingerprint);
    void apiInstance
      .post(`/sdlc/repositories/${accessRepoId}/access-check`, { force: false })
      .catch(() => undefined);
  }, [accessCheckStartedAt, accessCredentialRevision, accessErrorCode, accessRepoId, accessStatus]);
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

  const openCanvas = (canvasId: string): void => {
    if (!repoId) return;
    setRelatedSourceId(null);
    void navigate(`/sdlc/${repoId}/${section}?canvas=${encodeURIComponent(canvasId)}`);
  };

  const openArtifactCanvas = (canvasId: string): void => {
    if (!repoId) return;
    const canvas = canvases.find(item => item.id === canvasId);
    const artifactKind = metadataOf(canvas?.metadata)['artifactKind'];
    const targetSection = artifactKind === 'TECH_DOC' ? 'tech-docs' : 'prds';
    setRelatedSourceId(null);
    void navigate(`/sdlc/${repoId}/${targetSection}?canvas=${encodeURIComponent(canvasId)}`);
  };

  const openWikiPage = (page: SdlcWikiPage): void => {
    if (!repoId) return;
    setRelatedSourceId(null);
    void navigate(`/sdlc/${repoId}/wiki?canvas=${encodeURIComponent(page.canvasId)}`);
  };

  const closeCanvas = (): void => {
    if (!repoId) return;
    void navigate(`/sdlc/${repoId}/${section}`);
  };

  const openSdlcAssistant = useCallback((): void => {
    if (!repo || repo instanceof Error || !repo.channelId) return;
    closeExternalDebugger();
    setSelectedAgentSlug('sdlc-agent');
    xyneAIActor.send({
      type: 'OPEN',
      contextType: 'chat',
      contextId: repo.channelId,
      channelId: repo.channelId,
      startFreshChat: true,
      ...(assistantCanvas && { canvasInfo: assistantCanvas }),
      researchContext: { type: 'repository', id: repo.id, name: repo.name },
    });
  }, [assistantCanvas, closeExternalDebugger, repo, setSelectedAgentSlug]);

  const askSdlcAssistant = useCallback(
    (query: string, canvas: { canvasId: string; title: string }): void => {
      if (!repo || repo instanceof Error || !repo.channelId) return;
      const assistantState = xyneAIActor.getSnapshot();
      const pinnedContext = assistantState.context.researchContext;
      const needsFreshChat =
        !assistantState.matches('open') ||
        selectedAgentSlug !== 'sdlc-agent' ||
        assistantState.context.channelId !== repo.channelId ||
        pinnedContext?.type !== 'repository' ||
        pinnedContext.id !== repo.id;
      closeExternalDebugger();
      setSelectedAgentSlug('sdlc-agent');
      xyneAIActor.send({
        type: 'OPEN',
        contextType: 'chat',
        contextId: repo.channelId,
        channelId: repo.channelId,
        startFreshChat: needsFreshChat,
        canvasInfo: canvas,
        researchContext: { type: 'repository', id: repo.id, name: repo.name },
        initialQuery: query,
      });
    },
    [closeExternalDebugger, repo, selectedAgentSlug, setSelectedAgentSlug],
  );

  const openSdlcDebugger = useCallback(
    (target: Parameters<typeof openExternalDebugger>[0]): void => {
      if (xyneAIActor.getSnapshot().matches('open')) xyneAIActor.send({ type: 'CLOSE' });
      openExternalDebugger(target);
    },
    [openExternalDebugger],
  );

  useEffect(() => {
    if (!repo || repo instanceof Error || repo.id !== repoId) return;
    const assistantState = xyneAIActor.getSnapshot();
    const pinnedContext = assistantState.context.researchContext;
    const pinnedRepositoryId = pinnedContext?.type === 'repository' ? pinnedContext.id : null;
    const autoOpenClaimed = claimSdlcAssistantAutoOpen(repo.id);
    const scopeChanged = assistantRepositoryScopeRef.current !== repo.id;
    assistantRepositoryScopeRef.current = repo.id;
    if (
      !shouldOpenSdlcAssistantForRepository({
        assistantOpen: assistantState.matches('open'),
        pinnedRepositoryId,
        repositoryId: repo.id,
        autoOpenClaimed,
        scopeChanged,
      })
    )
      return;
    openSdlcAssistant();
  }, [openSdlcAssistant, repo, repoId]);

  const createArtifact = async (): Promise<void> => {
    if (!repoId || !artifactDialog || !artifactTitle.trim()) return;
    const response = await apiInstance.post<{
      artifact: { canvasId?: string; executionId?: string; conversationId?: string };
    }>(`/sdlc/repositories/${repoId}/artifacts`, {
      kind: artifactDialog,
      title: artifactTitle.trim(),
      content: [],
      generateWithAi: artifactAiDraft,
      ...(artifactAiPrompt.trim() && { aiPrompt: artifactAiPrompt.trim() }),
      ...(artifactDialog === 'TECH_DOC' && { parentCanvasId }),
    });
    const canvasId = response.data.artifact.canvasId;
    const executionId = response.data.artifact.executionId;
    setArtifactDialog(null);
    setArtifactTitle('');
    setArtifactAiDraft(false);
    setArtifactAiPrompt('');
    setParentCanvasId('');
    if (executionId) setPendingArtifactExecutionId(executionId);
    if (canvasId) openCanvas(canvasId);
  };

  const createTicket = async (): Promise<void> => {
    if (!repoId || !ticketTitle.trim()) return;
    await apiInstance.post(`/sdlc/repositories/${repoId}/tickets`, {
      title: ticketTitle.trim(),
      description: ticketDescription.trim(),
      ...(ticketSourceId && { sourceCanvasId: ticketSourceId }),
    });
    setTicketDialog(false);
    setTicketTitle('');
    setTicketDescription('');
    setTicketSourceId('');
  };

  const startTicket = (ticketId: string): void => {
    if (!repoId) return;
    void call(
      `work-${ticketId}`,
      () =>
        apiInstance.post(`/sdlc/repositories/${repoId}/start-work`, {
          sourceType: 'TICKET',
          sourceId: ticketId,
        }),
      'Coding work queued',
    );
  };

  const debugTicket = (execution: TicketExecution): void => {
    const debugContext = ticketDebugContext(execution);
    if (!repo || repo instanceof Error || !debugContext) return;
    openSdlcDebugger({
      source: 'sdlc',
      repoId: repo.id,
      executionId: execution.id,
      conversationId: debugContext.conversationId,
      sessionId: debugContext.sessionId,
      running: ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING'].includes(execution.status),
    });
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

  const renderArtifacts = (kind: ArtifactKind): ReactElement => {
    const list = kind === 'PRD' ? prds : techDocs;
    return (
      <section>
        {!artifactsUnlocked && (
          <div className='mb-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
            Locked until repository read access is verified and all five Repo Knowledge documents
            are approved.
          </div>
        )}
        <SectionHeader
          title={kind === 'PRD' ? 'PRDs' : 'Tech Docs'}
          description={
            kind === 'PRD'
              ? 'Product intent and acceptance criteria.'
              : 'Technical design tied to one PRD.'
          }
          action={
            <Button
              disabled={!artifactsUnlocked}
              title={
                !artifactsUnlocked ? 'Approve all five Repo Knowledge documents first' : undefined
              }
              onClick={() => setArtifactDialog(kind)}
            >
              <Plus />
              New {kind === 'PRD' ? 'PRD' : 'Tech Doc'}
            </Button>
          }
        />
        <div className='grid grid-cols-2 gap-4'>
          {list.map(canvas => {
            const linkedTargetId =
              kind === 'PRD'
                ? (links.find(
                    link => link.relationType === 'TECH_DOC' && link.sourceId === canvas.id,
                  )?.targetId ?? null)
                : (linkedTicketForCanvasChain(tickets, links, [canvas.id])?.id ?? null);
            const cta = artifactCta(kind, linkedTargetId);
            return (
              <ArtifactCard
                key={canvas.id}
                title={canvas.title}
                eyebrow={kind === 'PRD' ? 'PRD' : 'Tech Doc'}
                onOpen={() => openCanvas(canvas.id)}
                actionLabel={cta.label}
                actionDisabled={cta.action.startsWith('CREATE_') && !artifactsUnlocked}
                onAction={() => {
                  if (cta.action === 'VIEW_TECH_DOC') {
                    openArtifactCanvas(cta.targetId);
                    return;
                  }
                  if (cta.action === 'VIEW_TICKET') {
                    void navigate(
                      `/sdlc/${repo.id}/tickets?ticket=${encodeURIComponent(cta.targetId)}`,
                    );
                    return;
                  }
                  const query =
                    cta.action === 'CREATE_TECH_DOC'
                      ? `Create a Tech Doc for the PRD "${canvas.title}" (canvas ID: ${canvas.id}) in repository "${repo.name}".`
                      : `Create an implementation ticket for the Tech Doc "${canvas.title}" (canvas ID: ${canvas.id}) in repository "${repo.name}".`;
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
          selectedWikiPage ? 'w-72' : 'w-60',
        )}
        style={{ backdropFilter: 'blur(var(--sidebar-background-blur))' }}
      >
        <div className='border-b border-sidebar-border-muted p-4'>
          <div className='text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground'>
            SDLC Hub
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
            const sectionLocked =
              ['prds', 'tech-docs', 'tickets'].includes(item.id) && !artifactsUnlocked;
            return (
              <div key={item.id} className='mb-1'>
                <button
                  disabled={sectionLocked}
                  title={
                    sectionLocked ? 'Approve all five Repo Knowledge documents first' : undefined
                  }
                  onClick={() => void navigate(`/sdlc/${repo.id}/${item.id}`)}
                  className={cn(
                    'flex h-10 w-full items-center gap-3 rounded-[10px] border px-3 text-sm transition-colors',
                    section === item.id
                      ? 'border-transparent bg-sidebar-accent/70 font-medium text-sidebar-accent-foreground'
                      : 'border-transparent text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                    sectionLocked && 'cursor-not-allowed opacity-50',
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
        {selectedCanvas && (
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

      <main className='flex min-w-0 flex-1 flex-col overflow-hidden bg-background'>
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
            ) : (
              <h1 className='font-semibold'>
                {SECTIONS.find(item => item.id === section)?.label ?? 'Overview'}
              </h1>
            )}
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <Button
              onClick={() => openSdlcAssistant()}
              data-track-category='SdlcHub'
              data-track-name='OpenSdlcAssistant'
            >
              <Sparkles className='size-4' />
              Assistant
            </Button>
            <Button variant='outline' onClick={() => setMembersDialog(true)}>
              <Users />
              Members
            </Button>
          </div>
        </header>

        {selectedCanvasId ? (
          <div className='min-h-0 flex-1 overflow-hidden bg-background'>
            <CanvasScreen
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
                        {state.completedCount}/5 generated
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
                      {isAdmin && state.conversationId && repo.setupExecution?.id && (
                        <Button
                          variant='ghost'
                          size='iconSm'
                          className='text-muted-foreground'
                          title='Debug generation'
                          aria-label='Debug generation'
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
                      {setupRunning && isAdmin ? (
                        <>
                          <Button
                            variant='destructive'
                            loading={busy === 'cancel'}
                            disabled={busy !== null}
                            onClick={() =>
                              void call(
                                'cancel',
                                () =>
                                  apiInstance.post(`/sdlc/repositories/${repo.id}/setup/cancel`),
                                'Setup cancelled',
                              )
                            }
                          >
                            <X />
                            Cancel
                          </Button>
                          <Button
                            variant='outline'
                            loading={busy === 'restart'}
                            disabled={busy !== null}
                            onClick={() =>
                              void call(
                                'restart',
                                () =>
                                  apiInstance.post(`/sdlc/repositories/${repo.id}/setup/restart`),
                                'Setup restarted',
                              )
                            }
                          >
                            <RefreshCw />
                            Restart
                          </Button>
                        </>
                      ) : state.phase === 'NOT_STARTED' && isAdmin ? (
                        <Button
                          loading={busy === 'setup'}
                          disabled={!readReady}
                          onClick={() =>
                            void call(
                              'setup',
                              () => apiInstance.post(`/sdlc/repositories/${repo.id}/setup`),
                              'Repo Knowledge setup queued',
                            )
                          }
                        >
                          <Rocket />
                          Next: Generate baseline
                        </Button>
                      ) : (state.phase === 'PARTIALLY_FAILED' ||
                          state.phase === 'CANCELLED' ||
                          repo.setupExecution?.status === 'FAILURE') &&
                        isAdmin ? (
                        <Button
                          loading={busy === 'retry'}
                          onClick={() =>
                            void call(
                              'retry',
                              () => apiInstance.post(`/sdlc/repositories/${repo.id}/setup/retry`),
                              'Setup retry queued',
                            )
                          }
                        >
                          <RefreshCw />
                          Retry setup
                        </Button>
                      ) : state.phase === 'NOT_STARTED' ? (
                        <span className='max-w-40 text-right text-xs text-muted-foreground'>
                          Repository admin must generate baseline.
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className='mt-5 grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-background sm:grid-cols-4 sm:divide-y-0'>
                  <Metric
                    label='Repo Knowledge approved'
                    value={`${approvedCount}/5`}
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
                                <div className='text-xs text-muted-foreground'>{node.label}</div>
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
              </section>
            )}

            {section === 'baseline' && (
              <section>
                <SectionHeader
                  title='Repo Knowledge'
                  description='Admins edit and approve. Members can read. Reapproval replaces permanent memory.'
                />
                <div className='grid grid-cols-2 gap-4'>
                  {baseline.map(canvas => {
                    const metadata = metadataOf(canvas.metadata);
                    const approved = typeof metadata['approvedAt'] === 'string';
                    const generating = metadata['generationStatus'] === 'GENERATING';
                    const approvalAction = baselineApprovalAction({
                      approvedAt:
                        typeof metadata['approvedAt'] === 'string' ? metadata['approvedAt'] : null,
                      lastEditedAt: canvas.lastEditedAt,
                    });
                    const approvalDisabled = generating || approvalAction === 'UP_TO_DATE';
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
                          ) : approvalAction === 'REAPPROVE' ? (
                            <span className='rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300'>
                              Changes pending
                            </span>
                          ) : (
                            approved && (
                              <span className='flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300'>
                                <Check size={12} />
                                Approved
                              </span>
                            )
                          )}
                        </div>
                        <h3 className='mt-4 font-semibold'>
                          {BASELINE_LABELS[String(metadata['baselineKind'])] || canvas.title}
                        </h3>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          Updated {setupUpdatedAtLabel(canvas.lastEditedAt ?? canvas.updatedAt)}
                          {' · '}
                          {typeof metadata['generationCommit'] === 'string'
                            ? metadata['generationCommit'].slice(0, 8)
                            : 'repository HEAD'}
                        </p>
                        <div className='mt-5 flex items-center justify-between gap-3'>
                          <span className='text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground'>
                            Open document
                          </span>
                          {isAdmin && (
                            <Button
                              size='sm'
                              loading={busy === `approve-${canvas.id}`}
                              disabled={approvalDisabled}
                              onKeyDown={event => event.stopPropagation()}
                              onClick={event => {
                                event.stopPropagation();
                                if (approvalDisabled) return;
                                void call(
                                  `approve-${canvas.id}`,
                                  () =>
                                    apiInstance.post(
                                      `/sdlc/repositories/${repo.id}/baseline/${canvas.id}/approve`,
                                    ),
                                  approvalAction === 'REAPPROVE'
                                    ? 'Repo Knowledge updated'
                                    : 'Repo Knowledge approved',
                                );
                              }}
                            >
                              {approvalAction === 'APPROVE'
                                ? 'Approve'
                                : approvalAction === 'REAPPROVE'
                                  ? 'Reapprove'
                                  : 'Up to date'}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {baseline.length === 0 && (
                    <EmptyCard
                      text={
                        state.phase === 'NOT_STARTED'
                          ? 'Run Setup SDLC to generate Repo Knowledge.'
                          : 'Repo Knowledge generation is in progress.'
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
              />
            )}

            {section === 'prds' && renderArtifacts('PRD')}
            {section === 'tech-docs' && renderArtifacts('TECH_DOC')}
            {section === 'tickets' && (
              <SdlcTicketsBoard
                repoId={repo.id}
                boardId={sdlcBoard?.id ?? ''}
                channelId={repo.channelId ?? ''}
                tickets={tickets}
                initialTicketId={new URLSearchParams(location.search).get('ticket')}
                stages={sdlcBoardDetail?.stages ?? []}
                links={links}
                canvases={canvases}
                busyKey={busy}
                actionsDisabled={!artifactsUnlocked}
                onNewTicket={() => setTicketDialog(true)}
                onStartWork={startTicket}
                onDebugRun={debugTicket}
                onOpenCanvas={openArtifactCanvas}
              />
            )}
          </div>
        )}
      </main>

      <Dialog
        open={artifactDialog !== null}
        onOpenChange={open => !open && setArtifactDialog(null)}
        title={`New ${artifactDialog}`}
      >
        <form
          className='p-6'
          onSubmit={event => {
            event.preventDefault();
            void call(
              'artifact',
              createArtifact,
              artifactAiDraft
                ? `${artifactDialog === 'PRD' ? 'PRD' : 'Tech Doc'} generation started in Claw`
                : `${artifactDialog === 'PRD' ? 'PRD' : 'Tech Doc'} created`,
            );
          }}
        >
          <h2 className='text-lg font-semibold'>
            New {artifactDialog === 'PRD' ? 'PRD' : 'Tech Doc'}
          </h2>
          <label htmlFor='sdlc-artifact-title' className='mt-5 block text-sm font-medium'>
            Title
          </label>
          <input
            id='sdlc-artifact-title'
            autoFocus
            value={artifactTitle}
            onChange={event => setArtifactTitle(event.target.value)}
            className='mt-2 h-10 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring'
            placeholder='Clear, outcome-focused title'
            data-track-category='SdlcHub'
            data-track-name='ArtifactTitleChanged'
          />
          {artifactDialog === 'TECH_DOC' && (
            <>
              <label htmlFor='sdlc-techDoc-prd' className='mt-4 block text-sm font-medium'>
                PRD
              </label>
              <select
                id='sdlc-techDoc-prd'
                value={parentCanvasId}
                onChange={event => setParentCanvasId(event.target.value)}
                className='mt-2 h-10 w-full rounded-md border bg-background px-3'
                data-track-category='SdlcHub'
                data-track-name='TechDocPRDChanged'
              >
                <option value=''>Select PRD</option>
                {prds.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className='mt-4 flex items-center gap-2 text-sm font-medium'>
            <input
              type='checkbox'
              checked={artifactAiDraft}
              onChange={event => setArtifactAiDraft(event.target.checked)}
              data-track-category='SdlcHub'
              data-track-name='ArtifactAiDraftChanged'
            />
            Draft content with Xyne AI
          </label>
          {artifactAiDraft && (
            <>
              <label htmlFor='sdlc-artifact-ai-prompt' className='mt-4 block text-sm font-medium'>
                AI direction <span className='font-normal text-muted-foreground'>(optional)</span>
              </label>
              <textarea
                id='sdlc-artifact-ai-prompt'
                value={artifactAiPrompt}
                onChange={event => setArtifactAiPrompt(event.target.value)}
                className='mt-2 min-h-24 w-full rounded-md border bg-background p-3 outline-none focus:ring-2 focus:ring-ring'
                placeholder='What should this draft emphasize?'
                data-track-category='SdlcHub'
                data-track-name='ArtifactAiPromptChanged'
              />
            </>
          )}
          <div className='mt-6 flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={() => setArtifactDialog(null)}>
              Cancel
            </Button>
            <Button
              type='submit'
              loading={busy === 'artifact'}
              disabled={!artifactTitle.trim() || (artifactDialog === 'TECH_DOC' && !parentCanvasId)}
            >
              {artifactAiDraft ? 'Generate editable draft' : 'Create canvas'}
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

      <Dialog open={ticketDialog} onOpenChange={setTicketDialog} title='New Ticket'>
        <form
          className='p-6'
          onSubmit={event => {
            event.preventDefault();
            void call('ticket', createTicket, 'Ticket created in Backlog');
          }}
        >
          <h2 className='text-lg font-semibold'>New Ticket</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Creates an existing Xyne ticket on the project SDLC board.
          </p>
          <label htmlFor='sdlc-ticket-title' className='mt-5 block text-sm font-medium'>
            Title
          </label>
          <input
            id='sdlc-ticket-title'
            autoFocus
            value={ticketTitle}
            onChange={event => setTicketTitle(event.target.value)}
            className='mt-2 h-10 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring'
            data-track-category='SdlcHub'
            data-track-name='TicketTitleChanged'
          />
          <label htmlFor='sdlc-ticket-description' className='mt-4 block text-sm font-medium'>
            Description
          </label>
          <textarea
            id='sdlc-ticket-description'
            value={ticketDescription}
            onChange={event => setTicketDescription(event.target.value)}
            className='mt-2 min-h-28 w-full rounded-md border bg-background p-3 outline-none focus:ring-2 focus:ring-ring'
            data-track-category='SdlcHub'
            data-track-name='TicketDescriptionChanged'
          />
          <label htmlFor='sdlc-ticket-source' className='mt-4 block text-sm font-medium'>
            PRD or Tech Doc <span className='font-normal text-muted-foreground'>(optional)</span>
          </label>
          <select
            id='sdlc-ticket-source'
            value={ticketSourceId}
            onChange={event => setTicketSourceId(event.target.value)}
            className='mt-2 h-10 w-full rounded-md border bg-background px-3'
            data-track-category='SdlcHub'
            data-track-name='TicketSourceChanged'
          >
            <option value=''>No linked canvas</option>
            {prds.map(item => (
              <option key={item.id} value={item.id}>
                PRD · {item.title}
              </option>
            ))}
            {techDocs.map(item => (
              <option key={item.id} value={item.id}>
                Tech Doc · {item.title}
              </option>
            ))}
          </select>
          <div className='mt-6 flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={() => setTicketDialog(false)}>
              Cancel
            </Button>
            <Button type='submit' loading={busy === 'ticket'} disabled={!ticketTitle.trim()}>
              Create in Backlog
            </Button>
          </div>
        </form>
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
  action?: ReactElement;
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
  onOpen,
  onAction,
  actionLabel,
  actionDisabled,
}: {
  title: string;
  eyebrow: string;
  onOpen: () => void;
  onAction: () => void;
  actionLabel: string;
  actionDisabled: boolean;
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
      <div className='text-xs font-semibold uppercase tracking-[0.14em] text-primary'>
        {eyebrow}
      </div>
      <h3 className='mt-3 font-semibold'>{title}</h3>
      <div className='mt-6 flex items-center justify-between gap-3'>
        <span className='text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground'>
          Open document
        </span>
        <Button
          size='sm'
          disabled={actionDisabled}
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
  );
}
