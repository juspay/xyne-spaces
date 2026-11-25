import { v5 as uuidv5 } from 'uuid';
import { FormFieldType } from '../zero/types.js';

export type FormEntityValueColumns = {
  textValue: string | null;
  numberValue: number | null;
  dateValue: number | null;
  boolValue: boolean | null;
  plainValue: string | null;
};

export type TypedFormEntityValue = {
  columns: FormEntityValueColumns;
  /** MULTI_SELECT options / USER ids, one form_entity_value_items row each. Empty for other types. */
  items: string[];
  /** The STRING value as it is hashed into textHash; null when there is no text. */
  textHashInput: string | null;
};

const EMPTY_COLUMNS: FormEntityValueColumns = {
  textValue: null,
  numberValue: null,
  dateValue: null,
  boolValue: null,
  plainValue: null,
};

const FORM_ENTITY_VALUE_ITEM_NAMESPACE = '6f3b7c0e-2a8d-4f61-9c55-0d8e4b2a7f13';

/** Id of the item row for `item` on value `valueId`. Derived so the client's optimistic write and the server's agree. */
export const formEntityValueItemId = (valueId: string, item: string): string =>
  uuidv5(`form-entity-value-item:${valueId}:${item}`, FORM_ENTITY_VALUE_ITEM_NAMESPACE);

const FIELD_TYPES = new Set<string>(Object.values(FormFieldType));

/**
 * The field's type, or an error. Writers must know a value's type to put it in the right
 * typed column; a missing or unknown type would otherwise store nothing searchable.
 */
export const assertFormFieldType = (fieldType: unknown, fieldId: string): FormFieldType => {
  if (typeof fieldType !== 'string' || !FIELD_TYPES.has(fieldType)) {
    throw new Error(`Custom field ${fieldId} has no known field type (got ${JSON.stringify(fieldType)})`);
  }
  return fieldType as FormFieldType;
};

/**
 * A saved field keeps its type: its stored values sit in the typed column for that type, so
 * changing it would hide them. Definitions with no stored type (legacy rows linked to a global
 * field) are not checked.
 */
export const assertFieldTypeUnchanged = (
  savedType: string | null | undefined,
  nextType: string,
  fieldName: string,
): void => {
  if (savedType && savedType !== nextType) {
    throw new Error(`The type of "${fieldName}" can't be changed once it's saved. Create a new field instead.`);
  }
};

/** Lowercased and trimmed, so "Kalyan" and "kalyan " hash the same. */
export const normalizeTextForHash = (value: string): string => value.trim().toLowerCase();

const firstScalar = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

const toText = (value: unknown): string | null => {
  const scalar = firstScalar(value);
  if (typeof scalar === 'string') return scalar.trim().length > 0 ? scalar : null;
  if (typeof scalar === 'number' || typeof scalar === 'boolean') return String(scalar);
  return null;
};

