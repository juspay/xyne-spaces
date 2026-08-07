import { useMemo, useState, type ReactElement } from 'react';
import { Check, X } from 'lucide-react';
import { ChevronDown, ChevronUp, Tag } from '@xyne/icons';
import { TagMethod } from '@xyne/shared';
import { toast } from 'sonner';
import { SearchableMultiSelect } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect.types';
import { Button } from '../../../components/ui/Button/Button';
import { tagsApi } from '../../../api/tagsApi';
import { useRecordingLabelSuggestions } from '../../../hooks/useRecordingLabelSuggestions';
import {
  markResolvedRecordingLabelMethod,
  useResolvedRecordingLabels,
} from '../../../hooks/useResolvedRecordingLabels';
import { cn } from '../../../utils/classNames';
import { getRecordingTagDotColor, normalizeRecordingTags } from '../../../utils/recordingUtils';

export interface RecordingLabelPickerProps {
  labels: string[];
  canEdit: boolean;
  onChange: (labels: string[]) => void;
}

/** Labels beyond this collapse into a "+n" chip so the header stays on one line. */
const MAX_VISIBLE_LABELS = 3;

const CHIP_CLASS_NAME =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground whitespace-nowrap scrollbar-none data-[theme=midnight]:bg-muted/50';

const SUGGESTION_CHIP_CLASS_NAME =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs font-medium text-foreground whitespace-nowrap scrollbar-none';

const READ_ONLY_TRIGGER_CLASS_NAME =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border bg-background px-2 text-xs font-normal text-foreground shadow-xs';

function LabelChip({ label }: { label: string }): ReactElement {
  return (
    <span className={CHIP_CLASS_NAME}>
      <span
        className={cn('size-1.5 shrink-0 rounded-full', getRecordingTagDotColor(label))}
        aria-hidden='true'
      />
      <span>{label}</span>
    </span>
  );
}

/** An AI-suggested (unconfirmed) label — tick to keep it (moves into the label box), cross to discard it. */
function SuggestedLabelChip({
  label,
  onConfirm,
  onReject,
}: {
  label: string;
  onConfirm: () => void;
  onReject: () => void;
}): ReactElement {
  return (
    <span className={SUGGESTION_CHIP_CLASS_NAME}>
      <span
        className={cn('size-1.5 shrink-0 rounded-full', getRecordingTagDotColor(label))}
        aria-hidden='true'
      />
      <span>{label}</span>
      <button
        type='button'
        className='rounded-sm text-muted-foreground hover:text-foreground'
        aria-label={`Confirm suggested label ${label}`}
        onClick={onConfirm}
        data-track-category='RecordingDetailV2'
        data-track-name='confirm_suggested_label'
      >
        <Check className='size-3' aria-hidden='true' />
      </button>
      <button
        type='button'
        className='rounded-sm text-muted-foreground hover:text-foreground'
        aria-label={`Dismiss suggested label ${label}`}
        onClick={onReject}
        data-track-category='RecordingDetailV2'
        data-track-name='reject_suggested_label'
      >
        <X className='size-3' aria-hidden='true' />
      </button>
    </span>
  );
}

export function RecordingLabelPicker({
  labels,
  canEdit,
  onChange,
}: RecordingLabelPickerProps): ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);
  const suggestions = useRecordingLabelSuggestions(canEdit);
  const resolvable = useMemo(() => [...labels, ...suggestions], [labels, suggestions]);
  const { resolveLabel, resolveMethod } = useResolvedRecordingLabels(resolvable);

  // Unconfirmed AI suggestions render as standalone pills outside the label box —
  // ticking one flips it to `manual` (see handleConfirmSuggestion) so it then falls
  // into confirmedLabels and appears inside the box on the next render.
  const confirmedLabels = useMemo(
    () => (canEdit ? labels.filter(id => resolveMethod(id) !== TagMethod.LLM) : labels),
    [labels, canEdit, resolveMethod],
  );
  const suggestedLabels = useMemo(
    () => (canEdit ? labels.filter(id => resolveMethod(id) === TagMethod.LLM) : []),
    [labels, canEdit, resolveMethod],
  );

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

  const visibleLabels = confirmedLabels.slice(0, MAX_VISIBLE_LABELS);
  const overflowCount = confirmedLabels.length - visibleLabels.length;

  const handleCreate = (label: string): void => {
    onChange(normalizeRecordingTags([...labels, label]));
  };

  /** Tick: keep the AI-suggested tag — flips its Tag row to `manual` in place, no labels change needed. */
  const handleConfirmSuggestion = async (labelId: string): Promise<void> => {
    markResolvedRecordingLabelMethod(labelId, TagMethod.MANUAL);
    try {
      await tagsApi.confirmTag(labelId);
    } catch {
      markResolvedRecordingLabelMethod(labelId, TagMethod.LLM);
      toast.error('Failed to confirm label');
    }
  };

  /** Cross: discard the AI-suggested tag — just drop its id from the recording's labels. */
  const handleRejectSuggestion = (labelId: string): void => {
    onChange(labels.filter(id => id !== labelId));
  };

  const appliedLabels = (
    <span className='flex max-w-76 w-full items-center gap-1.5 overflow-x-scroll scrollbar-none'>
      {visibleLabels.map(label => (
        <LabelChip key={label} label={resolveLabel(label)} />
      ))}
      {overflowCount > 0 && (
        <span
          className={cn(CHIP_CLASS_NAME, 'text-muted-foreground')}
          title={confirmedLabels.slice(MAX_VISIBLE_LABELS).map(resolveLabel).join(', ')}
        >
          +{overflowCount}
        </span>
      )}
    </span>
  );

  const suggestionPills =
    canEdit && suggestedLabels.length > 0 ? (
      <span className='flex shrink-0 items-center gap-1.5'>
        {suggestedLabels.map(label => (
          <SuggestedLabelChip
            key={label}
            label={resolveLabel(label)}
            onConfirm={() => void handleConfirmSuggestion(label)}
            onReject={() => handleRejectSuggestion(label)}
          />
        ))}
      </span>
    ) : null;

  if (!canEdit) {
    if (labels.length === 0) return null;

    // Same frame as the owner's trigger — a shared recording's header shouldn't look
    // like a different screen — but with no chevron and nothing to click.
    return (
      <div className={READ_ONLY_TRIGGER_CLASS_NAME} aria-label={`Labels, ${labels.length} applied`}>
        <Tag className='size-3.5 shrink-0' aria-hidden='true' />
        {appliedLabels}
      </div>
    );
  }

  return (
    <div className='flex items-center gap-1.5'>
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
              confirmedLabels.length === 0
                ? 'border-dashed border-muted-foreground/40 px-3 text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                : 'px-2',
            )}
            aria-label={
              confirmedLabels.length > 0
                ? `Labels, ${confirmedLabels.length} applied`
                : 'Add a label to this recording'
            }
            data-track-category='RecordingDetailV2'
            data-track-name='open_recording_labels'
          >
            <Tag className='size-3.5' aria-hidden='true' />
            {confirmedLabels.length === 0 ? 'Add label' : appliedLabels}
            {isOpen ? (
              <ChevronUp className='size-3.5 text-muted-foreground' aria-hidden='true' />
            ) : (
              <ChevronDown className='size-3.5 text-muted-foreground' aria-hidden='true' />
            )}
          </Button>
        }
      />
      {suggestionPills}
    </div>
  );
}
