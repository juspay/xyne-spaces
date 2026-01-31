import type {
  Ticket,
  SubTicket,
  TicketEntityMapping,
  TicketTag,
  FormEntityValues,
} from '@xyne/shared';
import type { Stage } from './KanbanBoardScreen.types';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import { FormFieldType } from '@xyne/shared';

/**
 * Returns the color for a given stage name
 */
export const getStageColor = (stageName: string): string => {
  const colorMap: Record<string, string> = {};
  colorMap['backlog'] = '#9CA3AF';
  colorMap['todo'] = '#3B82F6';
  colorMap['in_progress'] = '#F59E0B';
  colorMap['review'] = '#8B5CF6';
  colorMap['done'] = '#10B981';
  colorMap['planning'] = '#9CA3AF';
  colorMap['development'] = '#F59E0B';
  colorMap['testing'] = '#8B5CF6';
  colorMap['completed'] = '#10B981';
  colorMap['reported'] = '#EF4444';
  colorMap['investigating'] = '#F59E0B';
  colorMap['fixing'] = '#3B82F6';
  colorMap['resolved'] = '#10B981';
  colorMap['proposed'] = '#9CA3AF';
  colorMap['approved'] = '#3B82F6';
  colorMap['implemented'] = '#10B981';
  return colorMap[stageName.toLowerCase()] || '#6B7280';
};

/**
 * Returns the color for a given ticket status
 */
export const getStatusColor = (status: string): string => {
  const colorMap: Record<string, string> = {
    TODO: '#3B82F6',
    STARTED: '#F59E0B',
    PAUSED: '#8B5CF6',
    COMPLETED: '#22C55E',
    CANCELLED: '#DC2626',
  };
  return colorMap[status] || '#6B7280';
};

/**
 * Returns status-based columns for the kanban board
 */
export const getStatusColumns = (): Stage[] => {
  return [
    { id: 'TODO', name: 'Todo', color: getStatusColor('TODO') },
    { id: 'STARTED', name: 'Started', color: getStatusColor('STARTED') },
    {
      id: 'PAUSED',
      name: 'Paused',
      color: getStatusColor('PAUSED'),
    },
    { id: 'COMPLETED', name: 'Completed', color: getStatusColor('COMPLETED') },
    { id: 'CANCELLED', name: 'Cancelled', color: getStatusColor('CANCELLED') },
  ];
};

/**
 * Filters tickets by board ID
 */
export const filterTicketsByBoard = (
  allTickets: Ticket[] | undefined,
  boardId: string | undefined,
): Ticket[] => {
  if (!allTickets || !boardId) return [];
  return allTickets.filter(ticket => ticket.boardId === boardId);
};

/**
 * Filters tickets by project ID
 */
export const filterTicketsByProject = (
  allTickets: Ticket[] | undefined,
  projectId: string | undefined,
): Ticket[] => {
  if (!allTickets || !projectId) return [];
  return allTickets.filter(ticket => ticket.projectId === projectId);
};

/**
 * Counts pending sync tickets
 */
export const countPendingSyncTickets = (
  filteredTickets: Ticket[] | undefined,
  localTickets: Ticket[] | undefined,
): number => {
  if (!filteredTickets || !localTickets) return 0;
  const serverTicketMap = new Map(filteredTickets.map(t => [t.id, t]));
  let count = 0;
  for (const localTicket of localTickets) {
    const serverTicket = serverTicketMap.get(localTicket.id);
    if (serverTicket && localTicket.stageName !== serverTicket.stageName) {
      count++;
    }
  }
  return count;
};

interface TicketSubTicketMapping {
  ticketId: string;
  subTicketId: string;
}

export const createSubTicketsByTicketIdMap = (
  allSubTickets: SubTicket[] | undefined,
  allTicketSubTicketMappings: TicketSubTicketMapping[] | undefined,
): Map<string, SubTicket[]> => {
  const map = new Map<string, SubTicket[]>();
  allTicketSubTicketMappings?.forEach(mapping => {
    const subTicket = allSubTickets?.find(st => st.id === mapping.subTicketId);
    if (subTicket) {
      if (!map.has(mapping.ticketId)) {
        map.set(mapping.ticketId, []);
      }
      map.get(mapping.ticketId)!.push(subTicket);
    }
  });
  return map;
};

export const createEntityMappingsByTicketIdMap = (
  allEntityMappings: TicketEntityMapping[] | undefined,
): Map<string, TicketEntityMapping[]> => {
  const map = new Map<string, TicketEntityMapping[]>();
  allEntityMappings?.forEach(mapping => {
    if (!map.has(mapping.ticketId)) {
      map.set(mapping.ticketId, []);
    }
    map.get(mapping.ticketId)!.push(mapping);
  });
  return map;
};

