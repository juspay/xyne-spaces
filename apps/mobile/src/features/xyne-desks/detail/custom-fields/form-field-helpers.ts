import { FormFieldType } from '@xyne/shared';

import type {
  LeftoverFieldValue,
  ResolvedBoardAdditionalField,
} from './board-form-entity-values';
import { parseFieldOptionValues } from './form-field-shared';

type FieldValueLike = ResolvedBoardAdditionalField | LeftoverFieldValue;

export const getFormEntityFieldName = (fieldValue: FieldValueLike): string =>
  fieldValue.globalField?.fieldName ??
  fieldValue.formField?.globalField?.fieldName ??
  fieldValue.formField?.fieldName ??
  ('fieldName' in fieldValue && typeof fieldValue.fieldName === 'string'
    ? fieldValue.fieldName
    : 'Unknown Field');

export const getFormEntityFieldType = (fieldValue: FieldValueLike): FormFieldType => {
  const raw =
    fieldValue.globalField?.fieldType ??
    fieldValue.formField?.globalField?.fieldType ??
    fieldValue.formField?.fieldType ??
    ('fieldType' in fieldValue ? fieldValue.fieldType : null);
  if (typeof raw === 'string' && (Object.values(FormFieldType) as string[]).includes(raw)) {
    return raw as FormFieldType;
  }
  return FormFieldType.STRING;
};

export const getFormEntityFieldEnum = (fieldValue: FieldValueLike): string[] | undefined => {
  const fieldEnum =
    fieldValue.globalField?.fieldOptions ??
    fieldValue.globalField?.fieldEnum ??
    fieldValue.formField?.globalField?.fieldOptions ??
    fieldValue.formField?.globalField?.fieldEnum ??
    fieldValue.formField?.fieldOptions ??
    fieldValue.formField?.fieldEnum;
  const options = parseFieldOptionValues(fieldEnum);
  return options.length > 0 ? options : undefined;
};

export const getFieldEffectiveRaw = (fieldValue: FieldValueLike): unknown =>
  fieldValue.actualFieldValue ?? fieldValue.fieldValue;

export const isFormFieldEmpty = (fieldValue: FieldValueLike): boolean => {
  const raw = getFieldEffectiveRaw(fieldValue);
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  if (Array.isArray(raw)) {
    return raw.every(
      entry => entry === null || entry === undefined || String(entry).trim() === '',
    );
  }
  return false;
};

export const jsonToDisplayString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(', ');
  return '';
};

export const jsonToStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map(v => String(v)).filter(v => v.length > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v)).filter(v => v.length > 0);
      }
    } catch {
      /* plain string */
    }
    return [trimmed];
  }
  return [];
};

export const formatBooleanDisplay = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes') return 'Yes';
    if (normalized === 'false' || normalized === 'no') return 'No';
  }
  return '';
};

export const normalizeBooleanSaveValue = (value: string): 'true' | 'false' | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes') return 'true';
  if (normalized === 'false' || normalized === 'no') return 'false';
  return null;
};

export const stripUserPrefix = (id: string): string =>
  id.startsWith('user:') ? id.slice('user:'.length) : id;

export const formatLeftoverFieldValue = (
  field: LeftoverFieldValue,
  userById: ReadonlyMap<string, { id: string; name?: string | null; email?: string | null }>,
): string => {
  const raw = getFieldEffectiveRaw(field);
  if (raw === null || raw === undefined || raw === '') return '—';

  if (field.fieldType === FormFieldType.BOOLEAN) {
    return formatBooleanDisplay(raw) || '—';
  }

  if (field.fieldType === FormFieldType.USER) {
    const ids = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
    if (ids.length === 0) return '—';
    return ids
      .map(id => {
        const normalizedId = stripUserPrefix(id);
        const user = userById.get(normalizedId);
        return user?.name?.trim() || user?.email?.trim() || id;
      })
      .join(', ');
  }

  if (Array.isArray(raw)) return raw.map(String).join(', ') || '—';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
};
