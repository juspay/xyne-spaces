import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/utils/classNames';
import { AtMark, PencilEditLine } from '@xyne/icons';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
import { useAuth } from '@/hooks/useAuth';
import { useAgentNameCheck } from '@/hooks/useAgentNameCheck';
import { useCreateClawAgent } from '@/hooks/useCreateClawAgent';
import {
  COLORS,
  INITIAL_WIZARD_STATE,
  effectiveSlug,
  slugify,
  type WizardState,
} from '../../../../ClawAgentsScreen/create/wizardState';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { wizardStateFromAgent } from './agentDraft';
import { useSaveClawAgent } from './useSaveClawAgent';
import { AgentColorRow } from './AgentColorRow';
import { LibraryIconTile } from '../../shared/components/LibraryCard';
import { AutoWidthInput } from '../../shared/primitives/AutoWidthInput';
import { BuiltinCapabilityRow } from '../../shared/pickers/builtin/BuiltinCapabilityRow';
import { KnowledgeCapabilityRow } from '../../shared/pickers/knowledge/KnowledgeCapabilityRow';
import { McpCapabilityRow } from '../../shared/pickers/mcp/McpCapabilityRow';
import { SkillsCapabilityRow } from '../../shared/pickers/skill/SkillsCapabilityRow';
import { SubagentCapabilityRow } from '../../shared/pickers/subagent/SubagentCapabilityRow';
import { CallableAgentCapabilityRow } from '../../shared/pickers/callableAgent/CallableAgentCapabilityRow';

const PROMPT_MIN_HEIGHT = 72;
const PROMPT_MAX_HEIGHT = 420;
const PROMPT_FLASH_MS = 1400;

interface DraftErrors {
  name?: string;
  slug?: string;
  systemPrompt?: string;
}

interface ClawAgentCreateV2Props {
  agent?: Agent;
  draft?: WizardState;
  onDraftChange?: (patch: Partial<WizardState>) => void;
  busy?: boolean;
  dirty?: boolean;
  instructionsPatchNonce?: number;
}