export const createTagsByTicketIdMap = (
  allTags: TicketTag[] | undefined,
): Map<string, TicketTag[]> => {
  const map = new Map<string, TicketTag[]>();
  allTags?.forEach(tag => {
    if (!map.has(tag.ticketId)) {
      map.set(tag.ticketId, []);
    }
    map.get(tag.ticketId)!.push(tag);
  });
  return map;
};

export const groupTicketsByStage = (
  localTickets: Ticket[] | undefined,
  stages: Stage[],
): Record<string, Ticket[]> => {
  const grouped: Record<string, Ticket[]> = {};
  stages.forEach(stage => {
    grouped[stage.id] = [];
  });

  // Create a Set to track which tickets we've already assigned
  const assignedTicketIds = new Set<string>();

  localTickets?.forEach(ticket => {
    // Skip if ticket already assigned to prevent duplicates
    if (assignedTicketIds.has(ticket.id)) {
      return;
    }

    const matchingStage = stages.find(
      s =>
        s.name.toLowerCase() === ticket.stageName?.toLowerCase() ||
        s.id === ticket.stageName?.toLowerCase().replace(/\s+/g, '_'),
    );

    const stageId = matchingStage?.id || stages[0]?.id || 'backlog';
    if (grouped[stageId]) {
      grouped[stageId].push(ticket);
      assignedTicketIds.add(ticket.id);
    }
  });

  return grouped;
};

/**
 * Groups tickets by their status field
 */
export const groupTicketsByStatus = (
  localTickets: Ticket[] | undefined,
  statusColumns: Stage[],
): Record<string, Ticket[]> => {
  const grouped: Record<string, Ticket[]> = {};
  statusColumns.forEach(column => {
    grouped[column.id] = [];
  });

  // Create a Set to track which tickets we've already assigned
  const assignedTicketIds = new Set<string>();

  localTickets?.forEach(ticket => {
    // Skip if ticket already assigned to prevent duplicates
    if (assignedTicketIds.has(ticket.id)) {
      return;
    }

    const ticketStatus = ticket.statusV2 as string;
    const matchingColumn = statusColumns.find(col => col.id === ticketStatus);

    const columnId = matchingColumn?.id || statusColumns[0]?.id || 'TODO';
    if (grouped[columnId]) {
      grouped[columnId].push(ticket);
      assignedTicketIds.add(ticket.id);
    }
  });

  return grouped;
};

/**
 * Apply filters to tickets
 */
