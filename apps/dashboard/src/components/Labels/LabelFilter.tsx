import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp } from '@xyne/icons';
import { SearchableMultiSelect } from '../ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../ui/SearchableMultiSelect/SearchableMultiSelect.types';
import { Button } from '../ui/Button/Button';
import { cn } from '../../utils/classNames';
import { getTagDotColor } from '../../utils/tagTheme';

export interface LabelFilterProps {
  labels: string[];
  selectedLabels: string[];
  onSelectedLabelsChange: (labels: string[]) => void;
  /** Resolves a label value (Tag id) to its display text. Defaults to identity. */
  resolveLabel?: ((label: string) => string) | undefined;
  /** Analytics namespace of the host screen, e.g. 'RecordingsV2' or 'CallHistory'. */
  trackCategory: string;
  /** aria-label for the enabled trigger, e.g. 'Filter calls by label'. */
  triggerAriaLabel: string;
  /** aria-label for the disabled trigger — say why it can't be used. */
  disabledAriaLabel: string;
  /** Forces the disabled state even when labels exist (e.g. rows can't carry labels). */
  isDisabled?: boolean | undefined;
  /** Overrides the trigger's default sizing, to match whatever sits beside it. */
  triggerClassName?: string | undefined;
}

const TRIGGER_CLASS_NAME = 'h-9 gap-1.5 rounded-xl border-border px-3 font-medium shadow-none';
const LIST_INHERITS_POPOVER_CLASS_NAME =
  '[[data-theme=midnight]_&_[role=listbox][aria-multiselectable]]:!bg-transparent';

export function LabelFilter({
  labels,
  selectedLabels,
  onSelectedLabelsChange,
  resolveLabel = (label: string) => label,
  trackCategory,
  triggerAriaLabel,
  disabledAriaLabel,
  isDisabled = false,
  triggerClassName = TRIGGER_CLASS_NAME,
}: LabelFilterProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  // Values stay Tag ids — what the selection is keyed by — while the resolved text
  // drives both the visible label and SearchableMultiSelect's own search filtering.
  const options = useMemo<SearchableMultiSelectOption[]>(
    () =>
      labels.map(label => {
        const displayLabel = resolveLabel(label);
        return {
          value: label,
          label: displayLabel,
          icon: (
            <span
              className={cn('size-2 shrink-0 rounded-full', getTagDotColor(displayLabel))}
              aria-hidden='true'
            />
          ),
        };
      }),
    [labels, resolveLabel],
  );

  if (isDisabled || labels.length === 0) {
    return (
      <Button
        type='button'
        variant='outline'
        disabled
        className={triggerClassName}
        aria-label={disabledAriaLabel}
      >
        Labels
        <ChevronDown className='size-4' aria-hidden='true' />
      </Button>
    );
  }

  return (
    <SearchableMultiSelect
      options={options}
      selectedValues={selectedLabels}
      onSelectedValuesChange={onSelectedLabelsChange}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      searchAriaLabel='Search labels'
      listAriaLabel='Labels'
      emptyMessage='No labels found'
      trackCategory={trackCategory}
      trackName='toggle_label_filter'
      className={LIST_INHERITS_POPOVER_CLASS_NAME}
      trigger={
        <Button
          type='button'
          variant='outline'
          className={cn(
            selectedLabels.length === 0 ? 'text-muted-foreground' : '!border-foreground',
            triggerClassName,
          )}
          aria-label={
            selectedLabels.length > 0
              ? `Labels, ${selectedLabels.length} selected`
              : triggerAriaLabel
          }
          data-track-category={trackCategory}
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
      }
    />
  );
}
