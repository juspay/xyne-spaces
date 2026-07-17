import {
  FormEntityType,
  FormFieldType,
  type FormEntityValues,
  type FormFields,
} from '@xyne/shared';
import { resolveDisplayFormFields } from './resolveDisplayFormFields';

type FormEntityValueRow = FormEntityValues & {
  formField?: FormFields | null | undefined;
  globalField?:
    | {
        fieldName?: string | null;
        fieldType?: FormFieldType | null;
        fieldEnum?: unknown;
        fieldOptions?: unknown;
      }
    | null
    | undefined;
};

type FormMappingLike = {
  formId: string;
  formFields?: readonly FormFields[];
};

const resolveFormFieldId = (formField: FormFields): string =>
  formField.globalFieldId ?? formField.id;

const isBoardContextValue = (
  value: FormEntityValueRow,
  boardId: string | null | undefined,
): boolean => {
  if (!value.contextId) return true;
  if (!boardId) return true;
  return value.contextId === boardId;
};

/** Latest row per fieldId across all forms/contexts for the entity values already loaded. */
export const buildLatestEntityWideValueByField = (
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

/** Latest board-context row per fieldId (contextId is boardId or unset). */
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
  workspaceId: string | null | undefined;
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
        // Always board-scoped so consumers never persist into the source stage context.
        contextId: boardId ?? null,
        resolvedFieldId,
        isPlaceholder: true,
        ...(membershipRow ? { formField: membershipRow } : {}),
      };
    }

    return {
      workspaceId: workspaceId ?? null,
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
