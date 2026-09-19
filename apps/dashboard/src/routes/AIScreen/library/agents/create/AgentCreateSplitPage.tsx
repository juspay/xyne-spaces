import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
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
import { AgentCreateChatPanel } from '@/components/flowUI/nodes/agent/create/AgentCreateChatPanel';
import { AgentCreateFooter } from '@/components/flowUI/nodes/agent/create/AgentCreateFooter';
import { DiscardDraftDialog } from '@/components/flowUI/nodes/agent/create/DiscardDraftDialog';
import {
  descriptionFromIntent,
  nameFromGeneratedPrompt,
  nameFromIntent,
} from '@/components/flowUI/nodes/agent/create/canvasFromIdentity';
import {
  classifyCreateTurn,
  detectIntakeGaps,
  isSkipIntake,
  isIntakeProceed,
  parseLocalRename,
  planDescribe,
  shouldGeneratePrompt,
  FIRST_DESCRIBE_FIELDS,
  type CreateTurnClassification,
  type CreateTurnField,
} from '@/components/flowUI/nodes/agent/create/classifyCreateTurn';
import { slicePatch } from '@/components/flowUI/nodes/agent/create/mergeChatPatch';
import {
  CLARIFY_REPLY,
  draftThenAskReply,
  intakeQuestionsReply,
  replyForCreateTurn,
  SKIP_INTAKE_ACK,
  SKILLS_ROW_REPLY,
} from '@/components/flowUI/nodes/agent/create/replyForCreateTurn';
import { toolboxFromSuggestion } from '@/components/flowUI/nodes/agent/create/toolboxFromSuggestion';
import {
  EMPTY_CREATE_FORM,
  type AgentCreateChatPatch,
  type AgentCreateField,
  type AgentCreatePhase,
} from '@/components/flowUI/nodes/agent/create/types';
import { useAgentCreateForm } from '@/components/flowUI/nodes/agent/create/useAgentCreateForm';

