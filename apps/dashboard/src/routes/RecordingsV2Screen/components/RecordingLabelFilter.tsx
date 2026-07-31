import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CheckTickSingle, ChevronDown, ChevronUp, SearchBig } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import Input from '../../../components/ui/Input';
import { cn } from '../../../utils/classNames';
import { getRecordingTagDotColor } from '../utils/RecordingsV2.utils';

interface RecordingLabelFilterProps {
  labels: string[];
  selectedLabels: string[];
  onSelectedLabelsChange: (labels: string[]) => void;
  /** Resolves a label value (Tag id) to its display text. Defaults to identity. */
  resolveLabel?: (label: string) => string;
}

const TRIGGER_CLASS_NAME = 'h-9 gap-1.5 rounded-xl border-border px-3 font-medium shadow-none';

export function RecordingLabelFilter({
  labels,
  selectedLabels,
  onSelectedLabelsChange,
  resolveLabel = (label: string) => label,
}: RecordingLabelFilterProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const visibleLabels = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    return query
      ? labels.filter(label => resolveLabel(label).toLowerCase().includes(query))
      : labels;
  }, [labels, searchValue, resolveLabel]);

  /** Filtering reshuffles the list, so park the cursor back on the first match. */
  useEffect(() => {
    setActiveIndex(0);
  }, [searchValue]);

  const getOptionId = (index: number): string => `${listboxId}-option-${index}`;

  const toggleLabel = (label: string): void => {
    onSelectedLabelsChange(
      selectedLabels.includes(label)
        ? selectedLabels.filter(selected => selected !== label)
        : [...selectedLabels, label],
    );
  };

  const handleOpenChange = (open: boolean): void => {
    setIsOpen(open);
    if (!open) {
      setSearchValue('');
      setActiveIndex(0);
    }
  };

  /** Accesibiliy navigation . */
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (visibleLabels.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(current => (current + 1) % visibleLabels.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(current => (current - 1 + visibleLabels.length) % visibleLabels.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(visibleLabels.length - 1);
        break;
      case 'Enter': {
        event.preventDefault();
        const activeLabel = visibleLabels[activeIndex];
        if (activeLabel) toggleLabel(activeLabel);
        break;
      }
      default:
        break;
    }
  };

  if (labels.length === 0) {
    return (
      <Button
        type='button'
        variant='outline'
        disabled
        className={TRIGGER_CLASS_NAME}
        aria-label='Label filter unavailable because no recordings are labelled'
      >
        Labels
        <ChevronDown className='size-4' aria-hidden='true' />
      </Button>
    );
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <Button
          type='button'
          variant='outline'
          className={cn(
            selectedLabels.length === 0 ? 'text-muted-foreground' : '!border-foreground',
            TRIGGER_CLASS_NAME,
          )}
          aria-label={
            selectedLabels.length > 0
              ? `Labels, ${selectedLabels.length} selected`
              : 'Filter recordings by label'
          }
          data-track-category='RecordingsV2'
          data-track-name='open_label_filter'
        >
          Labels
          {selectedLabels.length > 0 && (
            <span className='flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-xs font-semibold leading-none tabular-nums text-background'>
              {selectedLabels.length}
            </span>
          )}
          {isOpen ? (
            <ChevronUp className='size-4 text-muted-foreground' aria-hidden='true' />
          ) : (
            <ChevronDown className='size-4 text-muted-foreground' aria-hidden='true' />
          )}
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={6}
          className='z-50 min-w-52 rounded-xl border border-border p-1.5 shadow-xl'
          onOpenAutoFocus={event => {
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
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
              placeholder='Search...'
              className='h-auto min-w-0 flex-1 rounded-none border-0 p-0 text-sm shadow-none placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0'
              aria-label='Search labels'
              aria-expanded
              aria-autocomplete='list'
              aria-controls={listboxId}
              aria-activedescendant={
                visibleLabels.length > 0 ? getOptionId(activeIndex) : undefined
              }
            />
          </div>

          <div
            id={listboxId}
            role='listbox'
            aria-multiselectable='true'
            aria-label='Labels'
            className='thin-scrollbar mt-1.5 max-h-56 overflow-y-auto'
          >
            {visibleLabels.length === 0 ? (
              <p className='px-2 py-6 text-center text-xs text-muted-foreground'>No labels found</p>
            ) : (
              visibleLabels.map((label, index) => {
                const isSelected = selectedLabels.includes(label);
                const isActive = index === activeIndex;
                // Selected neighbours merge into one block instead of showing a seam.
                const previousLabel = visibleLabels[index - 1];
                const nextLabel = visibleLabels[index + 1];
                const followsSelected =
                  previousLabel !== undefined && selectedLabels.includes(previousLabel);
                const precedesSelected =
                  nextLabel !== undefined && selectedLabels.includes(nextLabel);

                return (
                  <div
                    key={label}
                    id={getOptionId(index)}
                    ref={node => {
                      optionRefs.current[index] = node;
                    }}
                    role='option'
                    tabIndex={-1}
                    aria-selected={isSelected}
                    onClick={() => toggleLabel(label)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleLabel(label);
                      }
                    }}
                    onMouseMove={() => setActiveIndex(index)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors',
                      (isSelected || isActive) && 'bg-accent',
                      isSelected && followsSelected && 'rounded-t-none',
                      isSelected && precedesSelected && 'rounded-b-none',
                    )}
                    data-track-category='RecordingsV2'
                    data-track-name='toggle_label_filter'
                  >
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        getRecordingTagDotColor(resolveLabel(label)),
                      )}
                      aria-hidden='true'
                    />
                    <span className='min-w-0 flex-1 truncate'>{resolveLabel(label)}</span>
                    {isSelected && (
                      <CheckTickSingle
                        className='size-4 shrink-0 text-primary'
                        aria-hidden='true'
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
