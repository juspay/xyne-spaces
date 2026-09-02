import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Ai01,
  ArrowUp,
  AtMark,
  MaximizeTwoArrow,
  MinimizeTwoArrow,
  PencilEditLine,
} from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button/index';
import { ComposerVoiceButton } from '@/components/AIScreen/ComposerVoiceButton';
import { useAuth } from '@/hooks/useAuth';
import { useAgentNameCheck } from '@/hooks/useAgentNameCheck';
import { useCreateClawAgent } from '@/hooks/useCreateClawAgent';
import { generateAgentPrompt } from '@/services/claw/clawAgentWizardService';
import {
  INITIAL_WIZARD_STATE,
  effectiveSlug,
  slugify,
  type WizardState,
} from '../../../../ClawAgentsScreen/create/wizardState';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { wizardStateFromAgent } from './agentDraft';
import { useSaveClawAgent } from './useSaveClawAgent';
import { AgentColorRow } from './AgentColorRow';
import { AutoWidthInput } from '../../shared/primitives/AutoWidthInput';
import { BuiltinCapabilityRow } from '../../shared/pickers/builtin/BuiltinCapabilityRow';
import { KnowledgeCapabilityRow } from '../../shared/pickers/knowledge/KnowledgeCapabilityRow';
import { McpCapabilityRow } from '../../shared/pickers/mcp/McpCapabilityRow';
import { SkillsCapabilityRow } from '../../shared/pickers/skill/SkillsCapabilityRow';
import { SubagentCapabilityRow } from '../../shared/pickers/subagent/SubagentCapabilityRow';

function inlineWidth(value: string, placeholder: string): string {
  return `${Math.max(value.length, placeholder.length) - 2}ch`;
}

interface ClawAgentCreateV2Props {
  agent?: Agent;
}

