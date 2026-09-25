import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ai01, AtMark, PencilEditLine } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
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
import { CallableAgentCapabilityRow } from '../../shared/pickers/callableAgent/CallableAgentCapabilityRow';

function inlineWidth(value: string, placeholder: string): string {
  return `${Math.max(value.length, placeholder.length) - 2}ch`;
}

interface DraftErrors {
  name?: string;
  slug?: string;
  systemPrompt?: string;
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showErrors, setShowErrors] = useState(false);

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

  const intent = state.systemPrompt.trim();
  const canImprove = intent.length > 0 && !generate.isPending;

  const runGenerate = (): void => {
    if (!canImprove) return;
    generate.mutate({ intent, agentName: state.name });
  };

  const errors = useMemo<DraftErrors>(() => {
    const next: DraftErrors = {};
    if (!state.name.trim()) next.name = 'Give your agent a name.';
    else if (nameCheck.nameError) next.name = nameCheck.nameError;
    if (!slug) next.slug = 'Add a handle so people can @mention this agent.';
    else if (nameCheck.slugError) next.slug = nameCheck.slugError;
    if (!state.systemPrompt.trim()) {
      next.systemPrompt = 'Add instructions so the agent knows what it should do.';
    }
    return next;
  }, [state.name, state.systemPrompt, slug, nameCheck.nameError, nameCheck.slugError]);

  const visibleErrors: DraftErrors = showErrors
    ? errors
    : {
        ...(nameCheck.nameError ? { name: nameCheck.nameError } : {}),
        ...(nameCheck.slugError ? { slug: nameCheck.slugError } : {}),
      };

  const handleSubmit = (): void => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setShowErrors(false);
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

  return (
    <div
      ref={scrollRef}
      className='h-full overflow-y-auto no-scrollbar'
      data-component='ClawAgentCreateV2'
    >
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
                  aria-invalid={visibleErrors.name !== undefined}
                  aria-describedby={visibleErrors.name ? 'agent-v2-name-error' : undefined}
                  autoFocus
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: name'
                  className='text-base font-medium leading-6 tracking-[-0.1px] text-foreground placeholder:font-medium placeholder:text-muted-foreground/60'
                />
                <PencilEditLine className='size-3 shrink-0 text-muted-foreground' aria-hidden />
              </div>

              {visibleErrors.name && (
                <p id='agent-v2-name-error' className='text-xs text-destructive'>
                  {visibleErrors.name}
                </p>
              )}

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
                    aria-invalid={visibleErrors.slug !== undefined}
                    aria-describedby={visibleErrors.slug ? 'agent-v2-slug-error' : undefined}
                    style={{ width: inlineWidth(slug, 'Agent handle') }}
                    className='text-sm font-medium leading-5 tracking-[-0.14px] text-foreground placeholder:font-medium placeholder:text-muted-foreground/60'
                  />
                </div>
                {nameCheck.checking && state.name.trim().length > 0 && (
                  <Loader2 className='size-3.5 animate-spin text-muted-foreground' aria-hidden />
                )}
              </div>

              {visibleErrors.slug && (
                <p id='agent-v2-slug-error' className='text-xs text-destructive'>
                  {visibleErrors.slug}
                </p>
              )}

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
                Instructions
              </label>

              <div className='w-full overflow-hidden rounded-2xl border border-border bg-card'>
                <textarea
                  id='agent-v2-prompt'
                  value={state.systemPrompt}
                  onChange={e => update({ systemPrompt: e.target.value })}
                  placeholder='Ai drafted instructions will be updated here...'
                  aria-invalid={visibleErrors.systemPrompt !== undefined}
                  aria-describedby={
                    visibleErrors.systemPrompt ? 'agent-v2-prompt-error' : undefined
                  }
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: prompt'
                  className='h-[250px] w-full resize-none bg-transparent p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none'
                />

                <div className='flex items-center justify-end bg-muted/60 p-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={runGenerate}
                    disabled={!canImprove}
                    loading={generate.isPending}
                    className='rounded-lg border-border bg-card text-foreground hover:bg-muted'
                    data-track-category='Claw Agents'
                    data-track-name='Create agent v2: improve prompt'
                  >
                    {!generate.isPending && <Ai01 className='size-4' aria-hidden />}
                    Improve with AI
                  </Button>
                </div>
              </div>

              {visibleErrors.systemPrompt && (
                <p id='agent-v2-prompt-error' className='text-xs text-destructive'>
                  {visibleErrors.systemPrompt}
                </p>
              )}
            </div>

            <McpCapabilityRow
              selection={state.tools}
              onSelectionChange={tools =>
                update({ tools: { ...tools, callableAgents: state.tools.callableAgents } })
              }
              suggestContext={{
                systemPrompt: state.systemPrompt,
                description: state.description,
              }}
            />

            {/* Delegation is a live grant against an existing agent, so this row
                only appears once the agent exists (edit, not create). */}
            {agent && (
              <CallableAgentCapabilityRow
                agentSlug={agent.slug}
                agentOwnerUserId={agent.ownerUserId}
                selected={state.tools.callableAgents}
                onSelectedChange={callableAgents =>
                  update({ tools: { ...state.tools, callableAgents } })
                }
              />
            )}

            <SubagentCapabilityRow
              selection={state.tools}
              onSelectionChange={tools =>
                update({ tools: { ...tools, callableAgents: state.tools.callableAgents } })
              }
              suggestContext={{
                systemPrompt: state.systemPrompt,
                description: state.description,
              }}
            />

            <BuiltinCapabilityRow
              selection={state.tools}
              onSelectionChange={tools =>
                update({ tools: { ...tools, callableAgents: state.tools.callableAgents } })
              }
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
