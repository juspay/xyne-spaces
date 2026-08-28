import { useMemo, useState, type ReactElement } from 'react';
import { CheckTickSingle, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { TagMethod } from '@xyne/shared';
import { toast } from 'sonner';
import { SearchableMultiSelect } from '../ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../ui/SearchableMultiSelect/SearchableMultiSelect.types';
import { Button } from '../ui/Button/Button';
import {
  confirmRecordingLabelSuggestion,
  useResolvedRecordingLabels,
} from '../../hooks/useResolvedRecordingLabels';
import { cn } from '../../utils/classNames';
import { normalizeRecordingTags, slugifyRecordingLabel } from '../../utils/recordingUtils';
import { getTagTheme } from '../../utils/tagTheme';

export interface LabelPickerProps {
  labels: string[];
  canEdit: boolean;
  /** Labels already in use elsewhere, offered in the list before anything is typed. */
  suggestions: string[];
  /** Analytics namespace of the host screen, e.g. 'RecordingDetailV2' or 'CallDetail'. */
  trackCategory: string;
  onChange: (labels: string[]) => void;
}

const LABEL_MAX_LENGTH = 40;
/** Labels beyond this are blocked on add (existing AI suggestions past the cap aren't touched). */
const MAX_LABELS = 10;

const CHIP_BASE_CLASS_NAME =
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-xs font-medium whitespace-nowrap';

const SUGGESTION_CHIP_CLASS_NAME = cn(
  CHIP_BASE_CLASS_NAME,
  'border border-dashed border-muted-foreground/40',
);

const LIST_INHERITS_POPOVER_CLASS_NAME =
  '[[data-theme=midnight]_&_[role=listbox][aria-multiselectable]]:!bg-transparent';

export function LabelChip({
  label,
  onRemove,
  trackCategory,
}: {
  label: string;
  onRemove?: (() => void) | undefined;
  trackCategory?: string | undefined;
}): ReactElement {
  const theme = getTagTheme(label);
  return (
    <span className={cn(CHIP_BASE_CLASS_NAME, theme.bg, theme.text)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', theme.dot)} aria-hidden='true' />
      <span>{label}</span>
      {onRemove && (
        <button
          type='button'
          className='rounded-sm opacity-70 hover:opacity-100'
          aria-label={`Remove label ${label}`}
          onClick={onRemove}
          data-track-category={trackCategory}
          data-track-name='remove_recording_label'
        >
          <MultipleCrossCancelDefault className='size-3' aria-hidden='true' />
        </button>
      )}
    </span>
  );
}

/** An AI-suggested (unconfirmed) label — tick to keep it (moves into the confirmed pills), cross to discard it. */
export function SuggestedLabelChip({
  label,
  onConfirm,
  onReject,
  trackCategory,
}: {
  label: string;
  onConfirm: () => void;
  onReject: () => void;
  trackCategory: string;
}): ReactElement {
  const theme = getTagTheme(label);
  return (
    <span className={cn(SUGGESTION_CHIP_CLASS_NAME, 'text-foreground')}>
      <span className={cn('size-1.5 shrink-0 rounded-full', theme.dot)} aria-hidden='true' />
      <span>{label}</span>
      <button
        type='button'
        className='rounded-sm opacity-70 hover:opacity-100'
        aria-label={`Confirm suggested label ${label}`}
        onClick={event => {
          event.stopPropagation();
          onConfirm();
        }}
        data-track-category={trackCategory}
        data-track-name='confirm_suggested_label'
      >
        <CheckTickSingle className='size-3' aria-hidden='true' />
      </button>
      <button
        type='button'
        className='rounded-sm opacity-70 hover:opacity-100'
        aria-label={`Dismiss suggested label ${label}`}
        onClick={event => {
          event.stopPropagation();
          onReject();
        }}
        data-track-category={trackCategory}
        data-track-name='reject_suggested_label'
      >
        <MultipleCrossCancelDefault className='size-3' aria-hidden='true' />
      </button>
    </span>
  );
}

export function LabelPicker({
  labels,
  canEdit,
  suggestions,
  trackCategory,
  onChange,
}: LabelPickerProps): ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);
  const resolvable = useMemo(() => [...labels, ...suggestions], [labels, suggestions]);
  const { resolveLabel, resolveMethod } = useResolvedRecordingLabels(resolvable);

  // Confirmed labels (TagMethod.MANUAL) vs still-pending suggestions (LLM or AUTOMATED).
  const confirmedLabels = useMemo(
    () => labels.filter(id => resolveMethod(id) === TagMethod.MANUAL),
    [labels, resolveMethod],
  );
  const suggestedLabels = useMemo(
    () => (canEdit ? labels.filter(id => resolveMethod(id) !== TagMethod.MANUAL) : []),
    [labels, canEdit, resolveMethod],
  );

  const options = useMemo<SearchableMultiSelectOption[]>(
    () =>
      normalizeRecordingTags([...suggestions, ...labels])
        .filter(label => resolveMethod(label) === TagMethod.MANUAL)
        .map(label => ({ value: label, displayLabel: resolveLabel(label) }))
        .sort((left, right) => left.displayLabel.localeCompare(right.displayLabel))
        .map(({ value, displayLabel }) => ({
          // The value stays the stored label — an id for generated ones — so selecting
          // writes back what the call already holds.
          value,
          label: displayLabel,
          icon: (
            <span
              className={cn('size-2 shrink-0 rounded-full', getTagTheme(displayLabel).dot)}
              aria-hidden='true'
            />
          ),
        })),
    [labels, suggestions, resolveLabel, resolveMethod],
  );

  const handleCreate = (label: string): void => {
    if (confirmedLabels.length >= MAX_LABELS) {
      toast.error(`You can add up to ${MAX_LABELS} labels`);
      return;
    }
    const slug = slugifyRecordingLabel(label);
    if (!slug) {
      toast.error('Label needs at least one letter or number');
      return;
    }
    onChange(normalizeRecordingTags([...labels, slug]));
  };

  // `options` already excludes AI-suggested labels (filtered above), so a size increase
  // here always means a confirmed/manual label is being added.
  const handleSelectedValuesChange = (values: string[]): void => {
    if (values.length > labels.length && confirmedLabels.length >= MAX_LABELS) {
      toast.error(`You can add up to ${MAX_LABELS} labels`);
      return;
    }
    onChange(values);
  };

  /** Tick: keep the AI-suggested tag — flips its Tag row to `manual` in place, no labels change needed. */
  const handleConfirmSuggestion = async (labelId: string): Promise<void> => {
    const revertMethod = resolveMethod(labelId);
    try {
      await confirmRecordingLabelSuggestion(labelId, revertMethod);
    } catch {
      toast.error('Failed to confirm label');
    }
  };

  /** Cross: discard the AI-suggested tag — just drop its id from the call's labels. */
  const handleRejectSuggestion = (labelId: string): void => {
    onChange(labels.filter(id => id !== labelId));
  };

  const suggestionPills =
    canEdit && suggestedLabels.length > 0
      ? suggestedLabels.map(label => (
          <SuggestedLabelChip
            key={label}
            label={resolveLabel(label)}
            onConfirm={() => void handleConfirmSuggestion(label)}
            onReject={() => handleRejectSuggestion(label)}
            trackCategory={trackCategory}
          />
        ))
      : null;

  if (!canEdit) {
    if (labels.length === 0) return null;

    // Same flat pills as the owner's view — a read-only header shouldn't look
    // like a different screen — just no remove/add controls.
    return (
      <>
        {confirmedLabels.map(label => (
          <LabelChip key={label} label={resolveLabel(label)} />
        ))}
      </>
    );
  }

  return (
    <>
      {confirmedLabels.map(label => (
        <LabelChip
          key={label}
          label={resolveLabel(label)}
          onRemove={() => onChange(labels.filter(id => id !== label))}
          trackCategory={trackCategory}
        />
      ))}
      <SearchableMultiSelect
        options={options}
        selectedValues={labels}
        onSelectedValuesChange={handleSelectedValuesChange}
        onCreateOption={handleCreate}
        className={LIST_INHERITS_POPOVER_CLASS_NAME}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        searchPlaceholder='Search or create...'
        searchMaxLength={LABEL_MAX_LENGTH}
        searchAriaLabel='Search or create a label'
        listAriaLabel='Labels'
        emptyMessage='No labels yet'
        trackCategory={trackCategory}
        trackName='toggle_recording_label'
        trigger={
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-6 gap-1.5 rounded-lg border-dashed border-muted-foreground/40 pl-2 pr-2.5 text-xs font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            aria-label='Add a label'
            data-track-category={trackCategory}
            data-track-name='open_recording_labels'
          >
            <PlusDefault className='size-3.5' aria-hidden='true' />
            Label
          </Button>
        }
      />
      {suggestionPills}
    </>
  );
}
