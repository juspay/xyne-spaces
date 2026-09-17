import { ReactElement, useState, useEffect, useRef } from 'react';
import { SearchDefault as Search, CheckTickSingle as Check } from '@xyne/icons';
import Input from '../../../../ui/Input/Input';
import { usePlatform } from '../../../../../hooks/usePlatform';

interface MerchantIdSubmenuProps {
  selectedMerchantIds: string[];
  onChange: (merchantIds: string[]) => void;
  className?: string;
}

// Merchant IDs are free-form, so there is no option list: typed IDs are added on
// Enter (comma/space separated values are split) and matched exactly.
export const MerchantIdSubmenu = ({
  selectedMerchantIds,
  onChange,
  className = '',
}: MerchantIdSubmenuProps): ReactElement => {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile]);

  const addTypedIds = () => {
    const ids = inputValue
      .split(/[\s,]+/)
      .map(id => id.trim())
      .filter(Boolean);
    if (ids.length === 0) return;
    onChange([...new Set([...selectedMerchantIds, ...ids])]);
    setInputValue('');
  };

  const handleRemove = (merchantId: string) => {
    onChange(selectedMerchantIds.filter(id => id !== merchantId));
  };

  return (
    <div
      className={`w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={inputRef}
            type='text'
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTypedIds();
              }
            }}
            placeholder='Enter merchant ID and press Enter'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
        {selectedMerchantIds.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>No merchant IDs added</div>
        ) : (
          <div className='space-y-0.5'>
            {selectedMerchantIds.map(merchantId => (
              <button
                key={merchantId}
                type='button'
                onClick={() => handleRemove(merchantId)}
                className='w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none bg-accent text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring'
                data-track-category='Tickets'
                data-track-name='ToggleMerchantIdFilter'
                data-track-metadata={JSON.stringify({ merchantId, selected: false })}
                title='Click to remove'
              >
                <span className='flex-1 text-left text-sm truncate'>{merchantId}</span>
                <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedMerchantIds.length > 0 && (
        <div className='p-3 border-t bg-muted flex items-center justify-between'>
          <div className='text-xs text-muted-foreground'>
            {selectedMerchantIds.length} merchant ID{selectedMerchantIds.length !== 1 ? 's' : ''}{' '}
            selected
          </div>
          <button
            type='button'
            onClick={() => onChange([])}
            className='text-xs text-primary hover:underline'
            data-track-category='Tickets'
            data-track-name='ClearMerchantIdFilter'
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
};
