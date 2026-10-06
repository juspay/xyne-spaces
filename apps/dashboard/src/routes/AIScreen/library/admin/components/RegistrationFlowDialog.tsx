import type { ReactElement } from 'react';
import { CheckTickSingle } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import { V2Dialog } from '../../shared/primitives/V2Dialog';
import type { RegistrationFlow, RegistrationStep } from '../hooks/useAgentRegistration';

type StepState = 'idle' | 'active' | 'loading' | 'done';

const STEPS: { step: RegistrationStep; label: string; doneLabel: string }[] = [
  { step: 'create', label: 'Create app', doneLabel: 'Created' },
  { step: 'install', label: 'Install app', doneLabel: 'Installed' },
  { step: 'configure', label: 'Configure webhook', doneLabel: 'Configured' },
  { step: 'grant', label: 'Grant permissions', doneLabel: 'Permissions granted' },
  { step: 'upload', label: 'Upload picture', doneLabel: 'Picture set' },
];

const ORDER: RegistrationStep[] = ['create', 'install', 'configure', 'grant', 'upload', 'done'];

function StepRow({
  position,
  label,
  doneLabel,
  state,
  onRun,
  onSkip,
}: {
  position: number;
  label: string;
  doneLabel: string;
  state: StepState;
  onRun: () => void;
  onSkip?: (() => void) | undefined;
}): ReactElement {
  const isDone = state === 'done';
  const isActive = state === 'active' || state === 'loading';

  return (
    <li
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-xl border border-border px-4 py-2.5',
        isActive && 'bg-muted/40',
      )}
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
          isDone || isActive ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground',
        )}
      >
        {isDone ? <CheckTickSingle className='size-3.5' aria-hidden /> : position}
      </span>

      <span
        className={cn(
          'flex-1 truncate text-sm leading-5',
          isDone || isActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {isDone ? doneLabel : label}
      </span>

      {isActive && (
        <div className='flex shrink-0 items-center gap-3'>
          {onSkip && (
            <button
              type='button'
              onClick={onSkip}
              data-track-category='Claw Admin'
              data-track-name={`Skip ${label}`}
              className='text-xs text-muted-foreground transition-colors hover:text-foreground'
            >
              Skip
            </button>
          )}
          <Button
            type='button'
            size='sm'
            loading={state === 'loading'}
            onClick={onRun}
            data-track-category='Claw Admin'
            data-track-name={`Registration step: ${label}`}
          >
            {label}
          </Button>
        </div>
      )}
    </li>
  );
}

export function RegistrationFlowDialog({
  flow,
  onRun,
  onPickPicture,
  onSkipUpload,
  onDismiss,
  showUploadStep = false,
}: {
  flow: RegistrationFlow | null;
  onRun: () => void;
  onPickPicture: () => void;
  onSkipUpload: () => void;
  onDismiss: () => void;
  showUploadStep?: boolean;
}): ReactElement | null {
  if (!flow) return null;

  const steps = showUploadStep ? STEPS : STEPS.filter(entry => entry.step !== 'upload');
  const currentIndex = ORDER.indexOf(flow.step);
  const finished = flow.step === 'done' || (!showUploadStep && flow.step === 'upload');

  const stateFor = (step: RegistrationStep): StepState => {
    if (flow.step === step) return flow.busy ? 'loading' : 'active';
    return ORDER.indexOf(step) < currentIndex ? 'done' : 'idle';
  };

  const skipFor = (step: RegistrationStep): (() => void) | undefined => {
    if (flow.step !== step) return undefined;
    if (step === 'upload') return onSkipUpload;
    if (step === 'grant') return onDismiss;
    return undefined;
  };

  return (
    <V2Dialog
      open
      onOpenChange={open => {
        if (!open) onDismiss();
      }}
      title={`Set up ${flow.agentName} on Spaces`}
      description='Run each registration step in order to connect this agent to Spaces.'
      testId='agent-registration-dialog'
      footer={
        finished ? (
          <Button
            type='button'
            size='sm'
            onClick={onDismiss}
            data-track-category='Claw Admin'
            data-track-name='Dismiss registration'
          >
            Done
          </Button>
        ) : undefined
      }
    >
      <p className='text-sm leading-5 text-muted-foreground'>
        {finished
          ? 'This agent is registered and ready to use.'
          : 'Run each step in order. You can close this and resume setup later.'}
      </p>

      {flow.error && <p className='text-xs text-destructive'>{flow.error}</p>}

      <ol className='flex flex-col gap-2'>
        {steps.map(({ step, label, doneLabel }, index) => (
          <StepRow
            key={step}
            position={index + 1}
            label={label}
            doneLabel={doneLabel}
            state={stateFor(step)}
            onRun={step === 'upload' ? onPickPicture : onRun}
            onSkip={skipFor(step)}
          />
        ))}
      </ol>
    </V2Dialog>
  );
}
