import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAgentNameCheck } from '@/hooks/useAgentNameCheck';
import { usePlatform } from '@/hooks/usePlatform';
import { createAgent, generateAgentPrompt } from '@/services/claw/clawAgentWizardService';
import { ClawApiError } from '@/services/claw/clawRequest';
import { effectiveSlug, slugify } from '@/routes/ClawAgentsScreen/create/wizardState';
import { AgentCreateCanvas } from '@/components/flowUI/nodes/agent/create/AgentCreateCanvas';
import { AgentDraftChatPanel } from '@/components/flowUI/nodes/agent/create/AgentDraftChatPanel';
import type { AgentSettingsTabId } from '../detail/detailTabs';
import { DraftAgentSettings } from '../detail/settings/AgentSettingsView';
import {
  BuildChatTabs,
  type CreateSideTab,
} from '@/components/flowUI/nodes/agent/create/BuildChatTabs';
import {
  AgentCreateChatPanel,
  type CreateChatTurn,
  type DraftTurnArgs,
} from '@/components/flowUI/nodes/agent/create/AgentCreateChatPanel';
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
  catchUpStep,
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
import {
  agentDraftStorageKey,
  clearAgentDraft,
  readAgentDraft,
  writeAgentDraft,
} from '@/components/flowUI/nodes/agent/create/agentCreateDraftStorage';
import { buildCreateAgentPayload } from './agentCreatePayload';
import { computeSaveGate } from './saveGate';
import {
  browserTimezone,
  scheduledJobInput,
  scheduleProblem,
} from '@/components/flowUI/nodes/agent/create/agentSchedule';
import { createScheduledJob } from '../detail/activity/createScheduledJob';
import {
  seedScriptedHubCatalog,
  watchScriptedHubCatalog,
} from '@/components/flowUI/nodes/agent/create/scriptedHubCatalog';
import { useScriptedCreatePlayer } from '@/components/flowUI/nodes/agent/create/useScriptedCreatePlayer';
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

