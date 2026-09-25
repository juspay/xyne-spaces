import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, ResizableGroup, Separator } from '@/components/ui/Resizable/Resizable';
import { useAuth } from '@/hooks/useAuth';
import { useAgentNameCheck } from '@/hooks/useAgentNameCheck';
import { usePlatform } from '@/hooks/usePlatform';
import { AgentConfigAttachError } from '@/hooks/useCreateClawAgent';
import {
  createAgent,
  generateAgentPrompt,
  updateAgent,
} from '@/services/claw/clawAgentWizardService';
import { getAvailableTools } from '@/services/claw/clawToolsService';
import { effectiveSlug, slugify } from '@/routes/ClawAgentsScreen/create/wizardState';
import { AgentCreateCanvas } from '@/components/flowUI/nodes/agent/create/AgentCreateCanvas';
import {
  AgentCreateChatPanel,
  type CreateChatTurn,
} from '@/components/flowUI/nodes/agent/create/AgentCreateChatPanel';
import { AgentCreateFooter } from '@/components/flowUI/nodes/agent/create/AgentCreateFooter';
import { DiscardDraftDialog } from '@/components/flowUI/nodes/agent/create/DiscardDraftDialog';
import {
  applyCreateHubDraft,
  decideCreateCanvasAction,
  resolveWalkCreateAction,
  WALK_BUILTIN_HUB_USER_TEXT,
  type CreateCanvasSnapshot,
} from '@/components/flowUI/nodes/agent/create/createChatMode';
import { preferredToolsHubRow } from '@/components/flowUI/nodes/agent/create/classifyCreateTurn';
import { PROGRESS_THINKING } from '@/components/flowUI/nodes/agent/create/createProgressLabel';
import {
  buildBuiltinCatalog,
  enableEntry as enableBuiltinEntry,
} from '@/routes/AIScreen/library/shared/pickers/builtin/builtinCatalog';
import { listAccessibleKnowledgeBase } from '@/services/claw/clawKnowledgeBaseService';
import { listSkills } from '@/services/claw/clawSkillsService';
import { sanitizeAgentCanvasName } from '@/components/flowUI/nodes/agent/create/canvasFromIdentity';
import { selectHubToolsForIntent } from '@/components/flowUI/nodes/agent/create/hubCatalogSelect';
import { inferNeededCapabilities } from '@/components/flowUI/nodes/agent/create/capabilityInference';
import {
  canvasHasCapability,
  capabilityGapMessage,
  jobIntentFromForm,
  validateCanvasCapabilities,
} from '@/components/flowUI/nodes/agent/create/capabilityValidation';
import {
  EMPTY_CREATE_FORM,
  type AgentCreateChatPatch,
  type AgentCreatePhase,
} from '@/components/flowUI/nodes/agent/create/types';
import { useAgentCreateForm } from '@/components/flowUI/nodes/agent/create/useAgentCreateForm';
import {
  seedScriptedHubCatalog,
  watchScriptedHubCatalog,
} from '@/components/flowUI/nodes/agent/create/scriptedHubCatalog';
import { useScriptedCreatePlayer } from '@/components/flowUI/nodes/agent/create/useScriptedCreatePlayer';

const WRITE_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function canvasIsEmpty(form: { name: string; systemPrompt: string }): boolean {
  return !form.name.trim() && !form.systemPrompt.trim();
}

