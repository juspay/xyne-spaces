import { FormFieldType } from '@xyne/shared';
import type { FormFields, GlobalField, Prisma } from '@prisma/client';

export interface FormFieldInput {
  fieldId?: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: Prisma.InputJsonValue;
  isOptional?: boolean;
}

export interface ResolvedFormField {
  id: string; // globalField id for new rows, form_fields id for legacy rows
  formId: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum: Prisma.JsonValue | null;
  isOptional: boolean;
  sequenceNumber: number;
  createdAt: Date;
  updatedAt: Date;
  membershipId?: string; // form_fields row id (per-form membership)
}

const isFormFieldType = (value: string): value is FormFieldType =>
  Object.values(FormFieldType).includes(value as FormFieldType);

const toFormFieldType = (value: string): FormFieldType => {
  if (!isFormFieldType(value)) {
    throw new Error(`Invalid form field type: ${value}`);
  }
  return value;
};

export const normalizeFormFieldInput = (
  field: {
    fieldId?: string;
    fieldName?: string;
    fieldType?: FormFieldType;
    fieldEnum?: Prisma.InputJsonValue;
    isOptional?: boolean;
  },
): FormFieldInput => {
  if (!field.fieldName || !field.fieldType) {
    throw new Error('Fields must include fieldName and fieldType');
  }

  return {
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    ...(field.fieldId ? { fieldId: field.fieldId } : {}),
    ...(field.fieldEnum !== undefined ? { fieldEnum: field.fieldEnum } : {}),
    ...(field.isOptional !== undefined ? { isOptional: field.isOptional } : {}),
  };
};

export const validateFormFieldInputs = (fields: FormFieldInput[]): void => {
  if (!fields.length) {
    throw new Error('At least one field is required');
  }

  const names = new Set<string>();
  const fieldIds = new Set<string>();

  for (const field of fields) {
    if (field.fieldId) {
      if (fieldIds.has(field.fieldId)) {
        throw new Error('Duplicate field IDs are not allowed');
      }
      fieldIds.add(field.fieldId);
    }

    const normalizedName = field.fieldName.trim().toLowerCase();
    if (!normalizedName) {
      throw new Error('All fields must have a name');
    }
    if (names.has(normalizedName)) {
      throw new Error('Duplicate field names are not allowed');
    }
    names.add(normalizedName);
  }
};

/**
 * Resolve a form's fields from its per-form membership rows (form_fields).
 *
 * Each membership row is either:
 *  - a new row pointing at a global_fields definition via globalFieldId, or
 *  - a legacy (deployed) row carrying its own definition columns (globalFieldId = null).
 *
 * `globalDefinitions` = global_fields rows looked up by membershipRows.globalFieldId.
 */
export const resolveFormFields = (
  formId: string,
  membershipRows: FormFields[],
  globalDefinitions: GlobalField[],
): ResolvedFormField[] => {
  const globalById = new Map(globalDefinitions.map(field => [field.id, field]));

  const resolved: ResolvedFormField[] = membershipRows.flatMap(row => {
    let resolvedId: string;
    let fieldName: string | null;
    let fieldTypeValue: string | null;
    let fieldEnum: Prisma.JsonValue | null;

    if (row.globalFieldId) {
      const def = globalById.get(row.globalFieldId);
      if (!def) {
        return []; // missing definition; skip rather than throw
      }
      resolvedId = row.globalFieldId;
      fieldName = def.fieldName;
      fieldTypeValue = def.fieldType;
      fieldEnum = def.fieldEnum;
    } else {
      resolvedId = row.id;
      fieldName = row.fieldName;
      fieldTypeValue = row.fieldType;
      fieldEnum = row.fieldEnum;
    }

    if (!fieldName || !fieldTypeValue) {
      return []; // malformed legacy row
    }

    return [{
      id: resolvedId,
      formId,
      fieldName,
      fieldType: toFormFieldType(fieldTypeValue),
      fieldEnum,
      isOptional: row.isOptional,
      sequenceNumber: row.sequenceNumber,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      membershipId: row.id,
    }];
  });

  return resolved.sort((a, b) => {
    if (a.sequenceNumber !== b.sequenceNumber) {
      return a.sequenceNumber - b.sequenceNumber;
    }
    return a.fieldName.toLowerCase().localeCompare(b.fieldName.toLowerCase());
  });
};

export const assertNoNameCollisions = (
  resolvedFields: Array<{ fieldName: string }>,
): void => {
  const names = new Set<string>();

  for (const field of resolvedFields) {
    const normalized = field.fieldName.trim().toLowerCase();
    if (names.has(normalized)) {
      throw new Error('Field names must be unique within a form');
    }
    names.add(normalized);
  }
};
