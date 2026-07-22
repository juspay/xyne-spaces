import { ReactElement } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import type { Ticket } from '@xyne/shared';
import { FormFieldType } from '@xyne/shared';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayNameById } from '../../../utils/userDisplayName';
import { getTimestampValue } from '../../../utils/board/dynamicFieldFilters';
import type { ResolvedDisplayFormField } from '../../../utils/board/resolveDisplayFormFields';

export const dynamicColumnKey = (fieldId: string): string => `df:${fieldId}`;

type TicketWithFieldValues = Ticket & {
  formEntityValues?: ReadonlyArray<{ fieldId: string; actualFieldValue?: unknown }>;
};

const toDisplayString = (raw: unknown): string => {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return JSON.stringify(raw) ?? '';
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
      return toDisplayString(raw);
    case FormFieldType.MULTI_SELECT:
      return Array.isArray(raw) ? raw.map(toDisplayString).join(', ') : toDisplayString(raw);
    case FormFieldType.USER: {
      const ids = Array.isArray(raw) ? raw : [raw];
      return ids
        .filter((id): id is string => typeof id === 'string')
        .map(id => getUserDisplayNameById(users, id.replace(/^user:/, '')))
        .join(', ');
    }
    case FormFieldType.DATE: {
      const timestamp = getTimestampValue(raw);
      return timestamp === null ? toDisplayString(raw) : new Date(timestamp).toLocaleDateString();
    }
    default:
      return toDisplayString(raw);
  }
};

const DynamicFieldCellRenderer = (
  params: ICellRendererParams<Ticket> & { fieldId: string; fieldType: FormFieldType },
): ReactElement => {
  const users = useUsers();
  const ticket = params.data as TicketWithFieldValues | undefined;
  const raw = ticket?.formEntityValues?.find(v => v.fieldId === params.fieldId)?.actualFieldValue;
  const formatted = formatValue(params.fieldType, raw, users);
  return <span className='text-sm truncate'>{formatted || '—'}</span>;
};

export const buildDynamicFieldColumns = (
  fields: readonly ResolvedDisplayFormField[],
): ColDef<Ticket>[] =>
  fields.map(field => ({
    colId: dynamicColumnKey(field.id),
    headerName: field.fieldName,
    minWidth: 140,
    sortable: false,
    cellRenderer: DynamicFieldCellRenderer,
    cellRendererParams: { fieldId: field.id, fieldType: field.fieldType },
  }));
