import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '../../../utils/classNames';
import type { MultiSelectProps, MultiSelectOption } from './MultiSelect.types';

/**
 * MultiSelect - A custom multi-select component with pill display and dropdown
 *
 * Features:
 * - Selected values displayed as removable pills (separate from trigger)
 * - Button trigger opens dropdown on click
 * - Search input inside dropdown for filtering options
 * - Keyboard accessible
 */
export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  selectedValues,
  onChange,
  placeholder = 'Select options',
  label,
  className,
  disabled = false,
  dropdownMaxHeight = 250,
  error,
  helperText,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Find selected options
  const selectedOptions: MultiSelectOption[] = options.filter(option =>
    selectedValues.includes(option.value),
  );

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    if (!searchValue.trim()) return options;
    return options.filter(option => option.label.toLowerCase().includes(searchValue.toLowerCase()));
  }, [options, searchValue]);

  // Toggle selection
  const toggleSelection = useCallback(
    (value: string): void => {
      if (disabled) return;

      const newSelection = selectedValues.includes(value)
        ? selectedValues.filter(v => v !== value)
        : [...selectedValues, value];

      onChange(newSelection);
    },
    [disabled, selectedValues, onChange],
  );

  // Remove selection from pill
  const handleRemovePill = (value: string, event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (disabled) return;

    const newSelection = selectedValues.filter(v => v !== value);
    onChange(newSelection);
  };

  // Reset search when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setSearchValue('');
      setFocusedIndex(-1);
    }
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || disabled) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex(prev => (prev < filteredOptions.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (
            focusedIndex >= 0 &&
            focusedIndex < filteredOptions.length &&
            filteredOptions[focusedIndex]
          ) {
            toggleSelection(filteredOptions[focusedIndex].value);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, focusedIndex, filteredOptions, disabled, toggleSelection]);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <label
          className={cn(
            'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
            disabled ? 'opacity-50' : '',
          )}
        >
          {label}
        </label>
      )}

      {/* Popover with Radix UI */}
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        {/* Trigger Button */}
        <Popover.Trigger asChild>
          <button
            type='button'
            disabled={disabled}
            className={cn(
              'flex items-center w-full min-h-[40px] px-3 py-2 text-sm text-left border border-input rounded-md bg-background',
              'transition-colors hover:bg-accent',
              'focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none',
              disabled ? 'bg-muted cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          >
            {/* Selected Pills Inside Trigger */}
            <div className='flex flex-1 flex-wrap items-center gap-1.5'>
              {selectedOptions.length > 0 ? (
                selectedOptions.map(option => (
                  <span
                    key={option.value}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground',
                      'transition-colors hover:bg-accent',
                    )}
                  >
                    {option.label}
                    {!disabled && (
                      <button
                        type='button'
                        onClick={e => handleRemovePill(option.value, e)}
                        data-track-category='ENTITY_PICKER'
                        data-track-name='REMOVE_SELECTED_PILL'
                        className={cn(
                          'ml-0.5 rounded-full p-0.5 text-muted-foreground',
                          'hover:bg-accent hover:text-foreground',
                          'focus:outline-hidden focus:ring-2 focus:ring-ring',
                        )}
                        aria-label={`Remove ${option.label}`}
                      >
                        <svg
                          xmlns='http://www.w3.org/2000/svg'
                          width='12'
                          height='12'
                          viewBox='0 0 15 15'
                          fill='none'
                        >
                          <path
                            d='M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z'
                            fill='currentColor'
                            fillRule='evenodd'
                            clipRule='evenodd'
                          />
                        </svg>
                      </button>
                    )}
                  </span>
                ))
              ) : (
                <span className='text-muted-foreground'>{placeholder}</span>
              )}
            </div>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              className={cn(
                'ml-2 flex-shrink-0 text-muted-foreground transition-transform',
                isOpen ? 'rotate-180' : '',
              )}
            >
              <polyline points='6 9 12 15 18 9'></polyline>
            </svg>
          </button>
        </Popover.Trigger>

        {/* Popover Content */}
        <Popover.Portal>
          <Popover.Content
            side='bottom'
            align='start'
            sideOffset={4}
            className='z-[100] w-full max-w-[350px] rounded-md border border-border bg-background shadow-lg'
            onOpenAutoFocus={e => {
              e.preventDefault();
              searchInputRef.current?.focus();
            }}
            onCloseAutoFocus={e => e.preventDefault()}
          >
            {/* Search Input */}
            <div className='border-b border-border p-2'>
              <input
                ref={searchInputRef}
                type='text'
                value={searchValue}
                onChange={e => {
                  setSearchValue(e.target.value);
                  setFocusedIndex(-1);
                }}
                placeholder='Search options...'
                className='w-full px-2 py-1.5 text-sm border border-input rounded bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-ring'
              />
            </div>

            {/* Options List */}
            <div
              className='overflow-y-auto'
              style={{
                maxHeight: dropdownMaxHeight - 50,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
                overscrollBehavior: 'contain',
                pointerEvents: 'auto',
              }}
              onWheel={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
            >
              {filteredOptions.length === 0 ? (
                <div className='px-3 py-2 text-sm text-muted-foreground'>
                  {searchValue ? 'No results found' : 'No options available'}
                </div>
              ) : (
                filteredOptions.map((option, index) => {
                  const isSelected = selectedValues.includes(option.value);
                  const isFocused = index === focusedIndex;

                  return (
                    <button
                      key={option.value}
                      type='button'
                      role='option'
                      aria-selected={isSelected}
                      onClick={() => toggleSelection(option.value)}
                      data-track-category='ENTITY_PICKER'
                      data-track-name='TOGGLE_OPTION'
                      onMouseEnter={() => setFocusedIndex(index)}
                      className={cn(
                        'flex w-full cursor-pointer select-none items-center gap-3 rounded-sm px-3 py-2 text-sm outline-none transition-colors',
                        isFocused
                          ? 'bg-accent text-foreground'
                          : 'hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {/* Optional Icon */}
                      {option.icon && (
                        <div className='flex-shrink-0 size-6 flex items-center justify-center'>
                          {option.icon}
                        </div>
                      )}

                      {/* Label and Subtitle */}
                      <div className='flex flex-col items-start min-w-0 flex-1'>
                        <div className='flex items-center gap-1.5'>
                          <span
                            className={cn(
                              'truncate text-left',
                              option.isDeactivated ? 'text-muted-foreground' : 'text-foreground',
                              isSelected ? 'font-medium' : '',
                            )}
                          >
                            {option.label}
                          </span>
                          {option.isDeactivated && (
                            <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                              Deactivated
                            </span>
                          )}
                        </div>
                        {option.subtitle && (
                          <span className='truncate text-xs text-muted-foreground'>
                            {option.subtitle}
                          </span>
                        )}
                      </div>

                      {/* Checkmark for selected items */}
                      {isSelected && (
                        <svg
                          xmlns='http://www.w3.org/2000/svg'
                          width='16'
                          height='16'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          className='flex-shrink-0 text-action-primary'
                        >
                          <polyline points='20 6 9 17 4 12'></polyline>
                        </svg>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {(error || helperText) && (
        <p className={cn('text-xs', error ? 'text-red-500' : 'text-muted-foreground')}>
          {error || helperText}
        </p>
      )}
    </div>
  );
};

MultiSelect.displayName = 'MultiSelect';

export default MultiSelect;
