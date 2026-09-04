import type {
  Ticket,
  SubTicket,
  TicketEntityMapping,
  TicketTag,
  FormEntityValues,
  TicketAssignment,
  TicketTagMapping,
} from '@xyne/shared';
import { TicketStatusV2 } from '@xyne/shared';
import { parseAssigneeFilter } from '../../zero/queries';
import type { Stage } from './KanbanBoardScreen.types';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import {
  FormContextType,
  FormEntityType,
  FormFieldType,
  type FieldEnumOption,
  type FormFields,
} from '@xyne/shared';
import { resolveDisplayFormFields } from '../../utils/board/resolveDisplayFormFields';
import { matchesDynamicFieldValue } from '../../utils/board/dynamicFieldFilters';

/**
 * Returns the color for a given stage name
 */
export const getStageColor = (stageName: string): string => {
  const colorMap: Record<string, string> = {};
  colorMap['backlog'] = 'var(--status-new)';
  colorMap['todo'] = 'var(--status-scheduled)';
  colorMap['in_progress'] = 'var(--status-pending)';
  colorMap['review'] = 'var(--status-paused)';
  colorMap['done'] = 'var(--status-success)';
  colorMap['planning'] = 'var(--status-new)';
  colorMap['development'] = 'var(--status-pending)';
  colorMap['testing'] = 'var(--status-paused)';
  colorMap['completed'] = 'var(--status-success)';
  colorMap['reported'] = 'var(--status-failure)';
  colorMap['investigating'] = 'var(--status-pending)';
  colorMap['fixing'] = 'var(--status-scheduled)';
  colorMap['resolved'] = 'var(--status-success)';
  colorMap['proposed'] = 'var(--status-new)';
  colorMap['approved'] = 'var(--status-scheduled)';
  colorMap['implemented'] = 'var(--status-success)';
  return colorMap[stageName.toLowerCase()] || 'var(--status-new)';
};

/**
 * Returns the color for a given ticket status
 */
export const getStatusColor = (status: string): string => {
  const colorMap: Record<string, string> = {
    TODO: 'var(--status-scheduled)',
    STARTED: 'var(--status-pending)',
    PAUSED: 'var(--status-paused)',
    COMPLETED: 'var(--status-success)',
    CANCELLED: 'var(--status-failure)',
  };
  return colorMap[status] || 'var(--status-new)';
};

/**
 * Returns status-based columns for the kanban board
 */
export const getStatusColumns = (): Stage[] => {
  return [
    {
      id: 'TODO',
      name: 'Todo',
      color: getStatusColor('TODO'),
      defaultTicketStatusV2: TicketStatusV2.TODO,
    },
    {
      id: 'STARTED',
      name: 'Started',
      color: getStatusColor('STARTED'),
      defaultTicketStatusV2: TicketStatusV2.STARTED,
    },
    {
      id: 'PAUSED',
      name: 'Paused',
      color: getStatusColor('PAUSED'),
      defaultTicketStatusV2: TicketStatusV2.PAUSED,
    },
    {
      id: 'COMPLETED',
      name: 'Completed',
      color: getStatusColor('COMPLETED'),
      defaultTicketStatusV2: TicketStatusV2.COMPLETED,
    },
    {
      id: 'CANCELLED',
      name: 'Cancelled',
      color: getStatusColor('CANCELLED'),
      defaultTicketStatusV2: TicketStatusV2.CANCELLED,
    },
  ];
};

interface BoardStageRow {
  id: string;
  boardId: string;
  name: string;
  sequenceNumber: number;
  defaultTicketStatusV2: TicketStatusV2;
  approvers?: Stage['approvers'];
  formContextMappings?: ReadonlyArray<{
    contextType: FormContextType;
    entityType: FormEntityType;
    formId: string;
  }>;
}

