import { useMemo, useState, type ReactElement } from 'react';
import { Check, X } from 'lucide-react';
import { ChevronDown, ChevronUp, Tag } from '@xyne/icons';
import { TagMethod } from '@xyne/shared';
import { toast } from 'sonner';
import { SearchableMultiSelect } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect.types';
import { Button } from '../../../components/ui/Button/Button';
import { tagsApi } from '../../../api/tagsApi';
import { useOverflowFit } from '../../../hooks/useOverflowFit';
import { useRecordingLabelSuggestions } from '../../../hooks/useRecordingLabelSuggestions';
import {
  markResolvedRecordingLabelMethod,
  useResolvedRecordingLabels,
} from '../../../hooks/useResolvedRecordingLabels';
import { cn } from '../../../utils/classNames';
import {
  getRecordingTagDotColor,
  normalizeRecordingTags,
  slugifyRecordingLabel,
} from '../../../utils/recordingUtils';

export interface RecordingLabelPickerProps {
  labels: string[];
  canEdit: boolean;
  onChange: (labels: string[]) => void;
}

const LABEL_STRIP_MAX_WIDTH = 388;
const LABEL_CHIP_GAP = 6;
const LABEL_MAX_LENGTH = 40;

const CHIP_CLASS_NAME =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground whitespace-nowrap scrollbar-none data-[theme=midnight]:bg-muted/50';

const SUGGESTION_CHIP_CLASS_NAME =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/40 px-1.5 h-7 text-xs font-medium text-foreground whitespace-nowrap scrollbar-none';

const READ_ONLY_TRIGGER_CLASS_NAME =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border bg-background px-2 text-xs font-normal text-foreground shadow-xs';

const LIST_INHERITS_POPOVER_CLASS_NAME =
  '[[data-theme=midnight]_&_[role=listbox][aria-multiselectable]]:!bg-transparent';

function LabelChip({
  label,
  canTruncate = false,
}: {
  label: string;
  canTruncate?: boolean;
}): ReactElement {
  return (
    <span className={cn(CHIP_CLASS_NAME, canTruncate && 'min-w-0 shrink')}>
      <span
        className={cn('size-1.5 shrink-0 rounded-full', getRecordingTagDotColor(label))}
        aria-hidden='true'
      />
      <span className={cn(canTruncate && 'truncate')}>{label}</span>
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
        .filter(label => resolveMethod(label) !== TagMethod.LLM)
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
    [labels, suggestions, resolveLabel, resolveMethod],
  );

  const { measureRef, visibleCount } = useOverflowFit<HTMLSpanElement>({
    itemCount: confirmedLabels.length,
    containerWidth: LABEL_STRIP_MAX_WIDTH,
    gap: LABEL_CHIP_GAP,
    minVisible: 1,
  });

  const shownCount = Math.min(visibleCount, confirmedLabels.length);
  const visibleLabels = confirmedLabels.slice(0, shownCount);
  const overflowCount = confirmedLabels.length - visibleLabels.length;

  const handleCreate = (label: string): void => {
    const slug = slugifyRecordingLabel(label);
    if (!slug) {
      toast.error('Label needs at least one letter or number');
      return;
    }
    onChange(normalizeRecordingTags([...labels, slug]));
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
    <span
      className='relative flex flex-nowrap items-center gap-1.5 overflow-hidden'
      style={{ maxWidth: LABEL_STRIP_MAX_WIDTH }}
    >
      <span
        ref={measureRef}
        aria-hidden='true'
        className='pointer-events-none invisible absolute left-0 top-0 flex w-max flex-nowrap items-center gap-1.5'
      >
        {confirmedLabels.map(label => (
          <LabelChip key={label} label={resolveLabel(label)} />
        ))}
        <span className={cn(CHIP_CLASS_NAME, 'text-muted-foreground')}>
          +{confirmedLabels.length}
        </span>
      </span>

      {visibleLabels.map(label => (
        <LabelChip key={label} label={resolveLabel(label)} canTruncate />
      ))}
      {overflowCount > 0 && (
        <span
          className={cn(CHIP_CLASS_NAME, 'text-muted-foreground')}
          title={confirmedLabels.slice(shownCount).map(resolveLabel).join(', ')}
        >
          +{overflowCount}
        </span>
      )}
    </span>
  );

  const suggestionPills =
    canEdit && suggestedLabels.length > 0
      ? suggestedLabels.map(label => (
          <SuggestedLabelChip
            key={label}
            label={resolveLabel(label)}
            onConfirm={() => void handleConfirmSuggestion(label)}
            onReject={() => handleRejectSuggestion(label)}
          />
        ))
      : null;

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
    <>
      <SearchableMultiSelect
        options={options}
        selectedValues={labels}
        onSelectedValuesChange={onChange}
        onCreateOption={handleCreate}
        className={LIST_INHERITS_POPOVER_CLASS_NAME}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        searchPlaceholder='Search or create...'
        searchMaxLength={LABEL_MAX_LENGTH}
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
              'h-7 gap-1.5 rounded-lg text-xs font-normal ',
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
    </>
  );
}
