import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Search, Check, ChevronRight, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { EntitySelectorProps } from './EntitySelector.types';
import { cn } from '../../../utils/classNames';

/**
 * EntitySelector - A generic, reusable single-select dropdown component
 *
 * Features:
 * - Search functionality
 * - Custom icons for each option
 * - Optional subtitle (e.g., email for users)
 * - Clear selection capability
 * - Keyboard accessible
 * Used by: UserSelector, UserGroupSelector
 */

export const EntitySelector: React.FC<EntitySelectorProps> = ({
  options,
  selectedValue,
  onSelect,
  placeholder,
  searchPlaceholder,
  showSearch = true,
  isLoading = false,
  width = 'auto',
  onSearchChange,
  disableClientFiltering = false,
  showClearButton = false,
  isStatusSelector,
  noBorder,
  variant = 'default',
  inputIcon,
  inputClassName,
  isOpen,
  onOpenChange,
  showIndicator = true,
  testId,
  showUnassignOption = false,
  unassignLabel = 'Unassign',
}) => {
  // ==================== STATE ====================
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const open = isOpen ?? internalOpen;
  // ==================== COMPUTED VALUES ====================

  /**
   * Find the selected option from options array
   * Used to display the selected item in the trigger button
   */
  const selectedOption = useMemo(
    () => options.find(opt => opt.value === selectedValue),
    [options, selectedValue],
  );

  /**
   * Filter options based on search value
   * Searches both label and subtitle (if present)
   */
  const filteredOptions = useMemo(() => {
    // If server-side filtering is enabled, don't filter client-side
    // The options are already filtered by the server
    if (disableClientFiltering) {
      return options;
    }

    // Client-side filtering (for components that fetch all data upfront)
    if (!searchValue.trim()) return options;

    const searchLower = searchValue.toLowerCase();
    return options.filter(
      opt =>
        opt.label.toLowerCase().includes(searchLower) ||
        opt.subtitle?.toLowerCase().includes(searchLower),
    );
  }, [options, searchValue, disableClientFiltering]);

  // ==================== EVENT HANDLERS ====================

  /**
   * Handle selecting an option
   */
  const handleSelect = (value: string): void => {
    // If user clicks the already selected value, deselect it (toggle behavior)
    if (onSelect) {
      if (value === selectedValue) {
        onSelect(null);
      } else {
        onSelect(value);
      }
    }
    handleOpenChange(false);
    setSearchValue('');
  };

  /**
   * Reset search value when popover closes
   */
  useEffect(() => {
    if (!open) {
      setSearchValue('');
    }
  }, [open]);

  // ==================== RENDER HELPER (DEFAULT) ====================

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      if (onOpenChange) {
        onOpenChange(nextOpen);
      } else {
        setInternalOpen(nextOpen);
      }
    },
    [onOpenChange],
  );

  // ==================== RENDER HELPER (INLINE) ====================
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect) {
      onSelect?.(null);
    }
  };

  const renderDefaultButtonTrigger = () => {
    return (
      <button
        type='button'
        data-testid={testId}
        className={cn(
          'group flex items-center gap-1.5 text-sm rounded-lg transition-colors bg-background',
          noBorder ? 'border-none' : 'border border-border hover:bg-accent px-2 py-0.5 ',
          inputClassName,
        )}
        style={{ width }}
      >
        {/* Icon: Show selected option's icon or nothing */}
        {selectedOption?.icon ? (
          <span className='flex-shrink-0 flex items-center justify-center'>
            {selectedOption.icon}
          </span>
        ) : inputIcon ? (
          <span className='flex-shrink-0 flex items-center justify-center'>{inputIcon}</span>
        ) : null}

        {/* Label: Show selected option's label or placeholder */}
        <span
          className={cn(
            'text-left break-words whitespace-normal text-foreground',
            noBorder ? 'py-0' : 'py-1',
          )}
        >
          {selectedOption?.label || placeholder}
        </span>
        {showClearButton && selectedOption ? (
          <button
            onClick={handleClear}
            className='flex-shrink-0 hover:bg-accent rounded p-0.5 transition-colors'
          >
            <X className='w-3 h-3 text-muted-foreground' />
          </button>
        ) : showIndicator ? (
          <ChevronRight className='ml-auto w-4 h-4 text-muted-foreground flex-shrink-0' />
        ) : null}
      </button>
    );
  };

  // ==================== RENDER HELPER (INLINE) ====================

  const renderInLineInputTrigger = () => {
    return (
      <div
        role='combobox'
        aria-expanded={open}
        aria-controls='entity-selector-listbox'
        aria-haspopup='listbox'
        data-testid={testId}
        style={{ width }}
        onPointerDown={e => {
          if (e.target !== inputRef.current) {
            e.preventDefault();
            inputRef.current?.focus();
          }
          handleOpenChange(false);
        }}
        className={cn(
          'relative flex items-center border px-2 gap-1.5 rounded-md h-7 transition-colors bg-muted w-fit max-w-full overflow-hidden ',
          inputClassName,
        )}
      >
        {/* Icon: Show selected option's icon or nothing */}
        {selectedOption?.icon ? (
          <span className='flex-shrink-0 flex items-center justify-center visual-regression-hide'>
            {selectedOption.icon}
          </span>
        ) : inputIcon ? (
          <span className='flex-shrink-0 flex items-center justify-center visual-regression-hide'>
            {inputIcon}
          </span>
        ) : null}
        <input
          ref={inputRef}
          type='text'
          data-testid={testId ? `${testId}-input` : undefined}
          style={{ fieldSizing: 'content' }}
          className={cn(
            'border-none focus-visible:ring-0 text-[13px] placeholder:text-foreground outline-none bg-muted max-w-40 min-w-9 truncate',
            inputClassName,
          )}
          placeholder={placeholder}
          value={searchValue || selectedOption?.label || ''}
          onChange={e => {
            const newVal = e.target.value;
            setSearchValue(newVal);
            onSearchChange?.(newVal);
            handleOpenChange(true);
            // Clear selection if search value is empty
            if (selectedOption && newVal.length < (selectedOption.label?.length || 0)) {
              onSelect?.(null);
            }
          }}
          onClick={e => {
            e.stopPropagation();
            e.currentTarget.focus();
          }}
          onFocus={() => {
            handleOpenChange(true);
          }}
          onKeyDown={e => {
            // Close the dropdown on 'Escape'
            if (e.key === 'Escape') {
              e.preventDefault();
              handleOpenChange(false);
            }
            // Select the first option on 'Enter'
            else if (e.key === 'Enter' && filteredOptions.length === 1) {
              e.preventDefault();
              const firstOpt = filteredOptions[0];
              if (firstOpt) handleSelect(firstOpt.value);
            }
          }}
        />
        {showClearButton && selectedOption ? (
          <button
            onClick={handleClear}
            className='flex-shrink-0 hover:bg-accent rounded p-0.5 transition-colors'
          >
            <X className='w-3 h-3 text-muted-foreground' />
          </button>
        ) : showIndicator ? (
          <ChevronRight className='ml-auto w-4 h-4 text-muted-foreground flex-shrink-0' />
        ) : null}
      </div>
    );
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      {/* ========== TRIGGER BUTTON ========== */}
      <Popover.Trigger asChild>
        {variant === 'default' ? renderDefaultButtonTrigger() : renderInLineInputTrigger()}
      </Popover.Trigger>

      {/* ========== POPOVER CONTENT ========== */}
      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={4}
          className='z-[100] w-auto max-w-64 max-h-96 overflow-auto rounded-lg border border-border bg-background shadow-lg'
          style={{
            maxHeight: 360,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
            pointerEvents: 'auto',
          }}
          onWheel={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          onOpenAutoFocus={e => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          {/* ========== SEARCH INPUT ========== */}
          {variant === 'default' && showSearch && (
            <div className='p-2 border-b border-border'>
              <div className='relative'>
                <Search className='absolute left-1 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
                <input
                  ref={inputRef}
                  type='text'
                  data-testid={testId ? `${testId}-search` : undefined}
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={e => {
                    setSearchValue(e.target.value);
                    onSearchChange?.(e.target.value);
                  }}
                  className='w-full pl-7 pr-3 rounded-md text-sm ring-none outline-none'
                />
              </div>
            </div>
          )}

          {/* ========== OPTIONS LIST ========== */}
          <div
            className='overflow-y-auto max-h-[320px]'
            onWheel={e => e.stopPropagation()}
            onTouchMove={e => e.stopPropagation()}
          >
            {isLoading ? (
              // Loading state
              <div className='p-4 text-center text-sm text-muted-foreground'>Loading...</div>
            ) : filteredOptions.length > 0 ? (
              // Options list
              <ul
                role='listbox'
                data-testid={testId ? `${testId}-options` : undefined}
                className='p-1 space-y-1'
              >
                {showUnassignOption && selectedValue && (
                  <li>
                    <button
                      type='button'
                      className='relative flex w-full select-none items-center gap-2 px-2 py-1.5 text-sm outline-none transition-colors rounded text-left cursor-pointer text-foreground hover:bg-accent'
                      onClick={() => {
                        onSelect?.(null);
                        handleOpenChange(false);
                        setSearchValue('');
                      }}
                    >
                      <span className='flex h-5 w-5 flex-none items-center justify-center'>
                        <div className='w-5 h-5 rounded-full bg-border flex items-center justify-center'>
                          <X className='w-3 h-3 text-muted-foreground' />
                        </div>
                      </span>
                      <div className='flex-1 min-w-0'>
                        <div className='truncate font-medium text-foreground'>{unassignLabel}</div>
                        <div className='truncate text-xs text-muted-foreground'>
                          Remove assignee
                        </div>
                      </div>
                    </button>
                  </li>
                )}
                {filteredOptions.map(option => (
                  <li
                    role='option'
                    aria-selected={selectedValue === option.value}
                    key={option.value}
                  >
                    <button
                      type='button'
                      disabled={option.disabled}
                      className={`relative flex w-full select-none items-center gap-2 px-2 py-1.5 text-sm outline-none transition-colors rounded text-left ${
                        option.disabled
                          ? 'cursor-not-allowed opacity-50 text-muted-foreground'
                          : 'cursor-pointer text-foreground hover:bg-accent'
                      }`}
                      onClick={() => !option.disabled && handleSelect(option.value)}
                      onKeyDown={(e): void => {
                        if ((e.key === 'Enter' || e.key === ' ') && !option.disabled) {
                          e.preventDefault();
                          handleSelect(option.value);
                        }
                      }}
                    >
                      {/* Option icon */}
                      {!isStatusSelector && option.icon && (
                        <span className='flex h-5 w-5 flex-none items-center justify-center'>
                          {option.icon}
                        </span>
                      )}
                      {/* Option label and subtitle */}
                      <div className='flex-1 min-w-0'>
                        <div className='truncate font-medium text-foreground'>{option.label}</div>
                        {option.subtitle && (
                          <div className='truncate text-xs text-muted-foreground'>
                            {option.subtitle}
                          </div>
                        )}
                      </div>

                      {/* Check mark if selected */}
                      <Check
                        className={`w-4 h-4 text-action-primary flex-shrink-0 
                        ${selectedValue === option.value ? 'opacity-100' : 'opacity-0'}`}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              // Empty state (no results found)
              <div className='p-2 text-center text-sm text-muted-foreground'>
                {searchValue.trim()
                  ? `No results found for "${searchValue}"`
                  : 'No options available'}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
