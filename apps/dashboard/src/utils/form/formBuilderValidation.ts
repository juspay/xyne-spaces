import { FormFieldType, resolveParentOption } from '@xyne/shared';
import type { BuilderField } from './formBuilderTypes';

export const FORM_NAME_MAX_LENGTH = 100;

export type FieldErrorCode =
  | 'name-required'
  | 'unsupported-type'
  | 'duplicate-name'
  | 'select-missing-option'
  | 'duplicate-option'
  | 'branch-unresolved'
  | 'branch-not-single-select'
  | 'branch-nested';

export interface FieldIssue {
  rowId: string;
  code: FieldErrorCode;
  message: string;
  optionId?: string;
}

export type FormIssueCode = 'form-name-required' | 'form-name-too-long' | 'no-started-fields';

export interface FormIssue {
  code: FormIssueCode;
  message: string;
}

export interface FormBuilderValidationResult {
  valid: boolean;
  formIssues: FormIssue[];
  fieldIssues: FieldIssue[];
}

export const isSelectFieldType = (fieldType: FormFieldType): boolean =>
  fieldType === FormFieldType.SINGLE_SELECT || fieldType === FormFieldType.MULTI_SELECT;

const hasNonBlankOption = (field: BuilderField): boolean =>
  (field.fieldEnum ?? []).some(option => option.value.trim().length > 0);

/**
 * A field is "started" once it has a persisted identity, a name, or typed options. Only a
 * brand-new, entirely blank row is not started — it is left out of the payload, never a
 * persisted row (dropping one would make the server reconcile-delete it).
 */
export const isFieldStarted = (field: BuilderField): boolean =>
  Boolean(field.definitionId) ||
  Boolean(field.membershipId) ||
  field.fieldName.trim().length > 0 ||
  hasNonBlankOption(field);

export const getStartedFields = (fields: BuilderField[]): BuilderField[] =>
  fields.filter(isFieldStarted);

export const validateFormBuilder = (
  formName: string,
  fields: BuilderField[],
): FormBuilderValidationResult => {
  const formIssues: FormIssue[] = [];
  const fieldIssues: FieldIssue[] = [];
  const started = getStartedFields(fields);

  const trimmedName = formName.trim();
  if (!trimmedName) {
    formIssues.push({ code: 'form-name-required', message: 'Add a form title' });
  } else if (trimmedName.length > FORM_NAME_MAX_LENGTH) {
    formIssues.push({
      code: 'form-name-too-long',
      message: `Form title must be ${FORM_NAME_MAX_LENGTH} characters or fewer`,
    });
  }

  if (started.length === 0) {
    formIssues.push({ code: 'no-started-fields', message: 'Add at least one question' });
  }

  const rowIdsByName = new Map<string, string[]>();
  for (const field of started) {
    const normalized = field.fieldName.trim().toLowerCase();
    if (!normalized) {
      fieldIssues.push({
        rowId: field.rowId,
        code: 'name-required',
        message: 'Enter a question for this field',
      });
      continue;
    }
    rowIdsByName.set(normalized, [...(rowIdsByName.get(normalized) ?? []), field.rowId]);
  }
  for (const rowIds of rowIdsByName.values()) {
    if (rowIds.length < 2) continue;
    for (const rowId of rowIds) {
      fieldIssues.push({
        rowId,
        code: 'duplicate-name',
        message: 'Field names must be unique within this form',
      });
    }
  }

  for (const field of started) {
    if (!Object.values(FormFieldType).includes(field.fieldType)) {
      fieldIssues.push({
        rowId: field.rowId,
        code: 'unsupported-type',
        message: 'This field has a type the editor does not support. Choose a type or remove it.',
      });
    }

    if (isSelectFieldType(field.fieldType)) {
      if (!hasNonBlankOption(field)) {
        fieldIssues.push({
          rowId: field.rowId,
          code: 'select-missing-option',
          message: 'Add at least one option',
        });
      }

      const seen = new Set<string>();
      for (const option of field.fieldEnum ?? []) {
        const value = option.value.trim();
        if (!value) continue;
        if (seen.has(value)) {
          fieldIssues.push({
            rowId: field.rowId,
            code: 'duplicate-option',
            message: `Option "${value}" is listed more than once`,
            optionId: option.id,
          });
        }
        seen.add(value);
      }
    }

    if (!field.parentOptionId) continue;

    const resolved = resolveParentOption(fields, field.parentOptionId);
    if (!resolved) {
      fieldIssues.push({
        rowId: field.rowId,
        code: 'branch-unresolved',
        message: 'The option this field depends on is missing or has no label',
      });
      continue;
    }
    if (resolved.parentField.fieldType !== FormFieldType.SINGLE_SELECT) {
      fieldIssues.push({
        rowId: field.rowId,
        code: 'branch-not-single-select',
        message: 'A field can only depend on an option of a Single Select field',
      });
    }
    if (resolved.parentField.parentOptionId) {
      fieldIssues.push({
        rowId: field.rowId,
        code: 'branch-nested',
        message: 'A field that depends on an option cannot have dependent fields of its own',
      });
    }
  }

  return {
    valid: formIssues.length === 0 && fieldIssues.length === 0,
    formIssues,
    fieldIssues,
  };
};
