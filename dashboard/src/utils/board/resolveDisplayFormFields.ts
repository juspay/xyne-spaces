import {
  FormFieldType,
  parseFieldOptions,
  type FieldEnumOption,
  type FormFields,
  type GlobalField,
} from '@xyne/shared';

export interface ResolvedDisplayFormField {
  id: string;
  formId: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: FieldEnumOption[];
  isOptional: boolean;
  sequenceNumber: number;
  parentOptionId?: string | null;
  membershipId?: string;
}

type MembershipRow = FormFields & { globalField?: GlobalField | null | undefined };

const toFieldOptions = (value: unknown): FieldEnumOption[] | undefined => {
  const items = parseFieldOptions(value);
  return items.length > 0 ? items : undefined;
};

/**
 * Resolve a form's fields from its per-form membership rows (form_fields).
 *
 * Each row is either:
 *  - a new row pointing at global_fields via globalFieldId, or
 *  - a legacy (deployed) row carrying its own definition columns (globalFieldId = null).
 */
export const resolveDisplayFormFields = (
  formId: string,
  membershipRows: MembershipRow[],
): ResolvedDisplayFormField[] => {
  const resolved: ResolvedDisplayFormField[] = membershipRows.flatMap(row => {
    let resolvedId: string;
    let fieldName: string | undefined;
    let fieldType: FormFieldType | undefined;
    let fieldEnum: FieldEnumOption[] | undefined;

    if (row.globalFieldId && row.globalField) {
      resolvedId = row.globalFieldId;
      fieldName = row.globalField.fieldName;
      fieldType = row.globalField.fieldType;
      fieldEnum = toFieldOptions(row.globalField.fieldOptions ?? row.globalField.fieldEnum);
    } else if (row.fieldName && row.fieldType) {
      resolvedId = row.id;
      fieldName = row.fieldName;
      fieldType = row.fieldType;
      fieldEnum = toFieldOptions(row.fieldOptions ?? row.fieldEnum);
    } else {
      return [];
    }

    return [
      {
        id: resolvedId,
        formId,
        fieldName,
        fieldType,
        ...(fieldEnum ? { fieldEnum } : {}),
        isOptional: row.isOptional ?? false,
        sequenceNumber: row.sequenceNumber ?? 0,
        parentOptionId: row.parentOptionId,
        membershipId: row.id,
      },
    ];
  });

  return resolved.sort((a, b) => {
    if (a.sequenceNumber !== b.sequenceNumber) {
      return a.sequenceNumber - b.sequenceNumber;
    }
    return a.fieldName.toLowerCase().localeCompare(b.fieldName.toLowerCase());
  });
};
