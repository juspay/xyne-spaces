import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import { cn } from '../../../utils/classNames';

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterMultiSelectProps {
  options: FilterOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const FilterMultiSelect: React.FC<FilterMultiSelectProps> = ({
  options,
  selectedValues,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOptions = useMemo(
    () => options.filter(o => selectedValues.includes(o.value)),
    [options, selectedValues],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = useCallback(
    (value: string) => {
      if (disabled) return;
      const next = selectedValues.includes(value)
        ? selectedValues.filter(v => v !== value)
        : [...selectedValues, value];
      onChange(next);
    },
    [disabled, selectedValues, onChange],
  );

  const removePill = (value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange(selectedValues.filter(v => v !== value));
  };

  useEffect(() => {
    if (!open) {
      setSearch('');
      setFocusedIndex(-1);
    }
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || disabled) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filtered.length && filtered[focusedIndex]) {
          toggle(filtered[focusedIndex].value);
        }
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  };

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[focusedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  const hasSelection = selectedOptions.length > 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={disabled}
          data-slot='filter-multi-select-trigger'
          className={cn(
            'flex h-8 w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
            '[&_svg]:pointer-events-none [&_svg]:shrink-0',
            className,
          )}
        >
          <span className='flex items-center gap-1.5 min-w-0 overflow-hidden'>
            {hasSelection ? (
              <span className='flex items-center gap-1 overflow-hidden'>
                {selectedOptions.length <= 2 ? (
                  selectedOptions.map(opt => (
                    <span
                      key={opt.value}
                      className='inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground max-w-[160px] truncate'
                    >
                      {opt.label}
                      <button
                        type='button'
                        onClick={e => removePill(opt.value, e)}
                        data-track-category='ENTITY_PICKER'
                        data-track-name='REMOVE_FILTER_PILL'
                        className='ml-0.5 rounded-full p-px text-muted-foreground hover:text-foreground'
                        aria-label={`Remove ${opt.label}`}
                      >
                        <XIcon className='size-3' />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className='text-xs font-medium text-foreground'>
                    {selectedOptions.length} selected
                  </span>
                )}
              </span>
            ) : (
              <span className='text-muted-foreground'>{placeholder}</span>
            )}
          </span>
          <ChevronDownIcon
            className={cn(
              'size-4 text-muted-foreground opacity-50 transition-transform flex-shrink-0',
              open && 'rotate-180',
            )}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={4}
          className={cn(
            'z-50 min-w-[180px] max-w-[280px] rounded-md border bg-popover text-popover-foreground shadow-md',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          )}
          onOpenAutoFocus={e => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          {/* Search */}
          <div className='border-b border-border p-1.5'>
            <input
              ref={searchRef}
              type='text'
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setFocusedIndex(-1);
              }}
              onKeyDown={handleKeyDown}
              placeholder='Search...'
              className='w-full h-7 px-2 text-sm bg-transparent border border-input rounded-sm outline-none focus:border-ring placeholder:text-muted-foreground'
            />
          </div>

          {/* Options */}
          <div
            ref={listRef}
            className='max-h-[200px] overflow-y-auto p-1'
            role='listbox'
            aria-multiselectable='true'
          >
            {filtered.length === 0 ? (
              <div className='px-2 py-4 text-center text-sm text-muted-foreground'>No results</div>
            ) : (
              filtered.map((option, index) => {
                const isSelected = selectedValues.includes(option.value);
                const isFocused = index === focusedIndex;
                return (
                  <button
                    key={option.value}
                    type='button'
                    role='option'
                    aria-selected={isSelected}
                    onClick={() => toggle(option.value)}
                    data-track-category='ENTITY_PICKER'
                    data-track-name='TOGGLE_FILTER_OPTION'
                    onMouseEnter={() => setFocusedIndex(index)}
                    className={cn(
                      'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none transition-colors',
                      isFocused
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <span className='truncate'>{option.label}</span>
                    {isSelected && (
                      <span className='absolute right-2 flex size-3.5 items-center justify-center'>
                        <CheckIcon className='size-4 text-foreground' />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Clear all */}
          {hasSelection && (
            <div className='border-t border-border p-1.5'>
              <button
                type='button'
                onClick={() => onChange([])}
                data-track-category='ENTITY_PICKER'
                data-track-name='CLEAR_ALL_FILTERS'
                className='w-full rounded-sm px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-center'
              >
                Clear all
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
