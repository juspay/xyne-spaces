import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  MAX_FIELD_OPTIONS,
  createBulkOptionInputHandlers,
  mergeFieldOptions,
  normalizeFieldOptions,
  parseBulkOptions,
} from '../../../utils/board';
import type { BuilderFieldOption } from './FormBuilder.types';
import { SortableOptionRow } from './SortableOptionRow';

type OptionsEditMode = 'individual' | 'bulk';

const getOptionsSignature = (options: BuilderFieldOption[]): string =>
  JSON.stringify(options.map(option => [option.id, option.value]));

interface BulkOptionsFeedback {
  duplicatesRemoved: number;
  truncated: boolean;
}

interface FormFieldOptionsEditorProps {
  rowId: string;
  options: BuilderFieldOption[];
  disabled: boolean;
  /** Field-level problem with the option list (e.g. no options yet). */
  error?: string | undefined;
  /** Per-option problems keyed by option id (e.g. duplicate label). */
  optionErrors: ReadonlyMap<string, string>;
  /** Option ids keep their identity across every edit here; only new text gets a new id. */
  onChange: (next: BuilderFieldOption[]) => void;
  renderOptionChip?: ((option: BuilderFieldOption) => ReactNode) | undefined;
  renderOptionPanel?: ((option: BuilderFieldOption) => ReactNode) | undefined;
  trackingCategory: string;
}

/**
 * Option list of a select field: drag to reorder, edit in place, type or paste to add, or
 * switch to bulk mode to edit the whole list as text. Owns its own DndContext so each field's
 * options reorder independently.
 */
