import { ReactElement, useState } from 'react';
import { ChevronDown, MultipleCrossCancelDefault as X } from '@xyne/icons';
import { TicketPriority } from '@xyne/shared';
import { PriorityFilterProps } from '../types';
import { Button } from '../../../ui/Button';
import { PRIORITY_CONFIG } from '../Utils/filterConstants';

export const PriorityFilter = ({
  selectedPriorities,
  onChange,
  className = '',
}: PriorityFilterProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = (priority: TicketPriority): void => {
    const isSelected = selectedPriorities.includes(priority);

    if (isSelected) {
      onChange(selectedPriorities.filter(p => p !== priority));
    } else {
      onChange([...selectedPriorities, priority]);
    }
  };

  const handleClear = (): void => {
    onChange([]);
  };

  const hasSelection = selectedPriorities.length > 0;

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <Button
        className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${
          hasSelection
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-border bg-background text-foreground hover:bg-muted'
        }`}
        onClick={() => setIsOpen(!isOpen)}
        data-track-category='TicketFilters'
        data-track-name='TogglePriorityDropdown'
        data-track-metadata={JSON.stringify({ filterType: 'priority', isOpen })}
        variant='ghost'
      >
        <span>Priority</span>
        {hasSelection && (
          <span className='bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full'>
            {selectedPriorities.length}
          </span>
        )}
        <ChevronDown className='w-4 h-4' />
      </Button>

      {/* Clear Button */}
      {hasSelection && (
        <Button
          onClick={handleClear}
          data-track-category='TicketFilters'
          data-track-name='ClearPriorityFilter'
          data-track-metadata={JSON.stringify({ filterType: 'priority', selectedPriorities })}
          className='absolute -top-1 -right-1 p-1'
          title='Clear priority filter'
          size='icon'
          variant='ghost'
        >
          <X className='w-3 h-3 text-muted-foreground' />
        </Button>
      )}

      {/* Dropdown Content */}
      <div
        className={`absolute top-full left-0 mt-1 w-48 bg-background border border-border rounded-lg shadow-lg z-50 ${!isOpen && 'hidden'}`}
      >
        <div className='p-2'>
          {Object.entries(PRIORITY_CONFIG).map(([priority, config]) => {
            const isSelected = selectedPriorities.includes(priority as TicketPriority);

            return (
              <label
                key={priority}
                className='flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer transition-colors'
              >
                <input
                  type='checkbox'
                  checked={isSelected}
                  onChange={() => handleToggle(priority as TicketPriority)}
                  className='rounded border-input text-blue-600 focus:ring-blue-500'
                  data-track-category='Tickets'
                  data-track-name='FilterPriority'
                  data-track-metadata={JSON.stringify({ priority })}
                />
                <span className={`px-2 py-1 text-xs font-medium rounded border ${config.color}`}>
                  {config.label}
                </span>
              </label>
            );
          })}

          {selectedPriorities.length > 0 && (
            <div className='mt-2 pt-2 border-t border-border'>
              <Button
                onClick={handleClear}
                data-track-category='TicketFilters'
                data-track-name='ClearAllPriorityFilter'
                data-track-metadata={JSON.stringify({ filterType: 'priority', selectedPriorities })}
                className='text-xs text-muted-foreground hover:text-foreground transition-colors p-0 h-auto'
                variant='ghost'
              >
                Clear all
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
