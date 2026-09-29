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
import {
  BuildChatTabs,
  type CreateSideTab,
} from '@/components/flowUI/nodes/agent/create/BuildChatTabs';
import {
  AgentCreateChatPanel,
  type CreateChatTurn,
} from '@/components/flowUI/nodes/agent/create/AgentCreateChatPanel';
import { DiscardDraftDialog } from '@/components/flowUI/nodes/agent/create/DiscardDraftDialog';
import {
  applyCreateHubDraft,
  decideCreateCanvasAction,
  type CreateCanvasSnapshot,
} from '@/components/flowUI/nodes/agent/create/createChatMode';
import { preferredToolsHubRow } from '@/components/flowUI/nodes/agent/create/classifyCreateTurn';
import { PROGRESS_THINKING } from '@/components/flowUI/nodes/agent/create/createProgressLabel';
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
  type HubPlanPatch,
  type HubPlanResult,
} from '@/components/flowUI/nodes/agent/create/hubPlan';
import {
  EMPTY_CREATE_FORM,
  type AgentCreateChatPatch,
  type AgentCreatePhase,
  type CreateHubSuggestions,
  type HubPickKind,
} from '@/components/flowUI/nodes/agent/create/types';
import { useAgentCreateForm } from '@/components/flowUI/nodes/agent/create/useAgentCreateForm';
import {
  agentDraftStorageKey,
  clearAgentDraft,
  readAgentDraft,
  writeAgentDraft,
} from '@/components/flowUI/nodes/agent/create/agentCreateDraftStorage';
import { buildCreateAgentPayload } from './agentCreatePayload';
import { computeSaveGate } from './saveGate';
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

const WRITE_MS = 1100;

type CreateMark = 'turn' | 'plan-ready' | 'tools-filled' | 'prompt-done' | 'ready';

/** Dev-only timing marks (`create:turn` … `create:ready`) for the create pipeline. */
function markCreate(mark: CreateMark): void {
  if (import.meta.env.DEV) performance.mark(`create:${mark}`);
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
  const turnsInFlightRef = useRef(0);
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
            setProgressLabel('Drafting name…');
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
        const planContext = wantsPlan ? loadHubPlanContext(user?.id) : undefined;
        if (wantsPlan) planRef.current = null;
        const hubPlan = wantsPlan
          ? requestHubPlan({
              intent: planIntent,
              systemPrompt: createForm.getForm().systemPrompt || undefined,
            }).then(plan => {
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
          await sleep(300);
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
      const agent = await createAgent(
        buildCreateAgentPayload(createForm.getForm(), slug, user?.id),
      );
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
                    marginRight: overlay.margin,
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
