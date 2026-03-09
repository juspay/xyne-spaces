import * as Popover from '@radix-ui/react-popover';
import { Check, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../utils/classNames';
import { EntitySelectorProps } from './EntitySelector.types';

interface EntityMultiSelectorProps extends EntitySelectorProps {
  selectedValues: string[]; // Controlled selected tags
  onMultiSelect: (tags: string[]) => void;
  allowCreate?: boolean;
  onCreateOption?: (value: string) => void;
}

export const EntityMultiSelector: React.FC<EntityMultiSelectorProps> = ({
  options,
  selectedValues,
  onMultiSelect,
  placeholder,
  isLoading = false,
  width = 'auto',
  onSearchChange,
  disableClientFiltering = false,
  inputIcon,
  inputClassName,
  allowCreate,
  onCreateOption,
}) => {
  // ==================== STATE ====================
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOptions = useMemo(
    () => options.filter(opt => selectedValues.includes(opt.value)),
    [options, selectedValues],
  );

  // ==================== COMPUTED VALUES ====================

  /**
   * Find the selected option from options array
   * Used to display the selected item in the trigger button
   */
  const filteredOptions = useMemo(() => {
    if (disableClientFiltering) return options;
    if (!searchValue.trim()) return options;

    const lower = searchValue.toLowerCase();

    return options.filter(
      opt => opt.label.toLowerCase().includes(lower) || opt.subtitle?.toLowerCase().includes(lower),
    );
  }, [options, searchValue, disableClientFiltering]);

  // ==================== EVENT HANDLERS ====================

  /**
   * Handle selecting an option
   */
  const toggleValue = (value: string) => {
    if (selectedValues.includes(value)) {
      onMultiSelect(selectedValues.filter(v => v !== value));
    } else {
      onMultiSelect([...selectedValues, value]);
    }
  };

  const removeValue = (value: string) => {
    onMultiSelect(selectedValues.filter(v => v !== value));
  };

  useEffect(() => {
    if (!isOpen) {
      setSearchValue('');
    }
  }, [isOpen]);

  /* ==================== TRIGGER ==================== */
  const renderInlineTrigger = () => (
    <div
      role='combobox'
      aria-expanded={isOpen}
      aria-controls='entity-multiselector-listbox'
      aria-haspopup='listbox'
      style={{ width }}
      onPointerDown={e => {
        if (e.target !== inputRef.current) {
          e.preventDefault();
          inputRef.current?.focus();
        }
        setIsOpen(false);
      }}
      className={cn(
        'relative flex items-center border px-2 gap-1.5 rounded-md h-7 transition-colors bg-muted w-fit max-w-full overflow-hidden ',
        inputClassName,
      )}
    >
      {inputIcon ? (
        <span className='flex-shrink-0 flex items-center justify-center'>{inputIcon}</span>
      ) : null}
      <input
        type='text'
        ref={inputRef}
        className={cn(
          'border-none focus-visible:ring-0 text-[13px] placeholder:text-foreground outline-none bg-muted max-w-40 min-w-8 truncate',
        )}
        style={{ fieldSizing: 'content' }}
        placeholder={placeholder}
        value={searchValue}
        onChange={e => {
          setSearchValue(e.target.value);
          onSearchChange?.(e.target.value);
          setIsOpen(true);
        }}
        onClick={e => {
          e.stopPropagation();
          e.currentTarget.focus();
        }}
        onFocus={() => {
          setIsOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Backspace' && !searchValue && selectedValues.length) {
            const lastValue = selectedValues[selectedValues.length - 1];
            if (lastValue) {
              removeValue(lastValue);
            }
          } else if (e.key === 'Enter') {
            e.preventDefault();
            // Check if we should create a new option
            const shouldCreate =
              allowCreate &&
              searchValue.trim() &&
              !filteredOptions.some(opt => opt.label.toLowerCase() === searchValue.toLowerCase());
            if (shouldCreate) {
              onCreateOption?.(searchValue.trim().toLowerCase());
              setSearchValue('');
            } else if (filteredOptions.length > 0) {
              const firstOpt = filteredOptions[0];
              if (firstOpt) toggleValue(firstOpt.value);
              setSearchValue('');
            }
          }
        }}
      />
    </div>
  );

  return (
    <>
      {selectedOptions.map(opt => (
        <span
          key={opt.value}
          className='flex items-center gap-1.5 rounded-md bg-background border px-2 text-xs h-7 cursor-default'
        >
          {opt.icon && <span className='flex items-center justify-center'>{opt.icon}</span>}
          <span className='max-w-32 text-xs font-medium text-foreground truncate'>{opt.label}</span>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              removeValue(opt.value);
            }}
            className='text-muted-foreground hover:text-muted-foreground'
          >
            <X className='size-2.5' strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <Popover.Root open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <Popover.Trigger asChild>{renderInlineTrigger()}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side='bottom'
            align='start'
            sideOffset={4}
            onOpenAutoFocus={e => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
            onWheel={e => {
              e.stopPropagation();
            }}
            onTouchMove={e => {
              e.stopPropagation();
            }}
            className='z-[100] max-w-52 w-auto max-h-48 overflow-y-auto no-scrollbar rounded-lg border border-border bg-background shadow-lg'
          >
            {/* Options */}
            {isLoading ? (
              <div className='p-4 text-center text-sm text-muted-foreground'>Loading</div>
            ) : (
              <>
                {filteredOptions.length > 0 && (
                  <ul className='p-1 space-y-1'>
                    {filteredOptions.map(option => {
                      const isSelected = selectedValues.includes(option.value);

                      return (
                        <li key={option.value}>
                          <button
                            type='button'
                            className='flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent'
                            onClick={() => toggleValue(option.value)}
                          >
                            {option.icon && (
                              <span className=' flex items-center justify-center'>
                                {option.icon}
                              </span>
                            )}

                            <div className='flex-1 min-w-0 text-left'>
                              <div className='truncate font-medium text-foreground'>
                                {option.label}
                              </div>
                              {option.subtitle && (
                                <div className='truncate text-xs text-muted-foreground'>
                                  {option.subtitle}
                                </div>
                              )}
                            </div>
                            {isSelected && <Check className='w-4 h-4 text-blue-600' />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {/* ADD CREATE OPTION HERE */}
                {allowCreate &&
                  searchValue.trim() &&
                  !filteredOptions.some(
                    opt => opt.label.toLowerCase() === searchValue.toLowerCase(),
                  ) && (
                    <div className='p-1 border-t border-border'>
                      <button
                        type='button'
                        className='flex w-full items-center gap-1.5 px-2 py-1.5 rounded hover:bg-accent text-muted-foreground'
                        onClick={() => {
                          onCreateOption?.(searchValue.trim());
                          setSearchValue('');
                        }}
                      >
                        <Plus className='size-3' strokeWidth={2.5} />
                        <span className='truncate text-xs'>
                          Create &quot;{searchValue.trim()}&quot;
                        </span>
                      </button>
                    </div>
                  )}

                {filteredOptions.length === 0 && (!allowCreate || !searchValue.trim()) && (
                  <div className='px-3 py-2.5 text-center text-xs text-muted-foreground'>
                    No results found
                  </div>
                )}
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
};