export const groupStagesByBoard = (
  stageRows: ReadonlyArray<BoardStageRow>,
): Map<string, Stage[]> => {
  const stagesByBoard = new Map<string, Stage[]>();
  stageRows.forEach(row => {
    const boardStages = stagesByBoard.get(row.boardId) ?? [];
    if (!boardStages.some(s => s.name === row.name)) {
      boardStages.push({
        id: row.id,
        name: row.name,
        color: getStageColor(row.name),
        sequenceNumber: row.sequenceNumber,
        defaultTicketStatusV2: row.defaultTicketStatusV2,
        formId:
          row.formContextMappings?.find(
            m => m.contextType === FormContextType.STAGE && m.entityType === FormEntityType.TICKET,
          )?.formId ?? null,
        ...(row.approvers && { approvers: row.approvers }),
      });
      stagesByBoard.set(row.boardId, boardStages);
    }
  });
  return stagesByBoard;
};

export const getSharedBoardStages = (
  boardIds: string[],
  stagesByBoard: Map<string, Stage[]>,
): Stage[] | null => {
  const signature = (boardStages: Stage[]): string =>
    boardStages
      .map(stage => stage.name)
      .sort()
      .join('\n');
  const perBoard = [...boardIds].sort().map(id => stagesByBoard.get(id));
  const [first] = perBoard;
  if (!first) return null;
  const firstSignature = signature(first);
  if (perBoard.some(boardStages => !boardStages || signature(boardStages) !== firstSignature)) {
    return null;
  }
  return first;
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

/**
 * Sorts tickets by kanbanPosition (lexicographic ascending, nulls last)
 * with createdAt DESC as tiebreaker.
 * IMPORTANT: Uses native string comparison (<, >), NOT localeCompare.
 */
export const sortByKanbanPosition = <T extends Ticket>(tickets: T[]): T[] => {
  return [...tickets].sort((a, b) => {
    const aPos = a.kanbanPosition;
    const bPos = b.kanbanPosition;

    // Both have positions — lexicographic ascending
    if (aPos !== null && aPos !== undefined && bPos !== null && bPos !== undefined) {
      if (aPos < bPos) return -1;
      if (aPos > bPos) return 1;
      // Same position — fall through to createdAt tiebreaker
    }
    // Nulls last
    if ((aPos === null || aPos === undefined) && bPos !== null && bPos !== undefined) return 1;
    if (aPos !== null && aPos !== undefined && (bPos === null || bPos === undefined)) return -1;

    // Both null or same position — createdAt DESC (newest first)
    return b.createdAt - a.createdAt;
  });
};

type KanbanSnapshotTicket = Ticket & {
  tagMappings?: TicketTagMapping[];
  assignments?: TicketAssignment[];
};

export const ticketBoardSnapshotSignature = (ticket: KanbanSnapshotTicket): string => {
  const tagMappingsSignature = (ticket.tagMappings ?? [])
    .map((tag: TicketTagMapping) => `${tag.tagId}:${tag.tagName}`)
    .join('|');
  const assignmentsSignature = (ticket.assignments ?? [])
    .map((assignment: TicketAssignment) => `${assignment.userId}:${assignment.roleId ?? ''}`)
    .join('|');

  return [
    ticket.id,
    ticket.updatedAt ?? 0,
    ticket.title ?? '',
    ticket.stageName ?? '',
    ticket.statusV2 ?? '',
    ticket.priority ?? '',
    ticket.assignedTo ?? '',
    ticket.userGroupId ?? '',
    ticket.eta ?? 0,
    ticket.kanbanPosition ?? '',
    tagMappingsSignature,
    assignmentsSignature,
  ].join('::');
};

export const ticketsHaveSameBoardSnapshot = (left: Ticket[], right: Ticket[]): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const leftTicket = left[index];
    const rightTicket = right[index];
    if (!leftTicket || !rightTicket) return false;
    if (leftTicket.id !== rightTicket.id) return false;
    if (ticketBoardSnapshotSignature(leftTicket) !== ticketBoardSnapshotSignature(rightTicket)) {
      return false;
    }
  }

  return true;
};

