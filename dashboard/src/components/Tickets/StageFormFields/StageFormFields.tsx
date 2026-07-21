import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { FormFieldType, isFieldActive, parseFieldOptionValues } from '@xyne/shared';
import type { FormEntityValues, MessageAttachment } from '@xyne/shared';
import { StageFormDocField } from '../StageFormModal/StageFormDocField';
import { MultiSelect } from '../../ui/MultiSelect/MultiSelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { ResolvedDisplayFormField } from '../../../utils/board/resolveDisplayFormFields';

export type StageFormDocLocalChange = { file: File } | { removed: true };
type FormEntityValueForRender = FormEntityValues & {
  readonly attachments?: readonly MessageAttachment[] | null;
};

export const stageFormControlClassName =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70 dark:[color-scheme:dark]';

const stringValuesFromJson = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
};

interface StageFormFieldsProps {
  fields: ResolvedDisplayFormField[];
  formData: Record<string, string[]>;
  setFormData: Dispatch<SetStateAction<Record<string, string[]>>>;
  localDocChanges: Map<string, StageFormDocLocalChange>;
  setLocalDocChanges: Dispatch<SetStateAction<Map<string, StageFormDocLocalChange>>>;
  valuesForRender: readonly FormEntityValueForRender[];
  targetStageId: string;
  disabled?: boolean;
  readOnlyDocs?: boolean;
  showPersistedDocValues?: boolean;
  idPrefix: string;
  trackNamePrefix: string;
}

