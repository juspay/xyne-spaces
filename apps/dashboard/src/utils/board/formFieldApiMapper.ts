import { FormFieldType, type FieldEnumOption } from '@xyne/shared';
import type { CreateFormField } from '../../services/Form/formService';
import type { FormDetailResponse } from '../../services/Form/formService';
import type { FormField } from '../../components/Board/CreateFormSlideOut/CreateFormSlideOut.types';
import { v4 as uuidv4 } from 'uuid';

export const isSelectFormFieldType = (fieldType: FormFieldType): boolean =>
  fieldType === FormFieldType.SINGLE_SELECT || fieldType === FormFieldType.MULTI_SELECT;

const getFieldName = (field: { fieldName: unknown }): string =>
  typeof field.fieldName === 'string' ? field.fieldName : '';

/** Fields the user has started. */
export const getStartedFormFields = (fields: FormField[]): FormField[] =>
  fields.filter(field => getFieldName(field).trim().length > 0);

const normalizeSelectOptions = (
  options: FieldEnumOption[] | undefined,
): FieldEnumOption[] | undefined => {
  if (!options) return undefined;
  const normalized = options
    .map(option => ({ ...option, value: option.value.trim() }))
    .filter(option => option.value.length > 0);
  return normalized.length > 0 ? normalized : undefined;
};

/** Trim select options and drop blank draft rows before save/API mapping. */
export const getSavableFormFields = (fields: FormField[]): FormField[] =>
  getStartedFormFields(fields).map(field => {
    if (!isSelectFormFieldType(field.fieldType)) {
      return field;
    }
    const fieldEnum = normalizeSelectOptions(field.fieldEnum);
    if (fieldEnum) {
      return { ...field, fieldEnum };
    }
    const { fieldEnum: _removed, ...withoutOptions } = field;
    return withoutOptions;
  });

export const hasDuplicateFormFieldNames = (fields: FormField[]): boolean => {
  const names = new Set<string>();
  for (const field of getStartedFormFields(fields)) {
    const normalized = getFieldName(field).trim().toLowerCase();
    if (!normalized) continue;
    if (names.has(normalized)) return true;
    names.add(normalized);
  }
  return false;
};

const fieldHasValidSelectOptions = (field: FormField): boolean => {
  if (!isSelectFormFieldType(field.fieldType)) return true;
  const options = (field.fieldEnum ?? []).map(option => option.value.trim()).filter(Boolean);
  return options.length > 0;
};

export const isFormBuilderSavable = (formName: string, fields: FormField[]): boolean => {
  const startedFields = getStartedFormFields(fields);
  if (!formName.trim() || startedFields.length === 0) return false;
  if (hasDuplicateFormFieldNames(fields)) return false;
  return startedFields.every(
    field => getFieldName(field).trim().length > 0 && fieldHasValidSelectOptions(field),
  );
};

export const buildFieldTypeChangeUpdates = (
  currentType: FormFieldType,
  nextType: FormFieldType,
): Partial<FormField> => {
  const wasSelect = isSelectFormFieldType(currentType);
  const isSelect = isSelectFormFieldType(nextType);

  if (isSelect && !wasSelect) {
    return { fieldType: nextType, fieldEnum: [{ id: uuidv4(), value: '' }] };
  }
  if (wasSelect && !isSelect) {
    return { fieldType: nextType };
  }
  return { fieldType: nextType };
};

export const mapFormFieldsToApiPayload = (fields: FormField[]): CreateFormField[] =>
  getSavableFormFields(fields).map(field => {
    const fieldOptions = isSelectFormFieldType(field.fieldType)
      ? normalizeSelectOptions(field.fieldEnum)
      : field.fieldEnum;

    return {
      ...(field.persistedFieldId ? { fieldId: field.persistedFieldId } : {}),
      fieldName: getFieldName(field).trim(),
      fieldType: field.fieldType,
      ...(fieldOptions ? { fieldOptions } : {}),
      isOptional: field.isOptional,
      ...(field.parentOptionId !== undefined ? { parentOptionId: field.parentOptionId } : {}),
    };
  });

export const hasFormFieldNameCollision = (fields: FormField[], candidateName: string): boolean => {
  const normalized = candidateName.trim().toLowerCase();
  if (!normalized) return false;
  return fields.some(field => getFieldName(field).trim().toLowerCase() === normalized);
};

export const getFieldTypeLabel = (fieldType: FormFieldType): string => {
  switch (fieldType) {
    case FormFieldType.STRING:
      return 'String';
    case FormFieldType.NUMBER:
      return 'Number';
    case FormFieldType.BOOLEAN:
      return 'Boolean';
    case FormFieldType.DATE:
      return 'Date';
    case FormFieldType.SINGLE_SELECT:
      return 'Single Select';
    case FormFieldType.MULTI_SELECT:
      return 'Multi Select';
    case FormFieldType.USER:
      return 'User';
    case FormFieldType.DOC:
      return 'Document';
    default:
      return fieldType;
  }
};

export const mapFormDetailsToBuilderFields = (formDetails: FormDetailResponse): FormField[] =>
  formDetails.fields.map(field => {
    const options = field.fieldOptions ?? field.fieldEnum;
    return {
      id: uuidv4(),
      persistedFieldId: field.id,
      fieldName: getFieldName(field),
      fieldType: field.fieldType,
      isOptional: field.isOptional,
      ...(options ? { fieldEnum: options } : {}),
      ...(field.parentOptionId ? { parentOptionId: field.parentOptionId } : {}),
    };
  });