const toNumber = (value: unknown): number | null => {
  const scalar = firstScalar(value);
  const parsed =
    typeof scalar === 'number'
      ? scalar
      : typeof scalar === 'string' && scalar.trim().length > 0
        ? Number(scalar)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const toBoolean = (value: unknown): boolean | null => {
  const scalar = firstScalar(value);
  if (typeof scalar === 'boolean') return scalar;
  if (typeof scalar === 'string') {
    const normalized = scalar.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
};

// Epoch milliseconds. Accepts Date, ISO strings, and epoch numbers or numeric strings.
const toEpochMs = (value: unknown): number | null => {
  const scalar = firstScalar(value);
  let date: Date | null = null;
  if (scalar instanceof Date) date = scalar;
  else if (typeof scalar === 'number') date = new Date(scalar);
  else if (typeof scalar === 'string' && scalar.trim().length > 0) {
    const trimmed = scalar.trim();
    date = new Date(/^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed);
  }
  const time = date?.getTime();
  return time !== undefined && Number.isFinite(time) ? time : null;
};

const toItems = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  const items = values
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
  return Array.from(new Set(items));
};

/**
 * Splits a custom-field value (text, number, boolean, date, or a list of options / user ids) into the typed columns
 * and item rows for its field type. A value that does not fit the type leaves every column
 * null rather than throwing; validation stays with the callers.
 */
export const toTypedFormEntityValue = (
  fieldType: FormFieldType | string | null | undefined,
  value: unknown,
): TypedFormEntityValue => {
  const empty: TypedFormEntityValue = { columns: { ...EMPTY_COLUMNS }, items: [], textHashInput: null };
  if (value === null || value === undefined) return empty;

  switch (fieldType) {
    case FormFieldType.STRING: {
      const text = toText(value);
      if (text === null) return empty;
      // Stored trimmed so a case-insensitive match on textValue (browser) agrees with textHash (server).
      return { ...empty, columns: { ...EMPTY_COLUMNS, textValue: text.trim() }, textHashInput: normalizeTextForHash(text) };
    }
    case FormFieldType.NUMBER:
      return { ...empty, columns: { ...EMPTY_COLUMNS, numberValue: toNumber(value) } };
    case FormFieldType.BOOLEAN:
      return { ...empty, columns: { ...EMPTY_COLUMNS, boolValue: toBoolean(value) } };
    case FormFieldType.DATE:
      return { ...empty, columns: { ...EMPTY_COLUMNS, dateValue: toEpochMs(value) } };
    case FormFieldType.SINGLE_SELECT:
    case FormFieldType.TICKET:
    case FormFieldType.DOC:
      return { ...empty, columns: { ...EMPTY_COLUMNS, plainValue: toText(value) } };
    case FormFieldType.MULTI_SELECT:
    case FormFieldType.USER:
      return { ...empty, items: toItems(value) };
    default:
      return empty;
  }
};

/** A custom-field value as callers work with it: text, number, boolean, ISO date, or a list. */
export type FormEntityValueRead = string | string[] | number | boolean | null;

export type TypedFormEntityValueRow = {
  textValue?: string | null;
  numberValue?: number | null;
  dateValue?: number | Date | null;
  boolValue?: boolean | null;
  plainValue?: string | null;
  // Required so a reader cannot forget to load the items relation (MULTI_SELECT / USER values).
  items: ReadonlyArray<{ item: string }>;
  // Old JSON value, read only for rows the typed-column backfill has not reached yet.
  actualFieldValue?: unknown;
};

const legacyValue = (value: unknown): FormEntityValueRead => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string');
    return items.length > 0 ? items : null;
  }
  return null;
};

/**
 * Reads a form_entity_values row's value from the typed columns and its items: text, number,
 * boolean, an ISO string for DATE, or a list for MULTI_SELECT and USER. The row must carry
 * the `items` relation, or multi-value fields would read as empty.
 */
export const readFormEntityValue = (row: TypedFormEntityValueRow | null | undefined): FormEntityValueRead => {
  if (!row) return null;
  if (row.textValue !== null && row.textValue !== undefined) return row.textValue;
  if (row.plainValue !== null && row.plainValue !== undefined) return row.plainValue;
  if (row.numberValue !== null && row.numberValue !== undefined) return row.numberValue;
  if (row.boolValue !== null && row.boolValue !== undefined) return row.boolValue;
  if (row.dateValue !== null && row.dateValue !== undefined) {
    const time = row.dateValue instanceof Date ? row.dateValue.getTime() : row.dateValue;
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  // Items have no stored order, so they are always returned sorted; the same value reads back identically.
  if (row.items && row.items.length > 0) return row.items.map(entry => entry.item).sort();
  // Every write fills the typed columns and actualFieldValue together, so an empty typed value
  // with a set actualFieldValue only happens on rows written before the typed columns existed.
  return legacyValue(row.actualFieldValue);
};

/**
 * A value in the shape it reads back after being stored for this field type ("2026-11-20"
 * becomes the ISO date, "42.50" becomes 42.5), so a submitted value compares equal to the
 * stored one. A value that doesn't fit the type is returned unchanged.
 */
export const asStoredFormEntityValue = (fieldType: FormFieldType | string, value: unknown): unknown => {
  const typed = toTypedFormEntityValue(fieldType, value);
  const read = readFormEntityValue({ ...typed.columns, items: typed.items.map(item => ({ item })) });
  return read === null ? value : read;
};

const canonicalFormEntityValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return JSON.stringify([...new Set(value.map(item => canonicalFormEntityValue(item)))].sort());
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return typeof value === 'string' ? value.trim() : String(value);
};

/**
 * Whether two custom-field values are the same: lists compare as sets (order and duplicates
 * ignored, since MULTI_SELECT and USER items have no stored order) and text ignores
 * surrounding spaces. Use it wherever an old value is compared with a new one.
 */
export const sameFormEntityValue = (left: unknown, right: unknown): boolean =>
  canonicalFormEntityValue(left) === canonicalFormEntityValue(right);
