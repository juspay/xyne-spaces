import { ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ActionDefinition } from './actions/action';

interface ActionCardsProps {
  actions: readonly ActionDefinition[];
  onSelect: (action: ActionDefinition) => void;
}

export const ActionCards = ({ actions, onSelect }: ActionCardsProps): ReactElement => (
  <div className='flex w-full flex-col gap-2'>
    {actions.map(action => (
      <button
        key={action.id}
        type='button'
        onClick={() => onSelect(action)}
        data-track-category='XyneAI'
        data-track-name='SELECT_SETUP_ACTION'
        className='flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      >
        <div className='flex min-w-0 flex-1 flex-col gap-[2px]'>
          <span className='text-[14px] font-semibold leading-[22px] text-foreground'>
            {action.title}
          </span>
          {action.hint && (
            <span className='text-[12px] font-normal leading-[16px] text-muted-foreground'>
              {action.hint}
            </span>
          )}
        </div>
        <ChevronRight className='size-4 shrink-0 text-muted-foreground' aria-hidden />
      </button>
    ))}
  </div>
);