const ClawAgentCreateV2 = ({
  agent,
  draft,
  onDraftChange,
  busy = false,
  dirty = false,
  instructionsPatchNonce = 0,
}: ClawAgentCreateV2Props = {}): ReactElement => {
  const isEdit = agent !== undefined;
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';

  const { user } = useAuth();
  const builtBy = agent?.owner?.name ?? agent?.owner?.email ?? user?.name ?? user?.email ?? 'you';

  const scrollRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [showErrors, setShowErrors] = useState(false);

  const [internalState, setInternalState] = useState<WizardState>(() =>
    agent ? wizardStateFromAgent(agent) : INITIAL_WIZARD_STATE,
  );
  const state = draft ?? internalState;
  const update = useCallback(
    (patch: Partial<WizardState>) => {
      if (onDraftChange) onDraftChange(patch);
      else setInternalState(prev => ({ ...prev, ...patch }));
    },
    [onDraftChange],
  );

  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, PROMPT_MIN_HEIGHT), PROMPT_MAX_HEIGHT)}px`;
  }, [state.systemPrompt]);

  const [promptFlash, setPromptFlash] = useState(false);
  const seenPatchNonce = useRef(instructionsPatchNonce);
  useEffect(() => {
    if (instructionsPatchNonce === seenPatchNonce.current) return;
    seenPatchNonce.current = instructionsPatchNonce;
    setPromptFlash(true);
    const timer = window.setTimeout(() => setPromptFlash(false), PROMPT_FLASH_MS);
    return (): void => window.clearTimeout(timer);
  }, [instructionsPatchNonce]);

  const leavePath = isEdit ? `${libraryPath}/agent/${agent.slug}?tab=persona` : libraryPath;

  const cycleColor = (): void => {
    const index = (COLORS as readonly string[]).indexOf(state.color);
    update({ color: COLORS[(index + 1) % COLORS.length] ?? COLORS[0] });
  };

  const slug = effectiveSlug(state);
  const nameCheck = useAgentNameCheck(isEdit ? '' : state.name.trim(), slug);
  const createMutation = useCreateClawAgent();
  const saveMutation = useSaveClawAgent(agent);

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
    <div className='flex h-full min-h-0 flex-col' data-component='ClawAgentCreateV2'>
      <div ref={scrollRef} className='min-h-0 flex-1 overflow-y-auto no-scrollbar'>
        <div className='mx-auto flex w-full max-w-[720px] flex-col px-6'>
          <div className='sticky top-0 z-10 flex flex-col gap-6 bg-background pb-8 pt-6'>
            <button
              type='button'
              onClick={() => void navigate(leavePath)}
              data-track-category='Claw Agents'
              data-track-name='Create agent v2: back'
              className='-ml-1.5 flex w-fit items-center gap-1 rounded-lg px-1.5 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            >
              <ChevronLeft className='size-4' aria-hidden />
              Back
            </button>

            <div className='flex w-full items-start gap-4'>
              <button
                type='button'
                onClick={cycleColor}
                aria-label='Change agent colour'
                title='Change agent colour'
                data-track-category='Claw Agents'
                data-track-name='Create agent v2: cycle colour'
                className='shrink-0 rounded-xl transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              >
                <LibraryIconTile
                  name={state.name || 'Agent'}
                  color={state.color || '#6366f1'}
                  size='lg'
                />
              </button>

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
                    ref={nameRef}
                    data-track-category='Claw Agents'
                    data-track-name='Create agent v2: name'
                    className='text-base font-medium leading-6 tracking-[-0.1px] text-foreground placeholder:font-medium placeholder:text-muted-foreground/60'
                  />
                  <button
                    type='button'
                    onClick={() => {
                      const el = nameRef.current;
                      if (!el) return;
                      el.focus();
                      el.setSelectionRange(el.value.length, el.value.length);
                    }}
                    aria-label='Rename agent'
                    title='Rename agent'
                    data-track-category='Claw Agents'
                    data-track-name='Create agent v2: rename'
                    className='flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  >
                    <PencilEditLine className='size-3' aria-hidden />
                  </button>
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
                      className='text-sm font-normal leading-5 tracking-[-0.14px] text-foreground placeholder:font-medium placeholder:text-muted-foreground/60'
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

                {isEdit && (
                  <p className='flex items-center gap-1.5 text-sm leading-[1.5] text-foreground'>
                    Built by
                    <span className='text-[color:var(--mention-color)]'>@{builtBy}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className='flex w-full flex-col gap-7 pb-6'>
            {isEdit && (
              <div className='flex w-full flex-col gap-3'>
                <span className='text-sm font-semibold leading-[1.2] tracking-[-0.1px] text-foreground'>
                  Color
                </span>
                <AgentColorRow color={state.color} onChange={color => update({ color })} />
              </div>
            )}

            <div className='mb-3 flex w-full flex-col gap-1.5'>
              <label
                htmlFor='agent-v2-prompt'
                className='text-sm font-semibold leading-[1.2] tracking-[-0.1px] text-foreground'
              >
                Instructions
              </label>

              <div
                className={cn(
                  'w-full overflow-hidden rounded-2xl border bg-card transition-colors duration-500',
                  promptFlash
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-border focus-within:border-ring',
                )}
              >
                <textarea
                  id='agent-v2-prompt'
                  ref={promptRef}
                  rows={1}
                  value={state.systemPrompt}
                  onChange={e => update({ systemPrompt: e.target.value })}
                  placeholder='Ai drafted instructions will be updated here...'
                  aria-invalid={visibleErrors.systemPrompt !== undefined}
                  aria-describedby={
                    visibleErrors.systemPrompt ? 'agent-v2-prompt-error' : undefined
                  }
                  style={{ minHeight: PROMPT_MIN_HEIGHT, maxHeight: PROMPT_MAX_HEIGHT }}
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: prompt'
                  className='block w-full resize-none overflow-y-auto bg-transparent px-4 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none'
                />
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
              showSuggestions={isEdit}
            />

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
              showSuggestions={isEdit}
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
              showSuggestions={isEdit}
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

            {createMutation.error && (
              <p className='text-sm text-destructive'>{createMutation.error.message}</p>
            )}

            <div className='mt-5 flex w-full items-center justify-end gap-3'>
              {!busy && dirty && (
                <span className='mr-auto text-xs leading-5 text-muted-foreground'>
                  Unsaved changes
                </span>
              )}

              <Button
                onClick={handleSubmit}
                disabled={busy || Object.keys(errors).length > 0}
                loading={isEdit ? saveMutation.saving : createMutation.isPending}
                className='rounded-xl'
                data-track-category='Claw Agents'
                data-track-name={`Create agent v2: ${isEdit ? 'save' : 'create'}`}
              >
                {isEdit ? 'Save' : 'Save agent'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClawAgentCreateV2;
