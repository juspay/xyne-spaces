import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAgentNameCheck } from '@/hooks/useAgentNameCheck';
import { usePlatform } from '@/hooks/usePlatform';
import { createAgent, generateAgentPrompt } from '@/services/claw/clawAgentWizardService';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { ClawApiError, clawErrorText } from '@/services/claw/clawRequest';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { clawPromptVersionsKey } from '@/hooks/useClawPromptVersions';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import { agentAvatarKey } from '@/components/agents/agentAvatarKey';
import { effectiveSlug, slugify } from '@/routes/ClawAgentsScreen/create/wizardState';
import { AgentCreateCanvas } from '@/components/flowUI/nodes/agent/create/AgentCreateCanvas';
import { DraftAgentChat } from '@/components/flowUI/nodes/agent/create/DraftAgentChat';
import type { AgentSettingsTabId } from '../detail/detailTabs';
import {
  buildUpdateAgentPayload,
  formFromAgent,
  instructionsFromSaved,
} from '../detail/agentProfileForm';
import { DraftAgentSettings, SavedAgentSettings } from '../detail/settings/AgentSettingsView';
import { useAgentDetailActions } from '../detail/useAgentDetailActions';
import {
  AgentCreateChatPanel,
  type CreateChatTurn,
  type DraftTurnArgs,
  type IncomingBuildMessage,
} from '@/components/flowUI/nodes/agent/create/AgentCreateChatPanel';
import type { HandoffPhase } from '@/components/flowUI/nodes/agent/create/DraftChatGapRows';
import {
  applyPropertyOps,
  capabilityRefs,
  fromDraftSchedule,
  plainInstructions,
  removalPatch,
  replaceSection,
  silentTurnReply,
  streamAgentDraft,
  TOOLS_INSERT_BEFORE,
  toDraftSchedule,
  userOwnedFields,
  type AgentDraftEvent,
  type DraftMode,
} from '@/components/flowUI/nodes/agent/create/agentDraftStream';
import { DiscardDraftDialog } from '@/components/flowUI/nodes/agent/create/DiscardDraftDialog';
import {
  applyCreateHubDraft,
  decideCreateCanvasAction,
  type CreateCanvasSnapshot,
} from '@/components/flowUI/nodes/agent/create/createChatMode';
import { preferredToolsHubRow } from '@/components/flowUI/nodes/agent/create/classifyCreateTurn';
import {
  PROGRESS_DRAFTING_NAME,
  PROGRESS_THINKING,
  progressLabelForField,
} from '@/components/flowUI/nodes/agent/create/createProgressLabel';
import { listAccessibleKnowledgeBase } from '@/services/claw/clawKnowledgeBaseService';
import { listSkills } from '@/services/claw/clawSkillsService';
import { sanitizeAgentCanvasName } from '@/components/flowUI/nodes/agent/create/canvasFromIdentity';
import {
  applyLocalHubBinds,
  describeSelectedTools,
  selectHubToolsForIntent,
} from '@/components/flowUI/nodes/agent/create/hubCatalogSelect';
import {
  createDismissedHubIds,
  dismissHubPick,
  EMPTY_HUB_SUGGESTIONS,
  hubPatchFromPlan,
  loadHubPlanContext,
  removeHubSuggestion,
  replaceHubSuggestions,
  requestHubPlan,
  type HubPlanContext,
  type HubPlanField,
  type HubPlanPatch,
  type HubPlanResult,
} from '@/components/flowUI/nodes/agent/create/hubPlan';
import { inferredCapabilityFields } from '@/components/flowUI/nodes/agent/create/capabilityInference';
import {
  EMPTY_CREATE_FORM,
  isFormDirty,
  type AgentCreateChatPatch,
  type AgentCreateField,
  type AgentCreateHubRow,
  type AgentCreatePhase,
  type CreateHubSuggestions,
  type HubPickKind,
} from '@/components/flowUI/nodes/agent/create/types';
import { useAgentCreateForm } from '@/components/flowUI/nodes/agent/create/useAgentCreateForm';
import {
  HUB_REVEAL_ORDER,
  REVEAL_HOLD_MS,
  TYPE_MS,
  canvasFieldForRow,
  createDraftReveal,
  expectedSlots,
  nextFrame,
  rowHoldMs,
  rowPatch,
  rowPillCount,
  rowSuggestionCount,
  rowSuggestions,
  typingSteps,
} from '@/components/flowUI/nodes/agent/create/draftReveal';
import { WarmHubCatalogs } from '@/components/flowUI/nodes/agent/create/WarmHubCatalogs';
import { connectorsToConnect } from '@/components/flowUI/nodes/agent/create/buildConnect';
import { useMcpCatalog } from '../../shared/pickers/mcp/useMcpCatalog';
import {
  chunkGapMs,
  nextRevealEnd,
} from '@/components/flowUI/nodes/agent/create/instructionsChunks';
import {
  agentDraftStorageKey,
  buildChatStorageKey,
  clearAgentDraft,
  forgetAgentDraftForm,
  newAgentDraftId,
  readAgentDraft,
  writeAgentDraft,
} from '@/components/flowUI/nodes/agent/create/agentCreateDraftStorage';
import { draftChatStorageKey } from '@/components/flowUI/nodes/agent/create/draftChatStorage';
import { useOAuthReturn } from '@/routes/AIScreen/library/shared/pickers/mcp/useOAuthReturn';
import {
  canvasColumnLeft,
  slideInPanel,
  slideOutToProfile,
  useArrivalCanvasLeft,
} from '@/components/flowUI/nodes/agent/create/editTransition';
import { buildCreateAgentPayload } from './agentCreatePayload';
import { computeSaveGate } from './saveGate';
import {
  browserTimezone,
  scheduledJobInput,
  scheduleProblem,
} from '@/components/flowUI/nodes/agent/create/agentSchedule';
import { createScheduledJob } from '../detail/activity/createScheduledJob';
import {
  CHAT_OVERLAY_WIDTH_MAX,
  CHAT_OVERLAY_WIDTH_MIN,
  chatOverlayShadow,
  useChatOverlayDial,
} from '@/components/flowUI/nodes/agent/create/chatOverlayDial';

/** Settle beat after a hub section lands, long enough for its pills to pop in. */
const WRITE_MS = 300;

/**
 * Build chat drafts through the streamed engine (POST /agents/draft) unless
 * turned off with VITE_CREATE_DRAFT_STREAM=off. If the service refuses a turn
 * the page drops back to the Ask AI marker path for the rest of the session.
 */
const DRAFT_STREAM_ENABLED = import.meta.env['VITE_CREATE_DRAFT_STREAM'] !== 'off';
const DRAFT_STREAM_DOWN_STATUSES = new Set([404, 502, 503]);

type CreateMark = 'send' | 'turn' | 'plan-ready' | 'tools-filled' | 'prompt-done' | 'ready';

const CREATE_MARKS: readonly CreateMark[] = [
  'send',
  'turn',
  'plan-ready',
  'tools-filled',
  'prompt-done',
  'ready',
];

/**
 * Dev-only timing marks (`create:send` … `create:ready`) for the create pipeline.
 * On `ready` it logs each stage as ms since send, then clears the marks, so one
 * console table per turn shows where the time went (the chat model ≈ send→turn).
 */