export const groupTicketsByStage = (
  localTickets: Ticket[] | undefined,
  stages: Stage[],
  useKanbanPosition = false,
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

    // Match ticket to stage by name (case-insensitive)
    const matchingStage = stages.find(
      s => s.name.toLowerCase() === ticket.stageName?.toLowerCase(),
    );

    const stageId = matchingStage?.id || stages[0]?.id || 'backlog';
    if (grouped[stageId]) {
      grouped[stageId].push(ticket);
      assignedTicketIds.add(ticket.id);
    }
  });

  // Sort within each column by kanbanPosition when in single-board mode
  if (useKanbanPosition) {
    for (const stageId of Object.keys(grouped)) {
      grouped[stageId] = sortByKanbanPosition(grouped[stageId] ?? []);
    }
  }

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
  formFieldsById?: Map<string, { fieldType: FormFieldType; fieldEnum?: FieldEnumOption[] | null }>,
  currentUserId?: string,
): Ticket[] => {
  return tickets.filter(ticket => {
    // My tickets filter toggles (assigned to me / created by me)
    // These filters work together: if both are off, show all (handled outside)
    // If one or both are on, show tickets matching the selected criteria
    if (currentUserId && (filters.assigned || filters.created)) {
      const isAssignedToMe =
        ticket.assignedTo === `user:${currentUserId}` || ticket.assignedTo === `${currentUserId}`;
      const isCreatedByMe =
        ticket.createdBy === `user:${currentUserId}` || ticket.createdBy === `${currentUserId}`;

      // If only assigned is on, require assigned to me
      if (filters.assigned && !filters.created && !isAssignedToMe) {
        return false;
      }
      // If only created is on, require created by me
      if (filters.created && !filters.assigned && !isCreatedByMe) {
        return false;
      }
      // If both are on, ticket must match at least one criteria
      if (filters.assigned && filters.created && !isAssignedToMe && !isCreatedByMe) {
        return false;
      }
    }

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

    // Assignee filter — supports the "unassigned" sentinel and invert marker.
    if (filters.assignee && filters.assignee.length > 0) {
      const { inverted, includeUnassigned, ids } = parseAssigneeFilter(filters.assignee);
      if (ids.length > 0 || includeUnassigned) {
        // Extract the ID from the prefixed format
        const assigneeId = ticket.assignedTo
          ? ticket.assignedTo.replace(/^(user:|group:|userGroup:)/, '')
          : '';
        const matches = assigneeId ? ids.includes(assigneeId) : includeUnassigned;
        if (inverted ? matches : !matches) {
          return false;
        }
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

    if (filters.roleAssignments && filters.roleAssignments.length > 0) {
      const assignments = (
        ticket as Ticket & { assignments?: Array<{ userId: string; roleId?: string | null }> }
      ).assignments;
      for (const ra of filters.roleAssignments) {
        if (!ra.userIds.length) continue;
        const matching = (assignments ?? []).filter(a => a.roleId === ra.roleId);
        if (!matching.some(a => ra.userIds.includes(a.userId))) {
          return false;
        }
      }
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

    // Stages filter
    if (filters.stages && filters.stages.length > 0) {
      if (!ticket.stageName || !filters.stages.includes(ticket.stageName)) {
        return false;
      }
    }

    // Ticket type filter
    if (filters.ticketTypes && filters.ticketTypes.length > 0) {
      if (!ticket.ticketType || !filters.ticketTypes.includes(ticket.ticketType)) {
        return false;
      }
    }

    // Source channel filter
    if (filters.sourceChannels && filters.sourceChannels.length > 0) {
      if (!ticket.channelId || !filters.sourceChannels.includes(ticket.channelId)) {
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

        // Per-type value matching lives in the shared matcher (also used by the
        // Support desk's client-side refinement) so the semantics stay identical.
        if (
          !matchesDynamicFieldValue(fieldInfo.fieldType, filterValue, fieldValue.actualFieldValue)
        ) {
          return false;
        }
      }
    }

    return true;
  });
};

interface FormFieldGroup {
  type: 'formField';
  fieldId: string;
  fieldName: string;
  fieldType: FormFieldType;
}

/**
 * Groups tickets by form field values
 */
export const groupTicketsByFormField = (
  tickets: Ticket[],
  criterion: FormFieldGroup,
  formValuesByTicketId: Map<string, FormEntityValues[]>,
  userNamesById: Map<string, string>,
): Record<string, Ticket[]> => {
  const { fieldId, fieldType } = criterion;
  const groups: Record<string, Ticket[]> = {};

  tickets.forEach(ticket => {
    const formValues = formValuesByTicketId.get(ticket.id) || [];
    const fieldEntry = formValues.find(v => v.fieldId === fieldId);

    // Use actualFieldValue which contains the properly typed value
    const actualValue = fieldEntry?.actualFieldValue;

    if (fieldType === FormFieldType.MULTI_SELECT && actualValue) {
      // Multi-select: actualFieldValue is already an array of strings
      const values = Array.isArray(actualValue) ? actualValue : [];
      if (values.length === 0) {
        const groupKey = 'No Value';
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(ticket);
      } else {
        values.forEach(val => {
          const groupKey = typeof val === 'string' ? val : String(val);
          if (!groups[groupKey]) groups[groupKey] = [];
          groups[groupKey].push(ticket);
        });
      }
    } else {
      if (fieldType === FormFieldType.USER) {
        // User field: actualFieldValue is an array of user IDs
        const userIds = Array.isArray(actualValue) ? actualValue : [];
        if (userIds.length === 0) {
          const groupKey = 'Unassigned';
          if (!groups[groupKey]) groups[groupKey] = [];
          groups[groupKey].push(ticket);
        } else {
          userIds.forEach(userId => {
            const groupKey =
              typeof userId === 'string' ? userNamesById.get(userId) || userId : 'Unassigned';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(ticket);
          });
        }
      } else {
        // Single select and others: actualFieldValue is the value
        let val: string | null = null;
        if (actualValue !== undefined && actualValue !== null) {
          if (typeof actualValue === 'string') {
            val = actualValue;
          } else if (typeof actualValue === 'number' || typeof actualValue === 'boolean') {
            val = String(actualValue);
          }
          // For objects/arrays, use JSON serialization or ignore
        }
        const groupKey = val || 'No Value';
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(ticket);
      }
    }
  });

  return groups;
};

/**
 * Extracts all unique form fields attached to the selected board.
 * This is shared by grouping and dynamic filter logic, but those callers
 * should apply their own filtering rules after the fact.
 */
export const extractBoardFormFields = (
  filters: TicketFilters,
  allBoards: ReadonlyArray<{ id: string; formContextMappings?: readonly unknown[] }> | undefined,
): Array<{ id: string; fieldName: string; fieldType: FormFieldType }> => {
  if (filters.boards?.length !== 1 || !allBoards) return [];

  const selectedBoard = allBoards.find(b => b.id === filters.boards?.[0]);
  const formMappings = selectedBoard?.formContextMappings || [];
  if (!formMappings.length) return [];

  const fieldsMap = new Map<string, { id: string; fieldName: string; fieldType: FormFieldType }>();

  formMappings.forEach(mapping => {
    const mappingWithFields = mapping as {
      formId?: string;
      formFields?: readonly FormFields[];
    };
    const fields = mappingWithFields.formId
      ? resolveDisplayFormFields(mappingWithFields.formId, [
          ...(mappingWithFields.formFields ?? []),
        ])
      : [];
    fields.forEach(field => {
      if (!fieldsMap.has(field.id)) {
        fieldsMap.set(field.id, {
          id: field.id,
          fieldName: field.fieldName,
          fieldType: field.fieldType,
        });
      }
    });
  });

  return Array.from(fieldsMap.values());
};

/**
 * Extracts form fields eligible for grouping (SINGLE_SELECT, MULTI_SELECT, USER)
 */
export const extractGroupableFormFields = (
  filters: TicketFilters,
  allBoards: ReadonlyArray<{ id: string; formContextMappings?: readonly unknown[] }> | undefined,
): Array<{ id: string; fieldName: string; fieldType: FormFieldType }> => {
  if (filters.boards?.length !== 1 || !allBoards) return [];
  return extractBoardFormFields(filters, allBoards).filter(
    field =>
      field.fieldType === FormFieldType.SINGLE_SELECT ||
      field.fieldType === FormFieldType.MULTI_SELECT ||
      field.fieldType === FormFieldType.USER,
  );
};
