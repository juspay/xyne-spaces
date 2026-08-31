import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Search, Check, ChevronRight, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { EntitySelectorProps, SelectorOption } from './EntitySelector.types';
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
  onScrollEnd,
  hasMore = false,
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
  headerAction,
  virtualize = false,
  // Only virtualize (opt-in) once the list is large enough to matter.
  virtualizeThreshold = 30,
  virtualizedHeight = 300,
}) => {
  // ==================== STATE ====================
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

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

  const isVirtualized = virtualize && !isLoading && filteredOptions.length > virtualizeThreshold;

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
   * Reset search value and highlight when popover closes
   */
  useEffect(() => {
    if (!open) {
      setSearchValue('');
      onSearchChange?.('');
      setHighlightedIndex(-1);
    }
  }, [open]);

  // Reset highlight when filtered options change (e.g. on search)
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [filteredOptions]);

  // Keep the highlighted item visible during keyboard navigation.
  useEffect(() => {
    if (highlightedIndex < 0) return;
    if (isVirtualized) {
      virtuosoRef.current?.scrollToIndex(highlightedIndex);
      return;
    }
    const item = listRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isVirtualized]);

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

  const handleOptionsScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    if (!onScrollEnd || !hasMore) {
      return;
    }

    const target = e.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

    if (distanceToBottom <= 24) {
      onScrollEnd();
    }
  };

  const renderUnassignRow = () => (
    <button
      type='button'
      className='relative flex w-full select-none items-center gap-2 px-2 py-1.5 text-sm outline-none transition-colors rounded text-left cursor-pointer text-foreground hover:bg-accent'
      onClick={() => {
        onSelect?.(null);
        handleOpenChange(false);
        setSearchValue('');
      }}
      data-track-category='ENTITY_PICKER'
      data-track-name='CLEAR_SELECTION'
    >
      <span className='flex h-5 w-5 flex-none items-center justify-center'>
        <div className='w-5 h-5 rounded-full bg-border flex items-center justify-center'>
          <X className='w-3 h-3 text-muted-foreground' />
        </div>
      </span>
      <div className='flex-1 min-w-0'>
        <div className='truncate font-medium text-foreground'>{unassignLabel}</div>
        <div className='truncate text-xs text-muted-foreground'>Remove assignee</div>
      </div>
    </button>
  );

  const renderOptionRow = (option: SelectorOption, index: number) => {
    const isSelected = selectedValue === option.value;
    const isHighlighted = index === highlightedIndex;
    return (
      <button
        type='button'
        disabled={option.disabled}
        className={`relative flex w-full select-none items-center gap-2 px-2 py-1.5 text-sm outline-none transition-colors rounded text-left ${
          option.disabled
            ? 'cursor-not-allowed opacity-50 text-muted-foreground'
            : isHighlighted
              ? 'cursor-pointer text-foreground bg-accent'
              : 'cursor-pointer text-foreground hover:bg-accent'
        }`}
        onClick={() => !option.disabled && handleSelect(option.value)}
        data-track-category='ENTITY_PICKER'
        data-track-name='SELECT_OPTION'
        onKeyDown={(e): void => {
          if ((e.key === 'Enter' || e.key === ' ') && !option.disabled) {
            e.preventDefault();
            handleSelect(option.value);
          }
        }}
      >
        {!isStatusSelector && option.icon && (
          <span className='flex h-5 w-5 flex-none items-center justify-center'>{option.icon}</span>
        )}
        <div className='flex-1 min-w-0'>
          <div className='truncate font-medium text-foreground'>{option.label}</div>
          {option.subtitle && (
            <div className='truncate text-xs text-muted-foreground'>{option.subtitle}</div>
          )}
        </div>
        {option.badge && (
          <span className='shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded-full border border-border bg-muted text-muted-foreground whitespace-nowrap'>
            {option.badge}
          </span>
        )}
        <Check
          className={`w-4 h-4 text-action-primary flex-shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0'}`}
        />
      </button>
    );
  };

  const renderDefaultButtonTrigger = () => {
    return (
      <button
        type='button'
        data-testid={testId}
        className={cn(
          'group flex items-center gap-1.5 text-sm rounded-[6px] transition-colors bg-background dark:bg-input',
          noBorder
            ? 'border-none'
            : 'border border-border hover:bg-accent px-2 py-0.5 shadow-[0_1px_1px_0_rgba(5,5,6,0.04)]',
          inputClassName,
        )}
        style={{ width }}
      >
        {/* Icon: Show selected option's icon or nothing */}
        {selectedOption?.icon ? (
          <span className='flex-shrink-0 flex items-center justify-center text-foreground'>
            {selectedOption.icon}
          </span>
        ) : inputIcon ? (
          <span
            className={cn(
              'flex-shrink-0 flex items-center justify-center',
              !selectedOption && 'text-muted-foreground',
            )}
          >
            {inputIcon}
          </span>
        ) : null}

        {/* Label: Show selected option's label or placeholder */}
        <span
          className={cn(
            'text-left break-words whitespace-normal',
            selectedOption ? 'text-foreground' : 'text-muted-foreground',
            noBorder ? 'py-0' : 'py-1',
          )}
        >
          {selectedOption?.label || placeholder}
        </span>
        {showClearButton && selectedOption ? (
          <button
            onClick={handleClear}
            data-track-category='ENTITY_PICKER'
            data-track-name='CLEAR_SELECTION'
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
          'relative flex items-center border border-border px-2 gap-1.5 rounded-[6px] h-7 transition-colors bg-background dark:bg-input w-fit max-w-full overflow-hidden shadow-[0_1px_1px_0_rgba(5,5,6,0.04)]',
          inputClassName,
        )}
      >
        {/* Icon: Show selected option's icon or nothing */}
        {selectedOption?.icon ? (
          <span className='flex-shrink-0 flex items-center justify-center visual-regression-hide text-foreground'>
            {selectedOption.icon}
          </span>
        ) : inputIcon ? (
          <span
            className={cn(
              'flex-shrink-0 flex items-center justify-center visual-regression-hide',
              !selectedOption && 'text-muted-foreground',
            )}
          >
            {inputIcon}
          </span>
        ) : null}
        <input
          ref={inputRef}
          type='text'
          data-testid={testId ? `${testId}-input` : undefined}
          style={{ fieldSizing: 'content' }}
          className={cn(
            'border-none focus-visible:ring-0 text-[13px] outline-none bg-muted max-w-40 min-w-9 truncate',
            selectedOption
              ? 'text-foreground placeholder:text-foreground'
              : 'text-muted-foreground placeholder:text-muted-foreground',
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
            data-track-category='ENTITY_PICKER'
            data-track-name='CLEAR_SELECTION'
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
          className='z-[100] w-auto max-w-96 max-h-96 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-background shadow-lg'
          style={{
            maxHeight: 360,
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
            pointerEvents: 'auto',
            // Never narrower than the trigger it drops from; a compact trigger
            // still lets the content size the popover as before.
            minWidth: 'var(--radix-popover-trigger-width)',
            // Virtuoso rows are absolutely positioned and can't size the popover;
            // lock it to the plain list's max width so widths stay consistent.
            ...(isVirtualized && { width: 'max(24rem, var(--radix-popover-trigger-width))' }),
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
                  data-testid={testId ? `${testId}-input` : undefined}
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={e => {
                    setSearchValue(e.target.value);
                    onSearchChange?.(e.target.value);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setHighlightedIndex(i => Math.min(i + 1, filteredOptions.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setHighlightedIndex(i => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
                      e.preventDefault();
                      const opt = filteredOptions[highlightedIndex];
                      if (opt && !opt.disabled) handleSelect(opt.value);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleOpenChange(false);
                    }
                  }}
                  className='w-full pl-7 pr-3 rounded-md text-sm ring-none outline-none bg-transparent text-foreground placeholder:text-muted-foreground'
                />
              </div>
            </div>
          )}

          {headerAction && (
            <div className='p-1 border-b border-border'>
              <button
                type='button'
                onClick={() => {
                  headerAction.onClick();
                  handleOpenChange(false);
                  setSearchValue('');
                }}
                className='flex w-full items-center gap-2 px-2 py-1.5 text-sm text-[#6276be] font-medium rounded hover:bg-accent'
                data-track-category={headerAction.trackCategory}
                data-track-name={headerAction.trackName}
              >
                {headerAction.icon}
                {headerAction.label}
              </button>
            </div>
          )}

          {/* ========== OPTIONS LIST ========== */}
          {isVirtualized ? (
            <div
              role='listbox'
              data-testid={testId ? `${testId}-options` : undefined}
              onWheel={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
            >
              {/* Unassign — pinned above the list, never virtualized */}
              {showUnassignOption && selectedValue && (
                <div className='p-1 pb-0'>{renderUnassignRow()}</div>
              )}
              <Virtuoso
                ref={virtuosoRef}
                data={filteredOptions}
                overscan={200}
                // Row-height estimate so the scroll range is right when Virtuoso
                // mounts before the popover settles.
                defaultItemHeight={44}
                // No padding on the scroller (it adds a spurious horizontal bar);
                // `- 48` leaves room for the pinned unassign row.
                style={{
                  height:
                    showUnassignOption && selectedValue
                      ? virtualizedHeight - 48
                      : virtualizedHeight,
                  width: '100%',
                  overflowX: 'hidden',
                }}
                {...(hasMore && onScrollEnd ? { endReached: onScrollEnd } : {})}
                itemContent={(index, option) => (
                  <div
                    role='option'
                    aria-selected={selectedValue === option.value}
                    className='px-1 pb-1 first:pt-1'
                  >
                    {renderOptionRow(option, index)}
                  </div>
                )}
              />
            </div>
          ) : (
            <div
              className='overflow-y-auto max-h-[320px]'
              onScroll={handleOptionsScroll}
              onWheel={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
            >
              {isLoading ? (
                <div className='p-4 text-center text-sm text-muted-foreground'>Loading...</div>
              ) : filteredOptions.length > 0 ? (
                <ul
                  ref={listRef}
                  role='listbox'
                  data-testid={testId ? `${testId}-options` : undefined}
                  className='p-1 space-y-1'
                >
                  {showUnassignOption && selectedValue && <li>{renderUnassignRow()}</li>}
                  {filteredOptions.map((option, index) => (
                    <li
                      role='option'
                      aria-selected={selectedValue === option.value}
                      key={option.value}
                    >
                      {renderOptionRow(option, index)}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className='p-2 text-center text-sm text-muted-foreground'>
                  {searchValue.trim() ? `No results found for "${searchValue}"` : null}
                </div>
              )}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
