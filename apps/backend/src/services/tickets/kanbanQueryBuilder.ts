import { Prisma } from '@prisma/client';
import {
  TicketPriority,
  TicketStatusV2,
  UserResponsibility,
  type FlowStepVisibilityOptions,
} from '@xyne/shared';
import { parseAssigneeFilter } from '@xyne/shared/zero/queries';

const SUPPORT_TICKET_TYPE = 'Support';

export type KanbanTicketViewMode =
  | 'project'
  | 'board'
  | 'my-tickets'
  | 'user-tickets'
  | 'group-tickets';

export type KanbanFormFieldGroup = {
  type: 'formField';
  fieldId: string;
  fieldName: string;
  fieldType: string;
};

export type KanbanGroupBy = 'none' | 'assignee' | 'status' | 'priority' | KanbanFormFieldGroup;

export type KanbanTicketFilters = {
  priority?: TicketPriority[];
  assignee?: string[];
  userGroups?: string[];
  createdBy?: string[];
  prReviewers?: string[];
  qaAssigned?: string[];
  roleAssignments?: Array<{ roleId: string; userIds: string[] }>;
  dueDateStart?: number;
  dueDateEnd?: number;
  createdDateStart?: number;
  createdDateEnd?: number;
  boards?: string[];
  sourceChannels?: string[];
  tags?: string[];
  assigned?: boolean;
  created?: boolean;
  stages?: string[];
  ticketTypes?: string[];
  dynamicFields?: Record<string, string[] | { start?: number; end?: number }>;
};

export type KanbanTicketQueryContext = FlowStepVisibilityOptions & {
  workspaceId: string;
  currentUserId?: string;
  viewMode: KanbanTicketViewMode;
  columnType?: 'stage' | 'status';
  projectId?: string;
  boardId?: string;
  boardIds?: string[];
  userId?: string;
  groupId?: string;
  filters?: KanbanTicketFilters;
  groupBy?: KanbanGroupBy;
  showOverdueOnly?: boolean;
};

const hasItems = <T>(value: readonly T[] | undefined): value is readonly T[] =>
  Array.isArray(value) && value.length > 0;

const prefixedIdentityValues = (id: string): string[] => [
  id,
  `user:${id}`,
  `group:${id}`,
  `userGroup:${id}`,
];

const compact = <T>(items: Array<T | false | null | undefined>): T[] =>
  items.filter((item): item is T => Boolean(item));

const timestampRangeFilter = (
  start: number | undefined,
  end: number | undefined,
): Prisma.DateTimeFilter | undefined => {
  if (start === undefined && end === undefined) return undefined;
  return {
    ...(start !== undefined ? { gte: new Date(start) } : {}),
    ...(end !== undefined ? { lte: new Date(end) } : {}),
  };
};

const buildCurrentUserFilter = (
  currentUserId: string | undefined,
  filters: KanbanTicketFilters,
): Prisma.TicketWhereInput | undefined => {
  if (!currentUserId || (!filters.assigned && !filters.created)) return undefined;

  const assignedFilter: Prisma.TicketWhereInput = {
    assignedTo: { in: [`user:${currentUserId}`, currentUserId] },
  };
  const createdFilter: Prisma.TicketWhereInput = {
    createdBy: { in: [`user:${currentUserId}`, currentUserId] },
  };

  if (filters.assigned && filters.created) {
    return { OR: [assignedFilter, createdFilter] };
  }
  return filters.assigned ? assignedFilter : createdFilter;
};

const buildChannelAccessFilter = (
  currentUserId: string | undefined,
): Prisma.TicketWhereInput | undefined => {
  if (!currentUserId) return undefined;

  return {
    channel: {
      is: {
        OR: [
          { visibility: 'PUBLIC' },
          {
            participants: {
              some: {
                userId: currentUserId,
              },
            },
          },
        ],
      },
    },
  };
};

const buildScopeFilter = (context: KanbanTicketQueryContext): Prisma.TicketWhereInput => {
  const { viewMode, projectId, boardId, boardIds, userId, groupId } = context;

  if (viewMode !== 'my-tickets') {
    if (boardId) return { boardId };
    if (hasItems(boardIds)) return { boardId: { in: [...boardIds] } };
    if (projectId) return { projectId };
  }

  if (viewMode === 'my-tickets' && context.currentUserId) {
    return {
      OR: [
        { assignedTo: { in: [`user:${context.currentUserId}`, context.currentUserId] } },
        { createdBy: { in: [`user:${context.currentUserId}`, context.currentUserId] } },
      ],
    };
  }

  if (viewMode === 'user-tickets' && userId) {
    return {
      OR: [
        { assignedTo: { in: [`user:${userId}`, userId] } },
        { createdBy: { in: [`user:${userId}`, userId] } },
      ],
    };
  }

  if (viewMode === 'group-tickets' && groupId) {
    return { userGroupId: { in: [`group:${groupId}`, groupId] } };
  }

  return {};
};