export function AgentCreateSplitPage({
  scripted = false,
}: { scripted?: boolean } = {}): ReactElement {
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const queryClient = useQueryClient();
  const createForm = useAgentCreateForm(EMPTY_CREATE_FORM);
  const [phase, setPhase] = useState<AgentCreatePhase>('empty');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [skeletonIdentity, setSkeletonIdentity] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [capabilityBlock, setCapabilityBlock] = useState(false);
  const canvasTurnChainRef = useRef(Promise.resolve());
  const lastJobIntentRef = useRef('');

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

  // Manual canvas picks clear a sticky Create block once chips cover job needs.
  useEffect(() => {
    if (!capabilityBlock) return;
    const intent = lastJobIntentRef.current || jobIntentFromForm('', createForm.form);
    const needed = inferNeededCapabilities(intent);
    if (needed.length === 0) {
      setCapabilityBlock(false);
      return;
    }
    if (needed.every(cls => canvasHasCapability(createForm.form, cls))) {
      setCapabilityBlock(false);
      setCreateError(null);
    }
  }, [capabilityBlock, createForm.form]);

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

  const canCreate =
    phase !== 'created' &&
    createForm.form.name.trim().length > 0 &&
    slug.length > 0 &&
    createForm.form.systemPrompt.trim().length > 0 &&
    createForm.conflicts.length === 0 &&
    !capabilityBlock &&
    (scripted ||
      !nameCheck.checking ||
      (nameCheck.nameError === null && nameCheck.slugError === null));

  /** Heal missing hubs from catalog once; returns validation after heal. */
  const healMissingCapabilities = useCallback(
    async (intent: string): Promise<ReturnType<typeof validateCanvasCapabilities>> => {
      const liveForm = createForm.getForm();
      const jobIntent = jobIntentFromForm(intent, liveForm);
      let catalog = await getAvailableTools().catch(() => null);
      let skillCount = 0;
      let knowledgeCount = 0;
      try {
        if (user?.id) skillCount = (await listSkills(user.id)).length;
      } catch {
        skillCount = 0;
      }
      try {
        knowledgeCount = (await listAccessibleKnowledgeBase()).collections.length;
      } catch {
        knowledgeCount = 0;
      }

      let result = validateCanvasCapabilities({
        intent: jobIntent,
        form: liveForm,
        catalog,
        skillCount,
        knowledgeCount,
      });
      if (result.healable.length === 0) return result;

      const patch: AgentCreateChatPatch = {};
      const toolsGap = result.healable.some(
        cls => cls === 'mcp' || cls === 'builtin' || cls === 'subagent',
      );
      if (toolsGap) {
        const selected = await selectHubToolsForIntent({
          intent: jobIntent,
          current: liveForm.tools,
          systemPrompt: liveForm.systemPrompt || undefined,
          catalog,
        });
        if (selected) {
          patch.tools = selected.selection;
          catalog = selected.catalog;
        }
      }
      if (result.healable.includes('skills') && user?.id) {
        try {
          const skills = await listSkills(user.id);
          skillCount = skills.length;
          const pick = skills.find(skill => skill.id) ?? skills[0];
          if (pick?.id) {
            patch.selectedSkillIds = [...new Set([...liveForm.selectedSkillIds, pick.id])];
          }
        } catch {
          /* keep gap */
        }
      }
      if (result.healable.includes('knowledge')) {
        try {
          const { collections } = await listAccessibleKnowledgeBase();
          knowledgeCount = collections.length;
          const pick = collections.find(c => c.id.trim()) ?? collections[0];
          if (pick?.id) {
            patch.selectedKbScope = 'COLLECTIONS';
            patch.selectedKbResources = [{ collectionId: pick.id, fileId: null }];
          }
        } catch {
          /* keep gap */
        }
      }
      if (Object.keys(patch).length > 0) {
        createForm.applyChatPatch(`hub-cap-heal-${Date.now()}`, patch, { highlight: false });
      }

      result = validateCanvasCapabilities({
        intent: jobIntent,
        form: createForm.getForm(),
        catalog,
        skillCount,
        knowledgeCount,
      });
      return result;
    },
    [createForm, user?.id],
  );

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
      const run = canvasTurnChainRef.current.then(async (): Promise<void> => {
        const canvasEmpty = canvasIsEmpty(createForm.form);
        const userText = turn.userText;

        const action =
          resolveWalkCreateAction(userText) ??
          decideCreateCanvasAction({
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
        setCapabilityBlock(false);
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

        const firstDescribe = canvasEmpty;
        if (firstDescribe) {
          setSkeletonIdentity(true);
        }

        try {
          const sourceId = `hub-${Date.now()}`;
          if (firstDescribe) {
            setSkeletonIdentity(false);
          }
          const toolsHubRow =
            userText === WALK_BUILTIN_HUB_USER_TEXT ? 'builtin' : preferredToolsHubRow(userText);
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
            ...(action.fields.includes('tools')
              ? {
                  fillTools: async (incoming: AgentCreateChatPatch) => {
                    try {
                      if (userText === WALK_BUILTIN_HUB_USER_TEXT) {
                        const catalog = await getAvailableTools().catch(() => null);
                        if (!catalog) return;
                        const built = buildBuiltinCatalog(catalog);
                        const pick = built.find(entry => entry.tools.length > 0);
                        if (pick) {
                          const live = createForm.getForm();
                          incoming.tools = {
                            ...enableBuiltinEntry(live.tools, pick),
                            callableAgents: live.tools.callableAgents,
                          };
                        }
                        return;
                      }
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
                      const pick =
                        (ranked[0] && ranked[0].score > 0 ? ranked[0].skill : null) ??
                        skills.find(skill => skill.slug) ??
                        skills[0];
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
                      const pick =
                        (ranked[0] && ranked[0].score > 0 ? ranked[0].collection : null) ??
                        collections.find(collection => collection.id.trim().length > 0) ??
                        collections[0];
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
          lastJobIntentRef.current = [userText.trim(), action.intent.trim()]
            .filter(Boolean)
            .join('\n');
          // Post-bind validation: heal missing hubs the job needs, then gate Create.
          const capResult = await healMissingCapabilities(lastJobIntentRef.current);
          if (capResult.healable.length > 0) {
            setCapabilityBlock(true);
            setCreateError(capabilityGapMessage(capResult));
          } else {
            setCapabilityBlock(false);
            const miss = capabilityGapMessage(capResult);
            if (miss && capResult.catalogMiss.length > 0) {
              setCreateError(miss);
            }
          }
          await sleep(WRITE_MS * 2);
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
      canvasTurnChainRef.current = run.catch(() => {});
      return run;
    },
    [createForm, healMissingCapabilities, scripted, user?.id],
  );

  const persist = useCallback(async (): Promise<void> => {
    if (scripted || !canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    const intent = lastJobIntentRef.current || jobIntentFromForm('', createForm.getForm());
    const capResult = await healMissingCapabilities(intent);
    if (capResult.healable.length > 0) {
      setCapabilityBlock(true);
      setCreateError(capabilityGapMessage(capResult));
      setCreating(false);
      return;
    }
    setCapabilityBlock(false);
    // catalogMiss is honest-only — Create may proceed (draft already warned).
    const form = { ...createForm.getForm(), slug };
    try {
      const agent = await createAgent({
        slug: form.slug,
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt.trim(),
        color: form.color,
        kbScope: form.selectedKbScope,
        ...(user?.id ? { ownerUserId: user.id } : {}),
        ...(form.selectedKbScope === 'USER' || form.selectedKbResources.length === 0
          ? {}
          : { knowledgeBase: form.selectedKbResources }),
      });
      const hasTools =
        form.tools.subagents.length > 0 ||
        form.tools.direct.length > 0 ||
        form.tools.custom.length > 0 ||
        form.tools.gateway.length > 0;
      const hasSkills = form.selectedSkillIds.length > 0;
      if (hasTools || hasSkills) {
        const config: Record<string, unknown> = {};
        if (hasTools) {
          config['tools'] = {
            subagents: form.tools.subagents,
            direct: form.tools.direct,
            custom: form.tools.custom,
            gateway: form.tools.gateway,
          };
        }
        try {
          await updateAgent(agent.slug, {
            ...(Object.keys(config).length > 0 ? { config } : {}),
            ...(hasSkills ? { skills: form.selectedSkillIds } : {}),
          });
        } catch (err) {
          throw new AgentConfigAttachError(
            agent.slug,
            err instanceof Error ? err.message : 'tools and skills did not save',
          );
        }
      }
      setCreatedSlug(agent.slug);
      setPhase('created');
      void queryClient.invalidateQueries({ queryKey: ['accessible-claw-agents'] });
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
    } catch (err) {
      if (err instanceof AgentConfigAttachError) {
        setCreatedSlug(err.slug);
        setPhase('created');
        void queryClient.invalidateQueries({ queryKey: ['accessible-claw-agents'] });
        void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
        setCreateError(
          `Agent @${err.slug} was created, but tools and skills didn't save. Open the agent to add them.`,
        );
        return;
      }
      const handle = slug || 'this agent';
      setCreateError(
        `Couldn't create @${handle}. Check the handle is unique and try Create Agent again. Your draft is still here.`,
      );
      setPhase('draft');
    } finally {
      setCreating(false);
    }
  }, [
    canCreate,
    createForm,
    creating,
    healMissingCapabilities,
    queryClient,
    scripted,
    slug,
    user?.id,
  ]);

  const canvasDirty = createForm.canvasDirty;
  const resetFrom = createForm.resetFrom;
  const requestDiscard = useCallback((): void => {
    if (canvasDirty) {
      setDiscardOpen(true);
      return;
    }
    resetFrom(EMPTY_CREATE_FORM);
    setPhase('empty');
    setCreateError(null);
    setCapabilityBlock(false);
    setSkeletonIdentity(false);
    lastJobIntentRef.current = '';
  }, [canvasDirty, resetFrom]);

  const footer = useMemo(
    () => (
      <AgentCreateFooter
        phase={phase === 'created' ? 'created' : 'pending'}
        canCreate={canCreate}
        creating={creating}
        discarding={false}
        onCreate={() => {
          if (scripted) return;
          void persist();
        }}
        onDiscard={requestDiscard}
        {...(createdSlug ? { createdSlug } : {})}
        createError={createError}
      />
    ),
    [canCreate, createError, createdSlug, creating, persist, phase, requestDiscard, scripted],
  );

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
      phase={phase === 'created' ? 'created' : phase === 'empty' ? 'empty' : 'draft'}
      builtBy={builtBy}
      handleError={handleError}
      checkingHandle={nameCheck.checking}
      footer={footer}
      readOnly={phase === 'created' || (scripted && scriptedPlayer.playing)}
    />
  );

  return (
    <div
      className='flex h-full min-h-0 w-full'
      data-component='AgentCreateSplitPage'
      {...(scripted
        ? {
            'data-scripted': 'true',
            'data-scripted-step': scriptedPlayer.step,
            'data-scripted-ready': scriptedPlayer.ready ? 'true' : 'false',
          }
        : {})}
    >
      {isMobile ? (
        canvas
      ) : (
        <ResizableGroup
          orientation='horizontal'
          className='h-full w-full'
          id='agent-create-hub-group'
          panelIds={['agent-create-hub-chat', 'agent-create-hub-canvas']}
        >
          <Panel id='agent-create-hub-chat' defaultSize='50%' minSize='30%'>
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
          </Panel>
          <Separator className='w-[2px] cursor-col-resize'>
            <div className='h-full w-[2px] bg-border' />
          </Separator>
          <Panel id='agent-create-hub-canvas' defaultSize='50%' minSize='30%' maxSize='70%'>
            {canvas}
          </Panel>
        </ResizableGroup>
      )}
      <DiscardDraftDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={() => {
          setDiscardOpen(false);
          createForm.resetFrom(EMPTY_CREATE_FORM);
          setPhase('empty');
          setCreateError(null);
          setSkeletonIdentity(false);
        }}
      />
    </div>
  );
}
