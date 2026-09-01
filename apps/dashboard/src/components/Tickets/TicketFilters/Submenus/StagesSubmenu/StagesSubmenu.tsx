import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { SearchDefault as Search, CheckTickSingle as Check } from '@xyne/icons';
import type { TicketStatusV2 } from '@xyne/shared';
import Input from '../../../../ui/Input/Input';
import { KanbanIcon } from '../../../KanbanColumns/KanbanColumns';
import { usePlatform } from '../../../../../hooks/usePlatform';

interface StageOption {
  name: string;
  status?: TicketStatusV2 | undefined;
}

interface StagesSubmenuProps {
  selectedStages: string[];
  onChange: (stages: string[]) => void;
  availableStages?: StageOption[];
  isLoading?: boolean;
  className?: string;
}

export const StagesSubmenu = ({
  selectedStages,
  onChange,
  availableStages = [],
  isLoading = false,
  className = '',
}: StagesSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const finalResults = useMemo(() => {
    if (!availableStages || availableStages.length === 0) return [];

    let list = [...availableStages];

    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(stage => stage.name.toLowerCase().includes(lower));
    }

    const selectedSet = new Set(selectedStages);
    return list
      .sort((a, b) => {
        const aSel = selectedSet.has(a.name) ? 1 : 0;
        const bSel = selectedSet.has(b.name) ? 1 : 0;
        return bSel - aSel;
      })
      .slice(0, 50);
  }, [availableStages, searchTerm, selectedStages]);

  const handleStageToggle = (stageName: string) => {
    const isSelected = selectedStages.includes(stageName);
    onChange(
      isSelected ? selectedStages.filter(s => s !== stageName) : [...selectedStages, stageName],
    );
  };

  return (
    <div
      className={`w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search status...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div
        className='max-h-80 overflow-y-auto p-1'
        role='listbox'
        aria-multiselectable='true'
        onWheel={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
      >
        {isLoading ? (
          <div className='p-8 text-center text-sm text-muted-foreground' aria-live='polite'>
            Loading status…
          </div>
        ) : !availableStages || availableStages.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>No status available</div>
        ) : finalResults.length > 0 ? (
          <div className='space-y-0.5'>
            {finalResults.map(stage => {
              const isSelected = selectedStages.includes(stage.name);
              return (
                <button
                  key={stage.name}
                  type='button'
                  onClick={() => handleStageToggle(stage.name)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleStageFilter'
                  data-track-metadata={JSON.stringify({
                    stageName: stage.name,
                    selected: !isSelected,
                  })}
                >
                  <div className='flex items-center justify-center w-5 h-5 shrink-0'>
                    <KanbanIcon status={stage.status} />
                  </div>
                  <span className='flex-1 text-left text-sm truncate'>{stage.name}</span>
                  {isSelected && (
                    <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-muted-foreground'>No status found</div>
        )}
      </div>
      {selectedStages.length > 0 && (
        <div className='p-3 border-t bg-muted'>
          <div className='text-xs text-muted-foreground'>
            {selectedStages.length} status selected
          </div>
        </div>
      )}
    </div>
  );
};