function markCreate(mark: CreateMark): void {
  if (!import.meta.env.DEV) return;
  performance.mark(`create:${mark}`);
  if (mark !== 'ready') return;
  const at = (name: CreateMark): number | undefined =>
    performance.getEntriesByName(`create:${name}`, 'mark').at(-1)?.startTime;
  const start = at('send') ?? at('turn');
  if (start !== undefined) {
    const rows = CREATE_MARKS.flatMap(name => {
      const time = at(name);
      return time === undefined ? [] : [{ stage: name, msSinceSend: Math.round(time - start) }];
    });
    // eslint-disable-next-line no-console -- dev-only per-turn timing table
    console.table(rows);
  }
  for (const name of CREATE_MARKS) performance.clearMarks(`create:${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function canvasIsEmpty(form: { name: string; systemPrompt: string }): boolean {
  return !form.name.trim() && !form.systemPrompt.trim();
}

/** Invisible left-edge target. Dragging left widens the card; no chrome. */
function SideCardWidthEdge({
  width,
  onWidthChange,
  onDraggingChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onDraggingChange: (dragging: boolean) => void;
}): ReactElement {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!dragRef.current) return;
      dragRef.current = null;
      onDraggingChange(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onDraggingChange],
  );

  useEffect(() => {
    return (): void => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  return (
    <div
      role='separator'
      aria-orientation='vertical'
      aria-label='Resize side card'
      aria-valuemin={CHAT_OVERLAY_WIDTH_MIN}
      aria-valuemax={CHAT_OVERLAY_WIDTH_MAX}
      aria-valuenow={Math.round(width)}
      data-testid='create-agent-side-card-resize-edge'
      className='absolute bottom-0 left-0 top-0 z-30 w-3 cursor-col-resize border-0 bg-transparent p-0'
      style={{ touchAction: 'none' }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragRef.current = { startX: event.clientX, startWidth: width };
        onDraggingChange(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture needs an active pointer. Drag still tracks move events on this edge.
        }
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag) return;
        onWidthChange(drag.startWidth + (drag.startX - event.clientX));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

/** The URL parameter that names the draft a canvas edits. */
const DRAFT_PARAM = 'draft';

/**
 * Create Agent. Every canvas is a draft with its own id in the URL: Create
 * agent arrives without one and gets a fresh canvas, while a reload, or a draft
 * opened from Drafts in Agent Hub, comes back to the same one. The canvas
 * remounts per draft, so nothing carries over between them.
 *
 * With `agent`, the same page edits a saved agent: its canvas, the Build chat
 * and the test chat, saving only what changed.
 */
export function AgentCreateSplitPage({
  agent,
  canRenameHandle = false,
}: {
  agent?: Agent | undefined;
  /** Only the owner renames an agent's handle. */
  canRenameHandle?: boolean;
} = {}): ReactElement {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const requested = params.get(DRAFT_PARAM);
  // A new id per arrival without one: location.key changes on every navigation.
  const freshRef = useRef<{ locationKey: string; id: string } | null>(null);
  if (!requested && freshRef.current?.locationKey !== location.key) {
    freshRef.current = { locationKey: location.key, id: newAgentDraftId() };
  }
  const draftId = requested ?? freshRef.current!.id;
  // Back from a connector's sign-in, started from a connect card on this page.
  useOAuthReturn();
  // Where the profile had the canvas, when Edit was clicked there.
  const arrivalLeft = useArrivalCanvasLeft();

  useEffect(() => {
    if (requested || agent) return;
    setParams(
      current => {
        const next = new URLSearchParams(current);
        next.set(DRAFT_PARAM, draftId);
        return next;
      },
      { replace: true },
    );
  }, [agent, draftId, requested, setParams]);

  if (agent) {
    // Where the profile's Back goes, kept for the way back.
    const returnTo = (location.state as { returnTo?: unknown } | null)?.returnTo;
    // Unsaved edits are kept per agent, for a reload or a connector's sign-in.
    return (
      <AgentCreateCanvasPage
        key={agent.id}
        draftId={`edit-${agent.id}`}
        agent={agent}
        canRenameHandle={canRenameHandle}
        enterFromLeft={arrivalLeft}
        returnTo={typeof returnTo === 'string' ? returnTo : undefined}
      />
    );
  }
  return <AgentCreateCanvasPage key={draftId} draftId={draftId} />;
}

function AgentCreateCanvasPage({
  draftId,
  agent,
  canRenameHandle = false,
  enterFromLeft,
  returnTo,
}: {
  draftId: string;
  /** Editing this saved agent instead of creating one. */
  agent?: Agent | undefined;
  canRenameHandle?: boolean;
  /**
   * Where the canvas column was on the agent's profile: the canvas glides over
   * from there and the Build chat slides in beside it.
   */
  enterFromLeft?: number | undefined;
  /** Where the profile's Back goes, handed back to it on the way out. */
  returnTo?: string | undefined;
}): ReactElement {
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const queryClient = useQueryClient();
  // The agent as it was opened: what Save compares against, and what Start over goes back to.
  const [startForm, setStartForm] = useState(() =>
    agent ? formFromAgent(agent) : EMPTY_CREATE_FORM,
  );
  /** When the saved agent was last saved, as it was opened: older stored edits are stale. */
  const [openedAt] = useState(() => (agent ? Date.parse(agent.updatedAt) : 0));
  const startPhase: AgentCreatePhase = agent ? 'draft' : 'empty';
  const createForm = useAgentCreateForm(startForm);
  const [phase, setPhase] = useState<AgentCreatePhase>(startPhase);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<AgentSettingsTabId>('persona');
  const [skeletonIdentity, setSkeletonIdentity] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const canvasTurnChainRef = useRef(Promise.resolve());
  // Hub plan (XOR-backed suggest-tools) of the latest draft turn, ids the user removed
  // this session, and the dashed suggestion chips. Kept out of useAgentCreateForm so
  // none of it feeds dirty checks or conflicts.
  const planRef = useRef<HubPlanResult | null>(null);
  const dismissedRef = useRef(createDismissedHubIds());
  const [hubSuggestions, setHubSuggestions] = useState<CreateHubSuggestions>(EMPTY_HUB_SUGGESTIONS);
  const hubSuggestionsRef = useRef(hubSuggestions);
  hubSuggestionsRef.current = hubSuggestions;

  const onHubSuggestionAccepted = useCallback((kind: HubPickKind, id: string): void => {
    setHubSuggestions(prev => removeHubSuggestion(prev, kind, id));
  }, []);
  const onHubPickDismissed = useCallback((kind: HubPickKind, id: string): void => {
    dismissHubPick(dismissedRef.current, kind, id);
    setHubSuggestions(prev => removeHubSuggestion(prev, kind, id));
  }, []);
  // Hub plan started at send time from the user's words, so XOR runs while the model
  // is still answering. The turn reuses it when the text matches.
  const prefetchRef = useRef<{
    text: string;
    plan: Promise<HubPlanResult | null>;
    context: ReturnType<typeof loadHubPlanContext>;
  } | null>(null);
  const turnsInFlightRef = useRef(0);
  // Streamed draft: one id for this page's draft, the catalog it maps plans with
  // (loaded once), and whether the service has refused us this session.
  const draftIdRef = useRef<string>(crypto.randomUUID());
  const draftContextRef = useRef<Promise<HubPlanContext> | null>(null);
  const [draftStreamDown, setDraftStreamDown] = useState(false);
  const draftKey = agentDraftStorageKey(workspaceId, user?.id, draftId);
  const storageReady = Boolean(user?.id);
  /** The user saved this draft, so it is listed under Drafts and every autosave keeps it there. */
  const keptRef = useRef(false);
  /** Bumped by Start over: the Build chat starts again with the canvas. */
  const [chatEpoch, setChatEpoch] = useState(0);
  // Read at the end of a Build turn, to offer connect cards for what it added.
  const mcpCatalog = useMcpCatalog();
  const mcpCatalogRef = useRef(mcpCatalog);
  mcpCatalogRef.current = mcpCatalog;
  // Messages the test chat sends to the Build chat (build from a request, add a
  // missing capability), and how far each has got.
  const [buildInbox, setBuildInbox] = useState<IncomingBuildMessage[]>([]);
  const [handoffs, setHandoffs] = useState<Readonly<Record<string, HandoffPhase>>>({});
  const handOffToBuild = useCallback((text: string): string => {
    const id = crypto.randomUUID();
    setBuildInbox(current => [...current, { id, text }]);
    setHandoffs(current => ({ ...current, [id]: 'queued' }));
    return id;
  }, []);
  const onIncomingPhase = useCallback((id: string, next: 'running' | 'done'): void => {
    setHandoffs(current => ({ ...current, [id]: next }));
    if (next === 'running') setBuildInbox(current => current.filter(message => message.id !== id));
  }, []);

  const slug = effectiveSlug({
    name: createForm.form.name,
    slug: createForm.form.slug,
    slugManual: createForm.form.slugManual,
  });
  const typedName = createForm.form.name.trim();
  // A saved agent's own name and handle aren't taken: only a change is checked.
  const identityChanged = !agent || typedName !== agent.name || slug !== agent.slug;
  const availability = useAgentNameCheck(
    phase === 'created' || !identityChanged ? '' : typedName,
    slug,
  );
  const nameCheck = agent
    ? {
        ...availability,
        nameError: typedName === agent.name ? null : availability.nameError,
        slugError: slug === agent.slug ? null : availability.slugError,
      }
    : availability;
  const handleError = nameCheck.slugError
    ? agent
      ? `@${slug} is taken. Choose another handle.`
      : `@${slug} is taken. Rename the handle to create a new agent.`
    : nameCheck.nameError;
  const builtBy = user?.name ?? user?.email ?? 'you';

  // Reopen this canvas's draft: a reload, or a draft opened from Agent Hub. The
  // Build chat comes back on its own (the panel reads it by the same key).
  const { restore: restoreForm } = createForm;
  /**
   * Bumped when a stored draft is restored. The canvas remounts with it, so
   * the whole draft sweeps in as one instead of row by row.
   */
  // A saved agent opened for editing comes into focus the same way.
  const [restoreEpoch, setRestoreEpoch] = useState(agent ? 1 : 0);
  /** Bumped when chat clears the canvas, so rows it had opened close too. */
  const [clearEpoch, setClearEpoch] = useState(0);
  useEffect(() => {
    if (!storageReady) return;
    const stored = readAgentDraft(draftKey);
    if (!stored) return;
    // Edits older than the agent's last save are stale: someone saved since.
    if (agent && stored.savedAt <= openedAt) {
      forgetAgentDraftForm(draftKey);
      return;
    }
    keptRef.current = stored.kept;
    restoreForm(stored.form);
    setPhase('draft');
    setRestoreEpoch(epoch => epoch + 1);
  }, [agent, draftKey, openedAt, restoreForm, storageReady]);

  // Keep the stored draft in step with the canvas.
  useEffect(() => {
    if (!storageReady || phase === 'created') return undefined;
    const form = createForm.form;
    const timer = window.setTimeout(() => {
      // An edit back at the saved agent has nothing to keep.
      if (agent && !isFormDirty(form, startForm)) forgetAgentDraftForm(draftKey);
      else writeAgentDraft(draftKey, form, { kept: keptRef.current });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [agent, createForm.form, draftKey, phase, startForm, storageReady]);

  // Leaving for a connector's sign-in can come sooner than the save above.
  const { getForm } = createForm;
  useEffect(() => {
    if (!storageReady || phase === 'created') return undefined;
    const flush = (): void => {
      const form = getForm();
      if (agent && !isFormDirty(form, startForm)) return;
      writeAgentDraft(draftKey, form, { kept: keptRef.current });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [agent, draftKey, getForm, phase, startForm, storageReady]);

  // A turn still writing the canvas would be lost on reload.
  useEffect(() => {
    if (!drafting) return undefined;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafting]);

  const saveGate = computeSaveGate({
    created: phase === 'created',
    creating,
    drafting,
    name: createForm.form.name,
    slug,
    description: createForm.form.description,
    instructions: createForm.form.systemPrompt,
    conflictCount: createForm.conflicts.length,
    // A saved agent's schedule is managed in Activity, so it can't hold Save up.
    scheduleProblem: agent ? null : scheduleProblem(createForm.form.schedule),
    nameCheck,
    ...(agent
      ? {
          editing: {
            dirty: isFormDirty(createForm.form, startForm),
            instructionsChanged:
              createForm.form.systemPrompt.trim() !== startForm.systemPrompt.trim(),
          },
        }
      : {}),
  });

  const canvasSnapshot: CreateCanvasSnapshot = {
    empty: canvasIsEmpty(createForm.form),
    name: createForm.form.name,
    slug: createForm.form.slug,
    description: createForm.form.description,
    instructions: createForm.form.systemPrompt,
  };

  const onTurnComplete = useCallback(
    (turn: CreateChatTurn): Promise<void> => {
      markCreate('turn');
      turnsInFlightRef.current += 1;
      setDrafting(true);
      const run = canvasTurnChainRef.current.then(async (): Promise<void> => {
        const canvasEmpty = canvasIsEmpty(createForm.form);
        const userText = turn.userText;

        const action = decideCreateCanvasAction({
          userText,
          canvasEmpty,
          marker: turn.marker,
        });

        if (action.type === 'idle') {
          createForm.clearHighlights();
          createForm.setWritingField(null);
          createForm.setAttentionField(null);
          setProgressLabel(null);
          setSkeletonIdentity(false);
          return;
        }

        setCreateError(null);
        createForm.clearHighlightMarks();
        setProgressLabel(PROGRESS_THINKING);

        if (action.type === 'rename') {
          const sourceId = `hub-rename-${Date.now()}`;
          const renameName = sanitizeAgentCanvasName(action.name);
          const nameBeforeRename = createForm.form.name.trim();
          try {
            createForm.setAttentionField('name');
            setProgressLabel(PROGRESS_DRAFTING_NAME);
            await sleep(320);
            createForm.setWritingField('name');
            await sleep(48);
            const changedName = createForm.applyChatPatch(
              sourceId,
              { name: renameName },
              { highlight: false },
            );
            if (changedName.includes('name')) {
              await sleep(WRITE_MS);
            }
            const nameLocked =
              !changedName.includes('name') &&
              nameBeforeRename.length > 0 &&
              nameBeforeRename !== renameName;
            if (!nameLocked) {
              createForm.setWritingField('slug');
              const changedSlug = createForm.applyChatPatch(
                `${sourceId}-slug`,
                { slug: slugify(action.name) },
                { highlight: false },
              );
              if (changedSlug.includes('slug')) {
                await sleep(WRITE_MS);
              }
            }
            setPhase('draft');
          } finally {
            createForm.setWritingField(null);
            createForm.setAttentionField(null);
            setProgressLabel(null);
          }
          return;
        }

        if (action.type !== 'draft') {
          setProgressLabel(null);
          return;
        }

        // One suggest-tools call decides every hub. Start it now so the ~1s call hides
        // behind the identity animation.
        const planIntent = [userText.trim(), action.intent.trim()].filter(Boolean).join('\n');
        const wantsPlan =
          canvasEmpty ||
          action.fields.some(
            field => field === 'tools' || field === 'skills' || field === 'knowledge',
          );
        const prefetched =
          prefetchRef.current?.text === userText.trim() ? prefetchRef.current : null;
        prefetchRef.current = null;
        const planContext = wantsPlan
          ? (prefetched?.context ?? loadHubPlanContext(user?.id))
          : undefined;
        if (wantsPlan) planRef.current = null;
        const hubPlan = wantsPlan
          ? (
              prefetched?.plan ??
              requestHubPlan({
                intent: planIntent,
                systemPrompt: createForm.getForm().systemPrompt || undefined,
              })
            ).then(plan => {
              planRef.current = plan;
              if (plan) markCreate('plan-ready');
              return plan;
            })
          : undefined;

        const firstDescribe = canvasEmpty;
        if (firstDescribe) {
          setSkeletonIdentity(true);
        }

        try {
          const sourceId = `hub-${Date.now()}`;
          if (firstDescribe) {
            setSkeletonIdentity(false);
          }
          const toolsHubRow = preferredToolsHubRow(userText);
          await applyCreateHubDraft({
            action,
            canvasEmpty,
            existingSystemPrompt: createForm.form.systemPrompt,
            writeMs: WRITE_MS,
            sourceId,
            toolsHubRow,
            generateAgentPrompt: async (intent, existingPrompt) =>
              generateAgentPrompt({
                intent,
                ...(existingPrompt ? { existingPrompt } : {}),
              }),
            setWritingField: createForm.setWritingField,
            setAttentionField: createForm.setAttentionField,
            setProgressLabel,
            applyChatPatch: createForm.applyChatPatch,
            sleep,
            ...(turn.announceSection ? { onSectionComplete: turn.announceSection } : {}),
            onPerfMark: markCreate,
            onHubSuggestions: (next, hubs) =>
              setHubSuggestions(prev => replaceHubSuggestions(prev, next, hubs)),
            ...(hubPlan && planContext
              ? {
                  hubPlan,
                  resolveHubPlan: async (plan: HubPlanResult): Promise<HubPlanPatch | null> => {
                    const context = await planContext;
                    const live = createForm.getForm();
                    return hubPatchFromPlan({
                      plan,
                      intent: planIntent,
                      catalog: context.catalog,
                      current: live,
                      skills: context.skills,
                      kbCollections: context.collections,
                      dismissed: dismissedRef.current,
                    });
                  },
                  // Soft deadline missed: regex binds only, the plan then adds chips.
                  fillToolsLocal: async (
                    incoming: AgentCreateChatPatch,
                  ): Promise<string[] | undefined> => {
                    const context = await planContext;
                    if (!context.catalog) return;
                    const next = applyLocalHubBinds(
                      planIntent,
                      context.catalog,
                      createForm.getForm().tools,
                    );
                    incoming.tools = next;
                    return describeSelectedTools(next, context.catalog);
                  },
                }
              : {}),
            ...(action.fields.includes('tools')
              ? {
                  fillTools: async (incoming: AgentCreateChatPatch) => {
                    try {
                      // Prefer userText — model draftIntent often drops “Slack”/“GitHub”.
                      const selectIntent = [userText.trim(), action.intent.trim()]
                        .filter(Boolean)
                        .join('\n');
                      const selected = await selectHubToolsForIntent({
                        intent: selectIntent,
                        current: createForm.getForm().tools,
                        systemPrompt:
                          incoming.systemPrompt || createForm.getForm().systemPrompt || undefined,
                      });
                      if (selected) {
                        incoming.tools = selected.selection;
                        if (selected.skillSlugs.length > 0 && user?.id) {
                          try {
                            const skills = await listSkills(user.id);
                            const ids = new Set(createForm.getForm().selectedSkillIds);
                            for (const slug of selected.skillSlugs) {
                              const match = skills.find(s => s.slug === slug);
                              if (match?.id) ids.add(match.id);
                            }
                            if (ids.size > 0) incoming.selectedSkillIds = [...ids];
                          } catch {
                            // Skills hub may stay empty if list fails.
                          }
                        }
                        return selected.labels;
                      }
                    } catch {
                      // Prompt still applies if tool suggest fails.
                    }
                    return;
                  },
                }
              : {}),
            ...(action.fields.includes('skills')
              ? {
                  fillSkills: async (incoming: AgentCreateChatPatch) => {
                    try {
                      if (!user?.id) return;
                      const skills = await listSkills(user.id);
                      if (skills.length === 0) return;
                      const intent = [userText.trim(), action.intent.trim()]
                        .filter(Boolean)
                        .join('\n')
                        .toLowerCase();
                      const tokens = intent.split(/[^a-z0-9]+/).filter(token => token.length >= 3);
                      const ranked = skills
                        .map(skill => {
                          const hay =
                            `${skill.name} ${skill.slug} ${skill.label} ${skill.description}`.toLowerCase();
                          let score = 0;
                          for (const token of tokens) {
                            if (hay.includes(token)) score += token.length;
                          }
                          if (/\bresearch\b/.test(intent) && /\bresearch\b/.test(hay)) score += 20;
                          return { skill, score };
                        })
                        .sort((a, b) => b.score - a.score);
                      // Precision: never bind skills[0] when score is 0.
                      const pick = ranked[0] && ranked[0].score > 0 ? ranked[0].skill : null;
                      if (pick?.id) {
                        const ids = new Set(createForm.form.selectedSkillIds);
                        ids.add(pick.id);
                        incoming.selectedSkillIds = [...ids];
                        return pick.label || pick.name || pick.slug;
                      }
                    } catch {
                      // Hub row may stay empty if skills API fails.
                    }
                    return;
                  },
                }
              : {}),
            ...(action.fields.includes('knowledge')
              ? {
                  fillKnowledge: async (incoming: AgentCreateChatPatch) => {
                    try {
                      const { collections } = await listAccessibleKnowledgeBase();
                      if (collections.length === 0) return;
                      const intent = [userText.trim(), action.intent.trim()]
                        .filter(Boolean)
                        .join('\n')
                        .toLowerCase();
                      const ranked = collections
                        .map(collection => {
                          const hay = `${collection.name ?? ''} ${collection.id}`.toLowerCase();
                          let score = 0;
                          if (/\b(docs?|documentation|product|knowledge|wiki)\b/.test(intent)) {
                            if (/\b(docs?|product|wiki|knowledge)\b/.test(hay)) score += 10;
                          }
                          return { collection, score };
                        })
                        .sort((a, b) => b.score - a.score);
                      // Precision: never bind knowledge[0] when score is 0.
                      const pick = ranked[0] && ranked[0].score > 0 ? ranked[0].collection : null;
                      if (!pick?.id) return;
                      incoming.selectedKbScope = 'COLLECTIONS';
                      incoming.selectedKbResources = [{ collectionId: pick.id, fileId: null }];
                      return pick.name?.trim() || pick.id;
                    } catch {
                      // Hub row may stay empty if KB API fails.
                    }
                    return;
                  },
                }
              : {}),
          });
          // The plan is settled by now (hard 4s ceiling). No word-match "heal" pass and no
          // Save block on capabilities: the plan and the chips decide what is bound.
          if (hubPlan) await hubPlan;
          markCreate('ready');
          createForm.setWritingField(null);
          createForm.setAttentionField(null);
          setProgressLabel(null);
          setSkeletonIdentity(false);
          setPhase('draft');
        } catch (err) {
          createForm.clearHighlights();
          createForm.setAttentionField(null);
          setProgressLabel(null);
          setSkeletonIdentity(false);
          setPhase(canvasIsEmpty(createForm.getForm()) ? 'empty' : 'draft');
          throw err;
        }
      });
      const settled = run.catch(() => {});
      void settled.then(() => {
        turnsInFlightRef.current = Math.max(0, turnsInFlightRef.current - 1);
        if (turnsInFlightRef.current === 0) setDrafting(false);
      });
      canvasTurnChainRef.current = settled;
      return run;
    },
    [createForm, user?.id],
  );

  const onSend = useCallback(
    (userText: string): void => {
      markCreate('send');
      // Only when this turn is likely to touch hubs: an empty canvas (first draft)
      // or words that name a tool, skill or knowledge. Chit-chat costs no XOR call.
      const form = createForm.getForm();
      if (!canvasIsEmpty(form) && inferredCapabilityFields(userText).length === 0) {
        prefetchRef.current = null;
        return;
      }
      prefetchRef.current = {
        text: userText.trim(),
        plan: requestHubPlan({ intent: userText, systemPrompt: form.systemPrompt || undefined }),
        context: loadHubPlanContext(user?.id),
      };
    },
    [createForm, user?.id],
  );

  const draftContext = useCallback((): Promise<HubPlanContext> => {
    draftContextRef.current ??= loadHubPlanContext(user?.id);
    return draftContextRef.current;
  }, [user?.id]);

  /**
   * "Start over" asked in the Build chat: the canvas goes back to empty (the
   * form, its dashed suggestions and the rows it had opened) and the chat
   * carries on. Undo puts back what was there, in case it was misread.
   */
  const clearCanvasFromChat = useCallback((): void => {
    const before = createForm.getForm();
    const suggestionsBefore = hubSuggestionsRef.current;
    const planBefore = planRef.current;
    // A saved agent starts over from itself as saved.
    createForm.resetFrom(startForm);
    planRef.current = null;
    setHubSuggestions(EMPTY_HUB_SUGGESTIONS);
    setClearEpoch(epoch => epoch + 1);
    setPhase(startPhase);
    setSkeletonIdentity(false);
    if (JSON.stringify(before) === JSON.stringify(startForm)) return;
    toast(agent ? 'Back to the saved agent' : 'Cleared the canvas', {
      // Long enough to take back a wiped canvas.
      duration: 8_000,
      action: {
        label: 'Undo',
        onClick: () => {
          createForm.restore(before);
          planRef.current = planBefore;
          setHubSuggestions(suggestionsBefore);
          setPhase('draft');
        },
      },
    });
  }, [agent, createForm, startForm, startPhase]);

  /**
   * One streamed draft turn. The stream lands at full speed; the canvas shows it
   * one part at a time, top to bottom (see draftReveal.ts): name, handle and
   * description type in, then each tools row, the schedule, each property, and
   * last the instructions.
   */
  const onDraftTurn = useCallback(
    async (turn: DraftTurnArgs): Promise<void> => {
      markCreate('send');
      setDrafting(true);
      setCreateError(null);
      createForm.clearHighlightMarks();
      setProgressLabel('Thinking…');

      const form = createForm.getForm();
      const contextPromise = draftContext();
      const hasCapabilities =
        form.tools.subagents.length +
          form.tools.direct.length +
          form.tools.custom.length +
          form.tools.gateway.length +
          form.selectedSkillIds.length +
          form.selectedKbResources.length >
        0;
      // Only an edit of an existing toolset needs the catalog before sending.
      const context = hasCapabilities ? await contextPromise : null;
      const turnId = crypto.randomUUID();
      let applied = 0;
      // An edit is the user asking for a change: it lands over their own edits.
      // A first draft fills in around them.
      let overrideEdits = false;
      const apply = (patch: AgentCreateChatPatch): void => {
        if (Object.keys(patch).length === 0) return;
        if (applied === 0) markCreate('turn');
        applied += 1;
        createForm.applyChatPatch(`draft-${turnId}-${applied}`, patch, {
          highlight: false,
          overrideEdits,
        });
      };

      const { signal } = turn;
      const reveal = createDraftReveal({ signal });
      const writing = (field: AgentCreateField, hubRow: AgentCreateHubRow | null = null): void => {
        createForm.setWritingField(field, hubRow);
        setProgressLabel(progressLabelForField(field, hubRow));
      };
      const typeIn = async (
        field: 'name' | 'description',
        text: string,
        maxMs: number,
      ): Promise<void> => {
        const set = (value: string): AgentCreateChatPatch =>
          field === 'name' ? { name: value } : { description: value };
        for (const shown of typingSteps(text.length, maxMs)) {
          if (signal.aborted) break;
          apply(set(text.slice(0, shown)));
          await nextFrame();
        }
        apply(set(text));
      };

      // A first draft writes the instructions in live. An edit keeps the current
      // text on screen (shimmering) and swaps in the new version when it's done,
      // instead of blanking a prompt the user was reading.
      let liveInstructions = !form.systemPrompt.trim();
      let instructions = '';
      let finalInstructions: string | null = null;
      let instructionsQueued = false;
      let streamEnded = false;
      let wakeInstructions: (() => void) | null = null;
      const instructionsChanged = (): Promise<void> =>
        new Promise(resolve => {
          wakeInstructions = resolve;
        });
      const poke = (): void => {
        const wake = wakeInstructions;
        wakeInstructions = null;
        wake?.();
      };
      signal.addEventListener('abort', poke, { once: true });
      const revealInstructions = async (): Promise<void> => {
        writing('systemPrompt');
        if (!liveInstructions) {
          while (finalInstructions === null && !streamEnded && !signal.aborted) {
            await instructionsChanged();
          }
          if (finalInstructions !== null) apply({ systemPrompt: finalInstructions });
          markCreate('prompt-done');
          return;
        }
        // Land what has streamed a few lines at a time (instructionsChunks.ts).
        // Only whole chunks go on the canvas, where each blurs in; a backlog
        // drains at a quicker beat instead of flooding in, and the reveal waits
        // on the stream when it catches up. One frame first, so the field mounts
        // its reveal empty and the first chunk animates like the rest.
        await nextFrame();
        let shown = 0;
        for (;;) {
          if (signal.aborted) return;
          const target = finalInstructions ?? plainInstructions(instructions);
          const done = finalInstructions !== null || streamEnded;
          const end = nextRevealEnd(target, shown, done);
          if (end === null) {
            if (done) break;
            await instructionsChanged();
            continue;
          }
          apply({ systemPrompt: target.slice(0, end) });
          shown = end;
          await sleep(chunkGapMs(target, end));
        }
        // The final text can differ from the stream: a repaired section, late tools.
        if (finalInstructions !== null) apply({ systemPrompt: finalInstructions });
        markCreate('prompt-done');
      };
      const queueInstructions = (): void => {
        if (instructionsQueued) return;
        instructionsQueued = true;
        reveal.fill('instructions', revealInstructions);
      };

      let failure: string | null = null;
      let mode: DraftMode | null = null;
      let ackText: string | null = null;
      // Whether the turn answered in chat (a warning alone is not an answer).
      let answered = false;

      const handle = async (event: AgentDraftEvent): Promise<void> => {
        switch (event.event) {
          case 'mode':
            mode = event.mode;
            if (event.mode === 'reset') {
              clearCanvasFromChat();
              return;
            }
            overrideEdits = event.mode === 'edit';
            if (event.mode === 'draft') liveInstructions = true;
            if (event.mode === 'draft' || event.mode === 'edit') {
              setProgressLabel(PROGRESS_THINKING);
              reveal.start(expectedSlots(event.mode, event.fields));
            }
            return;
          case 'field.start':
            // The reveal marks each field as it lands, not when the server starts it.
            return;
          case 'identity':
            reveal.fill('identity', async () => {
              setPhase('draft');
              if (event.name) {
                writing('name');
                await typeIn('name', event.name, TYPE_MS.name);
                await sleep(REVEAL_HOLD_MS.field);
              }
              if (event.handle) {
                writing('slug');
                apply({ slug: event.handle });
                await sleep(REVEAL_HOLD_MS.field);
              }
              if (event.description) {
                writing('description');
                await typeIn('description', event.description, TYPE_MS.description);
                await sleep(REVEAL_HOLD_MS.field);
              }
              if (event.handleAdjusted && event.handle) {
                turn.announce(
                  `@${event.handleAdjusted.requested} is taken, so I used @${event.handle}.`,
                );
              }
            });
            return;
          case 'permission':
            // Not shown on the canvas, so nothing to pace.
            apply({ permissionMode: event.mode });
            return;
          case 'schedule':
            if (agent) {
              turn.announce("A saved agent's schedule is set from Activity in its settings.");
              return;
            }
            if (event.op !== 'set' && event.op !== 'clear') {
              turn.announce(`Couldn't set the schedule (${event.text}): ${event.error}`);
              return;
            }
            reveal.fill('schedule', async () => {
              writing('schedule');
              apply({ schedule: event.op === 'set' ? fromDraftSchedule(event) : null });
              await sleep(REVEAL_HOLD_MS.row);
            });
            return;
          case 'properties': {
            const { ops } = event;
            reveal.fill('properties', async () => {
              writing('properties');
              // Changes and removals land together; each new row comes in after the last.
              const key = (title: string): string => title.trim().toLowerCase();
              const existing = new Set(
                createForm.getForm().customProperties.map(row => key(row.title)),
              );
              const added = ops.filter(op => op.op === 'set' && !existing.has(key(op.title)));
              const rest = ops.filter(op => !added.includes(op));
              if (rest.length > 0) {
                apply({
                  customProperties: applyPropertyOps(createForm.getForm().customProperties, rest),
                });
              }
              for (const op of added) {
                if (signal.aborted) return;
                apply({
                  customProperties: applyPropertyOps(createForm.getForm().customProperties, [op]),
                });
                await sleep(REVEAL_HOLD_MS.property);
              }
            });
            return;
          }
          case 'plan': {
            const ctx = await contextPromise;
            reveal.fill('capabilities', async () => {
              apply(removalPatch(createForm.getForm(), event.remove, ctx));
              const resolved = hubPatchFromPlan({
                plan: event.plan,
                intent: turn.userText,
                catalog: ctx.catalog,
                current: createForm.getForm(),
                skills: ctx.skills,
                kbCollections: ctx.collections,
                dismissed: dismissedRef.current,
              });
              const hubs: readonly HubPlanField[] =
                event.op === 'replace' ? ['tools', 'skills', 'knowledge'] : resolved.fields;
              // One row at a time, top to bottom, each with its pills.
              for (const row of HUB_REVEAL_ORDER) {
                if (signal.aborted) return;
                const patch = rowPatch(row, resolved.patch, createForm.getForm());
                const suggested = rowSuggestionCount(row, resolved.suggestions, hubs);
                const lands = Object.keys(patch).length > 0 || suggested > 0;
                if (lands) writing(canvasFieldForRow(row), row);
                apply(patch);
                setHubSuggestions(prev => rowSuggestions(prev, resolved.suggestions, hubs, row));
                if (lands) {
                  await sleep(
                    rowHoldMs(rowPillCount(row, createForm.getForm(), resolved.suggestions)),
                  );
                }
              }
              markCreate('plan-ready');
              markCreate('tools-filled');
            });
            return;
          }
          case 'instructions.delta':
            instructions += event.text;
            queueInstructions();
            poke();
            return;
          case 'instructions.section':
            instructions = replaceSection(
              instructions,
              event.heading,
              event.markdown,
              TOOLS_INSERT_BEFORE,
            );
            poke();
            return;
          case 'instructions.done':
            finalInstructions = event.text;
            queueInstructions();
            poke();
            return;
          case 'reply.delta':
            if (event.text) answered = true;
            // A conversational answer is its own live indicator once it starts.
            if (mode === 'chat' || mode === 'ask') setProgressLabel(null);
            turn.appendReply(event.text);
            return;
          case 'activity':
            turn.activity(event);
            setProgressLabel(event.status === 'running' ? 'Searching the web…' : 'Thinking…');
            return;
          case 'suggestion':
            turn.suggest(event.suggestions);
            return;
          case 'question':
            turn.ask({ id: event.id, questions: event.questions });
            return;
          case 'ack':
            // Said once the canvas has finished filling in, not while it still is.
            if (event.text) ackText = event.text;
            return;
          case 'warning':
            turn.announce(event.message);
            return;
          case 'error':
            failure = event.message;
            return;
          default:
            return;
        }
      };

      // Events are handled in order; `plan` awaits the catalog, the rest are instant.
      let queue = Promise.resolve();
      const settleReveal = async (): Promise<void> => {
        await queue;
        streamEnded = true;
        poke();
        await reveal.finish();
      };
      try {
        await streamAgentDraft(
          {
            draftId: draftIdRef.current,
            turnId,
            message: turn.userText,
            history: turn.history,
            canvas: {
              name: form.name,
              handle: form.slug,
              description: form.description,
              instructions: form.systemPrompt,
              permissionMode: form.permissionMode,
              schedule: toDraftSchedule(form.schedule),
              capabilities: capabilityRefs(form, context),
              customProperties: form.customProperties.map(({ title, type, value }) => ({
                title,
                type,
                value,
              })),
            },
            userOwned: userOwnedFields(createForm.dirty, createForm.focused),
            timezone: browserTimezone(),
          },
          event => {
            queue = queue.then(() => handle(event));
          },
          signal,
        );
        await settleReveal();
        if (failure) throw new Error(failure);
        if (ackText) {
          answered = true;
          turn.announce(ackText);
        }
        if (!answered && applied > 0) {
          turn.announce(silentTurnReply(mode, createForm.getForm().name));
        }
      } catch (err) {
        if (
          err instanceof ClawApiError &&
          DRAFT_STREAM_DOWN_STATUSES.has(err.status) &&
          applied === 0
        ) {
          setDraftStreamDown(true);
          throw new Error(
            'The draft service is unavailable, so I switched to the regular chat. Send that again.',
          );
        }
        throw err;
      } finally {
        // A stream that broke still shows what it sent before it broke.
        await settleReveal().catch(() => undefined);
        signal.removeEventListener('abort', poke);
        const { entries, connectedServerIds } = mcpCatalogRef.current;
        const toConnect = connectorsToConnect(
          entries,
          form.tools,
          createForm.getForm().tools,
          connectedServerIds,
        );
        if (toConnect.length > 0) turn.connectors(toConnect);
        createForm.setWritingField(null);
        createForm.setAttentionField(null);
        setProgressLabel(null);
        setDrafting(false);
        markCreate('ready');
      }
    },
    [agent, clearCanvasFromChat, createForm, draftContext],
  );

  const agentPath = useCallback(
    (agentSlug: string): string =>
      `${workspaceId ? `/${workspaceId}` : ''}/ai/library/agent/${agentSlug}?tab=persona`,
    [workspaceId],
  );

  const pageRef = useRef<HTMLDivElement | null>(null);
  const exitingRef = useRef(false);
  /**
   * Back to the agent's profile the way it came: the Build chat slides out and
   * the canvas glides over, then the profile picks the glide up from there.
   */
  const leaveToProfile = useCallback(
    async (agentSlug: string, options: { replace?: boolean } = {}): Promise<void> => {
      if (exitingRef.current) return;
      exitingRef.current = true;
      if (pageRef.current) await slideOutToProfile(pageRef.current, enterFromLeft);
      void navigate(agentPath(agentSlug), {
        ...options,
        state: { canvasLeft: canvasColumnLeft(), ...(returnTo ? { returnTo } : {}) },
      });
    },
    [agentPath, enterFromLeft, navigate, returnTo],
  );

  /** Save for a saved agent: only what changed, then back to its profile. */
  const persistEdit = useCallback(
    async (saved: Agent): Promise<void> => {
      const form = createForm.getForm();
      const latest = queryClient.getQueryData<Agent>(clawAgentDetailKey(saved.slug)) ?? saved;
      const payload = buildUpdateAgentPayload(
        form,
        startForm,
        latest.config ?? {},
        canRenameHandle,
      );
      const renaming = payload.slug !== undefined;
      try {
        const updated = await updateClawAgent(saved.slug, payload);
        if (renaming) {
          queryClient.removeQueries({ queryKey: clawAgentDetailKey(saved.slug), exact: true });
        }
        queryClient.setQueryData(clawAgentDetailKey(updated.slug), updated);
        void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
        void queryClient.invalidateQueries({ queryKey: ['accessible-claw-agents'] });
        if (payload.systemPrompt !== undefined) {
          void queryClient.invalidateQueries({ queryKey: clawPromptVersionsKey(updated.slug) });
        }
        clearAgentDraft(draftKey);
        setCreatedSlug(updated.slug);
        setPhase('created');
        toast.success('Changes saved');
        await leaveToProfile(updated.slug, { replace: true });
      } catch (err) {
        setCreateError(
          renaming && err instanceof ClawApiError && err.status === 409
            ? `@${slug} is already taken. Change the handle and save again.`
            : `Couldn't save the changes: ${clawErrorText(err, 'Something went wrong.')} Your edits are still here.`,
        );
      }
    },
    [canRenameHandle, createForm, draftKey, leaveToProfile, queryClient, slug, startForm],
  );

  const persist = useCallback(async (): Promise<void> => {
    if (!saveGate.canSave || creating) return;
    setCreating(true);
    setCreateError(null);
    if (agent) {
      await persistEdit(agent);
      setCreating(false);
      return;
    }
    try {
      const form = createForm.getForm();
      // The face it was built with goes with it (agentAvatarKey).
      const agent = await createAgent(buildCreateAgentPayload(form, slug, user?.id, draftId));
      // A schedule needs the agent to exist first. If arming it fails the agent
      // still stands; say so rather than rolling anything back.
      if (form.schedule) {
        try {
          if (!user?.id) throw new Error('not signed in');
          await createScheduledJob(
            user.id,
            scheduledJobInput(form.schedule, agent.slug, form.description),
          );
        } catch {
          toast.error(
            `@${agent.slug} is ready, but its schedule couldn't be set. Add it from the agent's Activity tab.`,
          );
        }
      }
      clearAgentDraft(draftKey);
      setCreatedSlug(agent.slug);
      setPhase('created');
      void queryClient.invalidateQueries({ queryKey: ['accessible-claw-agents'] });
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      toast.success(`@${agent.slug} is ready`);
      void navigate(agentPath(agent.slug), { state: { justCreated: true } });
    } catch (err) {
      if (err instanceof ClawApiError && err.status === 409) {
        setCreateError(`@${slug} is already taken. Change the handle and save again.`);
      } else {
        const reason = err instanceof Error && err.message ? err.message : 'Something went wrong.';
        setCreateError(
          `Couldn't save @${slug || 'this agent'}: ${reason} Your draft is still here.`,
        );
      }
    } finally {
      setCreating(false);
    }
  }, [
    agent,
    agentPath,
    createForm,
    creating,
    draftKey,
    navigate,
    persistEdit,
    queryClient,
    saveGate.canSave,
    slug,
    user?.id,
  ]);

  const leaveCreate = useCallback((): void => {
    // Editing goes back to the agent's profile; creating, to Agent Hub.
    if (agent) {
      void leaveToProfile(agent.slug);
      return;
    }
    const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
    void navigate(`${libraryPath}?tab=agents`);
  }, [agent, leaveToProfile, navigate, workspaceId]);

  const discardDraft = useCallback((): void => {
    clearAgentDraft(draftKey);
    setChatEpoch(epoch => epoch + 1);
    setBuildInbox([]);
    createForm.resetFrom(startForm);
    setPhase(startPhase);
    setCreateError(null);
    setSkeletonIdentity(false);
  }, [createForm, draftKey, startForm, startPhase]);

  const requestCancel = useCallback((): void => {
    if (creating) return;
    if (agent) {
      if (isFormDirty(createForm.getForm(), startForm)) {
        setDiscardOpen(true);
        return;
      }
      // Nothing changed: the next edit starts with a fresh Build chat.
      clearAgentDraft(draftKey);
      leaveCreate();
      return;
    }
    // A saved draft is already under Drafts; leaving just keeps the latest edits.
    if (storageReady && keptRef.current) {
      writeAgentDraft(draftKey, createForm.getForm(), { kept: true });
      leaveCreate();
      return;
    }
    if (createForm.canvasDirty) {
      setDiscardOpen(true);
      return;
    }
    leaveCreate();
  }, [agent, createForm, creating, draftKey, leaveCreate, startForm, storageReady]);

  /**
   * A prompt version restored from the gear is the saved prompt now: the canvas
   * follows it unless the instructions were already being edited here.
   */
  const promptRestored = useCallback(
    (systemPrompt: string): void => {
      if (!agent) return;
      void queryClient.invalidateQueries({ queryKey: clawAgentDetailKey(agent.slug) });
      const instructions = instructionsFromSaved(systemPrompt);
      const untouched = createForm.getForm().systemPrompt.trim() === startForm.systemPrompt.trim();
      setStartForm(prev => ({ ...prev, systemPrompt: instructions }));
      if (untouched) createForm.patchForm({ systemPrompt: instructions });
    },
    [agent, createForm, queryClient, startForm],
  );

  const canvas = (
    <AgentCreateCanvas
      key={`canvas-${restoreEpoch}-${clearEpoch}`}
      revealOnMount={restoreEpoch > 0}
      // Only the canvas the page opened with glides; a restore or Start over focuses in.
      glideFromLeft={restoreEpoch === 1 && clearEpoch === 0 ? enterFromLeft : undefined}
      form={createForm.form}
      onFormChange={patch => {
        createForm.patchForm(patch);
        if (phase === 'empty') setPhase('draft');
      }}
      onFieldFocus={createForm.onFieldFocus}
      highlights={createForm.highlights}
      conflicts={createForm.conflicts}
      onResolveConflict={createForm.resolveConflict}
      skeletonIdentity={skeletonIdentity}
      writingField={createForm.writingField}
      writingHubRow={createForm.writingHubRow}
      attentionField={createForm.attentionField}
      attentionHubRow={createForm.attentionHubRow}
      hubSuggestions={hubSuggestions}
      onHubSuggestionAccepted={onHubSuggestionAccepted}
      onHubPickDismissed={onHubPickDismissed}
      phase={phase === 'created' ? 'created' : phase === 'empty' ? 'empty' : 'draft'}
      builtBy={builtBy}
      handleError={handleError}
      checkingHandle={nameCheck.checking}
      layout='profile'
      {...(agent
        ? {
            title: 'Edit Agent',
            handleLocked: !canRenameHandle,
            scheduleLocked: true,
            avatar: (
              <AgentBotAvatar agentKey={agentAvatarKey(agent)} asleep={!agent.enabled} size={56} />
            ),
          }
        : // The face this draft keeps once saved.
          { avatarKey: draftId })}
      onSave={() => {
        void persist();
      }}
      onCancel={requestCancel}
      canSave={saveGate.canSave}
      saveBlockedReason={phase === 'empty' ? null : saveGate.reason}
      saving={creating}
      saveError={createError}
      readOnly={phase === 'created'}
      onOpenSettings={() => setSettingsOpen(true)}
      floatingChat={
        <DraftAgentChat
          getForm={createForm.getForm}
          agentName={createForm.form.name}
          agentKey={agent ? agentAvatarKey(agent) : draftId}
          disabled={phase === 'created'}
          // Mobile has no Build chat to hand off to.
          onHandoff={isMobile ? undefined : handOffToBuild}
          handoffs={handoffs}
          onToolsChange={tools => {
            createForm.patchForm({ tools });
            if (phase === 'empty') setPhase('draft');
          }}
          storageKey={storageReady ? draftChatStorageKey(draftKey) : undefined}
        />
      }
    />
  );

  const overlay = useChatOverlayDial();
  const [sideCardDragging, setSideCardDragging] = useState(false);
  const sideCardRef = useRef<HTMLDivElement | null>(null);
  // Arriving from the profile, the Build chat slides in as the canvas moves over.
  const slideInRef = useRef(enterFromLeft !== undefined);
  useLayoutEffect(() => {
    const card = sideCardRef.current;
    if (!slideInRef.current || !card) return undefined;
    return slideInPanel(card);
  }, []);

  return (
    <div
      ref={pageRef}
      // Clip, not hidden: while the Build chat slides in from past the edge, its
      // scroll-into-view would otherwise scroll the page sideways.
      className='flex h-full min-h-0 w-full overflow-x-clip'
      data-component='AgentCreateSplitPage'
      data-created-slug={createdSlug ?? ''}
    >
      <WarmHubCatalogs />
      {agent ? (
        // A saved agent's own settings, as on its profile: they save as they change.
        <EditAgentSettings
          agent={agent}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          onPromptRestored={promptRestored}
        />
      ) : (
        <DraftAgentSettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          config={createForm.form.settings}
          onConfigChange={settings => {
            createForm.patchForm({ settings });
            if (phase === 'empty') setPhase('draft');
          }}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          disabled={phase === 'created'}
        />
      )}
      {isMobile ? (
        <div className='flex h-full min-h-0 w-full flex-col'>
          <div className='min-h-0 flex-1'>{canvas}</div>
        </div>
      ) : (
        <div className='flex h-full min-h-0 w-full bg-background'>
          <div className='min-h-0 min-w-0 flex-1'>{canvas}</div>
          <div
            ref={sideCardRef}
            className='relative m-3 flex min-h-0 shrink-0 flex-col self-stretch overflow-hidden rounded-[20px] border border-border bg-background shadow-[0px_4px_4px_rgba(0,0,0,0.03),0px_14px_7px_rgba(0,0,0,0.03),0px_32px_9.5px_rgba(0,0,0,0.02)]'
            data-testid='create-agent-side-card'
            data-overlay-version={overlay.version}
            style={
              overlay.version === 'Figma'
                ? {
                    width: overlay.width,
                    flexBasis: overlay.width,
                    height: '100%',
                    alignSelf: 'stretch',
                    marginTop: 0,
                    marginBottom: 0,
                    marginLeft: overlay.margin,
                    // Left stroke only, so a right margin would read as extra padding
                    // inside the card. It sits flush with the window edge instead.
                    marginRight: 0,
                    borderRadius: overlay.radius,
                    borderStyle: 'solid',
                    borderTopWidth: 0,
                    borderRightWidth: 0,
                    borderBottomWidth: 0,
                    borderLeftWidth: 1,
                    borderLeftColor: 'hsl(var(--border))',
                    boxShadow: 'none',
                    padding: overlay.inset === 12 ? undefined : overlay.inset,
                    transition: sideCardDragging ? 'none' : undefined,
                  }
                : {
                    width: overlay.width,
                    flexBasis: overlay.width,
                    margin: overlay.margin,
                    borderRadius: overlay.radius,
                    borderColor: 'hsl(var(--border))',
                    boxShadow: chatOverlayShadow(overlay.shadow),
                    padding: overlay.inset === 12 ? undefined : overlay.inset,
                    transition: sideCardDragging ? 'none' : undefined,
                  }
            }
          >
            <SideCardWidthEdge
              width={overlay.width}
              onWidthChange={overlay.setWidth}
              onDraggingChange={setSideCardDragging}
            />
            <div className='flex min-h-0 flex-1 flex-col pt-3'>
              <AgentCreateChatPanel
                // Remounts to read the stored chat once the user is known, and on Start over.
                key={`${storageReady ? draftKey : 'no-storage'}:${chatEpoch}`}
                canvas={canvasSnapshot}
                onTurnComplete={onTurnComplete}
                onSend={onSend}
                {...(DRAFT_STREAM_ENABLED && !draftStreamDown ? { onDraftTurn } : {})}
                chatStorageKey={
                  storageReady && phase !== 'created' ? buildChatStorageKey(draftKey) : null
                }
                incoming={buildInbox}
                onIncomingPhase={onIncomingPhase}
                disabled={phase === 'created'}
                progressLabel={progressLabel}
                editing={Boolean(agent)}
              />
            </div>
          </div>
        </div>
      )}
      <DiscardDraftDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={() => {
          setDiscardOpen(false);
          discardDraft();
          leaveCreate();
        }}
        {...(agent
          ? {
              description: `Your changes to ${agent.name} aren't saved yet. Leave and they're gone.`,
              discardLabel: 'Discard changes',
            }
          : {})}
        {...(storageReady && !agent
          ? {
              onKeepForLater: () => {
                setDiscardOpen(false);
                keptRef.current = true;
                writeAgentDraft(draftKey, createForm.getForm(), { kept: true });
                toast.success('Saved to Drafts in Agent Hub');
                leaveCreate();
              },
            }
          : {})}
      />
    </div>
  );
}

/** The gear while editing a saved agent: the settings its profile opens. */
function EditAgentSettings({
  agent,
  open,
  onClose,
  tab,
  onTabChange,
  onPromptRestored,
}: {
  agent: Agent;
  open: boolean;
  onClose: () => void;
  tab: AgentSettingsTabId;
  onTabChange: (tab: AgentSettingsTabId) => void;
  onPromptRestored: (systemPrompt: string) => void;
}): ReactElement {
  const actions = useAgentDetailActions(agent);
  return (
    <SavedAgentSettings
      open={open}
      onClose={onClose}
      agent={agent}
      actions={actions}
      tab={tab}
      onTabChange={onTabChange}
      onPromptRestored={onPromptRestored}
    />
  );
}
