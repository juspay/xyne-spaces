import type { FC } from 'react';
import { Search, X } from 'lucide-react';

import Input from '../../ui/Input/Input';
import { SETTINGS_SEARCH_RESULTS_ID } from './SettingsSearchResults';

export interface SettingsSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onMove: (step: 1 | -1) => void;
  activeOptionId?: string | undefined;
  className?: string;
}

/** Search box at the top of the Preferences nav / mobile section list. Enter picks the active result. */
export const SettingsSearchInput: FC<SettingsSearchInputProps> = ({
  value,
  onChange,
  onSubmit,
  onMove,
  activeOptionId,
  className,
}) => (
  <div className={className}>
    <div className='relative'>
      <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
      <Input
        type='text'
        role='combobox'
        autoComplete='off'
        aria-autocomplete='list'
        aria-expanded={value.trim().length > 0}
        aria-controls={SETTINGS_SEARCH_RESULTS_ID}
        aria-activedescendant={activeOptionId}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            onMove(e.key === 'ArrowDown' ? 1 : -1);
          }
        }}
        placeholder='Search settings'
        aria-label='Search settings'
        className='h-8 pl-8 pr-8 text-sm'
        data-track-category='PREFERENCES'
        data-track-name='SearchSettings'
      />
      {value && (
        <button
          type='button'
          onMouseDown={e => e.preventDefault()}
          onClick={() => onChange('')}
          aria-label='Clear search'
          className='absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          data-track-category='PREFERENCES'
          data-track-name='ClearSearchSettings'
        >
          <X className='size-3.5' />
        </button>
      )}
    </div>
  </div>
);
