import { SavedConfigEntityName, TicketPriority } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import type { TicketFilters } from '../components/Tickets/TicketFilters/types';

export type SavedConfigValueRow = {
  entityName: SavedConfigEntityName;
  fieldName: string;
  fieldValue: string;
};

// Saved-view value rows → TicketFilters. Inverse of `filtersToValues` in KanbanBoardScreen.
// Lives here (not in KanbanBoardScreen) so always-mounted callers like the sidebar don't pull
// the whole board screen into their bundle.
export function valuesToFilters(values: ReadonlyArray<SavedConfigValueRow>): TicketFilters {
  const result: TicketFilters = {};
  for (const { entityName, fieldName, fieldValue } of values) {
    if (entityName === SavedConfigEntityName.FORM_ENTITY_VALUE) {
      if (!result.dynamicFields) result.dynamicFields = {};
      if (fieldName.endsWith('.start')) {
        const fieldId = fieldName.slice(0, -'.start'.length);
        result.dynamicFields[fieldId] = {
          ...(result.dynamicFields[fieldId] as object | undefined),
          start: Number(fieldValue),
        };
      } else if (fieldName.endsWith('.end')) {
        const fieldId = fieldName.slice(0, -'.end'.length);
        result.dynamicFields[fieldId] = {
          ...(result.dynamicFields[fieldId] as object | undefined),
          end: Number(fieldValue),
        };
      } else {
        result.dynamicFields[fieldName] = [
          ...((result.dynamicFields[fieldName] as string[] | undefined) ?? []),
          fieldValue,
        ];
      }
      continue;
    }
    switch (fieldName) {
      case 'boards':
        result.boards = [...(result.boards ?? []), fieldValue];
        break;
      case 'priority':
        result.priority = [...(result.priority ?? []), fieldValue as TicketPriority];
        break;
      case 'assignee':
        result.assignee = [...(result.assignee ?? []), fieldValue];
        break;
      case 'createdBy':
        result.createdBy = [...(result.createdBy ?? []), fieldValue];
        break;
      case 'userGroups':
        result.userGroups = [...(result.userGroups ?? []), fieldValue];
        break;
      case 'tags':
        result.tags = [...(result.tags ?? []), fieldValue];
        break;
      case 'roleAssignments': {
        const [roleId, userIds] = fieldValue.split('|');
        if (!roleId) break;
        result.roleAssignments = [
          ...(result.roleAssignments ?? []),
          { roleId, userIds: (userIds ?? '').split(',').filter(Boolean) },
        ];
        break;
      }
      case 'stages':
        result.stages = [...(result.stages ?? []), fieldValue];
        break;
      case 'ticketTypes':
        result.ticketTypes = [...(result.ticketTypes ?? []), fieldValue];
        break;
      case 'sourceChannels':
        result.sourceChannels = [...(result.sourceChannels ?? []), fieldValue];
        break;
      case 'dueDateStart':
        result.dueDateStart = Number(fieldValue);
        break;
      case 'dueDateEnd':
        result.dueDateEnd = Number(fieldValue);
        break;
      case 'createdDateStart':
        result.createdDateStart = Number(fieldValue);
        break;
      case 'createdDateEnd':
        result.createdDateEnd = Number(fieldValue);
        break;
      // Desk-specific fields
      case 'aiCategory':
        result.aiCategory = [...(result.aiCategory ?? []), fieldValue];
        break;
      case 'generatedTags':
        result.generatedTags = [...(result.generatedTags ?? []), fieldValue];
        break;
      case 'assigned':
        result.assigned = fieldValue === 'true';
        break;
      case 'hasAiDraft':
        result.hasAiDraft = fieldValue === 'true';
        break;
      case 'hasSubTickets':
        result.hasSubTickets = fieldValue === 'true';
        break;
      case 'conversationLabelId':
        result.conversationLabelId = fieldValue;
        break;
      case 'lastEmailAtStart':
        result.lastEmailAtStart = Number(fieldValue);
        break;
      case 'lastEmailAtEnd':
        result.lastEmailAtEnd = Number(fieldValue);
        break;
    }
  }
  return result;
}

