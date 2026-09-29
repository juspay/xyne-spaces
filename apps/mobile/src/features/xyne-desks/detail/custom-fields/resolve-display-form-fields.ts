import { FormFieldType } from '@xyne/shared';

import {
  orderFieldsWithBranchChildrenAfterParent,
  parseFieldOptions,
  type FieldEnumOption,
} from './form-field-shared';

export type MembershipFormFieldRow = {
  id: string;
  formId?: string | null;
  globalFieldId?: string | null;
  fieldName?: string | null;
  fieldType?: FormFieldType | string | null;
  fieldEnum?: unknown;
  fieldOptions?: unknown;
  isOptional?: boolean | null;
  sequenceNumber?: number | null;
  parentOptionId?: string | null;
  globalField?: {
    id?: string;
    fieldName?: string | null;
    fieldType?: FormFieldType | string | null;
    fieldEnum?: unknown;
    fieldOptions?: unknown;
  } | null;
};

export type ResolvedDisplayFormField = {
  id: string;
  formId: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: FieldEnumOption[];
  isOptional: boolean;
  sequenceNumber: number;
  parentOptionId?: string | null;
  membershipId?: string;
};

const toFieldOptions = (value: unknown): FieldEnumOption[] | undefined => {
  const items = parseFieldOptions(value);
  return items.length > 0 ? items : undefined;
};

const asFormFieldType = (raw: unknown): FormFieldType | null => {
  if (typeof raw !== 'string') return null;
  return (Object.values(FormFieldType) as string[]).includes(raw)
    ? (raw as FormFieldType)
    : null;
};

/**
 * Resolve a form's fields from membership rows (form_fields).
 * Global rows use globalFieldId; legacy rows carry definition columns inline.
 */
export const resolveDisplayFormFields = (
  formId: string,
  membershipRows: MembershipFormFieldRow[],
): ResolvedDisplayFormField[] => {
  const resolved: ResolvedDisplayFormField[] = membershipRows.flatMap(row => {
    let resolvedId: string;
    let fieldName: string | undefined;
    let fieldType: FormFieldType | null;
    let fieldEnum: FieldEnumOption[] | undefined;

    if (row.globalFieldId && row.globalField) {
      resolvedId = row.globalFieldId;
      fieldName = row.globalField.fieldName ?? undefined;
      fieldType = asFormFieldType(row.globalField.fieldType);
      fieldEnum = toFieldOptions(row.globalField.fieldOptions ?? row.globalField.fieldEnum);
    } else if (row.fieldName && row.fieldType) {
      resolvedId = row.id;
      fieldName = row.fieldName;
      fieldType = asFormFieldType(row.fieldType);
      fieldEnum = toFieldOptions(row.fieldOptions ?? row.fieldEnum);
    } else {
      return [];
    }

    if (!fieldName || !fieldType) return [];

    return [
      {
        id: resolvedId,
        formId,
        fieldName,
        fieldType,
        isOptional: row.isOptional ?? false,
        sequenceNumber: row.sequenceNumber ?? 0,
        parentOptionId: row.parentOptionId ?? null,
        membershipId: row.id,
        ...(fieldEnum ? { fieldEnum } : {}),
      } satisfies ResolvedDisplayFormField,
    ];
  });

  const bySequence = resolved.sort((a, b) => {
    if (a.sequenceNumber !== b.sequenceNumber) {
      return a.sequenceNumber - b.sequenceNumber;
    }
    return a.fieldName.toLowerCase().localeCompare(b.fieldName.toLowerCase());
  });

  return orderFieldsWithBranchChildrenAfterParent(bySequence);
};
