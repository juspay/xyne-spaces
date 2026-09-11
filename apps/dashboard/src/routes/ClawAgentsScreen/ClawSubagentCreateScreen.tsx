import { ReactElement, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/classNames';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Skeleton } from '@/components/ui/Skeleton';
import { StepIndicator } from './create/StepIndicator';
import { ToolboxPicker } from '@/components/ClawAgents/ToolboxPicker/ToolboxPicker';
import { useClawSubagents, useCreateClawSubagent } from '@/hooks/useClawSubagents';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { useClawResearchAgentOptions } from '@/hooks/useClawResearchAgentOptions';
import { useClawSkills } from '@/hooks/useClawSkills';
import { clawErrorText } from '@/services/claw/clawRequest';
import { fromToolboxSelection } from '@/services/claw/subagentToolsBridge';
import type { ToolboxSelection } from '@/services/claw/clawToolsTypes';

const STEPS = ['Identity', 'Persona', 'Tools', 'Knowledge', 'Review'] as const;
const LAST_STEP = STEPS.length - 1;

const STEP_SUBTITLES: readonly string[] = [
  'Name your subagent and describe when agents should call it.',
  'Write the system prompt that defines how this specialist behaves.',
  'Pick the tools this specialist can use.',
  'Attach skills and set the progress labels shown while it works.',
  'Take a last look before creating.',
];

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface CreateState {
  step: number;
  name: string;
  description: string;
  paramName: string;
  paramDescription: string;
  systemPrompt: string;
  tools: Required<ToolboxSelection>;
  researchAgentProductId: string;
  researchAgentRepositoryId: string;
  progressLabels: string[];
  skillIds: string[];
}

const INITIAL_STATE: CreateState = {
  step: 0,
  name: '',
  description: '',
  paramName: 'question',
  paramDescription: '',
  systemPrompt: '',
  tools: { subagents: [], direct: [], custom: [], gateway: [] },
  researchAgentProductId: '',
  researchAgentRepositoryId: '',
  progressLabels: ['Working…'],
  skillIds: [],
};

const FieldLabel = ({ children }: { children: React.ReactNode }): ReactElement => (
  <span className='text-sm font-medium text-foreground'>{children}</span>
);

const ClawSubagentCreateScreen = (): ReactElement => {
  const navigate = useNavigate();
  const create = useCreateClawSubagent();
  const { data: subagents = [] } = useClawSubagents();
  const { data: catalog, isLoading: toolsLoading } = useClawAvailableTools();
  const research = useClawResearchAgentOptions();
  const { data: skills = [], isLoading: skillsLoading } = useClawSkills();

  const [state, setState] = useState<CreateState>(INITIAL_STATE);
  const update = useCallback(
    (patch: Partial<CreateState>) => setState(prev => ({ ...prev, ...patch })),
    [],
  );
  const { step } = state;

  const existingNames = useMemo(() => new Set(subagents.map(s => s.name)), [subagents]);
  const trimmedName = state.name.trim();
  const nameError = useMemo(() => {
    if (!trimmedName) return null;
    if (!NAME_RE.test(trimmedName)) return 'Use lowercase letters, numbers, and hyphens.';
    if (existingNames.has(trimmedName)) return 'That name is already in use.';
    return null;
  }, [existingNames, trimmedName]);

  const toolCount =
    state.tools.subagents.length +
    state.tools.direct.length +
    state.tools.custom.length +
    state.tools.gateway.length;

  const toggleSkill = (id: string): void => {
    update({
      skillIds: state.skillIds.includes(id)
        ? state.skillIds.filter(skillId => skillId !== id)
        : [...state.skillIds, id],
    });
  };

  const canNext =
    step === 0
      ? Boolean(trimmedName && !nameError)
      : step === 1
        ? state.systemPrompt.trim().length > 0
        : true;

  const cancel = (): void => void navigate('/claw-agents/subagents');
  const goBack = (): void => update({ step: step - 1 });
  const goNext = (): void => update({ step: step + 1 });

  const handleCreate = async (): Promise<void> => {
    if (!canNext || create.isPending) return;
    try {
      const created = await create.mutateAsync({
        name: trimmedName,
        description: state.description.trim(),
        systemPrompt: state.systemPrompt.trim(),
        paramName: state.paramName.trim() || 'question',
        paramDescription: state.paramDescription.trim(),
        progressLabels: state.progressLabels.map(label => label.trim()).filter(Boolean),
        tools: fromToolboxSelection(state.tools, catalog ?? null),
        ...(state.skillIds.length ? { skillIds: state.skillIds } : {}),
      });
      toast.success(`${created.name} created`);
      void navigate(`/claw-agents/subagents/${encodeURIComponent(created.name)}`);
    } catch (error) {
      toast.error(clawErrorText(error, 'Failed to create subagent'));
    }
  };

  // The Tools step is a full-width marketplace; every other step stays narrow.
  const widthClass = step === 2 ? 'max-w-7xl' : 'max-w-[960px]';

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className={cn('mx-auto flex w-full shrink-0 flex-col gap-1 px-6 pt-6', widthClass)}>
        <h1 className='text-2xl font-medium tracking-tight text-foreground'>Create subagent</h1>
        <p className='text-sm text-muted-foreground'>{STEP_SUBTITLES[step]}</p>
      </div>

      <div className={cn('mx-auto w-full shrink-0 px-6 pt-4', widthClass)}>
        <StepIndicator steps={STEPS} current={step} />
      </div>

      <div
        key={step}
        className={cn(
          'step-enter mx-auto w-full min-h-0 flex-1 overflow-y-auto px-6 py-6',
          widthClass,
        )}
      >
        {/* Step 0 — Identity */}
        {step === 0 && (
          <div className='flex flex-col gap-5'>
            <label htmlFor='sa-name' className='flex flex-col gap-1.5'>
              <FieldLabel>Name</FieldLabel>
              <div className='relative'>
                <Input
                  id='sa-name'
                  autoFocus
                  value={state.name}
                  onChange={e =>
                    update({
                      name: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, '-')
                        .replace(/--+/g, '-'),
                    })
                  }
                  placeholder='deploy-checker'
                  aria-invalid={Boolean(nameError)}
                />
                {nameError && (
                  <AlertCircle className='absolute right-3 top-1/2 size-4 -translate-y-1/2 text-destructive' />
                )}
              </div>
              <span
                className={cn('text-xs text-muted-foreground', nameError && 'text-destructive')}
              >
                {nameError ?? 'Permanent kebab-case identifier.'}
              </span>
            </label>

            <label htmlFor='sa-description' className='flex flex-col gap-1.5'>
              <FieldLabel>Description</FieldLabel>
              <Input
                id='sa-description'
                value={state.description}
                onChange={e => update({ description: e.target.value })}
                placeholder='What this specialist does and when it should be called'
              />
            </label>

            <div className='grid gap-4 sm:grid-cols-3'>
              <label htmlFor='sa-param-name' className='flex flex-col gap-1.5'>
                <FieldLabel>Parameter name</FieldLabel>
                <Input
                  id='sa-param-name'
                  value={state.paramName}
                  onChange={e => update({ paramName: e.target.value })}
                  placeholder='question'
                />
              </label>
              <label htmlFor='sa-param-desc' className='flex flex-col gap-1.5 sm:col-span-2'>
                <FieldLabel>Parameter description</FieldLabel>
                <Input
                  id='sa-param-desc'
                  value={state.paramDescription}
                  onChange={e => update({ paramDescription: e.target.value })}
                  placeholder='What the parent agent passes in'
                />
              </label>
            </div>
          </div>
        )}

        {/* Step 1 — Persona */}
        {step === 1 && (
          <label htmlFor='sa-prompt' className='flex flex-col gap-1.5'>
            <div className='flex items-center justify-between'>
              <FieldLabel>System prompt</FieldLabel>
              <span className='text-xs text-muted-foreground'>
                {state.systemPrompt.length} characters
              </span>
            </div>
            <Textarea
              id='sa-prompt'
              autoFocus
              value={state.systemPrompt}
              onChange={e => update({ systemPrompt: e.target.value })}
              placeholder='You are a focused specialist that…'
              className='min-h-80 font-mono text-xs leading-relaxed'
            />
          </label>
        )}

        {/* Step 2 — Tools */}
        {step === 2 && (
          <ToolboxPicker
            variant='large'
            largeHeight='clamp(420px, calc(100vh - 340px), 720px)'
            availableTools={catalog ?? null}
            loading={toolsLoading}
            value={state.tools}
            onChange={(next: ToolboxSelection) =>
              update({
                tools: {
                  subagents: next.subagents,
                  direct: next.direct,
                  custom: next.custom,
                  gateway: next.gateway ?? [],
                },
              })
            }
            autoSuggest
            suggestContext={{
              systemPrompt: state.systemPrompt,
              description: state.description,
            }}
            researchAgent={{
              productId: state.researchAgentProductId,
              onProductIdChange: v => update({ researchAgentProductId: v }),
              products: research.products,
              repositoryId: state.researchAgentRepositoryId,
              onRepositoryIdChange: v => update({ researchAgentRepositoryId: v }),
              repositories: research.repositories,
              loading: research.isLoading,
            }}
            hideSubagents
          />
        )}

        {/* Step 3 — Knowledge */}
        {step === 3 && (
          <div className='flex flex-col gap-7'>
            <section className='flex flex-col gap-2'>
              <div className='flex items-center justify-between'>
                <FieldLabel>Progress labels</FieldLabel>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={state.progressLabels.length >= 8}
                  onClick={() => update({ progressLabels: [...state.progressLabels, ''] })}
                  data-track-category='Claw Agents'
                  data-track-name='ADD_PROGRESS_LABEL'
                >
                  <Plus className='size-3.5' /> Add label
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>
                Short statuses shown while the subagent works.
              </p>
              {state.progressLabels.map((label, index) => (
                <div key={index} className='flex gap-2'>
                  <Input
                    value={label}
                    onChange={e =>
                      update({
                        progressLabels: state.progressLabels.map((item, i) =>
                          i === index ? e.target.value : item,
                        ),
                      })
                    }
                    placeholder='Working…'
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    disabled={state.progressLabels.length === 1}
                    onClick={() =>
                      update({
                        progressLabels: state.progressLabels.filter((_, i) => i !== index),
                      })
                    }
                    data-track-category='Claw Agents'
                    data-track-name='REMOVE_PROGRESS_LABEL'
                    aria-label='Remove progress label'
                  >
                    <X className='size-4' />
                  </Button>
                </div>
              ))}
            </section>

            <section className='flex flex-col gap-3'>
              <div>
                <h2 className='text-sm font-semibold text-foreground'>Skills</h2>
                <p className='text-xs text-muted-foreground'>
                  Markdown playbooks available to this subagent.
                </p>
              </div>
              {skillsLoading ? (
                <Skeleton className='h-20 w-full' />
              ) : skills.length === 0 ? (
                <p className='rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground'>
                  No skills available.
                </p>
              ) : (
                <div className='flex flex-wrap gap-2'>
                  {skills.map(skill => (
                    <button
                      key={skill.id}
                      type='button'
                      onClick={() => toggleSkill(skill.id)}
                      data-track-category='Claw Agents'
                      data-track-name='Toggle subagent skill (create)'
                    >
                      <Badge variant={state.skillIds.includes(skill.id) ? 'primary' : 'outline'}>
                        {skill.name}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Step 4 — Review */}
        {step === 4 && (
          <div className='flex flex-col gap-4'>
            <div className='rounded-xl border border-border bg-card p-5'>
              <div className='flex items-center gap-2'>
                <span className='font-mono text-base font-semibold text-foreground'>
                  {trimmedName}
                </span>
                <Badge variant='secondary'>Custom</Badge>
              </div>
              <p className='mt-1 text-sm text-muted-foreground'>
                {state.description.trim() || 'No description added'}
              </p>
              <dl className='mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3'>
                {[
                  ['Parameter', state.paramName.trim() || 'question'],
                  ['Tools', String(toolCount)],
                  ['Skills', String(state.skillIds.length)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className='text-xs text-muted-foreground'>{label}</dt>
                    <dd className='mt-0.5 font-medium tabular-nums text-foreground'>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {create.error && (
              <p className='rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'>
                {create.error.message}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer: Cancel + Back/Next/Create — non-shrinking bar, always in view */}
      <div className='shrink-0 border-t border-border bg-background'>
        <div
          className={cn(
            'mx-auto flex w-full items-center justify-between gap-3 px-6 py-4',
            widthClass,
          )}
        >
          <Button
            variant='ghost'
            onClick={cancel}
            data-track-category='Claw Agents'
            data-track-name='CANCEL_CREATE_SUBAGENT'
          >
            Cancel
          </Button>
          <div className='flex items-center gap-2'>
            {step > 0 && (
              <Button
                variant='outline'
                onClick={goBack}
                data-track-category='Claw Agents'
                data-track-name='SUBAGENT_WIZARD_BACK'
              >
                <ChevronLeft className='size-4' />
                Back
              </Button>
            )}
            {step < LAST_STEP ? (
              <Button
                onClick={goNext}
                data-track-category='Claw Agents'
                data-track-name='SUBAGENT_WIZARD_NEXT'
                disabled={!canNext}
              >
                Next
                <ChevronRight className='size-4' />
              </Button>
            ) : (
              <Button
                onClick={() => void handleCreate()}
                data-track-category='Claw Agents'
                data-track-name='CREATE_SUBAGENT'
                loading={create.isPending}
                disabled={!canNext}
              >
                {!create.isPending && <Check className='size-4' />}
                Create subagent
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClawSubagentCreateScreen;
