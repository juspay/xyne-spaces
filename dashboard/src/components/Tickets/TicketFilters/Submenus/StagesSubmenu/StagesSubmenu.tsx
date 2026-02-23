import { ReactElement, useState, useEffect, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import type { TicketStatusV2 } from '@xyne/shared';
import Input from '../../../../ui/Input/Input';
import { KanbanIcon } from '../../../KanbanColumns/KanbanColumns';

interface StageOption {
  name: string;
  status?: TicketStatusV2 | undefined;
}

interface StagesSubmenuProps {
  selectedStages: string[];
  onChange: (stages: string[]) => void;
  availableStages?: StageOption[];
  className?: string;
}

export const StagesSubmenu = ({
  selectedStages,
  onChange,
  availableStages = [],
  className = '',
}: StagesSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

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
      className={`w-80 border border-gray-200 flex flex-col rounded-lg shadow-lg bg-white overflow-hidden ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-white z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none' />
          <Input
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search stages...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
        {!availableStages || availableStages.length === 0 ? (
          <div className='p-8 text-center text-sm text-gray-400'>No stages available</div>
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
                    ${isSelected ? 'bg-[#F2F2F3] text-black' : 'hover:bg-gray-50 text-gray-700'}
                    focus-visible:ring-2 focus-visible:ring-[#F2F2F3]
                  `}
                >
                  <div className='flex items-center justify-center w-5 h-5 shrink-0'>
                    <KanbanIcon status={stage.status} />
                  </div>
                  <span className='flex-1 text-left text-sm truncate'>{stage.name}</span>
                  {isSelected && (
                    <Check className='w-4 h-4 text-blue-600 shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-gray-400'>No stages found</div>
        )}
      </div>
      {selectedStages.length > 0 && (
        <div className='p-3 border-t bg-gray-50'>
          <div className='text-xs text-gray-500'>
            {selectedStages.length} stage{selectedStages.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  );
};