const ClawAgentCreateV2 = ({ agent }: ClawAgentCreateV2Props = {}): ReactElement => {
  const isEdit = agent !== undefined;
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';

  const { user } = useAuth();
  const builtBy = agent?.owner?.name ?? agent?.owner?.email ?? user?.name ?? user?.email ?? 'you';

  const [aiOpen, setAiOpen] = useState(false);
  const aiIntentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aiOpen) aiIntentRef.current?.focus();
  }, [aiOpen]);

  const [state, setState] = useState<WizardState>(() =>
    agent ? wizardStateFromAgent(agent) : INITIAL_WIZARD_STATE,
  );
  const update = useCallback(
    (patch: Partial<WizardState>) => setState(prev => ({ ...prev, ...patch })),
    [],
  );

  const slug = effectiveSlug(state);
  const nameCheck = useAgentNameCheck(isEdit ? '' : state.name.trim(), slug);
  const createMutation = useCreateClawAgent();
  const saveMutation = useSaveClawAgent(agent);

  const generate = useMutation({
    mutationFn: generateAgentPrompt,
    onSuccess: prompt => {
      if (prompt) update({ systemPrompt: prompt });
    },
    onError: (err: Error) =>
      toast.error('Could not generate a prompt', { description: err.message }),
  });

  const appendIntent = useCallback((text: string): void => {
    setState(prev => ({ ...prev, aiIntent: `${prev.aiIntent} ${text}`.trim() }));
  }, []);

  const runGenerate = (): void => {
    const intent = state.aiIntent.trim();
    if (!intent || generate.isPending) return;
    generate.mutate({ intent, agentName: state.name });
  };

  const canSubmit =
    state.name.trim().length > 0 &&
    slug.length > 0 &&
    (isEdit || (nameCheck.nameValid && !nameCheck.checking)) &&
    state.systemPrompt.trim().length > 0;

  const handleSubmit = (): void => {
    if (isEdit) {
      void saveMutation.save(state);
      return;
    }
    createMutation.mutate({
      slug,
      name: state.name.trim(),
      description: state.description.trim(),
      systemPrompt: state.systemPrompt.trim(),
      color: state.color,
      kbScope: state.selectedKbScope,
      knowledgeBase: state.selectedKbResources,
      tools: state.tools,
      skillIds: state.selectedSkillIds,
      research: {
        productId: state.researchAgentProductId,
        repositoryId: state.researchAgentRepositoryId,
      },
    });
  };

  const fieldError = nameCheck.nameError ?? nameCheck.slugError;

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawAgentCreateV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 py-6'>
        <h1 className='text-2xl font-semibold leading-[1.2] tracking-[-0.24px] text-foreground'>
          {isEdit ? 'Edit agent' : 'Create agent'}
        </h1>

        <div className='flex w-full flex-col gap-4'>
          <div className='flex w-full items-start gap-4 py-4'>
            <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
              <div className='flex w-full items-center gap-2'>
                <AutoWidthInput
                  value={state.name}
                  onChange={next =>
                    update({
                      name: next,
                      ...(state.slugManual ? {} : { slug: slugify(next) }),
                    })
                  }
                  placeholder='Name your agent'
                  aria-label='Agent name'
                  autoFocus
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: name'
                  className='text-base font-medium leading-6 tracking-[-0.1px] text-foreground placeholder:font-medium placeholder:text-muted-foreground'
                />
                <PencilEditLine className='size-3 shrink-0 text-muted-foreground' aria-hidden />
              </div>

              <div className='flex items-center gap-1.5'>
                <div className='flex items-center gap-0.5 rounded-[10px] bg-muted py-0.5 pl-0.5 pr-1'>
                  <AtMark className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                  <AutoWidthInput
                    value={slug}
                    onChange={raw => {
                      const next = slugify(raw);
                      update({ slugManual: next.length > 0, slug: next });
                    }}
                    placeholder='Agent handle'
                    aria-label='Agent handle'
                    style={{ width: inlineWidth(slug, 'Agent handle') }}
                    className='text-sm font-medium leading-5 tracking-[-0.14px] text-foreground placeholder:font-medium placeholder:text-muted-foreground'
                  />
                </div>
                {nameCheck.checking && state.name.trim().length > 0 && (
                  <Loader2 className='size-3.5 animate-spin text-muted-foreground' aria-hidden />
                )}
              </div>

              {fieldError && <p className='text-xs text-destructive'>{fieldError}</p>}

              <p className='flex items-center gap-1.5 text-sm leading-[1.5] text-foreground'>
                Built by
                <span className='text-[color:var(--mention-color)]'>@{builtBy}</span>
              </p>
            </div>
          </div>

          <div className='flex w-full flex-col gap-8'>
            <div className='flex w-full flex-col gap-3'>
              <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
                Color
              </span>
              <AgentColorRow color={state.color} onChange={color => update({ color })} />
            </div>

            <div className='flex w-full flex-col gap-3'>
              <label
                htmlFor='agent-v2-description'
                className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'
              >
                Description
              </label>
              <textarea
                id='agent-v2-description'
                value={state.description}
                onChange={e => update({ description: e.target.value })}
                placeholder='Add a description so people and agents understand when to use it.'
                data-track-category='Claw Agents'
                data-track-name='Create agent v2: description'
                className='h-[86px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>

            <div className='flex w-full flex-col gap-3'>
              <label
                htmlFor='agent-v2-prompt'
                className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'
              >
                What it does
              </label>

              <div className='w-full overflow-hidden rounded-2xl border border-border bg-card'>
                <textarea
                  id='agent-v2-prompt'
                  value={state.systemPrompt}
                  onChange={e => update({ systemPrompt: e.target.value })}
                  placeholder='Ai drafted instructions will be updated here...'
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: prompt'
                  className='h-[250px] w-full resize-none bg-transparent p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none'
                />

                <div className='flex flex-col gap-2 bg-muted/60 p-1'>
                  {aiOpen && (
                    <div
                      id='agent-v2-ai-intent'
                      className='flex items-center gap-1 rounded-2xl border-[0.8px] border-border bg-background p-1'
                    >
                      <input
                        ref={aiIntentRef}
                        value={state.aiIntent}
                        onChange={e => update({ aiIntent: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter') runGenerate();
                        }}
                        placeholder='Describe what this agent should do…'
                        aria-label='Describe what this agent should do'
                        data-track-category='Claw Agents'
                        data-track-name='Create agent v2: AI intent'
                        className='min-w-0 flex-1 bg-transparent p-2 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none'
                      />
                      <ComposerVoiceButton
                        onTranscript={appendIntent}
                        disabled={generate.isPending}
                        className='size-9 shrink-0 rounded-xl'
                      />
                      <button
                        type='button'
                        onClick={runGenerate}
                        disabled={generate.isPending || !state.aiIntent.trim()}
                        aria-label='Generate with AI'
                        data-track-category='Claw Agents'
                        data-track-name='Create agent v2: generate prompt'
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity',
                          (generate.isPending || !state.aiIntent.trim()) &&
                            'cursor-not-allowed opacity-40',
                        )}
                      >
                        {generate.isPending ? (
                          <Loader2 className='size-4 animate-spin' aria-hidden />
                        ) : (
                          <ArrowUp className='size-4' aria-hidden />
                        )}
                      </button>
                    </div>
                  )}

                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-1.5 p-2'>
                      <Ai01 className='size-4 text-foreground' aria-hidden />
                      <span className='text-sm leading-5 text-foreground'>Generate with AI</span>
                    </div>
                    <button
                      type='button'
                      onClick={() => setAiOpen(open => !open)}
                      aria-expanded={aiOpen}
                      aria-controls='agent-v2-ai-intent'
                      aria-label={aiOpen ? 'Hide AI prompt' : 'Write a prompt for AI'}
                      title={aiOpen ? 'Hide AI prompt' : 'Write a prompt for AI'}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent v2: toggle AI prompt'
                      className='flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                    >
                      {aiOpen ? (
                        <MinimizeTwoArrow className='size-4' aria-hidden />
                      ) : (
                        <MaximizeTwoArrow className='size-4' aria-hidden />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <McpCapabilityRow
              selection={state.tools}
              onSelectionChange={tools => update({ tools })}
              suggestContext={{
                systemPrompt: state.systemPrompt,
                description: state.description,
              }}
            />

            <SubagentCapabilityRow
              selection={state.tools}
              onSelectionChange={tools => update({ tools })}
              suggestContext={{
                systemPrompt: state.systemPrompt,
                description: state.description,
              }}
            />

            <BuiltinCapabilityRow
              selection={state.tools}
              onSelectionChange={tools => update({ tools })}
              suggestContext={{
                systemPrompt: state.systemPrompt,
                description: state.description,
              }}
            />

            <SkillsCapabilityRow
              selectedIds={state.selectedSkillIds}
              onChange={selectedSkillIds => update({ selectedSkillIds })}
            />

            <KnowledgeCapabilityRow
              scope={state.selectedKbScope}
              onScopeChange={selectedKbScope => update({ selectedKbScope })}
              grants={state.selectedKbResources}
              onGrantsChange={selectedKbResources => update({ selectedKbResources })}
            />
          </div>
        </div>

        {createMutation.error && (
          <p className='text-sm text-destructive'>{createMutation.error.message}</p>
        )}

        <div className='flex w-full items-center justify-end gap-3'>
          <Button
            variant='ghost'
            onClick={() =>
              void navigate(isEdit ? `${libraryPath}/agent/${agent.slug}?tab=persona` : libraryPath)
            }
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name='Create agent v2: cancel'
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={isEdit ? saveMutation.saving : createMutation.isPending}
            disabled={!canSubmit}
            className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
            data-track-category='Claw Agents'
            data-track-name={`Create agent v2: ${isEdit ? 'save' : 'create'}`}
          >
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ClawAgentCreateV2;
