import type { ReactElement } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import type { RegistrationFlow, RegistrationStep } from '../hooks/useAgentRegistration';

type StepState = 'idle' | 'active' | 'loading' | 'done';

const STEPS: { step: RegistrationStep; label: string; doneLabel: string }[] = [
  { step: 'create', label: '1. Create App', doneLabel: 'Created' },
  { step: 'install', label: '2. Install App', doneLabel: 'Installed' },
  { step: 'configure', label: '3. Configure Webhook', doneLabel: 'Configured' },
  { step: 'grant', label: '4. Grant Permissions', doneLabel: 'Permissions Granted' },
  { step: 'upload', label: '5. Upload Picture', doneLabel: 'Picture Set' },
];

const ORDER: RegistrationStep[] = ['create', 'install', 'configure', 'grant', 'upload', 'done'];

function StepButton({
  label,
  doneLabel,
  state,
  onClick,
}: {
  label: string;
  doneLabel: string;
  state: StepState;
  onClick: () => void;
}): ReactElement {
  const isActive = state === 'active';
  const isLoading = state === 'loading';
  const isDone = state === 'done';

  return (
    <Button
      type='button'
      size='sm'
      variant={isActive ? 'default' : 'secondary'}
      onClick={onClick}
      disabled={!isActive}
      loading={isLoading}
      data-track-category='Claw Admin'
      data-track-name={`Registration step: ${label}`}
      className={cn(
        'rounded-md',
        isDone && 'bg-muted text-foreground',
        !isActive && !isDone && 'bg-muted/50 text-muted-foreground',
      )}
    >
      {isDone && <Check className='size-4' aria-hidden />}
      {isDone ? doneLabel : label}
    </Button>
  );
}

export function RegistrationFlowCard({
  flow,
  onRun,
  onPickPicture,
  onSkipUpload,
  onDismiss,
  showUploadStep = false,
}: {
  flow: RegistrationFlow;
  onRun: () => void;
  onPickPicture: () => void;
  onSkipUpload: () => void;
  onDismiss: () => void;
  showUploadStep?: boolean;
}): ReactElement {
  const steps = showUploadStep ? STEPS : STEPS.filter(entry => entry.step !== 'upload');
  const currentIndex = ORDER.indexOf(flow.step);
  const finished = flow.step === 'done' || (!showUploadStep && flow.step === 'upload');

  const stateFor = (step: RegistrationStep): StepState => {
    if (flow.step === step) return flow.busy ? 'loading' : 'active';
    return ORDER.indexOf(step) < currentIndex ? 'done' : 'idle';
  };

  return (
    <section className='rounded-xl border border-border bg-muted/40 px-5 py-4'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <h4 className='text-sm font-semibold text-foreground'>
          Spaces App Setup — {flow.agentSlug}
        </h4>
        {finished && (
          <button
            type='button'
            onClick={onDismiss}
            data-track-category='Claw Admin'
            data-track-name='Dismiss registration'
            className='text-xs text-muted-foreground transition-colors hover:text-foreground'
          >
            Dismiss
          </button>
        )}
      </div>

      {flow.error && <p className='mb-3 text-xs text-destructive'>{flow.error}</p>}

      <div className='flex flex-wrap items-center gap-3'>
        {steps.map(({ step, label, doneLabel }, index) => (
          <div key={step} className='flex items-center gap-3'>
            {index > 0 && <ChevronRight className='size-4 text-muted-foreground' aria-hidden />}
            <StepButton
              label={label}
              doneLabel={doneLabel}
              state={stateFor(step)}
              onClick={step === 'upload' ? onPickPicture : onRun}
            />
            {flow.step === step && (step === 'upload' || step === 'grant') && (
              <button
                type='button'
                onClick={step === 'upload' ? onSkipUpload : onDismiss}
                data-track-category='Claw Admin'
                data-track-name={`Skip ${step}`}
                className='text-xs text-muted-foreground transition-colors hover:text-foreground'
              >
                Skip
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