// Assignee filter with support for the "unassigned" sentinel and the invert
// marker (see parseAssigneeFilter in @xyne/shared). Inverted mode matches the
// exact complement of the normal selection.
const buildAssigneeFilter = (
  assignee: string[],
): Prisma.TicketWhereInput | undefined => {
  const { inverted, includeUnassigned, ids } = parseAssigneeFilter(assignee);
  const prefixedIds = ids.flatMap(prefixedIdentityValues);
  if (prefixedIds.length === 0 && !includeUnassigned) return undefined;

  if (!inverted) {
    return {
      OR: compact<Prisma.TicketWhereInput>([
        prefixedIds.length ? { assignedTo: { in: prefixedIds } } : undefined,
        ...(includeUnassigned ? [{ assignedTo: null }, { assignedTo: '' }] : []),
      ]),
    };
  }

  if (includeUnassigned) {
    // Must be assigned to someone outside the selected set.
    return {
      AND: compact<Prisma.TicketWhereInput>([
        prefixedIds.length ? { assignedTo: { notIn: prefixedIds } } : undefined,
        { NOT: { assignedTo: null } },
        { assignedTo: { not: '' } },
      ]),
    };
  }

  // Complement of the selected users — unassigned tickets qualify too
  // (SQL NOT IN drops NULL rows, so include them explicitly).
  return {
    OR: [
      { assignedTo: { notIn: prefixedIds } },
      { assignedTo: null },
      { assignedTo: '' },
    ],
  };
};

export const buildKanbanTicketWhere = (
  context: KanbanTicketQueryContext,
): Prisma.TicketWhereInput => {
  const filters = context.filters ?? {};
  const dueDateFilter = timestampRangeFilter(filters.dueDateStart, filters.dueDateEnd);
  const createdAtFilter = timestampRangeFilter(filters.createdDateStart, filters.createdDateEnd);

  return {
    AND: compact<Prisma.TicketWhereInput>([
      { workspaceId: context.workspaceId },
      { isArchived: false },
      buildChannelAccessFilter(context.currentUserId),
      buildScopeFilter(context),
      context.excludeFlowSteps ? { rootId: null } : undefined,
      {
        OR: [{ ticketType: null }, { ticketType: { not: SUPPORT_TICKET_TYPE } }],
      },
      buildCurrentUserFilter(context.currentUserId, filters),
      hasItems(filters.boards) ? { boardId: { in: [...filters.boards] } } : undefined,
      hasItems(filters.sourceChannels)
        ? { channelId: { in: [...filters.sourceChannels] } }
        : undefined,
      hasItems(filters.priority) ? { priority: { in: [...filters.priority] } } : undefined,
      hasItems(filters.assignee) ? buildAssigneeFilter(filters.assignee) : undefined,
      hasItems(filters.createdBy) ? { createdBy: { in: [...filters.createdBy] } } : undefined,
      hasItems(filters.userGroups) ? { userGroupId: { in: [...filters.userGroups] } } : undefined,
      hasItems(filters.prReviewers)
        ? {
            assignments: {
              some: {
                userResponsibility: UserResponsibility.PR_REVIEWER,
                userId: { in: [...filters.prReviewers] },
              },
            },
          }
        : undefined,
      hasItems(filters.qaAssigned)
        ? {
            assignments: {
              some: {
                userResponsibility: UserResponsibility.QA,
                userId: { in: [...filters.qaAssigned] },
              },
            },
          }
        : undefined,
      ...(filters.roleAssignments ?? [])
        .filter(ra => ra.userIds.length > 0)
        .map(ra => ({
          assignments: {
            some: {
              roleId: ra.roleId,
              userId: { in: ra.userIds },
            },
          },
        })),
      dueDateFilter ? { eta: dueDateFilter } : undefined,
      createdAtFilter ? { createdAt: createdAtFilter } : undefined,
      hasItems(filters.tags) ? { tags: { some: { name: { in: [...filters.tags] } } } } : undefined,
      hasItems(filters.stages) ? { stageName: { in: [...filters.stages] } } : undefined,
      hasItems(filters.ticketTypes) ? { ticketType: { in: [...filters.ticketTypes] } } : undefined,
      context.showOverdueOnly
        ? ({
            statusV2: { notIn: [TicketStatusV2.COMPLETED, TicketStatusV2.CANCELLED] },
            isStageOverdue: true,
          } as Prisma.TicketWhereInput)
        : undefined,
    ]),
  };
};
