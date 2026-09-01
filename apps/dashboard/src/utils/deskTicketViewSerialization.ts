import { SavedConfigEntityName, TicketPriority } from '@xyne/shared';
import type { TicketFilters } from '../components/Tickets/TicketFilters/types';

export interface DeskTicketValueRow {
  entityName: SavedConfigEntityName.TICKET;
  fieldName: string;
  fieldValue: string;
}

export function deskTicketFiltersToValues(filters: TicketFilters): DeskTicketValueRow[] {
  const rows: DeskTicketValueRow[] = [];

  const add = (fieldName: string, fieldValue: string): void => {
    rows.push({ entityName: SavedConfigEntityName.TICKET, fieldName, fieldValue });
  };

  for (const v of filters.priority ?? []) add('priority', v);
  for (const v of filters.assignee ?? []) add('assignee', v);
  for (const v of filters.userGroups ?? []) add('userGroups', v);
  for (const v of filters.createdBy ?? []) add('createdBy', v);
  for (const v of filters.stages ?? []) add('stages', v);
  for (const v of filters.aiCategory ?? []) add('aiCategory', v);
  for (const v of filters.generatedTags ?? []) add('generatedTags', v);

  if (filters.assigned !== undefined) add('assigned', String(filters.assigned));
  if (filters.created !== undefined) add('created', String(filters.created));
  if (filters.hasAiDraft !== undefined) add('hasAiDraft', String(filters.hasAiDraft));
  if (filters.hasSubTickets !== undefined) add('hasSubTickets', String(filters.hasSubTickets));
  if (filters.createdDateStart !== undefined)
    add('createdDateStart', String(filters.createdDateStart));
  if (filters.createdDateEnd !== undefined) add('createdDateEnd', String(filters.createdDateEnd));
  if (filters.lastEmailAtStart !== undefined)
    add('lastEmailAtStart', String(filters.lastEmailAtStart));
  if (filters.lastEmailAtEnd !== undefined) add('lastEmailAtEnd', String(filters.lastEmailAtEnd));
  if (filters.conversationLabelId) add('conversationLabelId', filters.conversationLabelId);

  for (const [key, val] of Object.entries(filters.dynamicFields ?? {})) {
    add(`dynamicFields.${key}`, JSON.stringify(val));
  }

  return rows;
}

export function valuesToDeskTicketFilters(
  rows: readonly { fieldName: string; fieldValue: string }[],
): TicketFilters {
  const result: TicketFilters = {
    priority: [],
    assignee: [],
    userGroups: [],
    createdBy: [],
    stages: [],
    aiCategory: [],
    generatedTags: [],
    dynamicFields: {},
  };

  for (const { fieldName, fieldValue } of rows) {
    if (fieldName.startsWith('dynamicFields.')) {
      const key = fieldName.slice('dynamicFields.'.length);
      try {
        (result.dynamicFields as Record<string, unknown>)[key] = JSON.parse(fieldValue);
      } catch {
        // skip malformed
      }
      continue;
    }

    switch (fieldName) {
      case 'priority':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result.priority!.push(fieldValue as TicketPriority);
        break;
      case 'assignee':
        result.assignee!.push(fieldValue);
        break;
      case 'userGroups':
        result.userGroups!.push(fieldValue);
        break;
      case 'createdBy':
        result.createdBy!.push(fieldValue);
        break;
      case 'stages':
        result.stages!.push(fieldValue);
        break;
      case 'aiCategory':
        result.aiCategory!.push(fieldValue);
        break;
      case 'generatedTags':
        result.generatedTags!.push(fieldValue);
        break;
      case 'assigned':
        result.assigned = fieldValue === 'true';
        break;
      case 'created':
        result.created = fieldValue === 'true';
        break;
      case 'hasAiDraft':
        result.hasAiDraft = fieldValue === 'true';
        break;
      case 'hasSubTickets':
        result.hasSubTickets = fieldValue === 'true';
        break;
      case 'createdDateStart':
        result.createdDateStart = Number(fieldValue);
        break;
      case 'createdDateEnd':
        result.createdDateEnd = Number(fieldValue);
        break;
      case 'lastEmailAtStart':
        result.lastEmailAtStart = Number(fieldValue);
        break;
      case 'lastEmailAtEnd':
        result.lastEmailAtEnd = Number(fieldValue);
        break;
      case 'conversationLabelId':
        result.conversationLabelId = fieldValue;
        break;
    }
  }

  return result;
}
