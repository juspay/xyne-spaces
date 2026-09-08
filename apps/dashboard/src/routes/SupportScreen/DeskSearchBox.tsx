import { ReactElement, RefObject } from 'react';
import { SearchDefault as Search, MultipleCrossCancelDefault as X } from '@xyne/icons';
import Tooltip from '../../components/ui/Tooltip';
import { cn } from '../../utils/classNames';

const EXPANDED_WIDTH = 'w-[220px] ml-2';

interface DeskSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Omitted by the toolbar's hidden measurement twin, which only needs the width. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * Collapsed magnifier that expands into a text input. Rendered twice — once for real
 * and once inside the toolbar's hidden measurement twin — so the overflow pass in
 * useDeskToolbarOverflow budgets for whichever form is on screen.
 */
export function DeskSearchBox({
  value,
  onChange,
  isOpen,
  onOpenChange,
  inputRef,
}: DeskSearchBoxProps): ReactElement {
  if (!isOpen && !value) {
    return (
      <Tooltip content='Search mail' side='bottom'>
        <button
          onClick={() => onOpenChange(true)}
          aria-label='Search mail'
          className='p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
          data-track-category='Support'
          data-track-name='OpenDeskSearch'
        >
          <Search size={16} />
        </button>
      </Tooltip>
    );
  }

  return (
    <div className={cn('relative', EXPANDED_WIDTH)}>
      <Search
        size={16}
        className='absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none'
      />
      <input
        ref={inputRef}
        type='text'
        value={value}
        onChange={event => onChange(event.target.value)}
        onBlur={() => {
          if (!value) onOpenChange(false);
        }}
        onKeyDown={event => {
          if (event.key !== 'Escape') return;
          onChange('');
          onOpenChange(false);
          event.currentTarget.blur();
        }}
        placeholder='Search mail'
        aria-label='Search mail'
        className='w-full text-sm bg-background border border-border text-foreground rounded-lg pl-8 pr-8 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500'
        data-track-category='Support'
        data-track-name='DeskSearch'
      />
      {value && (
        <button
          onClick={() => {
            onChange('');
            inputRef?.current?.focus();
          }}
          aria-label='Clear search'
          className='absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors'
          data-track-category='Support'
          data-track-name='ClearDeskSearch'
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export default DeskSearchBox;
