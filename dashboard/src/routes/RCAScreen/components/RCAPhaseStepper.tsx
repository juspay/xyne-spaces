import { cn } from '../../../utils/classNames';
import type { RCAPhaseStepperProps } from '../RCAScreen.types';

export const RCAPhaseStepper = ({ phases, activePhase, onPhaseClick }: RCAPhaseStepperProps) => {
  return (
    <div className='bg-background border-b border-border px-2 sm:px-2 py-2'>
      <div className='mx-auto w-full max-w-4xl'>
        <div className='pb-1 -mb-1'>
          <div
            className='flex flex-wrap items-center sm:justify-center gap-y-2 gap-x-1 sm:gap-x-2 px-1'
            role='tablist'
          >
            {phases.map((phase, index) => {
              const isActive = activePhase === phase.id;

              return (
                <div key={phase.id} className='flex items-center'>
                  <button
                    type='button'
                    role='tab'
                    aria-selected={isActive}
                    onClick={() => onPhaseClick(phase.id)}
                    data-track-category='RCA'
                    data-track-name='SelectRCAPhase'
                    className={cn(
                      'flex items-center gap-1.5 px-1 py-1.5 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
                      isActive
                        ? 'bg-muted text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full text-[10px] sm:text-xs font-semibold shrink-0',
                        isActive ? 'bg-background text-foreground' : 'bg-border text-foreground',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span>{phase.label}</span>
                  </button>

                  {index < phases.length - 1 && (
                    <div className='h-px w-4 sm:w-8 bg-border mx-1 sm:mx-2 shrink-0' />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
