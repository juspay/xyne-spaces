import type { FC } from 'react';
import { Search } from 'lucide-react';

import Input from '../../ui/Input/Input';

export interface SettingsSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  className?: string;
}

/** Search box at the top of the Preferences nav / mobile section list. Enter picks the top result. */
export const SettingsSearchInput: FC<SettingsSearchInputProps> = ({
  value,
  onChange,
  onSubmit,
  className,
}) => (
  <div className={className}>
    <div className='relative'>
      <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
      <Input
        type='search'
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder='Search settings'
        aria-label='Search settings'
        className='h-8 pl-8 pr-2 text-sm'
        data-track-category='PREFERENCES'
        data-track-name='SearchSettings'
      />
    </div>
  </div>
);
