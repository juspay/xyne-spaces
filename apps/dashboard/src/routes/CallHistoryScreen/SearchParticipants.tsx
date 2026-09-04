import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import Input from '../../components/ui/Input';
import { Check, Search, X, ChevronUp, ChevronRight } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '../../utils/classNames';

interface ParticipantOptions extends SelectorOption {
  children?: React.ReactNode;
}

interface SearchParticipantsProps {
  options: ParticipantOptions[];
  selectedValues: string[];
  onMultiSelect: (tags: string[]) => void | Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  ref?: React.RefObject<HTMLInputElement | null>;
  onEnterQuerySubmit?: (query: string) => boolean;
  helperText?: React.ReactNode;
  channelMembersOptions?: ParticipantOptions[];
  excludedChannelMembers?: Set<string>;
  hoistSelectedChannelMembers?: boolean;
  toggleExcludedChannelMember?: (
    userId: string,
    isSelectAll?: boolean,
    allUserIds?: string[],
  ) => void;
  exclusiveSelection?: boolean;
  /** Already-selected values that cannot be deselected (no X, no backspace, no clear-all). */
  lockedValues?: ReadonlySet<string>;
  /**
   * Skip the built-in `label.includes(query)` substring filter. Set this when the
   * caller has already ranked `options` with the shared participant matcher
   * (`rankParticipantOptions`) so the fuzzy/prefix results are not re-filtered
   * (and dropped) by substring matching. The exclusive-selection filtering below
   * still applies.
   */
  disableClientFiltering?: boolean;
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
  channelMembersOptions,
  excludedChannelMembers,
  hoistSelectedChannelMembers = false,
  toggleExcludedChannelMember,
  exclusiveSelection = true,
  lockedValues,
  disableClientFiltering = false,
}) => {
  const [selectedOptionsMap, setSelectedOptionsMap] = useState<Map<string, ParticipantOptions>>(
    new Map(),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [participantSearchQuery, setParticipantSearchQuery] = useState('');

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

  const hasGroupSelected = useMemo(() => {
    return exclusiveSelection && selectedValues.some(v => v.startsWith('user_group:'));
  }, [selectedValues, exclusiveSelection]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    let opts = options;

    // A channel-scoped selection is its own mode (it unfurls a member checklist), so
    // once any individual is picked the channel options drop out. User groups are NOT
    // exclusive: callers expand a group into its members on select, so picking one is
    // the same as picking those users by hand and must not hide the remaining groups.
    if (exclusiveSelection && (hasUserSelected || hasGroupSelected)) {
      opts = opts.filter(opt => !opt.value.startsWith('channel:'));
    }

    if (disableClientFiltering || !searchQuery.trim()) return opts;

    return opts.filter(
      opt =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        opt.subtitle?.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [
    options,
    searchQuery,
    hasUserSelected,
    hasGroupSelected,
    exclusiveSelection,
    disableClientFiltering,
  ]);

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
    return exclusiveSelection && selectedValues.some(v => v.startsWith('channel:'));
  }, [selectedValues, exclusiveSelection]);

  // Only meaningful while `lockedValues` is set: the pinned roster vs. what this editor added.
  const pinnedOptions = useMemo(
    () => selectedOptions.filter(opt => lockedValues?.has(opt.value)),
    [selectedOptions, lockedValues],
  );
  const addedByEditorOptions = useMemo(
    () => selectedOptions.filter(opt => !lockedValues?.has(opt.value)),
    [selectedOptions, lockedValues],
  );

  const isEmailLikeQuery = useMemo(() => {
    const query = searchQuery.trim();
    return query.includes('@');
  }, [searchQuery]);

  const visibleChannelMemberOptions = useMemo(() => {
    if (!channelMembersOptions) return [];

    const matchingOptions = channelMembersOptions.filter(opt =>
      opt.label.toLowerCase().includes(participantSearchQuery.toLowerCase()),
    );

    if (!hoistSelectedChannelMembers) return matchingOptions;

    return matchingOptions.sort((a, b) => {
      const aUserId = a.value.replace('user:', '');
      const bUserId = b.value.replace('user:', '');
      const aSelected = !excludedChannelMembers?.has(aUserId);
      const bSelected = !excludedChannelMembers?.has(bUserId);
      return Number(bSelected) - Number(aSelected);
    });
  }, [
    channelMembersOptions,
    excludedChannelMembers,
    hoistSelectedChannelMembers,
    participantSearchQuery,
  ]);

  const toggleValue = (value: string) => {
    if (lockedValues?.has(value) && selectedValues.includes(value)) return;

    const isChannel = value.startsWith('channel:');

    if (!selectedValues.includes(value) && hasChannelSelected && !isChannel) {
      return;
    }

    // Groups and channels still don't mix, but group + group does.
    if (!selectedValues.includes(value) && hasGroupSelected && isChannel) {
      return;
    }

    if (exclusiveSelection && isChannel && !selectedValues.includes(value)) {
      const option = options.find(opt => opt.value === value);
      if (option) {
        setSelectedOptionsMap(prev => new Map(prev).set(value, option));
      }
      void onMultiSelect([value]);
      setSearchQuery('');
      setIsOpen(false);
      return;
    }

    if (selectedValues.includes(value)) {
      void onMultiSelect(selectedValues.filter(v => v !== value));
    } else {
      const option = options.find(opt => opt.value === value);
      if (option) {
        setSelectedOptionsMap(prev => new Map(prev).set(value, option));
      }
      void onMultiSelect([...selectedValues, value]);
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

  const renderSelectedPill = (option: ParticipantOptions): React.ReactNode => (
    <div
      key={option.value}
      className='flex items-center gap-1 px-2 py-1 bg-card rounded-md text-sm border border-border'
    >
      {option.icon && <span>{option.icon}</span>}
      <span className='truncate max-w-60 text-foreground'>{option.label}</span>
      {!lockedValues?.has(option.value) && (
        <button
          type='button'
          onClick={e => {
            e.stopPropagation();
            toggleValue(option.value);
          }}
          className='ml-0.5 hover:bg-muted rounded p-0.5 text-foreground'
          data-track-category='CALLS'
          data-track-name='remove-participant'
        >
          <X className='size-3' />
        </button>
      )}
    </div>
  );

  const renderTrigger = () => {
    const selectedGroupOrChannel = exclusiveSelection
      ? selectedOptions.find(opt => opt.value.startsWith('channel:'))
      : undefined;

    if (selectedGroupOrChannel) {
      const allSelected = excludedChannelMembers && excludedChannelMembers.size === 0;
      const someSelected =
        excludedChannelMembers &&
        channelMembersOptions &&
        excludedChannelMembers.size > 0 &&
        excludedChannelMembers.size < channelMembersOptions.length;

      return (
        <div
          className={cn(
            'flex items-center justify-between transition-all duration-200',
            isOpen
              ? 'w-full h-10 px-2 border border-border rounded-lg bg-background'
              : 'w-auto inline-flex items-center gap-3',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-1 px-2 py-1 bg-card rounded-md text-sm border border-border',
              isOpen && 'flex-1',
            )}
          >
            {selectedGroupOrChannel.icon && (
              <span className='shrink-0'>{selectedGroupOrChannel.icon}</span>
            )}
            <span className='truncate text-foreground flex-1'>{selectedGroupOrChannel.label}</span>
            {channelMembersOptions &&
              channelMembersOptions.length > 0 &&
              toggleExcludedChannelMember && (
                <div className='flex items-center gap-2 mr-1 ml-auto shrink-0'>
                  {isOpen && (
                    <input
                      type='checkbox'
                      className='w-4 h-4 cursor-pointer'
                      title='Select All'
                      checked={!!allSelected}
                      data-track-category='CALLS'
                      data-track-name='select-all-channel-members'
                      ref={el => {
                        if (el) {
                          el.indeterminate = !!someSelected;
                        }
                      }}
                      onChange={e => {
                        const isSelectAll = e.target.checked;
                        toggleExcludedChannelMember(
                          '',
                          isSelectAll,
                          channelMembersOptions.map(opt => opt.value.replace('user:', '')),
                        );
                      }}
                    />
                  )}
                  <button
                    type='button'
                    data-track-category='CALLS'
                    data-track-name='toggle-channel-members-expand'
                    onClick={e => {
                      e.stopPropagation();
                      setIsOpen(!isOpen);
                    }}
                    className='hover:bg-muted rounded p-0.5 text-foreground'
                  >
                    {isOpen ? (
                      <ChevronUp className='size-3' />
                    ) : (
                      <ChevronRight className='size-3' />
                    )}
                  </button>
                </div>
              )}
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                toggleValue(selectedGroupOrChannel.value);
              }}
              className='ml-0.5 hover:bg-muted rounded p-0.5 text-foreground shrink-0'
              data-track-category='CALLS'
              data-track-name='remove-participant'
            >
              <X className='size-3' />
            </button>
          </div>
          {!isOpen && (
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                void onMultiSelect([]);
              }}
              className='text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0'
              data-track-category='CALLS'
              data-track-name='change-selection'
            >
              Change
            </button>
          )}
        </div>
      );
    }

    return (
      <div className='relative'>
        <div
          onClick={() => {
            inputRef.current?.focus();
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              inputRef.current?.focus();
            }
          }}
          role='button'
          tabIndex={0}
          className='relative flex items-center h-10 border border-border rounded-lg focus-within:border-foreground duration-300 ease-in-out bg-background'
          data-track-category='CALLS'
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
              placeholder={
                hasUserSelected ? 'Search by user name' : 'Search by user, channel, or group name'
              }
              value={searchQuery}
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
  };

  return (
    <div className='relative'>
      {hasChannelSelected ? (
        <>
          {renderTrigger()}
          {isOpen &&
            channelMembersOptions &&
            channelMembersOptions.length > 0 &&
            toggleExcludedChannelMember && (
              <div className='mt-2 w-full max-h-60 overflow-y-auto rounded-xl border border-border bg-background shadow-sm'>
                <div className='flex items-center px-3 py-2.5 border-b border-border sticky top-0 bg-background z-10'>
                  <Search className='w-4 h-4 text-muted-foreground mr-2 shrink-0' />
                  <input
                    type='text'
                    placeholder='Search participants...'
                    value={participantSearchQuery}
                    onChange={e => setParticipantSearchQuery(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                    data-track-category='CALLS'
                    data-track-name='channel-member-search'
                    className='flex-1 bg-transparent border-none focus:outline-none text-sm text-foreground placeholder:text-muted-foreground'
                  />
                </div>
                <div className='p-2'>
                  {visibleChannelMemberOptions.map(opt => {
                    const userId = opt.value.replace('user:', '');
                    const isChecked = !excludedChannelMembers?.has(userId);
                    return (
                      <div
                        key={opt.value}
                        className='flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm text-foreground hover:bg-muted'
                      >
                        <label className='flex items-center gap-2 flex-1 cursor-pointer min-w-0'>
                          {opt.icon && <span className='shrink-0'>{opt.icon}</span>}
                          <div className='flex-1 min-w-0 text-left truncate'>
                            <div className='truncate text-sm text-foreground'>{opt.label}</div>
                            {opt.subtitle && (
                              <div className='truncate text-xs text-muted-foreground'>
                                {opt.subtitle}
                              </div>
                            )}
                          </div>
                          <input
                            type='checkbox'
                            checked={isChecked}
                            onChange={() => toggleExcludedChannelMember(userId)}
                            data-track-category='CALLS'
                            data-track-name='toggle-channel-member-inclusion'
                            className='shrink-0'
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        </>
      ) : (
        <Popover.Root
          open={isOpen}
          onOpenChange={open => {
            if (open && isEmailLikeQuery) return;
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
              <>
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
                            onClick={() => {
                              toggleValue(option.value);
                              setIsOpen(false);
                            }}
                            onMouseEnter={() => setIndex(index)}
                            data-track-category='CALLS'
                            data-track-name='select-participant-option'
                            data-testid='participant-option'
                          >
                            {option.children ? (
                              option.children
                            ) : (
                              <>
                                {option.icon && <span>{option.icon}</span>}
                                <div className='flex-1 min-w-0 text-left'>
                                  <div className='truncate text-sm text-foreground'>
                                    {option.label}
                                  </div>
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
              </>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}

      {/* Restricted editors get the roster split into its own panel: one section for the
          people already on the call, one for the people they added. Mixing both into a
          single wrap left the removable pills indistinguishable from the pinned ones. */}
      {lockedValues && selectedOptions.length > 0 && !hasChannelSelected && (
        <div className='mt-2 rounded-xl border border-border bg-muted/20 divide-y divide-border overflow-hidden'>
          {pinnedOptions.length > 0 && (
            <div className='p-3 space-y-2'>
              <p className='text-xs text-muted-foreground'>Already in this call</p>
              <div className='flex flex-wrap gap-1.5 max-h-28 overflow-y-auto no-scrollbar'>
                {pinnedOptions.map(renderSelectedPill)}
              </div>
            </div>
          )}
          <div className='p-3 space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <p className='text-xs text-muted-foreground'>
                Added by you
                {addedByEditorOptions.length > 0 && ` (${addedByEditorOptions.length})`}
              </p>
              {addedByEditorOptions.length > 0 && (
                <button
                  type='button'
                  onClick={() =>
                    void onMultiSelect(selectedValues.filter(v => lockedValues.has(v)))
                  }
                  className='shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors'
                  data-track-category='CALLS'
                  data-track-name='clear-all-participants'
                >
                  Clear all
                </button>
              )}
            </div>
            {addedByEditorOptions.length > 0 ? (
              <div className='flex flex-wrap gap-1.5 max-h-28 overflow-y-auto no-scrollbar'>
                {addedByEditorOptions.map(renderSelectedPill)}
              </div>
            ) : (
              <p className='text-xs text-muted-foreground'>
                Search above to invite more people to this call.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Selected participants rendered below the search bar */}
      {!lockedValues && selectedOptions.length > 0 && !hasChannelSelected && (
        <div className='flex items-start justify-between mt-2'>
          <div className='flex flex-wrap gap-1.5 max-h-32 overflow-y-auto flex-1'>
            {selectedOptions.map(renderSelectedPill)}
          </div>
          <button
            type='button'
            onClick={() => void onMultiSelect([])}
            className='ml-2 shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5'
            data-track-category='CALLS'
            data-track-name='clear-all-participants'
          >
            Clear all
          </button>
        </div>
      )}

      {hasChannelSelected && (
        <p className='text-xs text-muted-foreground mt-1 px-1'>
          You can start a call with one channel at a time.
        </p>
      )}

      {helperText && <div className='text-xs text-muted-foreground mt-1 px-1'>{helperText}</div>}
    </div>
  );
};