export const applyTicketFilters = (
  tickets: Ticket[],
  filters: TicketFilters,
  tagsByTicketId?: Map<string, TicketTag[]>,
  formValuesByTicketId?: Map<string, FormEntityValues[]>,
  formFieldsById?: Map<string, { fieldType: FormFieldType; fieldEnum?: string[] | null }>,
): Ticket[] => {
  return tickets.filter(ticket => {
    // Board filter
    if (filters.boards && filters.boards.length > 0) {
      if (!ticket.boardId || !filters.boards.includes(ticket.boardId)) {
        return false;
      }
    }

    // Priority filter
    if (filters.priority && filters.priority.length > 0) {
      if (!filters.priority.includes(ticket.priority)) {
        return false;
      }
    }

    // Assignee filter
    if (filters.assignee && filters.assignee.length > 0) {
      if (!ticket.assignedTo) {
        return false;
      }
      // Extract the ID from the prefixed format
      const assigneeId = ticket.assignedTo.replace(/^(user:|group:|userGroup:)/, '');
      if (!filters.assignee.includes(assigneeId)) {
        return false;
      }
    }

    // Created by filter
    if (filters.createdBy && filters.createdBy.length > 0) {
      if (!filters.createdBy.includes(ticket.createdBy)) {
        return false;
      }
    }

    // User groups filter
    if (filters.userGroups && filters.userGroups.length > 0) {
      if (!ticket.userGroupId || !filters.userGroups.includes(ticket.userGroupId)) {
        return false;
      }
    }
    if (filters.userGroups && filters.userGroups.length > 0) {
      if (!ticket.userGroupId || !filters.userGroups.includes(ticket.userGroupId)) return false;
    }

    // Due date filter (filters use timestamps)
    if (filters.dueDateStart || filters.dueDateEnd) {
      if (!ticket.eta) {
        return false;
      }
      if (filters.dueDateStart && ticket.eta < filters.dueDateStart) {
        return false;
      }
      if (filters.dueDateEnd && ticket.eta > filters.dueDateEnd) {
        return false;
      }
    }

    // Created date filter (filters use timestamps)
    if (filters.createdDateStart || filters.createdDateEnd) {
      if (filters.createdDateStart && ticket.createdAt < filters.createdDateStart) {
        return false;
      }
      if (filters.createdDateEnd && ticket.createdAt > filters.createdDateEnd) {
        return false;
      }
    }
    if (filters.tags && filters.tags.length > 0 && tagsByTicketId) {
      const ticketTags = tagsByTicketId.get(ticket.id);
      if (!ticketTags || ticketTags.length === 0) {
        return false; // Ticket has no tags, but filter requires tags
      }

      // Check if ticket has at least one of the selected tags
      const ticketTagNames = new Set(ticketTags.map(t => t.name));
      const hasMatchingTag = filters.tags.some(filterTag => ticketTagNames.has(filterTag));

      if (!hasMatchingTag) {
        return false;
      }
    }

    // Dynamic form field filters
    if (filters.dynamicFields && formValuesByTicketId && formFieldsById) {
      const ticketFormValues = formValuesByTicketId.get(ticket.id);

      for (const [fieldId, filterValue] of Object.entries(filters.dynamicFields)) {
        const fieldInfo = formFieldsById.get(fieldId);
        if (!fieldInfo) continue; // Field not found, skip

        const fieldValue = ticketFormValues?.find(v => v.fieldId === fieldId);

        // If ticket doesn't have a value for this field, exclude it (as per requirement)
        if (!fieldValue) {
          return false;
        }

        const fieldType = fieldInfo.fieldType;

        // Handle different field types
        if (Array.isArray(filterValue)) {
          // SELECT, STRING, NUMBER, BOOLEAN, USER fields
          if (fieldType === FormFieldType.MULTI_SELECT) {
            // Multi-select: check if any ticket value matches filter values
            const ticketValues = (fieldValue.actualFieldValue as string[]) || [];
            const hasMatch = ticketValues.some(v => filterValue.includes(v));
            if (!hasMatch) return false;
          } else if (fieldType === FormFieldType.STRING) {
            // String: case-insensitive substring search (use actualFieldValue since fieldValue is empty)
            const rawValue = fieldValue.actualFieldValue;
            let ticketValue = '';
            if (typeof rawValue === 'string') {
              ticketValue = rawValue;
            } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
              ticketValue = String(rawValue);
            }
            ticketValue = ticketValue.toLowerCase();
            const searchTerm = (filterValue[0] || '').toLowerCase();
            if (!ticketValue.includes(searchTerm)) {
              return false;
            }
          } else if (fieldType === FormFieldType.NUMBER) {
            // Number: convert both to string and compare (use actualFieldValue)
            const rawValue = fieldValue.actualFieldValue;
            const ticketValue =
              typeof rawValue === 'number' || typeof rawValue === 'string' ? String(rawValue) : '';
            const filterNumber = String(filterValue[0] || '');
            if (ticketValue !== filterNumber) {
              return false;
            }
          } else if (fieldType === FormFieldType.USER) {
            // User field: actualFieldValue is an array of user IDs
            const userIds = Array.isArray(fieldValue.actualFieldValue)
              ? fieldValue.actualFieldValue
              : [];
            // Check if any user ID in the ticket matches any in the filter
            const hasMatch = userIds.some(
              userId => typeof userId === 'string' && filterValue.includes(userId),
            );
            if (!hasMatch) {
              return false;
            }
          } else {
            // Single select, boolean: exact match (use actualFieldValue)
            const rawValue = fieldValue.actualFieldValue;
            const ticketValue =
              typeof rawValue === 'string' ||
              typeof rawValue === 'number' ||
              typeof rawValue === 'boolean'
                ? String(rawValue)
                : '';

            if (!filterValue.includes(ticketValue)) {
              return false;
            }
          }
        } else if (
          typeof filterValue === 'object' &&
          ('start' in filterValue || 'end' in filterValue)
        ) {
          // DATE field - range check
          // actualFieldValue stores date in yyyy-mm-dd format, convert to timestamp
          const dateValue = fieldValue.actualFieldValue;
          const ticketDate = typeof dateValue === 'string' ? new Date(dateValue).getTime() : 0;
          if (filterValue.start && ticketDate < filterValue.start) return false;
          if (filterValue.end && ticketDate > filterValue.end) return false;
        }
      }
    }

    return true;
  });
};