export const FormFieldOptionsEditor = ({
  rowId,
  options,
  disabled,
  error,
  optionErrors,
  onChange: onChangeProp,
  renderOptionChip,
  renderOptionPanel,
  trackingCategory,
}: FormFieldOptionsEditorProps): ReactElement => {
  const [editMode, setEditMode] = useState<OptionsEditMode>('individual');
  const [bulkDraft, setBulkDraft] = useState('');
  const [feedback, setFeedback] = useState<BulkOptionsFeedback | null>(null);

  // The bulk draft is a text copy of the options. If the options are replaced from outside
  // this editor (e.g. the field is linked to an existing field), the draft is rebuilt from
  // them — otherwise applying the stale draft would overwrite the new options.
  const lastEmittedSignatureRef = useRef(getOptionsSignature(options));
  const onChange = (next: BuilderFieldOption[]): void => {
    lastEmittedSignatureRef.current = getOptionsSignature(next);
    onChangeProp(next);
  };
  const optionsSignature = getOptionsSignature(options);
  useEffect(() => {
    if (optionsSignature === lastEmittedSignatureRef.current) return;
    lastEmittedSignatureRef.current = optionsSignature;
    setBulkDraft(
      options
        .map(option => option.value)
        .filter(Boolean)
        .join('\n'),
    );
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsSignature]);

  // 5px activation distance so a click on the grip that never moves does not start a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = options.findIndex(option => option.id === active.id);
    const to = options.findIndex(option => option.id === over.id);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(options, from, to));
  };

  // Adds one or more options at once (typed Enter or pasted list), de-duping and capping.
  const addOptions = (incoming: string[]): void => {
    const { options: merged, duplicatesRemoved, truncated } = mergeFieldOptions(options, incoming);
    onChange(merged);
    setFeedback({ duplicatesRemoved, truncated });
  };

  const bulkOptionInputHandlers = createBulkOptionInputHandlers(addOptions);

  const applyBulkDraft = (): void => {
    const {
      options: next,
      duplicatesRemoved,
      truncated,
    } = normalizeFieldOptions(parseBulkOptions(bulkDraft), options);
    setBulkDraft(next.map(option => option.value).join('\n'));
    // Blurring an unchanged draft must not count as an edit (it would stop live reseeding).
    if (getOptionsSignature(next) !== getOptionsSignature(options)) onChange(next);
    setFeedback({ duplicatesRemoved, truncated });
  };

  const toggleEditMode = (): void => {
    if (editMode === 'individual') {
      setEditMode('bulk');
      setBulkDraft(
        options
          .map(option => option.value)
          .filter(Boolean)
          .join('\n'),
      );
      setFeedback(null);
      return;
    }
    applyBulkDraft();
    setEditMode('individual');
  };

  return (
    <div className='flex flex-col gap-[8px] mt-2 px-[12px]'>
      <div className='flex items-center justify-between gap-2'>
        <label className='text-[12px] font-semibold' htmlFor={`options-${rowId}`}>
          Options
        </label>
        <button
          type='button'
          onClick={toggleEditMode}
          disabled={disabled}
          className='text-[12px] text-[#6276be] font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-50'
          data-track-category={trackingCategory}
          data-track-name={
            editMode === 'bulk' ? 'switch_to_individual_options' : 'switch_to_bulk_options'
          }
        >
          {editMode === 'bulk' ? 'Edit one at a time' : 'Bulk add'}
        </button>
      </div>

      {editMode === 'bulk' ? (
        <div className='flex flex-col gap-[6px]'>
          <textarea
            id={`options-${rowId}`}
            value={bulkDraft}
            onChange={e => setBulkDraft(e.target.value)}
            onBlur={applyBulkDraft}
            disabled={disabled}
            placeholder='One option per line. Paste from a spreadsheet, comma-separated list, etc.'
            rows={8}
            className='w-full min-h-[120px] max-h-[240px] px-[10px] py-[8px] text-[13px] text-foreground bg-background border border-border rounded-[8px] resize-y focus:outline-none focus:ring-1 focus:ring-[#6276be]/40'
            data-track-category={trackingCategory}
            data-track-name='bulk_options_textarea'
          />
          <div className='flex flex-col gap-[2px]'>
            <span className='text-[11px] text-muted-foreground'>
              {options.length > 0
                ? `${options.length} option${options.length === 1 ? '' : 's'}`
                : 'No options yet'}
              {feedback?.duplicatesRemoved
                ? ` · ${feedback.duplicatesRemoved} duplicate${
                    feedback.duplicatesRemoved === 1 ? '' : 's'
                  } removed`
                : ''}
            </span>
            <span className='text-[11px] text-muted-foreground'>
              Renaming an option here replaces it — fields that depend on it are removed.
            </span>
            {feedback?.truncated && (
              <span className='text-[11px] text-amber-600'>
                Maximum {MAX_FIELD_OPTIONS} options. Extra entries were removed.
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className='flex flex-col gap-[8px]'>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={options.map(option => option.id)}
              strategy={verticalListSortingStrategy}
            >
              {options.map((option, optionIndex) => (
                <SortableOptionRow
                  key={option.id}
                  id={option.id}
                  value={option.value}
                  placeholder={`Option ${optionIndex + 1}`}
                  disabled={disabled}
                  error={optionErrors.get(option.id)}
                  chip={renderOptionChip?.(option)}
                  onChange={value =>
                    onChange(
                      options.map(current =>
                        current.id === option.id ? { ...current, value } : current,
                      ),
                    )
                  }
                  onRemove={() => onChange(options.filter(current => current.id !== option.id))}
                  trackingCategory={trackingCategory}
                >
                  {renderOptionPanel?.(option)}
                </SortableOptionRow>
              ))}
            </SortableContext>
          </DndContext>

          <div className='flex flex-col gap-[4px]'>
            <div className='flex items-center gap-[8px] px-[6px] py-[4px]'>
              <input
                id={`options-${rowId}`}
                type='text'
                disabled={disabled}
                placeholder={
                  options.length
                    ? 'Add another option (paste multiple at once)'
                    : 'Add option (paste multiple at once)'
                }
                className='flex-1 text-[13px] bg-transparent border-0 focus:outline-none focus:ring-0 p-0'
                onKeyDown={bulkOptionInputHandlers.onKeyDown}
                onPaste={bulkOptionInputHandlers.onPaste}
                data-track-category={trackingCategory}
                data-track-name='add_option'
              />
              <span className='text-[14px] text-muted-foreground font-medium'>⏎</span>
            </div>
            {feedback && (feedback.duplicatesRemoved > 0 || feedback.truncated) && (
              <span className='text-[11px] text-muted-foreground px-[6px]'>
                {feedback.duplicatesRemoved > 0 &&
                  `${feedback.duplicatesRemoved} duplicate${
                    feedback.duplicatesRemoved === 1 ? '' : 's'
                  } skipped`}
                {feedback.duplicatesRemoved > 0 && feedback.truncated && ' · '}
                {feedback.truncated && `Maximum ${MAX_FIELD_OPTIONS} options`}
              </span>
            )}
          </div>
        </div>
      )}

      {error && <p className='text-[11px] text-destructive px-[6px]'>{error}</p>}
    </div>
  );
};
