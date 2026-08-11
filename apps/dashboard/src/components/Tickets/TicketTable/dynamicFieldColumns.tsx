import { ReactElement } from 'react';
import type {
  ColDef,
  ICellRendererParams,
  ValueGetterParams,
  ValueSetterParams,
} from 'ag-grid-community';
import type { Ticket } from '@xyne/shared';
import { FormFieldType } from '@xyne/shared';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayNameById } from '../../../utils/userDisplayName';
import { getTimestampValue } from '../../../utils/board/dynamicFieldFilters';
import type { ResolvedDisplayFormField } from '../../../utils/board/resolveDisplayFormFields';
import { DynamicFieldCellEditor } from './DynamicFieldCellEditor';
import {
  dynamicValuesEqual,
  sameValues,
  stringifyValue,
  toGridValue,
  toStringArray,
} from './dynamicFieldValues';

export const dynamicColumnKey = (fieldId: string): string => `df:${fieldId}`;

interface FormEntityValueRowLike {
  id?: string;
  fieldId: string;
  actualFieldValue?: unknown;
  updatedAt?: number | null;
}

type TicketWithFieldValues = Ticket & {
  formEntityValues?: ReadonlyArray<FormEntityValueRowLike>;
};

const findFieldValueRow = (
  ticket: TicketWithFieldValues | undefined,
  fieldId: string,
): FormEntityValueRowLike | undefined => {
  let latest: FormEntityValueRowLike | undefined;
  for (const row of ticket?.formEntityValues ?? []) {
    if (row.fieldId !== fieldId) continue;
    if (!latest || (row.updatedAt ?? 0) > (latest.updatedAt ?? 0)) latest = row;
  }
  return latest;
};

const formatValue = (
  fieldType: FormFieldType,
  raw: unknown,
  users: Parameters<typeof getUserDisplayNameById>[0],
): string => {
  if (raw === null || raw === undefined || raw === '') return '';
  switch (fieldType) {
    case FormFieldType.BOOLEAN:
      if (raw === true || raw === 'true') return 'Yes';
      if (raw === false || raw === 'false') return 'No';
      return stringifyValue(raw);
    case FormFieldType.MULTI_SELECT:
      return Array.isArray(raw) ? raw.map(stringifyValue).join(', ') : stringifyValue(raw);
    case FormFieldType.USER: {
      const ids = Array.isArray(raw) ? raw : [raw];
      return ids
        .filter((id): id is string => typeof id === 'string')
        .map(id => getUserDisplayNameById(users, id.replace(/^user:/, '')))
        .join(', ');
    }
    case FormFieldType.DATE: {
      const timestamp = getTimestampValue(raw);
      return timestamp === null ? stringifyValue(raw) : new Date(timestamp).toLocaleDateString();
    }
    default:
      return stringifyValue(raw);
  }
};

const DynamicFieldCellRenderer = (
  params: ICellRendererParams<Ticket> & { fieldId: string; fieldType: FormFieldType },
): ReactElement => {
  const users = useUsers();
  const ticket = params.data as TicketWithFieldValues | undefined;
  const raw = findFieldValueRow(ticket, params.fieldId)?.actualFieldValue;
  const formatted = formatValue(params.fieldType, raw, users);
  return <span className='text-sm truncate'>{formatted || '—'}</span>;
};

export interface DynamicFieldSaveParams {
  ticket: Ticket;
  field: ResolvedDisplayFormField;
  valueId: string | undefined;
  newValue: string[];
}

const EDITABLE_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set([
  FormFieldType.STRING,
  FormFieldType.NUMBER,
  FormFieldType.BOOLEAN,
  FormFieldType.DATE,
  FormFieldType.SINGLE_SELECT,
  FormFieldType.MULTI_SELECT,
  FormFieldType.USER,
]);

const cellEditorFor = (fieldType: FormFieldType): string | typeof DynamicFieldCellEditor => {
  if (fieldType === FormFieldType.STRING) return 'agTextCellEditor';
  if (fieldType === FormFieldType.NUMBER) return 'agNumberCellEditor';
  return DynamicFieldCellEditor;
};

export const buildDynamicFieldColumns = (
  fields: readonly ResolvedDisplayFormField[],
  onSave?: (params: DynamicFieldSaveParams) => void,
): ColDef<Ticket>[] =>
  fields.map(field => {
    const editable = !!onSave && EDITABLE_FIELD_TYPES.has(field.fieldType);
    return {
      colId: dynamicColumnKey(field.id),
      headerName: field.fieldName,
      minWidth: 140,
      sortable: false,
      editable,
      cellRenderer: DynamicFieldCellRenderer,
      cellRendererParams: { fieldId: field.id, fieldType: field.fieldType },
      ...(editable
        ? { cellEditor: cellEditorFor(field.fieldType), cellEditorParams: { field } }
        : {}),
      valueGetter: (params: ValueGetterParams<Ticket>): string | string[] =>
        toGridValue(
          field.fieldType,
          toStringArray(
            findFieldValueRow(params.data as TicketWithFieldValues | undefined, field.id)
              ?.actualFieldValue,
          ),
        ),
      equals: dynamicValuesEqual,
      valueSetter: (params: ValueSetterParams<Ticket>): boolean => {
        if (!params.data || !onSave) return false;
        const newValue = toStringArray(params.newValue);
        if (sameValues(toStringArray(params.oldValue), newValue)) return false;
        onSave({
          ticket: params.data,
          field,
          valueId: findFieldValueRow(params.data as TicketWithFieldValues, field.id)?.id,
          newValue,
        });
        return false;
      },
    };
  });