export const StageFormFields = ({
  fields,
  formData,
  setFormData,
  localDocChanges,
  setLocalDocChanges,
  valuesForRender,
  targetStageId,
  disabled = false,
  readOnlyDocs = false,
  showPersistedDocValues = true,
  idPrefix,
  trackNamePrefix,
}: StageFormFieldsProps): React.JSX.Element => {
  const docAttachmentIds = useMemo(() => {
    const attachmentIds = new Set<string>();
    fields.forEach(field => {
      if (field.fieldType !== FormFieldType.DOC) return;
      (formData[field.id] ?? []).forEach(value => {
        if (value) attachmentIds.add(value);
      });
      if (showPersistedDocValues) {
        valuesForRender
          .filter(value => value.fieldId === field.id && value.contextId === targetStageId)
          .forEach(value => {
            stringValuesFromJson(value.actualFieldValue).forEach(attachmentId => {
              attachmentIds.add(attachmentId);
            });
          });
      }
    });
    return Array.from(attachmentIds);
  }, [fields, formData, showPersistedDocValues, targetStageId, valuesForRender]);

  const [attachmentsByIdResult] = useCachedQuery(
    queries.attachmentsByIds({ attachmentIds: docAttachmentIds }),
    { enabled: docAttachmentIds.length > 0 },
  );

  const attachmentById = useMemo(() => {
    const attachments = Array.isArray(attachmentsByIdResult) ? attachmentsByIdResult : [];
    return new Map(attachments.map(attachment => [attachment.id, attachment]));
  }, [attachmentsByIdResult]);

  const updateFieldValue = (fieldId: string, value: string[]): void => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  };

  // formData is already keyed by field id here, unlike the ticket-creation form which is
  // keyed by fieldName — no name lookup needed to find a parent's current value.
  const getFieldEffectiveValue = (fieldId: string): string | undefined => formData[fieldId]?.[0];

  return (
    <>
      {fields
        .filter(field => isFieldActive(field, fields, getFieldEffectiveValue))
        .map(field => {
          const fieldValue = formData[field.id] ?? [];
          const fieldEnumOptions = parseFieldOptionValues(field.fieldEnum);
          const trackMetadata = JSON.stringify({
            fieldId: field.id,
            fieldName: field.fieldName,
          });

          return (
            <div key={field.id} className='mb-4'>
              <label className='mb-1 block text-sm font-medium text-foreground'>
                {field.fieldName}
                {!field.isOptional && <span className='text-red-500'>*</span>}
              </label>

              {field.fieldType === FormFieldType.STRING && (
                <input
                  type='text'
                  value={fieldValue[0] ?? ''}
                  onChange={event => updateFieldValue(field.id, [event.target.value])}
                  disabled={disabled}
                  className={stageFormControlClassName}
                  data-track-category='Tickets'
                  data-track-name={`${trackNamePrefix}StringInput`}
                  data-track-metadata={trackMetadata}
                />
              )}

              {field.fieldType === FormFieldType.NUMBER && (
                <input
                  type='number'
                  value={fieldValue[0] ?? ''}
                  onChange={event => updateFieldValue(field.id, [event.target.value])}
                  disabled={disabled}
                  className={stageFormControlClassName}
                  data-track-category='Tickets'
                  data-track-name={`${trackNamePrefix}NumberInput`}
                  data-track-metadata={trackMetadata}
                />
              )}

              {field.fieldType === FormFieldType.BOOLEAN && (
                <div className='flex items-center gap-4'>
                  {[
                    { value: 'true', label: 'Yes' },
                    { value: 'false', label: 'No' },
                  ].map(option => (
                    <label
                      key={option.value}
                      className={`flex items-center gap-2 text-sm ${
                        disabled
                          ? 'cursor-not-allowed text-muted-foreground opacity-70'
                          : 'cursor-pointer text-foreground'
                      }`}
                    >
                      <input
                        type='radio'
                        name={`${idPrefix}-${field.id}`}
                        value={option.value}
                        checked={fieldValue[0] === option.value}
                        onChange={() => updateFieldValue(field.id, [option.value])}
                        disabled={disabled}
                        className='h-4 w-4 border-input bg-background text-blue-600 disabled:cursor-not-allowed dark:[color-scheme:dark]'
                        data-track-category='Tickets'
                        data-track-name={`${trackNamePrefix}Boolean`}
                        data-track-metadata={trackMetadata}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              )}

              {field.fieldType === FormFieldType.DATE && (
                <input
                  type='date'
                  value={fieldValue[0] ?? ''}
                  onChange={event => updateFieldValue(field.id, [event.target.value])}
                  disabled={disabled}
                  className={stageFormControlClassName}
                  data-track-category='Tickets'
                  data-track-name={`${trackNamePrefix}DateInput`}
                  data-track-metadata={trackMetadata}
                />
              )}

              {field.fieldType === FormFieldType.SINGLE_SELECT && (
                <Select
                  value={fieldValue[0] ?? ''}
                  onValueChange={value => updateFieldValue(field.id, [value])}
                  disabled={disabled}
                >
                  <SelectTrigger
                    className='w-full'
                    data-track-category='Tickets'
                    data-track-name={`${trackNamePrefix}Select`}
                    data-track-metadata={trackMetadata}
                  >
                    <SelectValue placeholder='Select an option' />
                  </SelectTrigger>
                  <SelectContent>
                    {fieldEnumOptions.map(option => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {field.fieldType === FormFieldType.MULTI_SELECT && (
                <div
                  data-track-category='Tickets'
                  data-track-name={`${trackNamePrefix}MultiSelect`}
                  data-track-metadata={trackMetadata}
                >
                  <MultiSelect
                    options={fieldEnumOptions.map(option => ({ value: option, label: option }))}
                    selectedValues={fieldValue}
                    onChange={next => updateFieldValue(field.id, next)}
                    disabled={disabled}
                    placeholder={
                      fieldEnumOptions.length > 0 ? 'Select options' : 'No options configured'
                    }
                  />
                </div>
              )}

              {field.fieldType === FormFieldType.USER && (
                <input
                  type='text'
                  placeholder='User ID'
                  value={fieldValue[0] ?? ''}
                  onChange={event => updateFieldValue(field.id, [event.target.value])}
                  disabled={disabled}
                  className={stageFormControlClassName}
                  data-track-category='Tickets'
                  data-track-name={`${trackNamePrefix}UserInput`}
                  data-track-metadata={trackMetadata}
                />
              )}

              {field.fieldType === FormFieldType.DOC &&
                ((): React.JSX.Element => {
                  const latestValue = showPersistedDocValues
                    ? valuesForRender
                        .filter(
                          value => value.fieldId === field.id && value.contextId === targetStageId,
                        )
                        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
                    : undefined;
                  const savedAttachmentId =
                    fieldValue[0] ??
                    (showPersistedDocValues
                      ? stringValuesFromJson(latestValue?.actualFieldValue)[0]
                      : undefined);
                  const persistedAttachment =
                    latestValue?.attachments?.[0] ??
                    (savedAttachmentId ? attachmentById.get(savedAttachmentId) : undefined);
                  const change = localDocChanges.get(field.id);
                  const effectiveExisting =
                    change && 'removed' in change ? undefined : persistedAttachment;
                  const effectiveExistingAttachmentId =
                    change && 'removed' in change ? undefined : savedAttachmentId;

                  return (
                    <StageFormDocField
                      key={`${field.id}:${effectiveExistingAttachmentId ?? 'empty'}`}
                      fieldId={field.id}
                      existingAttachment={effectiveExisting}
                      existingAttachmentId={effectiveExistingAttachmentId}
                      onLocalChange={file => {
                        setLocalDocChanges(prev => {
                          const next = new Map(prev);
                          if (file) {
                            next.set(field.id, { file });
                          } else if (persistedAttachment || savedAttachmentId) {
                            next.set(field.id, { removed: true });
                          } else {
                            next.delete(field.id);
                          }
                          return next;
                        });
                      }}
                      disabled={disabled}
                      readOnly={readOnlyDocs}
                    />
                  );
                })()}
            </div>
          );
        })}
    </>
  );
};
