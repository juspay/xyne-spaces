import { createContext, useContext, useState } from 'react';
import { ChevronRight, CornerDownRight } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import type { MoveTarget } from '../FlowAutomationView/FlowAutomationView.utils';

/** Provided by the builder in edit mode only; null elsewhere, so cards show no "Move to…". */
export interface MoveStepActions {
  targetsFor: (stepId: string) => MoveTarget[];
  moveTo: (stepId: string, target: MoveTarget) => void;
}

export const MoveStepContext = createContext<MoveStepActions | null>(null);

/** "Move to…" for a step card's actions menu; the destinations open inline below it. */
export function MoveStepMenuItem({
  stepId,
  onDone,
}: {
  stepId: string;
  onDone: () => void;
}): React.ReactElement | null {
  const actions = useContext(MoveStepContext);
  const [open, setOpen] = useState(false);
  if (!actions) return null;
  const targets = actions.targetsFor(stepId);
  if (targets.length === 0) return null;

  return (
    <>
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        data-track-category='automation-builder'
        data-track-name='step-card-move-to'
        className='flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent/40'
      >
        <CornerDownRight className='size-4' aria-hidden='true' />
        <span className='flex-1'>Move to…</span>
        <ChevronRight
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')}
          aria-hidden='true'
        />
      </button>
      {open && (
        <div className='flex max-h-60 flex-col overflow-y-auto border-y border-border py-1'>
          {targets.map(target => (
            <button
              key={`${target.ownerId ?? 'root'}:${target.branchKey ?? ''}`}
              type='button'
              title={target.label}
              onClick={() => {
                actions.moveTo(stepId, target);
                onDone();
              }}
              data-track-category='automation-builder'
              data-track-name='step-card-move-to-target'
              className='w-full truncate rounded-md py-1.5 pl-9 pr-3 text-left text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            >
              {target.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
