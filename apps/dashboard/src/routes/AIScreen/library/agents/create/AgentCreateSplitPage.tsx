import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
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
import { getAvailableTools, suggestTools } from '@/services/claw/clawToolsService';
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
  type CreateCanvasSnapshot,
} from '@/components/flowUI/nodes/agent/create/createChatMode';
import { sanitizeAgentCanvasName } from '@/components/flowUI/nodes/agent/create/canvasFromIdentity';
import { toolboxFromSuggestion } from '@/components/flowUI/nodes/agent/create/toolboxFromSuggestion';
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
    (scripted || !nameCheck.checking);

  const canvasSnapshot: CreateCanvasSnapshot = {
    empty: canvasIsEmpty(createForm.form),
    name: createForm.form.name,
    slug: createForm.form.slug,
    description: createForm.form.description,
    instructions: createForm.form.systemPrompt,
  };

  const onTurnComplete = useCallback(
    async (turn: CreateChatTurn): Promise<void> => {
      if (scripted) return;
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
        setSkeletonIdentity(false);
        return;
      }

      setCreateError(null);
      createForm.clearHighlightMarks();

      if (action.type === 'rename') {
        const sourceId = `hub-rename-${Date.now()}`;
        try {
          createForm.setWritingField('name');
          await sleep(48);
          const changedName = createForm.applyChatPatch(
            sourceId,
            { name: sanitizeAgentCanvasName(action.name) },
            { highlight: false },
          );
          if (changedName.includes('name')) {
            await sleep(WRITE_MS);
          }
          createForm.setWritingField('slug');
          const changedSlug = createForm.applyChatPatch(
            `${sourceId}-slug`,
            { slug: slugify(action.name) },
            { highlight: false },
          );
          if (changedSlug.includes('slug')) {
            await sleep(WRITE_MS);
          }
          setPhase('draft');
        } finally {
          createForm.setWritingField(null);
        }
        return;
      }

      if (action.type !== 'draft') {
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
        await applyCreateHubDraft({
          action,
          canvasEmpty,
          existingSystemPrompt: createForm.form.systemPrompt,
          writeMs: WRITE_MS,
          sourceId,
          generateAgentPrompt: async (intent, existingPrompt) =>
            generateAgentPrompt({
              intent,
              ...(existingPrompt ? { existingPrompt } : {}),
            }),
          setWritingField: createForm.setWritingField,
          applyChatPatch: createForm.applyChatPatch,
          sleep,
          ...(action.fields.includes('tools')
            ? {
                fillTools: async (incoming: AgentCreateChatPatch) => {
                  try {
                    const [suggestion, catalog] = await Promise.all([
                      suggestTools({
                        systemPrompt:
                          incoming.systemPrompt || createForm.form.systemPrompt || undefined,
                        description: action.intent,
                      }),
                      getAvailableTools().catch(() => null),
                    ]);
                    incoming.tools = toolboxFromSuggestion(
                      createForm.form.tools,
                      suggestion,
                      catalog,
                    );
                  } catch {
                    // Prompt still applies if tool suggest fails.
                  }
                },
              }
            : {}),
        });
        await sleep(WRITE_MS * 2);
        createForm.setWritingField(null);
        setSkeletonIdentity(false);
        setPhase('draft');
      } catch (err) {
        createForm.clearHighlights();
        setSkeletonIdentity(false);
        setPhase(canvasIsEmpty(createForm.form) ? 'empty' : 'draft');
        throw err;
      }
    },
    [createForm, scripted],
  );

  const persist = useCallback(async (): Promise<void> => {
    if (scripted || !canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    const form = { ...createForm.form, slug };
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
  }, [canCreate, createForm.form, creating, queryClient, scripted, slug, user?.id]);

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
    setSkeletonIdentity(false);
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