type DeskValueRow = {
  id: string;
  entityName: SavedConfigEntityName;
  fieldName: string;
  fieldValue: string;
};

/** Serialize TicketFilters (including desk-specific fields) to saved-view value rows. */
export function deskFiltersToValues(filters: TicketFilters): DeskValueRow[] {
  const values: DeskValueRow[] = [];

  const addTicket = (fieldName: string, fieldValue: string): void => {
    values.push({ id: uuidv4(), entityName: SavedConfigEntityName.TICKET, fieldName, fieldValue });
  };
  const addForm = (fieldName: string, fieldValue: string): void => {
    values.push({
      id: uuidv4(),
      entityName: SavedConfigEntityName.FORM_ENTITY_VALUE,
      fieldName,
      fieldValue,
    });
  };

  // Standard ticket fields
  filters.priority?.forEach(v => addTicket('priority', v));
  filters.assignee?.forEach(v => addTicket('assignee', v));
  filters.userGroups?.forEach(v => addTicket('userGroups', v));
  filters.createdBy?.forEach(v => addTicket('createdBy', v));
  filters.stages?.forEach(v => addTicket('stages', v));
  filters.ticketTypes?.forEach(v => addTicket('ticketTypes', v));
  filters.sourceChannels?.forEach(v => addTicket('sourceChannels', v));
  filters.tags?.forEach(v => addTicket('tags', v));
  if (filters.dueDateStart !== undefined) addTicket('dueDateStart', String(filters.dueDateStart));
  if (filters.dueDateEnd !== undefined) addTicket('dueDateEnd', String(filters.dueDateEnd));
  if (filters.createdDateStart !== undefined)
    addTicket('createdDateStart', String(filters.createdDateStart));
  if (filters.createdDateEnd !== undefined)
    addTicket('createdDateEnd', String(filters.createdDateEnd));

  // Desk-specific fields
  filters.aiCategory?.forEach(v => addTicket('aiCategory', v));
  filters.generatedTags?.forEach(v => addTicket('generatedTags', v));
  if (filters.assigned !== undefined) addTicket('assigned', String(filters.assigned));
  if (filters.hasAiDraft !== undefined) addTicket('hasAiDraft', String(filters.hasAiDraft));
  if (filters.hasSubTickets !== undefined)
    addTicket('hasSubTickets', String(filters.hasSubTickets));
  if (filters.conversationLabelId) addTicket('conversationLabelId', filters.conversationLabelId);
  if (filters.lastEmailAtStart !== undefined)
    addTicket('lastEmailAtStart', String(filters.lastEmailAtStart));
  if (filters.lastEmailAtEnd !== undefined)
    addTicket('lastEmailAtEnd', String(filters.lastEmailAtEnd));

  // Dynamic form fields
  if (filters.dynamicFields) {
    Object.entries(filters.dynamicFields).forEach(([fieldId, val]) => {
      if (Array.isArray(val)) {
        val.forEach(v => addForm(fieldId, v));
      } else {
        if (val.start !== undefined) addForm(`${fieldId}.start`, String(val.start));
        if (val.end !== undefined) addForm(`${fieldId}.end`, String(val.end));
      }
    });
  }

  return values;
}

interface ShareableView {
  id: string;
  name: string;
  contextId: string;
  values?: readonly SavedConfigValueRow[];
}

// DB-backed share link: /projects/views/{viewId}.
// The link itself grants no access — users must be shared with via the
// Share dialog (view_access) to open the view.
export function buildShareLink(view: ShareableView): string {
  const base = window.location.pathname.split('/projects')[0];
  return `${window.location.origin}${base}/projects/views/${view.id}`;
}
