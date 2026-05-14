import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import Input from '../../components/ui/Input';
import { Check, Search, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '../../utils/classNames';

interface ParticipantOptions extends SelectorOption {
  children?: React.ReactNode;
}

interface SearchParticipantsProps {
  options: ParticipantOptions[];
  selectedValues: string[];
  onMultiSelect: (tags: string[]) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  ref?: React.RefObject<HTMLInputElement | null>;
  onEnterQuerySubmit?: (query: string) => boolean;
  helperText?: React.ReactNode;
}

export const SearchParticipants: React.FC<SearchParticipantsProps> = ({
  options,
  selectedValues,
  onMultiSelect,
  searchQuery,
  setSearchQuery,
  ref,
  onEnterQuerySubmit,
  helperText,
}) => {
  const [selectedOptionsMap, setSelectedOptionsMap] = useState<Map<string, ParticipantOptions>>(
    new Map(),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const internalRef = useRef<HTMLInputElement | null>(null);
  const inputRef = ref ?? internalRef;
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const hasUserSelected = useMemo(() => {
    return selectedValues.some(v => v.startsWith('user:'));
  }, [selectedValues]);

  // Cache selected options so they remain visible even when filtered out of options
  useEffect(() => {
    setSelectedOptionsMap(prev => {
      const next = new Map(prev);
      selectedValues.forEach(value => {
        const option = options.find(opt => opt.value === value);
        if (option) {
          next.set(value, option);
        }
      });
      return next;
    });
  }, [selectedValues, options]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    let opts = options;

    // Filter out channels if a user is already selected
    if (hasUserSelected) {
      opts = opts.filter(opt => !opt.value.startsWith('channel:'));
    }

    if (!searchQuery.trim()) return opts;

    return opts.filter(
      opt =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        opt.subtitle?.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [options, searchQuery, hasUserSelected]);

  const selectedOptions = useMemo(() => {
    return selectedValues
      .map(value => {
        const currentOption = options.find(opt => opt.value === value);
        if (currentOption) return currentOption;

        // Fallback to cached option
        return selectedOptionsMap.get(value);
      })
      .filter((opt): opt is ParticipantOptions => opt !== undefined);
  }, [options, selectedValues, selectedOptionsMap]);

  const hasChannelSelected = useMemo(() => {
    return selectedValues.some(v => v.startsWith('channel:'));
  }, [selectedValues]);

  const isEmailLikeQuery = useMemo(() => {
    const query = searchQuery.trim();
    return query.includes('@');
  }, [searchQuery]);

  const toggleValue = (value: string) => {
    const isChannel = value.startsWith('channel:');

    if (!selectedValues.includes(value) && hasChannelSelected) {
      return;
    }

    if (isChannel && !selectedValues.includes(value)) {
      const option = options.find(opt => opt.value === value);
      if (option) {
        setSelectedOptionsMap(prev => new Map(prev).set(value, option));
      }
      onMultiSelect([value]);
      setSearchQuery('');
      setIsOpen(false);
      return;
    }

    if (selectedValues.includes(value)) {
      onMultiSelect(selectedValues.filter(v => v !== value));
    } else {
      const option = options.find(opt => opt.value === value);
      if (option) {
        setSelectedOptionsMap(prev => new Map(prev).set(value, option));
      }
      onMultiSelect([...selectedValues, value]);
      setSearchQuery('');
    }
  };

  useEffect(() => {
    setIndex(0);
  }, [filteredOptions]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlightedElement = listRef.current.children[index] as HTMLElement;

      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      }
    }
  }, [index, isOpen]);

  // Scroll to the last selected option
  useEffect(() => {
    if (inputContainerRef.current) {
      inputContainerRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'end',
      });
    }
  }, [selectedOptions.length]);

  // Open the popover if there is a search query and no channel is selected
  useEffect(() => {
    if (isEmailLikeQuery) {
      setIsOpen(false);
    } else if (searchQuery.trim() && !hasChannelSelected) {
      setIsOpen(true);
    }
  }, [searchQuery, hasChannelSelected, isEmailLikeQuery]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (hasChannelSelected) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setIndex(prev => (prev < filteredOptions.length - 1 ? prev + 1 : prev));
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          setIndex(prev => (prev > 0 ? prev - 1 : prev));
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (searchQuery.trim() && onEnterQuerySubmit?.(searchQuery.trim())) {
          setIsOpen(false);
          break;
        }
        if (filteredOptions.length > 0 && filteredOptions[index]) {
          toggleValue(filteredOptions[index].value);
        }
        setIsOpen(false);
        break;

      case 'Escape':
        setIsOpen(false);
        break;

      case 'Backspace':
        // If input is empty and there are selected values, remove the last one
        if (!searchQuery && selectedValues.length > 0) {
          e.preventDefault();
          const lastValue = selectedValues[selectedValues.length - 1];
          if (lastValue !== undefined) {
            toggleValue(lastValue);
          }
        }
        break;

      default:
        break;
    }
  };

  const renderTrigger = () => (
    <div className='relative'>
      <div
        onClick={() => {
          if (!hasChannelSelected) {
            inputRef.current?.focus();
          }
        }}
        onKeyDown={e => {
          if ((e.key === 'Enter' || e.key === ' ') && !hasChannelSelected) {
            inputRef.current?.focus();
          }
        }}
        role='button'
        tabIndex={0}
        className='relative flex items-center h-10 border border-border rounded-lg focus-within:border-foreground duration-300 ease-in-out bg-background'
        data-track-category='calls'
        data-track-name='search-participants-input'
      >
        <span className='px-2 bg-background'>
          <Search className='absolute left-2.5 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground z-50 pointer-events-none bg-background' />
        </span>
        <div ref={inputContainerRef} className='flex-1 pl-6'>
          <Input
            type='text'
            role='combobox'
            ref={inputRef}
            placeholder='Search by user or channel name'
            value={!hasChannelSelected ? searchQuery : ''}
            disabled={hasChannelSelected}
            onKeyDown={handleKeyDown}
            onChange={e => setSearchQuery(e.target.value)}
            className='pl-0.5 w-full border-0 shadow-none placeholder:text-muted-foreground text-foreground focus-visible:ring-0 bg-background'
            aria-expanded={isOpen}
            aria-controls='participant-listbox'
            aria-activedescendant={
              isOpen && filteredOptions[index]
                ? `option-${filteredOptions[index].value}`
                : undefined
            }
            aria-autocomplete='list'
            data-testid='search-participants-input'
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className='relative'>
      <Popover.Root
        open={isOpen}
        onOpenChange={open => {
          if (open && (hasChannelSelected || isEmailLikeQuery)) return;
          setIsOpen(open);
        }}
      >
        <Popover.Trigger asChild>{renderTrigger()}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side='bottom'
            align='start'
            sideOffset={4}
            onOpenAutoFocus={e => e.preventDefault()}
            onWheel={e => {
              e.stopPropagation();
            }}
            onTouchMove={e => {
              e.stopPropagation();
            }}
            className={cn(
              'z-[100] w-[var(--radix-popover-trigger-width)] max-h-48 overflow-y-auto no-scrollbar rounded-xl border border-border bg-background shadow-lg',
            )}
          >
            {filteredOptions.length > 0 && (
              <ul
                ref={listRef}
                role='listbox'
                id='participant-listbox'
                data-testid='participant-search-results'
                className='p-2 space-y-1 w-full'
              >
                {filteredOptions.map((option, i) => {
                  const isSelected = selectedValues.includes(option.value);
                  const isHighlighted = i === index;
                  return (
                    <li
                      key={option.value}
                      role='option'
                      id={`option-${option.value}`}
                      aria-selected={isSelected}
                    >
                      <button
                        type='button'
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm text-foreground hover:bg-muted',
                          isHighlighted && 'bg-muted',
                        )}
                        onClick={() => toggleValue(option.value)}
                        onMouseEnter={() => setIndex(index)}
                        data-track-category='calls'
                        data-track-name='select-participant-option'
                        data-testid='participant-option'
                      >
                        {option.children ? (
                          option.children
                        ) : (
                          <>
                            {option.icon && <span>{option.icon}</span>}
                            <div className='flex-1 min-w-0 text-left'>
                              <div className='truncate text-sm text-foreground'>{option.label}</div>
                              {option.subtitle && (
                                <div className='truncate text-xs text-muted-foreground'>
                                  {option.subtitle}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                        {isSelected && <Check className='w-4 h-4 text-blue-600' />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {filteredOptions.length === 0 && !isEmailLikeQuery && (
              <div className='px-3 py-2 text-sm text-foreground'>No results found</div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Selected participants rendered below the search bar */}
      {selectedOptions.length > 0 && (
        <div className='flex flex-wrap gap-1.5 mt-2 max-h-32 overflow-y-auto'>
          {selectedOptions.map(option => (
            <div
              key={option.value}
              className='flex items-center gap-1 px-2 py-1 bg-card rounded-md text-sm border border-border'
            >
              {option.icon && <span>{option.icon}</span>}
              <span className='truncate max-w-60 text-foreground'>{option.label}</span>
              <button
                type='button'
                onClick={e => {
                  e.stopPropagation();
                  toggleValue(option.value);
                }}
                className='ml-0.5 hover:bg-muted rounded p-0.5 text-foreground'
                data-track-category='calls'
                data-track-name='remove-participant'
              >
                <X className='size-3' />
              </button>
            </div>
          ))}
        </div>
      )}

      {hasChannelSelected && (
        <p className='text-xs text-muted-foreground mt-1 px-1'>
          Only one channel selection is allowed
        </p>
      )}

      {helperText && <div className='text-xs text-muted-foreground mt-1 px-1'>{helperText}</div>}
    </div>
  );
};
