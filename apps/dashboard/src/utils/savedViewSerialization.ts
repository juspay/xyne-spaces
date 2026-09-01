import { SavedConfigEntityName, TicketPriority } from '@xyne/shared';
import type { TicketFilters } from '../components/Tickets/TicketFilters/types';

type SavedConfigValueRow = {
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
    }
  }
  return result;
}

interface ShareableView {
  name: string;
  contextId: string;
  values?: readonly SavedConfigValueRow[];
}

// Self-contained share link: /projects/views/new#cfg=<base64(JSON{name,filters,groupBy})>.
// Recipient opens it → builder prefilled → "Save view" creates their own private copy.
export function buildShareLink(view: ShareableView): string {
  const values = view.values ?? [];
  const filters = valuesToFilters(values);
  // Legacy per-board views store their board in contextId, not as 'boards' value rows.
  if (!filters.boards?.length && view.contextId) {
    filters.boards = [view.contextId];
  }
  const groupBy = values.find(v => v.fieldName === '__groupBy')?.fieldValue;
  const cfg = { name: view.name, filters, ...(groupBy ? { groupBy } : {}) };
  const encoded = btoa(encodeURIComponent(JSON.stringify(cfg)));
  const base = window.location.pathname.split('/projects')[0];
  return `${window.location.origin}${base}/projects/views/new#cfg=${encoded}`;
}