export function AgentCreateSplitPage({
  scripted = false,
}: { scripted?: boolean } = {}): ReactElement {
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const queryClient = useQueryClient();
  const createForm = useAgentCreateForm(EMPTY_CREATE_FORM);
  const [phase, setPhase] = useState<AgentCreatePhase>('empty');
  const [sideTab, setSideTab] = useState<CreateSideTab>('build');
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
  const draftKey = agentDraftStorageKey(workspaceId, user?.id);
  const storageReady = !scripted && Boolean(user?.id);

  const slug = effectiveSlug({
    name: createForm.form.name,
    slug: createForm.form.slug,
    slugManual: createForm.form.slugManual,
  });
  const nameCheck = useAgentNameCheck(phase === 'created' ? '' : createForm.form.name.trim(), slug);
  const handleError = nameCheck.slugError
    ? `@${slug} is taken. Rename the handle to create a new agent.`
    : nameCheck.nameError;
  const builtBy = user?.name ?? user?.email ?? 'you';

  const seedHub = useCallback((): void => {
    seedScriptedHubCatalog(queryClient, user?.id);
  }, [queryClient, user?.id]);

  useEffect(() => {
    if (!scripted) return undefined;
    return watchScriptedHubCatalog(queryClient, user?.id);
  }, [queryClient, scripted, user?.id]);

  // Reopen the last unsaved draft for this workspace + user.
  const { restore: restoreForm } = createForm;
  const discardRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!storageReady) return;
    const stored = readAgentDraft(draftKey);
    if (!stored) return;
    restoreForm(stored.form);
    setPhase('draft');
    toast('Restored your unsaved agent draft', {
      id: 'agent-draft-restored',
      action: { label: 'Start over', onClick: () => discardRef.current() },
    });
  }, [draftKey, restoreForm, storageReady]);

  // Keep the stored draft in step with the canvas.
  useEffect(() => {
    if (!storageReady || phase === 'created') return undefined;
    const form = createForm.form;
    const timer = window.setTimeout(() => writeAgentDraft(draftKey, form), 400);
    return () => window.clearTimeout(timer);
  }, [createForm.form, draftKey, phase, storageReady]);

  // A turn still writing the canvas would be lost on reload.
  useEffect(() => {
    if (!drafting) return undefined;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafting]);

  const scriptedPlayer = useScriptedCreatePlayer({
    enabled: scripted,
    emptyForm: EMPTY_CREATE_FORM,
    form: {
      applyChatPatch: createForm.applyChatPatch,
      setWritingField: createForm.setWritingField,
      clearHighlights: createForm.clearHighlights,
      patchForm: createForm.patchForm,
      resetFrom: createForm.resetFrom,
      resolveConflict: createForm.resolveConflict,
    },
    setPhase,
    setSkeletonIdentity,
    seedHub,
  });

  const saveGate = computeSaveGate({
    created: phase === 'created',
    creating,
    drafting,
    name: createForm.form.name,
    slug,
    description: createForm.form.description,
    instructions: createForm.form.systemPrompt,
    conflictCount: createForm.conflicts.length,
    scheduleProblem: scheduleProblem(createForm.form.schedule),
    nameCheck,
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
      if (scripted) return Promise.resolve();
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
    [createForm, scripted, user?.id],
  );

  const onSend = useCallback(
    (userText: string): void => {
      if (scripted) return;
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
    [createForm, scripted, user?.id],
  );

  const draftContext = useCallback((): Promise<HubPlanContext> => {
    draftContextRef.current ??= loadHubPlanContext(user?.id);
    return draftContextRef.current;
  }, [user?.id]);

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
      const apply = (patch: AgentCreateChatPatch): void => {
        if (Object.keys(patch).length === 0) return;
        if (applied === 0) markCreate('turn');
        applied += 1;
        createForm.applyChatPatch(`draft-${turnId}-${applied}`, patch, { highlight: false });
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
        // Type out what has streamed so far, catching up on any backlog, then
        // follow the stream as it arrives.
        let shown = 0;
        for (;;) {
          if (signal.aborted) return;
          const target = finalInstructions ?? plainInstructions(instructions);
          if (shown >= target.length) {
            if (finalInstructions !== null || streamEnded) break;
            await instructionsChanged();
            continue;
          }
          shown += catchUpStep(target.length - shown);
          apply({ systemPrompt: target.slice(0, shown) });
          await nextFrame();
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
        createForm.setWritingField(null);
        createForm.setAttentionField(null);
        setProgressLabel(null);
        setDrafting(false);
        markCreate('ready');
      }
    },
    [createForm, draftContext],
  );

  const agentPath = useCallback(
    (agentSlug: string): string =>
      `${workspaceId ? `/${workspaceId}` : ''}/ai/library/agent/${agentSlug}?tab=persona`,
    [workspaceId],
  );

  const persist = useCallback(async (): Promise<void> => {
    if (scripted || !saveGate.canSave || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const form = createForm.getForm();
      const agent = await createAgent(buildCreateAgentPayload(form, slug, user?.id));
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
    agentPath,
    createForm,
    creating,
    draftKey,
    navigate,
    queryClient,
    saveGate.canSave,
    scripted,
    slug,
    user?.id,
  ]);

  const leaveCreate = useCallback((): void => {
    const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
    void navigate(`${libraryPath}?tab=agents`);
  }, [navigate, workspaceId]);

  const discardDraft = useCallback((): void => {
    clearAgentDraft(draftKey);
    createForm.resetFrom(EMPTY_CREATE_FORM);
    setPhase('empty');
    setCreateError(null);
    setSkeletonIdentity(false);
  }, [createForm, draftKey]);
  discardRef.current = discardDraft;

  const requestCancel = useCallback((): void => {
    if (creating) return;
    if (createForm.canvasDirty) {
      setDiscardOpen(true);
      return;
    }
    leaveCreate();
  }, [createForm.canvasDirty, creating, leaveCreate]);

  const canvas = (
    <AgentCreateCanvas
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
      onSave={() => {
        if (scripted) return;
        void persist();
      }}
      onCancel={requestCancel}
      canSave={saveGate.canSave}
      saveBlockedReason={phase === 'empty' ? null : saveGate.reason}
      saving={creating}
      saveError={createError}
      readOnly={phase === 'created' || (scripted && scriptedPlayer.playing)}
      {...(scripted ? {} : { onOpenSettings: () => setSettingsOpen(true) })}
    />
  );

  const overlay = useChatOverlayDial();
  const [sideCardDragging, setSideCardDragging] = useState(false);

  return (
    <div
      className='flex h-full min-h-0 w-full'
      data-component='AgentCreateSplitPage'
      data-created-slug={createdSlug ?? ''}
      {...(scripted
        ? {
            'data-scripted': 'true',
            'data-scripted-step': scriptedPlayer.step,
            'data-scripted-ready': scriptedPlayer.ready ? 'true' : 'false',
          }
        : {})}
    >
      {scripted ? null : <WarmHubCatalogs />}
      {scripted ? null : (
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
            <BuildChatTabs
              tab={sideTab}
              onTabChange={setSideTab}
              suspendLayout={sideCardDragging}
            />
            <div aria-hidden className='pointer-events-none mt-3 h-8 shrink-0' />
            <div className={sideTab === 'build' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <AgentCreateChatPanel
                canvas={canvasSnapshot}
                onTurnComplete={onTurnComplete}
                onSend={onSend}
                {...(DRAFT_STREAM_ENABLED && !draftStreamDown ? { onDraftTurn } : {})}
                disabled={phase === 'created'}
                progressLabel={scripted ? null : progressLabel}
                {...(scripted
                  ? {
                      scripted: true,
                      scriptedMessages: scriptedPlayer.messages,
                      scriptedDraft: scriptedPlayer.draft,
                      scriptedPlaying: scriptedPlayer.playing,
                      scriptedTyping: scriptedPlayer.typing,
                      scriptedDone: scriptedPlayer.step === 'done',
                      onScriptedEngage: scriptedPlayer.engageComposer,
                      onScriptedReplay: scriptedPlayer.replay,
                    }
                  : {})}
              />
            </div>
            <div className={sideTab === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <AgentDraftChatPanel getForm={createForm.getForm} disabled={phase === 'created'} />
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
        {...(storageReady
          ? {
              onKeepForLater: () => {
                setDiscardOpen(false);
                writeAgentDraft(draftKey, createForm.getForm());
                leaveCreate();
              },
            }
          : {})}
      />
    </div>
  );
}
