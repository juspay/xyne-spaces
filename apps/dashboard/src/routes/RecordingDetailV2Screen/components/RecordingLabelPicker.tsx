import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp, Tag } from '@xyne/icons';
import { SearchableMultiSelect } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect.types';
import { Button } from '../../../components/ui/Button/Button';
import { useRecordingLabelSuggestions } from '../../../hooks/useRecordingLabelSuggestions';
import { useResolvedRecordingLabels } from '../../../hooks/useResolvedRecordingLabels';
import { cn } from '../../../utils/classNames';
import { getRecordingTagDotColor, normalizeRecordingTags } from '../../../utils/recordingUtils';

export interface RecordingLabelPickerProps {
  labels: string[];
  /** Only the recording owner can change labels; everyone else sees them read-only. */
  canEdit: boolean;
  onChange: (labels: string[]) => void;
}

/** Labels beyond this collapse into a "+n" chip so the header stays on one line. */
const MAX_VISIBLE_LABELS = 3;

const CHIP_CLASS_NAME =
  'inline-flex items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground';

/**
 * Mirrors the owner's trigger — Button `outline` + `sm` with the same overrides
 * applied below — as a static frame, so both states read as the same control.
 */
const READ_ONLY_TRIGGER_CLASS_NAME =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border bg-background px-2 text-xs font-normal text-foreground shadow-xs';

function LabelChip({ label }: { label: string }): ReactElement {
  return (
    <span className={CHIP_CLASS_NAME}>
      <span
        className={cn('size-1.5 shrink-0 rounded-full', getRecordingTagDotColor(label))}
        aria-hidden='true'
      />
      <span className='max-w-24 truncate'>{label}</span>
    </span>
  );
}

/**
 * Label picker for the recording detail header: the trigger previews the applied
 * labels and opens a searchable multi-select that can also create new labels.
 *
 * Call.labels holds Tag ids for anything the summary pipeline generated, and the raw
 * text for anything typed in here. Resolving covers both: an id becomes the tag's
 * text, and text that resolves to nothing falls back to itself.
 */
export function RecordingLabelPicker({
  labels,
  canEdit,
  onChange,
}: RecordingLabelPickerProps): ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);
  const suggestions = useRecordingLabelSuggestions(canEdit);
  const resolvable = useMemo(() => [...labels, ...suggestions], [labels, suggestions]);
  const { resolveLabel } = useResolvedRecordingLabels(resolvable);

  const options = useMemo<SearchableMultiSelectOption[]>(
    () =>
      normalizeRecordingTags([...suggestions, ...labels])
        .map(label => ({ value: label, displayLabel: resolveLabel(label) }))
        .sort((left, right) => left.displayLabel.localeCompare(right.displayLabel))
        .map(({ value, displayLabel }) => ({
          // The value stays the stored label — an id for generated ones — so selecting
          // writes back what the recording already holds.
          value,
          label: displayLabel,
          icon: (
            <span
              className={cn('size-2 shrink-0 rounded-full', getRecordingTagDotColor(displayLabel))}
              aria-hidden='true'
            />
          ),
        })),
    [labels, suggestions, resolveLabel],
  );

  const visibleLabels = labels.slice(0, MAX_VISIBLE_LABELS);
  const overflowCount = labels.length - visibleLabels.length;

  const handleCreate = (label: string): void => {
    onChange(normalizeRecordingTags([...labels, label]));
  };

  /** Identical in both states — only the chevron and the interaction differ. */
  const appliedLabels = (
    <>
      {visibleLabels.map(label => (
        <LabelChip key={label} label={resolveLabel(label)} />
      ))}
      {overflowCount > 0 && (
        <span
          className={cn(CHIP_CLASS_NAME, 'text-muted-foreground')}
          title={labels.slice(MAX_VISIBLE_LABELS).map(resolveLabel).join(', ')}
        >
          +{overflowCount}
        </span>
      )}
    </>
  );

  if (!canEdit) {
    if (labels.length === 0) return null;

    // Same frame as the owner's trigger — a shared recording's header shouldn't look
    // like a different screen — but with no chevron and nothing to click.
    return (
      <div className={READ_ONLY_TRIGGER_CLASS_NAME} aria-label={`Labels, ${labels.length} applied`}>
        {appliedLabels}
      </div>
    );
  }

  return (
    <SearchableMultiSelect
      options={options}
      selectedValues={labels}
      onSelectedValuesChange={onChange}
      onCreateOption={handleCreate}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      searchPlaceholder='Search or create...'
      searchAriaLabel='Search or create a label'
      listAriaLabel='Labels'
      emptyMessage='No labels yet'
      trackCategory='RecordingDetailV2'
      trackName='toggle_recording_label'
      trigger={
        <Button
          type='button'
          variant='outline'
          size='sm'
          className={cn(
            'h-7 gap-1.5 rounded-lg text-xs font-normal',
            labels.length === 0
              ? 'border-dashed border-muted-foreground/40 px-3 text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              : 'px-2',
          )}
          aria-label={
            labels.length > 0 ? `Labels, ${labels.length} applied` : 'Add a label to this recording'
          }
          data-track-category='RecordingDetailV2'
          data-track-name='open_recording_labels'
        >
          {labels.length === 0 ? (
            <>
              <Tag className='size-3.5' aria-hidden='true' />
              Add label
            </>
          ) : (
            appliedLabels
          )}
          {isOpen ? (
            <ChevronUp className='size-3.5 text-muted-foreground' aria-hidden='true' />
          ) : (
            <ChevronDown className='size-3.5 text-muted-foreground' aria-hidden='true' />
          )}
        </Button>
      }
    />
  );
}
