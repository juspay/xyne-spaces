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
}

export const SearchParticipants: React.FC<SearchParticipantsProps> = ({
  options,
  selectedValues,
  onMultiSelect,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const hasUserSelected = useMemo(() => {
    return selectedValues.some(v => v.startsWith('user:'));
  }, [selectedValues]);

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
      .map(value => options.find(opt => opt.value === value))
      .filter((opt): opt is ParticipantOptions => opt !== undefined);
  }, [options, selectedValues]);

  const hasChannelSelected = useMemo(() => {
    return selectedValues.some(v => v.startsWith('channel:'));
  }, [selectedValues]);

  const toggleValue = (value: string) => {
    const isChannel = value.startsWith('channel:');

    if (!selectedValues.includes(value) && hasChannelSelected) {
      return;
    }

    if (isChannel && !selectedValues.includes(value)) {
      onMultiSelect([value]);
      setSearchQuery('');
      setIsOpen(false);
      return;
    }

    if (selectedValues.includes(value)) {
      onMultiSelect(selectedValues.filter(v => v !== value));
    } else {
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
    if (searchQuery.trim() && !hasChannelSelected) {
      setIsOpen(true);
    }
  }, [searchQuery, hasChannelSelected]);

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
    <div className='relative space-y-1'>
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
        tabIndex={hasChannelSelected ? -1 : 0}
        className='relative flex items-center h-10 border border-gray-200 rounded-lg focus-within:border-gray-800 duration-300 ease-in-out'
        data-track-category='calls'
        data-track-name='search-participants-input'
      >
        {/* Render selected options as chips */}
        <span className='p-2 bg-white'>
          <Search className='absolute left-2.5 top-1/2 transform -translate-y-1/2 size-4 text-gray-300 z-20 pointer-events-none bg-white' />
        </span>
        <span className='bg-gradient-to-r from-white via-white to-transparent absolute left-4 top-0 h-full w-7 pointer-events-none z-10 rounded-lg' />
        <div className='flex overflow-x-scroll no-scrollbar items-center gap-1 pl-5 flex-1'>
          {selectedOptions.map(option => (
            <div
              key={option.value}
              className='flex items-center justify-center gap-1 p-1 bg-gray-100 rounded-md text-sm'
            >
              {option.icon && <span>{option.icon}</span>}
              <span className='truncate max-w-80'>{option.label}</span>
              <button
                type='button'
                onClick={e => {
                  e.stopPropagation();
                  toggleValue(option.value);
                }}
                className='ml-1 hover:bg-gray-200 rounded p-0.5'
                data-track-category='calls'
                data-track-name='remove-participant'
              >
                <X className='size-3' />
              </button>
            </div>
          ))}

          {/* Search input */}
          <div ref={inputContainerRef} className='flex-1 min-w-64'>
            <Input
              type='text'
              role='combobox'
              maxLength={56}
              ref={inputRef}
              placeholder={selectedValues.length === 0 ? 'Search by user or channel name' : ''}
              value={!hasChannelSelected ? searchQuery : ''}
              disabled={hasChannelSelected}
              onKeyDown={handleKeyDown}
              onChange={e => setSearchQuery(e.target.value)}
              className='pl-0.5 w-full border-0 shadow-none placeholder:text-[#C9CCCF] focus-visible:ring-0'
              aria-expanded={isOpen}
              aria-controls='participant-listbox'
              aria-activedescendant={
                isOpen && filteredOptions[index]
                  ? `option-${filteredOptions[index].value}`
                  : undefined
              }
              aria-autocomplete='list'
            />
          </div>
        </div>
      </div>
      {hasChannelSelected && (
        <p className='text-xs text-gray-500 mt-1 px-1'>Only one channel selection is allowed</p>
      )}
    </div>
  );

  return (
    <div className='relative'>
      <Popover.Root
        open={isOpen}
        onOpenChange={open => {
          if (open && hasChannelSelected) return;
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
              'z-[100] w-[var(--radix-popover-trigger-width)] max-h-48 overflow-y-auto no-scrollbar rounded-xl border border-gray-200 bg-white shadow-lg',
            )}
          >
            {filteredOptions.length > 0 && (
              <ul
                ref={listRef}
                role='listbox'
                id='participant-listbox'
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
                          'flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-gray-100',
                          isHighlighted && 'bg-gray-100',
                        )}
                        onClick={() => toggleValue(option.value)}
                        onMouseEnter={() => setIndex(index)}
                        data-track-category='calls'
                        data-track-name='select-participant-option'
                      >
                        {option.children ? (
                          option.children
                        ) : (
                          <>
                            {option.icon && <span>{option.icon}</span>}
                            <div className='flex-1 min-w-0 text-left'>
                              <div className='truncate text-sm'>{option.label}</div>
                              {option.subtitle && (
                                <div className='truncate text-xs'>{option.subtitle}</div>
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
            {filteredOptions.length === 0 && (
              <div className='px-3 py-2 text-sm'>No results found</div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
};
