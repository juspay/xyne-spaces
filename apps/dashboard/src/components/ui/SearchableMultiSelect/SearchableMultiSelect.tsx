import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { CheckTickSingle, PlusDefault, SearchBig } from '@xyne/icons';
import Input from '../Input';
import { Popover } from '../Popover';
import { cn } from '../../../utils/classNames';
import type { SearchableMultiSelectProps } from './SearchableMultiSelect.types';

/**
 * Searchable, keyboard-navigable multi-select list rendered inside a popover.
 * The trigger is supplied by the caller, so the same list can hang off a filter
 * button, a tab, or any other control.
 *
 * @example
 * <SearchableMultiSelect
 *   options={[{ value: 'infra', label: 'infra' }]}
 *   selectedValues={selectedLabels}
 *   onSelectedValuesChange={setSelectedLabels}
 *   isOpen={isOpen}
 *   onOpenChange={setIsOpen}
 *   trigger={<Button>Labels</Button>}
 *   searchAriaLabel='Search labels'
 *   listAriaLabel='Labels'
 * />
 */
export function SearchableMultiSelect({
  options,
  selectedValues,
  onSelectedValuesChange,
  trigger,
  isOpen,
  onOpenChange,
  searchPlaceholder = 'Search...',
  searchMaxLength,
  searchAriaLabel,
  listAriaLabel,
  emptyMessage = 'No results found',
  onCreateOption,
  align = 'start',
  className,
  trackCategory,
  trackName,
}: SearchableMultiSelectProps): ReactElement {
  const [searchValue, setSearchValue] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = searchValue.trim();

  const visibleOptions = useMemo(() => {
    const query = trimmedQuery.toLowerCase();
    return query ? options.filter(option => option.label.toLowerCase().includes(query)) : options;
  }, [options, trimmedQuery]);

  const canCreate =
    onCreateOption !== undefined &&
    trimmedQuery.length > 0 &&
    !options.some(option => option.label.toLowerCase() === trimmedQuery.toLowerCase());

  /** Filtering reshuffles the list, so park the cursor back on the first match. */
  useEffect(() => {
    setActiveIndex(0);
  }, [searchValue]);

  const getOptionId = (index: number): string => `${listboxId}-option-${index}`;

  const toggleValue = (value: string): void => {
    onSelectedValuesChange(
      selectedValues.includes(value)
        ? selectedValues.filter(selected => selected !== value)
        : [...selectedValues, value],
    );
    setSearchValue('');
  };

  const handleOpenChange = (open: boolean): void => {
    onOpenChange(open);
    if (!open) {
      setSearchValue('');
      setActiveIndex(0);
    }
  };

  const createOption = (): void => {
    onCreateOption?.(trimmedQuery);
    setSearchValue('');
  };

  /** Accesibiliy navigation . */
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // Enter falls through to creation when nothing in the list is highlighted.
    if (event.key === 'Enter') {
      event.preventDefault();
      const activeOption = visibleOptions[activeIndex];
      if (activeOption) {
        toggleValue(activeOption.value);
      } else if (canCreate) {
        createOption();
      }
      return;
    }

    if (visibleOptions.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(current => (current + 1) % visibleOptions.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(current => (current - 1 + visibleOptions.length) % visibleOptions.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(visibleOptions.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}
      trigger={trigger}
      side='bottom'
      align={align}
      sideOffset={6}
      focusRef={searchInputRef}
      className={cn('min-w-52 rounded-xl border-border p-1.5 shadow-xl', className)}
    >
      <div className='flex h-8 items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5'>
        <SearchBig
          size={13}
          strokeWidth={2.2}
          className='shrink-0 text-muted-foreground'
          aria-hidden='true'
        />
        <Input
          ref={searchInputRef}
          type='text'
          role='combobox'
          value={searchValue}
          onChange={event => setSearchValue(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={searchPlaceholder}
          maxLength={searchMaxLength}
          className='h-auto min-w-0 flex-1 rounded-none border-0 p-0 text-sm shadow-none placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0'
          aria-label={searchAriaLabel}
          aria-expanded
          aria-autocomplete='list'
          aria-controls={listboxId}
          aria-activedescendant={visibleOptions.length > 0 ? getOptionId(activeIndex) : undefined}
        />
      </div>

      <div
        id={listboxId}
        role='listbox'
        aria-multiselectable='true'
        aria-label={listAriaLabel}
        className='thin-scrollbar mt-1.5 max-h-56 overflow-y-auto'
      >
        {visibleOptions.length === 0 && !canCreate ? (
          <p className='px-2 py-6 text-center text-xs text-muted-foreground'>{emptyMessage}</p>
        ) : (
          visibleOptions.map((option, index) => {
            const isSelected = selectedValues.includes(option.value);
            const isActive = index === activeIndex;
            // Selected neighbours merge into one block instead of showing a seam.
            const previousOption = visibleOptions[index - 1];
            const nextOption = visibleOptions[index + 1];
            const followsSelected =
              previousOption !== undefined && selectedValues.includes(previousOption.value);
            const precedesSelected =
              nextOption !== undefined && selectedValues.includes(nextOption.value);

            return (
              <div
                key={option.value}
                id={getOptionId(index)}
                role='option'
                tabIndex={-1}
                aria-selected={isSelected}
                onClick={() => toggleValue(option.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleValue(option.value);
                  }
                }}
                onMouseMove={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors',
                  (isSelected || isActive) && 'bg-accent',
                  isSelected && followsSelected && 'rounded-t-none',
                  isSelected && precedesSelected && 'rounded-b-none',
                )}
                data-track-category={trackCategory}
                data-track-name={trackName}
              >
                {option.icon}
                <span className='min-w-0 flex-1 truncate'>{option.label}</span>
                {isSelected && (
                  <CheckTickSingle className='size-4 shrink-0 text-primary' aria-hidden='true' />
                )}
              </div>
            );
          })
        )}
      </div>

      {canCreate && (
        <button
          type='button'
          onClick={createOption}
          className='mt-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          data-track-category={trackCategory}
          data-track-name='create_option'
        >
          <PlusDefault className='size-3.5 shrink-0' aria-hidden='true' />
          <span className='min-w-0 flex-1 truncate'>Create “{trimmedQuery}”</span>
        </button>
      )}
    </Popover>
  );
}
