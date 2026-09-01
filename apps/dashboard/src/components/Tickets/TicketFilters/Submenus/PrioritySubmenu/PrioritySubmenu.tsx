import { ReactElement, useMemo } from 'react';
import { Check } from 'lucide-react';
import { TicketPriority } from '@xyne/shared';
import { PRIORITY_CONFIG } from '../../Utils/filterConstants';
import { getPriorityIcon } from '../../../TicketCard/TicketCard.utils';

interface PrioritySubmenuProps {
  selectedPriorities: TicketPriority[];
  onChange: (priorities: TicketPriority[]) => void;
  availablePriorities?: TicketPriority[];
}

export const PrioritySubmenu = ({
  selectedPriorities,
  onChange,
  availablePriorities,
}: PrioritySubmenuProps): ReactElement => {
  const availablePrioritySet = useMemo(() => {
    return availablePriorities && availablePriorities.length > 0
      ? new Set(availablePriorities.map(p => String(p)))
      : null;
  }, [availablePriorities]);

  const prioritiesToShow = useMemo(() => {
    return Object.entries(PRIORITY_CONFIG).filter(([key]) => {
      if (availablePrioritySet && !availablePrioritySet.has(key)) {
        return false;
      }
      return true;
    });
  }, [availablePrioritySet]);

  const handleToggle = (priority: TicketPriority): void => {
    const isSelected = selectedPriorities.includes(priority);
    if (isSelected) {
      onChange(selectedPriorities.filter(p => p !== priority));
    } else {
      onChange([...selectedPriorities, priority]);
    }
  };

  const allSelected =
    prioritiesToShow.length > 0 &&
    prioritiesToShow.every(([key]) => selectedPriorities.includes(key as TicketPriority));

  const handleSelectAllToggle = (): void => {
    if (allSelected) {
      const visibleSet = new Set(prioritiesToShow.map(([key]) => key));
      onChange(selectedPriorities.filter(p => !visibleSet.has(p)));
    } else {
      const all = prioritiesToShow.map(([key]) => key as TicketPriority);
      const merged = new Set<TicketPriority>([...selectedPriorities, ...all]);
      onChange([...merged]);
    }
  };

  return (
    <div className='w-56 bg-background border border-border rounded-lg shadow-lg overflow-hidden'>
      <div
        className='py-1.5 px-1 flex flex-col gap-1 max-h-80 overflow-y-auto'
        onWheel={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
      >
        {prioritiesToShow.length > 0 ? (
          <>
            <button
              type='button'
              onClick={handleSelectAllToggle}
              className={`flex items-center justify-between w-full px-3 py-2 transition-colors rounded-md border-b border-border/50
                ${allSelected ? 'bg-accent text-foreground' : 'hover:bg-muted text-foreground'}
              `}
              data-track-category='Tickets'
              data-track-name='ToggleSelectAllPriorities'
            >
              <span className='text-sm font-medium text-primary'>
                {allSelected ? 'Deselect all' : 'Select all'}
              </span>
              {allSelected && <Check className='w-4 h-4 text-primary shrink-0' />}
            </button>
            {prioritiesToShow.map(([priority, config]) => {
            const isSelected = selectedPriorities.includes(priority as TicketPriority);

            return (
              <button
                key={priority}
                onClick={() => handleToggle(priority as TicketPriority)}
                type='button'
                className={`flex items-center justify-between w-full px-3 py-2 transition-colors rounded-md
                  ${isSelected ? 'bg-accent text-foreground' : 'hover:bg-muted text-foreground'}
                `}
                data-track-category='Tickets'
                data-track-name='TogglePriorityFilter'
                data-track-metadata={JSON.stringify({ priority, selected: !isSelected })}
                data-testid={`priority-filter-${priority.toLowerCase()}`}
              >
                <div className='flex items-center gap-2'>
                  <div className='flex items-center justify-center'>
                    {getPriorityIcon(priority as TicketPriority)}
                  </div>
                  <span className='text-sm font-medium'>{config.label}</span>
                </div>

                {isSelected && <Check className='w-5 h-5 text-foreground' strokeWidth={2.5} />}
              </button>
              );
            })}
          </>
        ) : (
          <div className='px-4 py-3 text-sm text-muted-foreground'>
            No priority options available
          </div>
        )}
      </div>
    </div>
  );
};
