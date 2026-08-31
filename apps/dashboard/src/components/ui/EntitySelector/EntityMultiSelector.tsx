import * as Popover from '@radix-ui/react-popover';
import { Check, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../utils/classNames';
import { EntitySelectorProps } from './EntitySelector.types';

interface EntityMultiSelectorProps extends EntitySelectorProps {
  selectedValues: string[]; // Controlled selected tags
  onMultiSelect: (tags: string[]) => void;
  allowCreate?: boolean;
  onCreateOption?: (value: string) => void;
  showSearch?: boolean;
  collapseSelectedAfter?: number;
  collapsedLabel?: string;
}

export const EntityMultiSelector: React.FC<EntityMultiSelectorProps> = ({
  options,
  selectedValues,
  onMultiSelect,
  placeholder,
  searchPlaceholder,
  isLoading = false,
  width = 'auto',
  onSearchChange,
  disableClientFiltering = false,
  inputIcon,
  inputClassName,
  allowCreate,
  onCreateOption,
  showSearch = false,
  collapseSelectedAfter,
  collapsedLabel = 'items',
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

  const shouldCollapseSelected =
    typeof collapseSelectedAfter === 'number' && selectedOptions.length > collapseSelectedAfter;

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
        'relative flex items-center border border-border px-2 gap-1.5 rounded-[6px] h-7 transition-colors bg-background w-fit max-w-full overflow-hidden shadow-[0_1px_1px_0_rgba(5,5,6,0.04)] hover:bg-accent',
        inputClassName,
      )}
    >
      {inputIcon ? (
        <span
          className={cn(
            'flex-shrink-0 flex items-center justify-center',
            selectedValues.length === 0 && 'text-muted-foreground',
          )}
        >
          {inputIcon}
        </span>
      ) : null}
      <input
        type='text'
        ref={inputRef}
        className={cn(
          'border-none focus-visible:ring-0 text-[13px] outline-none bg-transparent max-w-40 min-w-8 truncate cursor-pointer',
          selectedValues.length > 0
            ? 'text-foreground placeholder:text-foreground'
            : 'text-muted-foreground placeholder:text-muted-foreground',
        )}
        style={{ fieldSizing: 'content' }}
        placeholder={placeholder}
        value={showSearch ? '' : searchValue}
        readOnly={showSearch}
        onChange={e => {
          if (showSearch) return;
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
          if (showSearch) return;
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
      {!shouldCollapseSelected &&
        selectedOptions.map(opt => (
          <span
            key={opt.value}
            className='flex items-center gap-1.5 rounded-md bg-background border px-2 text-xs h-7 cursor-default'
          >
            {opt.icon && <span className='flex items-center justify-center'>{opt.icon}</span>}
            <span className='max-w-32 text-xs font-medium text-foreground truncate'>
              {opt.label}
            </span>
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                removeValue(opt.value);
              }}
              data-track-category='ENTITY_PICKER'
              data-track-name='REMOVE_SELECTED_VALUE'
              className='text-muted-foreground hover:text-muted-foreground'
            >
              <X className='size-2.5' strokeWidth={2.5} />
            </button>
          </span>
        ))}
      <Popover.Root open={isOpen} onOpenChange={setIsOpen} modal={false}>
        {shouldCollapseSelected ? (
          <Popover.Trigger asChild>
            <span className='flex items-center gap-1.5 rounded-md bg-background border px-2 text-xs h-7 cursor-pointer'>
              <span className='flex items-center -space-x-2.5'>
                {selectedOptions.slice(0, collapseSelectedAfter).map(opt => (
                  <span key={opt.value} className='flex items-center justify-center size-4'>
                    {opt.icon}
                  </span>
                ))}
              </span>
              <span className='text-xs font-medium text-foreground'>
                {selectedOptions.length} {collapsedLabel} selected
              </span>
              <button
                type='button'
                onClick={e => {
                  e.stopPropagation();
                  onMultiSelect([]);
                }}
                data-track-category='ENTITY_PICKER'
                data-track-name='CLEAR_ALL_SELECTED'
                className='text-muted-foreground hover:text-muted-foreground'
              >
                <X className='size-2.5' strokeWidth={2.5} />
              </button>
            </span>
          </Popover.Trigger>
        ) : (
          <Popover.Trigger asChild className='cursor-pointer'>
            {renderInlineTrigger()}
          </Popover.Trigger>
        )}
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
            className='z-[100] w-auto max-w-64 max-h-96 overflow-y-auto no-scrollbar rounded-lg border border-border bg-background shadow-lg'
          >
            {/* Search input inside dropdown */}
            {showSearch && (
              <div className='p-2 border-b border-border'>
                <div className='relative'>
                  <Search className='absolute left-1.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground' />
                  <input
                    type='text'
                    ref={showSearch ? inputRef : undefined}
                    placeholder={searchPlaceholder || placeholder}
                    value={searchValue}
                    onChange={e => {
                      setSearchValue(e.target.value);
                      onSearchChange?.(e.target.value);
                    }}
                    className='w-full pl-6 pr-2 text-sm rounded outline-none bg-transparent text-foreground'
                  />
                </div>
              </div>
            )}
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
                            data-track-category='ENTITY_PICKER'
                            data-track-name='TOGGLE_OPTION'
                          >
                            <span
                              className={cn(
                                'flex-shrink-0 flex items-center justify-center size-3.5 rounded border transition-colors',
                                isSelected
                                  ? 'bg-primary border-primary'
                                  : 'border-border bg-background',
                              )}
                            >
                              {isSelected && (
                                <Check
                                  className='size-2.5 text-primary-foreground'
                                  strokeWidth={3}
                                />
                              )}
                            </span>
                            {option.icon && (
                              <span className='flex items-center justify-center'>
                                {option.icon}
                              </span>
                            )}

                            <div className='flex-1 min-w-0 text-left'>
                              <div className='flex items-center gap-1.5'>
                                <div
                                  className={`truncate font-medium ${option.isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
                                >
                                  {option.label}
                                </div>
                                {option.isDeactivated && (
                                  <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                                    Deactivated
                                  </span>
                                )}
                              </div>
                              {option.subtitle && (
                                <div className='truncate text-xs text-muted-foreground'>
                                  {option.subtitle}
                                </div>
                              )}
                            </div>
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
                        data-track-category='ENTITY_PICKER'
                        data-track-name='CREATE_OPTION'
                      >
                        <Plus className='size-3' strokeWidth={2.5} />
                        <span className='truncate text-xs'>
                          Create &quot;{searchValue.trim()}&quot;
                        </span>
                      </button>
                    </div>
                  )}

                {filteredOptions.length === 0 && (!allowCreate || !searchValue.trim()) && (
                  <div className='px-3 py-2.5 text-center text-sm text-muted-foreground'>
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
