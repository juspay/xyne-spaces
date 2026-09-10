import { ReactElement, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { useAgentNameCheck } from '@/hooks/useAgentNameCheck';
import { useCreateClawAgent } from '@/hooks/useCreateClawAgent';
import { StepIndicator } from './create/StepIndicator';
import {
  INITIAL_WIZARD_STATE,
  STEPS,
  STEP_SUBTITLES,
  effectiveSlug,
  type WizardState,
} from './create/wizardState';
import { IdentityStep } from './create/steps/IdentityStep';
import { PersonaStep } from './create/steps/PersonaStep';
import { ToolboxStep } from './create/steps/ToolboxStep';
import { KnowledgeStep } from './create/steps/KnowledgeStep';
import { ReviewStep } from './create/steps/ReviewStep';

const LAST_STEP = STEPS.length - 1;

const ClawAgentCreateScreen = (): ReactElement => {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE);
  const update = useCallback(
    (patch: Partial<WizardState>) => setState(prev => ({ ...prev, ...patch })),
    [],
  );

  const { step } = state;
  const slug = effectiveSlug(state);
  const nameCheck = useAgentNameCheck(state.name.trim(), slug);
  const createMutation = useCreateClawAgent();

  // Per-step Next gating (mirrors the reference wizard).
  const canNext =
    step === 0
      ? state.name.trim().length > 0 &&
        slug.length > 0 &&
        nameCheck.nameValid &&
        !nameCheck.checking
      : step === 1
        ? state.systemPrompt.trim().length > 0
        : true;

  const cancel = (): void => {
    void navigate('/claw-agents');
  };
  const goBack = (): void => {
    update({ step: step - 1 });
  };
  const goNext = (): void => {
    update({ step: step + 1 });
  };

  const handleCreate = (): void => {
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

  // The Toolbox step is a full-width marketplace; every other step stays narrow.
  const widthClass = step === 2 ? 'max-w-7xl' : 'max-w-[960px]';

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* Title + subtitle, then the step indicator. */}
      <div className={cn('mx-auto flex w-full shrink-0 flex-col gap-1 px-6 pt-6', widthClass)}>
        <h1 className='text-2xl font-medium tracking-tight text-foreground'>Create agent</h1>
        <p className='text-sm text-muted-foreground'>{STEP_SUBTITLES[step]}</p>
      </div>

      <div className={cn('mx-auto w-full shrink-0 px-6 pt-4', widthClass)}>
        <StepIndicator steps={STEPS} current={step} />
      </div>

      {/* Active step — scrolls internally; `key` re-triggers the enter animation. */}
      <div
        key={step}
        className={cn(
          'step-enter mx-auto w-full min-h-0 flex-1 overflow-y-auto px-6 py-6',
          widthClass,
        )}
      >
        {step === 0 && (
          <IdentityStep state={state} slug={slug} nameCheck={nameCheck} update={update} />
        )}
        {step === 1 && <PersonaStep state={state} update={update} />}
        {step === 2 && <ToolboxStep state={state} update={update} />}
        {step === 3 && <KnowledgeStep state={state} update={update} />}
        {step === 4 && (
          <ReviewStep state={state} slug={slug} error={createMutation.error?.message ?? null} />
        )}
      </div>

      {/* Cancel + Back/Next/Create — non-shrinking bar, always in view. */}
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
            data-track-name='CANCEL_CREATE_AGENT'
          >
            Cancel
          </Button>
          <div className='flex items-center gap-2'>
            {step > 0 && (
              <Button
                variant='outline'
                onClick={goBack}
                data-track-category='Claw Agents'
                data-track-name='AGENT_WIZARD_BACK'
              >
                <ChevronLeft className='size-4' />
                Back
              </Button>
            )}
            {step < LAST_STEP ? (
              <Button
                onClick={goNext}
                data-track-category='Claw Agents'
                data-track-name='AGENT_WIZARD_NEXT'
                disabled={!canNext}
              >
                Next
                <ChevronRight className='size-4' />
              </Button>
            ) : (
              <Button
                onClick={handleCreate}
                data-track-category='Claw Agents'
                data-track-name='CREATE_AGENT'
                loading={createMutation.isPending}
                disabled={!canNext}
              >
                {!createMutation.isPending && <Check className='size-4' />}
                Create agent
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClawAgentCreateScreen;
