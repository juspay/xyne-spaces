import { FormEntityType, FormFieldType } from '@xyne/shared';

import {
  resolveDisplayFormFields,
  type MembershipFormFieldRow,
} from './resolve-display-form-fields';

export type FormEntityValueRow = {
  id: string;
  workspaceId?: string | null;
  formId?: string | null;
  fieldId: string;
  entityId?: string | null;
  entityType?: string | null;
  contextId?: string | null;
  fieldValue?: string | null;
  actualFieldValue?: unknown;
  version?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  formField?: MembershipFormFieldRow | null;
  globalField?: {
    fieldName?: string | null;
    fieldType?: FormFieldType | string | null;
    fieldEnum?: unknown;
    fieldOptions?: unknown;
  } | null;
  attachments?: readonly unknown[] | null;
};

type FormMappingLike = {
  formId: string;
  formFields?: readonly MembershipFormFieldRow[];
};

const resolveFormFieldId = (formField: MembershipFormFieldRow): string =>
  formField.globalFieldId ?? formField.id;

const isBoardContextValue = (
  value: FormEntityValueRow,
  boardId: string | null | undefined,
): boolean => {
  if (!value.contextId) return true;
  if (!boardId) return true;
  return value.contextId === boardId;
};

const buildLatestEntityWideValueByField = (
  values: readonly FormEntityValueRow[],
  fieldIds: ReadonlySet<string>,
): Map<string, FormEntityValueRow> => {
  const map = new Map<string, FormEntityValueRow>();
  values
    .filter(value => fieldIds.has(value.fieldId))
    .forEach(value => {
      const current = map.get(value.fieldId);
      if (!current || (value.updatedAt ?? 0) > (current.updatedAt ?? 0)) {
        map.set(value.fieldId, value);
      }
    });
  return map;
};

const buildLatestBoardContextValueByField = (
  values: readonly FormEntityValueRow[],
  formId: string,
  boardId: string | null | undefined,
  fieldIds: ReadonlySet<string>,
): Map<string, FormEntityValueRow> => {
  const map = new Map<string, FormEntityValueRow>();
  values
    .filter(
      value =>
        value.formId === formId &&
        fieldIds.has(value.fieldId) &&
        isBoardContextValue(value, boardId),
    )
    .forEach(value => {
      const current = map.get(value.fieldId);
      if (!current || (value.updatedAt ?? 0) > (current.updatedAt ?? 0)) {
        map.set(value.fieldId, value);
      }
    });
  return map;
};

export type ResolvedBoardAdditionalField = FormEntityValueRow & {
  resolvedFieldId: string;
  isPlaceholder: boolean;
};

export type LeftoverFieldValue = FormEntityValueRow & {
  resolvedFieldId: string;
  fieldName: string;
  fieldType: FormFieldType;
};

export const resolveBoardAdditionalFields = ({
  formMapping,
  formEntityValues,
  boardId,
  ticketId,
  workspaceId,
}: {
  formMapping: FormMappingLike | null | undefined;
  formEntityValues: readonly FormEntityValueRow[] | undefined;
  boardId: string | null | undefined;
  ticketId: string;
  workspaceId: string;
}): ResolvedBoardAdditionalField[] => {
  const boardFormId = formMapping?.formId;
  const membershipRows = formMapping?.formFields;
  if (!boardFormId || !membershipRows || membershipRows.length === 0) {
    return [];
  }

  const resolvedFields = resolveDisplayFormFields(boardFormId, [...membershipRows]);
  const fieldIds = new Set(resolvedFields.map(field => field.id));
  const values = formEntityValues ?? [];

  const boardContextByField = buildLatestBoardContextValueByField(
    values,
    boardFormId,
    boardId,
    fieldIds,
  );
  const entityWideByField = buildLatestEntityWideValueByField(values, fieldIds);

  return resolvedFields.map(field => {
    const resolvedFieldId = field.id;
    const membershipRow = membershipRows.find(row => resolveFormFieldId(row) === resolvedFieldId);
    const boardValue = boardContextByField.get(resolvedFieldId);
    if (boardValue) {
      return { ...boardValue, resolvedFieldId, isPlaceholder: false };
    }

    const prefillValue = entityWideByField.get(resolvedFieldId);
    if (prefillValue) {
      return {
        ...prefillValue,
        id: `prefill-${resolvedFieldId}`,
        formId: boardFormId,
        fieldId: resolvedFieldId,
        contextId: boardId ?? null,
        resolvedFieldId,
        isPlaceholder: true,
        ...(membershipRow ? { formField: membershipRow } : {}),
      };
    }

    return {
      workspaceId,
      id: `placeholder-${resolvedFieldId}`,
      formId: boardFormId,
      fieldId: resolvedFieldId,
      entityId: ticketId,
      entityType: FormEntityType.TICKET,
      contextId: boardId ?? null,
      fieldValue: '',
      actualFieldValue: null,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(membershipRow ? { formField: membershipRow } : {}),
      resolvedFieldId,
      isPlaceholder: true,
    };
  });
};

export const resolveLeftoverFieldValues = ({
  formMapping,
  formEntityValues,
  boardId,
}: {
  formMapping: FormMappingLike | null | undefined;
  formEntityValues: readonly FormEntityValueRow[] | undefined;
  boardId: string | null | undefined;
}): LeftoverFieldValue[] => {
  const membershipRows = formMapping?.formFields;
  const currentFieldIds = new Set(
    formMapping?.formId && membershipRows
      ? resolveDisplayFormFields(formMapping.formId, [...membershipRows]).map(field => field.id)
      : [],
  );
  const values = formEntityValues ?? [];

  const latestByField = new Map<string, FormEntityValueRow>();
  values
    .filter(value => isBoardContextValue(value, boardId) && !currentFieldIds.has(value.fieldId))
    .forEach(value => {
      const current = latestByField.get(value.fieldId);
      if (!current || (value.updatedAt ?? 0) > (current.updatedAt ?? 0)) {
        latestByField.set(value.fieldId, value);
      }
    });

  const resolved: LeftoverFieldValue[] = [];
  for (const [resolvedFieldId, value] of latestByField) {
    const fieldName = value.globalField?.fieldName ?? value.formField?.fieldName;
    const rawType = value.globalField?.fieldType ?? value.formField?.fieldType;
    const fieldType =
      typeof rawType === 'string' && (Object.values(FormFieldType) as string[]).includes(rawType)
        ? (rawType as FormFieldType)
        : null;
    if (!fieldName || !fieldType) continue;
    resolved.push({ ...value, resolvedFieldId, fieldName, fieldType });
  }

  return resolved.sort((a, b) => a.fieldName.localeCompare(b.fieldName));
};