const WRITE_MS = 1100;
const FIELD_ORDER: AgentCreateField[] = [
  'name',
  'slug',
  'description',
  'systemPrompt',
  'tools',
  'skills',
  'knowledge',
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function canvasIsEmpty(form: { name: string; systemPrompt: string }): boolean {
  return !form.name.trim() && !form.systemPrompt.trim();
}

function pickPatch(patch: AgentCreateChatPatch, fields: CreateTurnField[]): AgentCreateChatPatch {
  const next: AgentCreateChatPatch = {};
  for (const field of fields) {
    Object.assign(next, slicePatch(patch, field));
  }
  return next;
}

export function AgentCreateSplitPage(): ReactElement {
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const queryClient = useQueryClient();
  const createForm = useAgentCreateForm(EMPTY_CREATE_FORM);
  const [phase, setPhase] = useState<AgentCreatePhase>('empty');
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [skeletonIdentity, setSkeletonIdentity] = useState(false);
  const intakeRef = useRef<{ seed: string; rounds: number } | null>(null);
  const afterDraftRef = useRef<string | null>(null);

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

  const canCreate =
    phase !== 'created' &&
    createForm.form.name.trim().length > 0 &&
    slug.length > 0 &&
    createForm.form.systemPrompt.trim().length > 0 &&
    !nameCheck.checking &&
    nameCheck.nameValid &&
    createForm.conflicts.length === 0;

  const onSend = useCallback(
    async (text: string): Promise<string> => {
      setSending(true);
      setCreateError(null);
      createForm.clearHighlights();
      try {
        const canvasEmpty = canvasIsEmpty(createForm.form);
        const pending = intakeRef.current;
        let intent = text;
        let classification: CreateTurnClassification = classifyCreateTurn(text, canvasEmpty, {
          ...(pending && canvasEmpty ? { intakePending: true } : {}),
        });

        if (pending && canvasEmpty) {
          if (classification.kind === 'reply') {
            return replyForCreateTurn(text, createForm.form, canvasEmpty);
          }
          if (isIntakeProceed(text)) {
            intent = pending.seed;
            classification = { kind: 'edit', fields: FIRST_DESCRIBE_FIELDS };
            intakeRef.current = null;
          } else if (
            classification.kind === 'edit' &&
            classification.fields.length === FIRST_DESCRIBE_FIELDS.length
          ) {
            const combined = `${pending.seed}\n${text}`.trim();
            if (planDescribe(combined) === 'ask' && pending.rounds < 2) {
              intakeRef.current = { seed: combined, rounds: pending.rounds + 1 };
              return intakeQuestionsReply(combined);
            }
            intent = combined;
            classification = {
              kind: 'edit',
              fields: FIRST_DESCRIBE_FIELDS,
              askAfter: planDescribe(combined) === 'draft-then-ask',
            };
            intakeRef.current = null;
          } else {
            intakeRef.current = null;
          }
        } else if (afterDraftRef.current && !canvasEmpty && classification.kind !== 'reply') {
          if (isSkipIntake(text)) {
            afterDraftRef.current = null;
            return SKIP_INTAKE_ACK;
          }
          if (classification.kind === 'clarify' || classification.fields.length === 0) {
            intent = `${afterDraftRef.current}\n${text}`.trim();
            classification = { kind: 'edit', fields: ['systemPrompt'] };
            afterDraftRef.current = null;
          } else {
            afterDraftRef.current = null;
          }
        }

        if (classification.kind === 'reply') {
          return replyForCreateTurn(text, createForm.form, canvasEmpty);
        }
        if (classification.kind === 'intake') {
          intakeRef.current = { seed: text, rounds: 1 };
          return intakeQuestionsReply(text);
        }
        if (classification.kind === 'clarify') {
          return CLARIFY_REPLY;
        }
        if (classification.fields.every(field => field === 'skills')) {
          return SKILLS_ROW_REPLY;
        }

        const renameTo = parseLocalRename(text);
        const generate = shouldGeneratePrompt(classification, canvasEmpty, text);
        const firstDescribe = canvasEmpty && generate;

        if (firstDescribe) {
          setSkeletonIdentity(true);
        }

        const incoming: AgentCreateChatPatch = {};

        if (renameTo) {
          incoming.name = renameTo;
          incoming.slug = slugify(renameTo);
        }

        if (generate) {
          const prompt = await generateAgentPrompt({
            intent,
            ...(createForm.form.systemPrompt.trim()
              ? { existingPrompt: createForm.form.systemPrompt.trim() }
              : {}),
          });
          if (classification.fields.includes('systemPrompt')) {
            incoming.systemPrompt = prompt;
          }
          if (classification.fields.includes('name') && !renameTo) {
            incoming.name = nameFromGeneratedPrompt(prompt) || nameFromIntent(intent);
          }
          if (classification.fields.includes('slug') && incoming.name) {
            incoming.slug = slugify(incoming.name);
          }
          if (classification.fields.includes('description') && canvasEmpty) {
            incoming.description = descriptionFromIntent(intent);
          }
        }

        if (classification.fields.includes('tools')) {
          try {
            const [suggestion, catalog] = await Promise.all([
              suggestTools({
                systemPrompt: incoming.systemPrompt || createForm.form.systemPrompt || undefined,
                description: intent,
              }),
              getAvailableTools().catch(() => null),
            ]);
            incoming.tools = toolboxFromSuggestion(createForm.form.tools, suggestion, catalog);
          } catch {
            // Prompt still applies if tool suggest fails.
          }
        }

        const patch = pickPatch(incoming, classification.fields);
        setSkeletonIdentity(false);
        const sourceId = `hub-${Date.now()}`;
        const reveal = FIELD_ORDER.filter(field => classification.fields.includes(field));
        for (const field of reveal) {
          const slice = slicePatch(patch, field);
          if (Object.keys(slice).length === 0) continue;
          const changed = createForm.applyChatPatch(`${sourceId}-${field}`, slice, {
            highlight: false,
          });
          if (!changed.includes(field)) {
            continue;
          }
          createForm.setWritingField(field);
          await sleep(WRITE_MS);
        }
        createForm.setWritingField(null);
        setPhase('draft');
        if (renameTo) {
          return `Renamed to ${renameTo}. The rest of the canvas is unchanged.`;
        }
        if (classification.fields.length === 1 && classification.fields[0] === 'systemPrompt') {
          return 'Updated instructions. Everything else is unchanged.';
        }
        if (classification.askAfter) {
          afterDraftRef.current = intent;
          return draftThenAskReply(detectIntakeGaps(intent));
        }
        return 'Filled the canvas. Edit anything, then Create Agent.';
      } catch (err) {
        createForm.clearHighlights();
        setSkeletonIdentity(false);
        setPhase(canvasIsEmpty(createForm.form) ? 'empty' : 'draft');
        throw err;
      } finally {
        setSending(false);
      }
    },
    [createForm],
  );

  const persist = useCallback(async (): Promise<void> => {
    if (!canCreate || creating) return;
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
  }, [canCreate, createForm.form, creating, queryClient, slug, user?.id]);

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
    intakeRef.current = null;
    afterDraftRef.current = null;
  }, [canvasDirty, resetFrom]);

  const footer = useMemo(
    () => (
      <AgentCreateFooter
        phase={phase === 'created' ? 'created' : 'pending'}
        canCreate={canCreate}
        creating={creating}
        discarding={false}
        onCreate={() => void persist()}
        onDiscard={requestDiscard}
        {...(createdSlug ? { createdSlug } : {})}
        createError={createError}
      />
    ),
    [canCreate, createError, createdSlug, creating, persist, phase, requestDiscard],
  );

  const canvas = (
    <AgentCreateCanvas
      form={createForm.form}
      onFormChange={patch => {
        createForm.patchForm(patch);
        if (phase === 'empty') setPhase('draft');
        intakeRef.current = null;
      }}
      onFieldFocus={createForm.onFieldFocus}
      highlights={createForm.highlights}
      conflicts={createForm.conflicts}
      onResolveConflict={createForm.resolveConflict}
      skeletonIdentity={skeletonIdentity}
      writingField={createForm.writingField}
      phase={phase === 'created' ? 'created' : phase === 'empty' ? 'empty' : 'draft'}
      builtBy={builtBy}
      handleError={handleError}
      checkingHandle={nameCheck.checking}
      footer={footer}
      readOnly={phase === 'created'}
    />
  );

  return (
    <div className='flex h-full min-h-0 w-full' data-component='AgentCreateSplitPage'>
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
              sending={sending}
              onSend={onSend}
              disabled={phase === 'created'}
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
          intakeRef.current = null;
          afterDraftRef.current = null;
        }}
      />
    </div>
  );
}
