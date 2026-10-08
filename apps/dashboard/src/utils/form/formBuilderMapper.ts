import { FormFieldType, parseFieldOptions } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import type { FormField } from '../../components/Board/CreateFormSlideOut/CreateFormSlideOut.types';
import type { CreateFormField, FormDetailResponse } from '../../services/Form/formService';
import type { BuilderField, BuilderFieldOption, FormBuilderData } from './formBuilderTypes';
import { getStartedFields, isSelectFieldType } from './formBuilderValidation';

/**
 * Unified input shape both read sources populate. Options come exclusively from the
 * form_fields row / its global definition — never from form_entity_values.
 *
 * Identity: `definitionId` is global_fields.id for global rows and form_fields.id for legacy
 * rows; `membershipId` is always the form_fields row id. For legacy rows the two are equal.
 */
export interface SourceFormField {
  definitionId?: string | undefined;
  membershipId?: string | undefined;
  fieldName?: string | null | undefined;
  fieldType?: string | null | undefined;
  /** Canonical {id,value}[] (possibly JSON-stringified). */
  fieldOptions?: unknown;
  /** Legacy string[] projection, or a legacy {id,value}[] written by old create payloads. */
  fieldEnum?: unknown;
  isOptional?: boolean | null | undefined;
  parentOptionId?: string | null | undefined;
}

/** Structural subset of a Zero `form_fields` row with its `globalField` relation. */
export interface ZeroFormFieldRow {
  id: string;
  globalFieldId?: string | null | undefined;
  fieldName?: string | null | undefined;
  fieldType?: string | null | undefined;
  fieldEnum?: unknown;
  fieldOptions?: unknown;
  isOptional?: boolean | null | undefined;
  parentOptionId?: string | null | undefined;
  globalField?:
    | {
        fieldName?: string | null | undefined;
        fieldType?: string | null | undefined;
        fieldEnum?: unknown;
        fieldOptions?: unknown;
      }
    | null
    | undefined;
}

export interface ZeroFormUpdateField {
  id: string;
  membershipId: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldOptions?: BuilderFieldOption[];
  isOptional?: boolean;
  parentOptionId?: string | null;
}

export interface ZeroFormUpdateArgs {
  formId: string;
  projectId?: string;
  formDescription?: string;
  fields: ZeroFormUpdateField[];
  timestamp: number;
}

const isFormFieldType = (value: unknown): value is FormFieldType =>
  typeof value === 'string' && Object.values(FormFieldType).includes(value as FormFieldType);

const resolveSourceOptions = (source: SourceFormField): BuilderFieldOption[] => {
  const canonical = parseFieldOptions(source.fieldOptions);
  return canonical.length > 0 ? canonical : parseFieldOptions(source.fieldEnum);
};

/**
 * Maps every source row — a row with a blank name or unknown type is NOT dropped: it keeps
 * its identity and validation blocks the save instead of the server reconcile-deleting it.
 */
export const fromSourceField = (source: SourceFormField): BuilderField => {
  const name = typeof source.fieldName === 'string' ? source.fieldName : '';
  const options = resolveSourceOptions(source);

  return {
    rowId: source.membershipId ?? source.definitionId ?? uuidv4(),
    ...(source.definitionId ? { definitionId: source.definitionId } : {}),
    ...(source.membershipId ? { membershipId: source.membershipId } : {}),
    fieldName: name,
    // An unknown or missing type is kept as stored (not coerced to STRING, which a save would
    // write onto the shared definition); validation blocks the save until the user picks one.
    fieldType: (isFormFieldType(source.fieldType)
      ? source.fieldType
      : typeof source.fieldType === 'string'
        ? source.fieldType
        : '') as FormFieldType,
    isOptional: source.isOptional ?? false,
    ...(options.length > 0 ? { fieldEnum: options } : {}),
    ...(source.parentOptionId ? { parentOptionId: source.parentOptionId } : {}),
  };
};

export const fromRestDetail = (detail: FormDetailResponse): FormBuilderData => ({
  formName: detail.formName,
  formDescription: detail.formDescription ?? '',
  fields: [...detail.fields]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map(field =>
      fromSourceField({
        definitionId: field.id,
        membershipId: field.membershipId ?? field.id,
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        fieldOptions: field.fieldOptions,
        fieldEnum: field.fieldEnum,
        isOptional: field.isOptional,
        parentOptionId: field.parentOptionId,
      }),
    ),
});

