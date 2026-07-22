import { ReactElement } from 'react';
import { X } from 'lucide-react';

type ActivityUnreadsFloatingButtonProps = {
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
};

export const ActivityUnreadsFloatingButton = ({
  isActive,
  onActivate,
  onDeactivate,
}: ActivityUnreadsFloatingButtonProps): ReactElement => (
  <div className='pointer-events-none absolute bottom-[calc(85px+env(safe-area-inset-bottom))] right-4 z-40 min-[700px]:bottom-4'>
    {isActive ? (
      <div className='pointer-events-auto flex items-center overflow-hidden rounded-full bg-action-primary text-action-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'>
        <button
          type='button'
          onClick={onActivate}
          aria-pressed='true'
          aria-label='Unreads filter active'
          className='py-2.5 pl-4 pr-2 text-[15px] font-semibold hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/70 min-[700px]:py-2 min-[700px]:pl-3 min-[700px]:pr-1.5 min-[700px]:text-sm'
          data-testid='activity-unread-toggle'
          data-track-category='ACTIVITY'
          data-track-name='UNREAD_FILTER_ACTIVE'
        >
          Unreads
        </button>
        <button
          type='button'
          onClick={onDeactivate}
          aria-label='Clear unreads filter'
          className='py-2.5 pl-1 pr-3 hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/70 min-[700px]:py-2 min-[700px]:pl-1 min-[700px]:pr-2.5'
          data-testid='activity-unread-clear'
          data-track-category='ACTIVITY'
          data-track-name='UNREAD_FILTER_CLEAR'
        >
          <X className='size-[18px] min-[700px]:size-4' strokeWidth={2.25} aria-hidden='true' />
        </button>
      </div>
    ) : (
      <button
        type='button'
        onClick={onActivate}
        aria-pressed='false'
        aria-label='Show unreads only'
        className='pointer-events-auto rounded-full border border-action-primary bg-action-primary px-4 py-2.5 text-[15px] font-semibold text-action-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-colors hover:bg-action-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/40 min-[700px]:px-3 min-[700px]:py-2 min-[700px]:text-sm'
        data-testid='activity-unread-toggle'
        data-track-category='ACTIVITY'
        data-track-name='UNREAD_FILTER_TOGGLE'
      >
        Unreads
      </button>
    )}
  </div>
);

export default ActivityUnreadsFloatingButton;