export const fromZeroRows = (
  form: { formName: string; formDescription?: string | null | undefined },
  rows: readonly ZeroFormFieldRow[],
): FormBuilderData => ({
  formName: form.formName,
  formDescription: form.formDescription ?? '',
  fields: rows.map(row => {
    const global = row.globalField;
    return fromSourceField({
      definitionId: row.globalFieldId ?? row.id,
      membershipId: row.id,
      fieldName: global?.fieldName ?? row.fieldName,
      fieldType: global?.fieldType ?? row.fieldType,
      // Global definition first, then the row's own (legacy) columns; canonical before legacy.
      fieldOptions: [global?.fieldOptions, global?.fieldEnum, row.fieldOptions, row.fieldEnum].find(
        candidate => parseFieldOptions(candidate).length > 0,
      ),
      isOptional: row.isOptional,
      parentOptionId: row.parentOptionId,
    });
  }),
});

const normalizeOptions = (
  options: BuilderFieldOption[] | undefined,
): BuilderFieldOption[] | undefined => {
  if (!options) return undefined;
  const normalized = options
    .map(option => ({ id: option.id, value: option.value.trim() }))
    .filter(option => option.value.length > 0);
  return normalized.length > 0 ? normalized : undefined;
};

/** Options as they go on the wire: selects are trimmed with blanks dropped; ids never change. */
const getPayloadOptions = (field: BuilderField): BuilderFieldOption[] | undefined =>
  isSelectFieldType(field.fieldType) ? normalizeOptions(field.fieldEnum) : field.fieldEnum;

/**
 * REST field payload — the same shape for POST /forms and PUT /forms/:id. Options always
 * travel as canonical `fieldOptions: {id,value}[]`, never as `fieldEnum`. Only not-started
 * rows are left out; the caller must have passed validateFormBuilder first.
 */
export const toRestPayload = (data: Pick<FormBuilderData, 'fields'>): CreateFormField[] =>
  getStartedFields(data.fields).map(field => {
    const fieldOptions = getPayloadOptions(field);
    return {
      ...(field.definitionId ? { fieldId: field.definitionId } : {}),
      fieldName: field.fieldName.trim(),
      fieldType: field.fieldType,
      ...(fieldOptions ? { fieldOptions } : {}),
      isOptional: field.isOptional,
      ...(field.parentOptionId !== undefined ? { parentOptionId: field.parentOptionId } : {}),
    };
  });

/** Args for the Zero `form.update` mutator, kept ready for a future Zero persistence adapter. */
export const toZeroUpdateArgs = (
  data: FormBuilderData,
  ctx: { formId: string; projectId?: string | undefined; timestamp: number },
): ZeroFormUpdateArgs => {
  const formDescription = data.formDescription.trim();
  return {
    formId: ctx.formId,
    timestamp: ctx.timestamp,
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    ...(formDescription ? { formDescription } : {}),
    fields: getStartedFields(data.fields).map(field => {
      const fieldOptions = isSelectFieldType(field.fieldType)
        ? normalizeOptions(field.fieldEnum)
        : undefined;
      return {
        id: field.definitionId ?? uuidv4(),
        membershipId: field.membershipId ?? uuidv4(),
        fieldName: field.fieldName.trim(),
        fieldType: field.fieldType,
        ...(fieldOptions ? { fieldOptions } : {}),
        isOptional: field.isOptional,
        ...(field.parentOptionId !== undefined ? { parentOptionId: field.parentOptionId } : {}),
      };
    }),
  };
};

/** Board parents still speak the CreateFormSlideOut `FormField` shape. */
export const toLegacyFormFieldArray = (fields: BuilderField[]): FormField[] =>
  getStartedFields(fields).map(field => {
    const fieldEnum = getPayloadOptions(field);
    return {
      id: field.rowId,
      ...(field.definitionId ? { persistedFieldId: field.definitionId } : {}),
      ...(field.membershipId ? { membershipId: field.membershipId } : {}),
      fieldName: field.fieldName,
      fieldType: field.fieldType,
      isOptional: field.isOptional,
      ...(fieldEnum ? { fieldEnum } : {}),
      ...(field.parentOptionId !== undefined ? { parentOptionId: field.parentOptionId } : {}),
    };
  });

export const fromLegacyFormFieldArray = (fields: FormField[]): BuilderField[] =>
  fields.map(field => ({
    rowId: field.id,
    ...(field.persistedFieldId ? { definitionId: field.persistedFieldId } : {}),
    ...(field.membershipId ? { membershipId: field.membershipId } : {}),
    fieldName: typeof field.fieldName === 'string' ? field.fieldName : '',
    fieldType: field.fieldType,
    isOptional: field.isOptional,
    ...(field.fieldEnum ? { fieldEnum: field.fieldEnum } : {}),
    ...(field.parentOptionId !== undefined ? { parentOptionId: field.parentOptionId } : {}),
  }));
