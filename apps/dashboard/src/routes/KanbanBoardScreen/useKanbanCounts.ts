import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import {
  getKanbanCounts,
  type KanbanCountGroup,
  type KanbanCountsFilters,
  type KanbanCountsGroupBy,
  type KanbanCountsRequest,
  type KanbanCountsViewMode,
} from '../../services/ticketService';
import {
  BaseTicketType,
  FormFieldType,
  TicketStatusV2,
  type FlowStepVisibilityOptions,
} from '@xyne/shared';
import { parseAssigneeFilter } from '../../zero/queries';
import { websocketService } from '../../services/clients/socketClient';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';

interface UseKanbanCountsOptions extends FlowStepVisibilityOptions {
  viewMode: KanbanCountsViewMode;
  columnType?: 'stage' | 'status';
  projectId?: string;
  boardId?: string;
  userId?: string;
  groupId?: string;
  filters?: TicketFilters;
  groupBy?: KanbanCountsGroupBy;
  showOverdueOnly?: boolean;
  enabled?: boolean;
  currentUserId?: string;
}

interface UseKanbanCountsResult {
  groups: KanbanCountGroup[];
  groupsByKey: Map<string, KanbanCountGroup>;
  isLoading: boolean;
  error: Error | null;
}

type TicketCountsSnapshot = {
  id: string;
  workspaceId: string;
  boardId: string | null;
  channelId: string | null;
  projectId: string | null;
  stageName: string | null;
  statusV2: string | null;
  priority: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  userGroupId: string | null;
  ticketType: string | null;
  isStageOverdue: boolean;
  eta: number | null;
  createdAt: number;
  tags: string[];
  roleAssignments: Array<{ roleId: string; userIds: string[] }>;
  formFieldValues: Record<string, unknown>;
};

type TicketCountsUpdateEvent = {
  operation: 'insert' | 'update';
  ticket: TicketCountsSnapshot;
  previousTicket?: TicketCountsSnapshot | null;
  timestamp: string;
};

const sortUniqueValues = <T extends string>(values?: readonly T[]): T[] | undefined => {
  if (!values || values.length === 0) return undefined;

  const uniqueValues = [...new Set(values)];
  uniqueValues.sort((left, right) => left.localeCompare(right));
  return uniqueValues;
};

const SUPPORT_TICKET_TYPE = BaseTicketType.Support;
const ALL_TICKETS_GROUP = 'All Tickets';
const UNASSIGNED_GROUP = 'Unassigned';

const normalizeIdentity = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.replace(/^(user:|group:|userGroup:)/, '');
};

const stringifyFormFieldValue = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const isStringValue = (value: string | null): value is string => value !== null;

const getTicketCountsRoom = (
  request: KanbanCountsRequest,
  currentUserId?: string,
): string | null => {
  if (request.viewMode === 'project') {
    if (request.projectId) return `ticket-counts:project:${request.projectId}`;
    if (request.boardId) return `ticket-counts:board:${request.boardId}`;
    return null;
  }

  if (request.viewMode === 'board') {
    if (request.projectId) return `ticket-counts:project:${request.projectId}`;
    if (request.boardId) return `ticket-counts:board:${request.boardId}`;
    return null;
  }

  if (request.viewMode === 'user-tickets') {
    if (request.userId) return `ticket-counts:user:${request.userId}`;
    return null;
  }

  if (request.viewMode === 'group-tickets') {
    if (request.groupId) return `ticket-counts:group:${request.groupId}`;
    return null;
  }

  if (request.viewMode === 'my-tickets' && currentUserId) {
    return `ticket-counts:user:${currentUserId}`;
  }

  return null;
};

const getFormFieldGroupKeys = (
  snapshot: TicketCountsSnapshot,
  groupBy: Extract<KanbanCountsGroupBy, { type: 'formField' }>,
): string[] => {
  const value = snapshot.formFieldValues[groupBy.fieldId] ?? null;

  if (groupBy.fieldType === FormFieldType.MULTI_SELECT) {
    const values = Array.isArray(value) ? value : [];
    const stringValues = values.map(stringifyFormFieldValue).filter(isStringValue);
    return stringValues.length > 0 ? stringValues : ['No Value'];
  }

  if (groupBy.fieldType === FormFieldType.USER) {
    const values = Array.isArray(value) ? value : [];
    const stringValues = values.map(stringifyFormFieldValue).filter(isStringValue);
    return stringValues.length > 0 ? stringValues : ['Unassigned'];
  }

  if (Array.isArray(value)) {
    const stringValues = value.map(stringifyFormFieldValue).filter(isStringValue);
    return stringValues.length > 0 ? stringValues : ['No Value'];
  }

  if (value === null || value === undefined || value === '') return ['No Value'];
  const stringValue = stringifyFormFieldValue(value);
  return stringValue ? [stringValue] : ['No Value'];
};

const getGroupKeys = (
  snapshot: TicketCountsSnapshot,
  groupBy: KanbanCountsGroupBy | undefined,
): string[] => {
  if (!groupBy || groupBy === 'none') return [ALL_TICKETS_GROUP];
  if (groupBy === 'assignee') return [normalizeIdentity(snapshot.assignedTo) ?? UNASSIGNED_GROUP];
  if (groupBy === 'createdBy') return [normalizeIdentity(snapshot.createdBy) ?? 'Unknown'];
  if (groupBy === 'status') return [snapshot.statusV2 ?? ''];
  if (groupBy === 'priority') return [snapshot.priority ?? ''];
  if (typeof groupBy === 'object' && groupBy.type === 'formField') {
    return getFormFieldGroupKeys(snapshot, groupBy);
  }
  return [];
};

const getStageKeys = (snapshot: TicketCountsSnapshot): string[] => {
  return snapshot.stageName ? [snapshot.stageName] : [];
};

const getStatusKeys = (snapshot: TicketCountsSnapshot): string[] => {
  return snapshot.statusV2 ? [snapshot.statusV2] : [];
};

const isSupportTicket = (snapshot: TicketCountsSnapshot): boolean =>
  snapshot.ticketType === SUPPORT_TICKET_TYPE;

const matchesFilterList = (
  value: string | null | undefined,
  candidates?: readonly string[],
): boolean => {
  if (!candidates || candidates.length === 0) return true;
  const normalizedValue = normalizeIdentity(value);
  if (!normalizedValue) return false;
  return candidates.includes(normalizedValue);
};

// Assignee-specific: understands the "unassigned" sentinel and invert marker.
const matchesAssigneeList = (
  value: string | null | undefined,
  candidates?: readonly string[],
): boolean => {
  if (!candidates || candidates.length === 0) return true;
  const { inverted, includeUnassigned, ids } = parseAssigneeFilter(candidates);
  if (!ids.length && !includeUnassigned) return true;
  const normalizedValue = normalizeIdentity(value);
  const matches = normalizedValue ? ids.includes(normalizedValue) : includeUnassigned;
  return inverted ? !matches : matches;
};

const matchesIdentity = (
  value: string | null | undefined,
  expected: string | undefined,
): boolean => {
  if (!expected) return true;
  return normalizeIdentity(value) === normalizeIdentity(expected);
};

const matchesRequest = (
  snapshot: TicketCountsSnapshot,
  request: KanbanCountsRequest,
  currentUserId?: string,
): boolean => {
  if (isSupportTicket(snapshot)) return false;

  if (request.boardId && snapshot.boardId !== request.boardId) return false;
  if (request.projectId && !request.boardId && snapshot.projectId !== request.projectId)
    return false;
  if (request.userId && request.viewMode === 'user-tickets') {
    if (
      !matchesIdentity(snapshot.assignedTo, request.userId) &&
      !matchesIdentity(snapshot.createdBy, request.userId)
    ) {
      return false;
    }
  }
  if (request.groupId && request.viewMode === 'group-tickets') {
    if (!matchesIdentity(snapshot.userGroupId, request.groupId)) return false;
  }
  if (request.viewMode === 'my-tickets' && currentUserId) {
    const assignedMatch = matchesIdentity(snapshot.assignedTo, currentUserId);
    const createdMatch = matchesIdentity(snapshot.createdBy, currentUserId);
    if (
      (request.filters?.assigned && !request.filters?.created && !assignedMatch) ||
      (request.filters?.created && !request.filters?.assigned && !createdMatch) ||
      (request.filters?.assigned && request.filters?.created && !assignedMatch && !createdMatch)
    ) {
      return false;
    }
    if (
      !request.filters?.assigned &&
      !request.filters?.created &&
      !assignedMatch &&
      !createdMatch
    ) {
      return false;
    }
  }

  const filters = request.filters;
  if (!filters) return true;

  if (filters.boards?.length && !filters.boards.includes(snapshot.boardId ?? '')) return false;
  if (filters.sourceChannels?.length && !filters.sourceChannels.includes(snapshot.channelId ?? ''))
    return false;
  if (filters.priority?.length && !filters.priority.includes(snapshot.priority as never))
    return false;
  if (filters.assignee?.length && !matchesAssigneeList(snapshot.assignedTo, filters.assignee))
    return false;
  if (filters.createdBy?.length && !matchesFilterList(snapshot.createdBy, filters.createdBy))
    return false;
  if (filters.userGroups?.length && !matchesFilterList(snapshot.userGroupId, filters.userGroups))
    return false;
  if (filters.tags?.length && !filters.tags.some(tag => snapshot.tags.includes(tag))) return false;
  if (filters.roleAssignments?.length) {
    for (const ra of filters.roleAssignments) {
      if (!ra.userIds.length) continue;
      const snap = snapshot.roleAssignments.find(s => s.roleId === ra.roleId);
      if (!snap || !ra.userIds.some(u => snap.userIds.includes(u))) return false;
    }
  }
  if (filters.dueDateStart !== undefined && (snapshot.eta ?? 0) < filters.dueDateStart)
    return false;
  if (filters.dueDateEnd !== undefined && (snapshot.eta ?? 0) > filters.dueDateEnd) return false;
  if (filters.createdDateStart !== undefined && snapshot.createdAt < filters.createdDateStart)
    return false;
  if (filters.createdDateEnd !== undefined && snapshot.createdAt > filters.createdDateEnd)
    return false;
  if (filters.stages?.length && !filters.stages.includes(snapshot.stageName ?? '')) return false;
  if (filters.ticketTypes?.length && !filters.ticketTypes.includes(snapshot.ticketType ?? ''))
    return false;
  if (filters.assigned !== undefined) {
    const isAssigned = Boolean(snapshot.assignedTo);
    if (filters.assigned !== isAssigned) return false;
  }
  if (filters.created !== undefined) {
    const isCreated = currentUserId ? matchesIdentity(snapshot.createdBy, currentUserId) : false;
    if (filters.created !== isCreated) return false;
  }

  if (filters.dynamicFields) {
    for (const [fieldId, filterValue] of Object.entries(filters.dynamicFields)) {
      const value = snapshot.formFieldValues[fieldId] ?? null;

      if (Array.isArray(filterValue)) {
        if (Array.isArray(value)) {
          if (!value.some(item => typeof item === 'string' && filterValue.includes(item)))
            return false;
        } else {
          const scalarValue =
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : null;
          if (!scalarValue) return false;
          if (filterValue.length === 1) {
            if (!scalarValue.toLowerCase().includes(filterValue[0]!.toLowerCase())) return false;
          } else if (!filterValue.includes(scalarValue)) {
            return false;
          }
        }
      } else {
        const scalarValue =
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : null;
        if (!scalarValue) return false;
        const timestamp = new Date(scalarValue).getTime();
        if (Number.isNaN(timestamp)) return false;
        if (filterValue.start !== undefined && timestamp < filterValue.start) return false;
        if (filterValue.end !== undefined && timestamp > filterValue.end) return false;
      }
    }
  }

  if (request.showOverdueOnly) {
    const isTerminal =
      snapshot.statusV2 === TicketStatusV2.COMPLETED ||
      snapshot.statusV2 === TicketStatusV2.CANCELLED;
    if (isTerminal) return false;
    if (!snapshot.isStageOverdue) return false;
  }

  return true;
};

const cloneGroup = (group: KanbanCountGroup): KanbanCountGroup => ({
  ...group,
  stages: { ...group.stages },
  statuses: { ...group.statuses },
});

const applyCountDelta = (
  group: KanbanCountGroup,
  keys: string[],
  delta: number,
  field: 'stages' | 'statuses',
): void => {
  for (const key of keys) {
    const nextCount = (group[field][key] ?? 0) + delta;
    if (nextCount <= 0) {
      delete group[field][key];
    } else {
      group[field][key] = nextCount;
    }
  }
};

const applyGroupDelta = (
  groups: KanbanCountGroup[],
  groupKeys: string[],
  stageKeys: string[],
  statusKeys: string[],
  delta: number,
  columnType: 'stage' | 'status',
): KanbanCountGroup[] => {
  const nextGroups = groups.map(cloneGroup);
  for (const groupKey of groupKeys) {
    const groupIndex = nextGroups.findIndex(group => group.groupKey === groupKey);
    const displayName =
      groupKey === ALL_TICKETS_GROUP || groupKey === UNASSIGNED_GROUP ? groupKey : groupKey;
    let group = groupIndex >= 0 ? nextGroups[groupIndex] : null;

    if (!group) {
      if (delta <= 0) continue;
      group = {
        groupKey,
        displayName,
        totalCount: 0,
        stages: {},
        statuses: {},
      };
      nextGroups.push(group);
    }

    group.totalCount += delta;
    if (columnType === 'status') {
      applyCountDelta(group, statusKeys, delta, 'statuses');
    } else {
      applyCountDelta(group, stageKeys, delta, 'stages');
    }

    if (group.totalCount <= 0) {
      return nextGroups.filter(item => item.groupKey !== groupKey);
    }
  }

  return nextGroups.sort((left, right) => left.displayName.localeCompare(right.displayName));
};

const applyTicketCountsUpdate = (
  current: { groups: KanbanCountGroup[] } | undefined,
  request: KanbanCountsRequest,
  event: TicketCountsUpdateEvent,
  currentUserId?: string,
): { groups: KanbanCountGroup[] } | undefined => {
  if (!current) return current;
  if (
    event.ticket.workspaceId &&
    request.projectId &&
    event.ticket.projectId !== request.projectId &&
    !request.boardId
  ) {
    // If scoped by project, the ticket must belong to that project.
    if (request.viewMode !== 'my-tickets' && event.ticket.projectId !== request.projectId) {
      return current;
    }
  }

  const previousMatches = event.previousTicket
    ? matchesRequest(event.previousTicket, request, currentUserId)
    : false;
  const currentMatches = matchesRequest(event.ticket, request, currentUserId);

  if (!previousMatches && !currentMatches) return current;

  let nextGroups = current.groups;
  const columnType = request.columnType ?? 'stage';

  if (previousMatches && event.previousTicket) {
    const previousGroupKeys = getGroupKeys(event.previousTicket, request.groupBy);
    if (previousGroupKeys.length > 0) {
      const previousStageKeys = getStageKeys(event.previousTicket);
      const previousStatusKeys = getStatusKeys(event.previousTicket);
      nextGroups = applyGroupDelta(
        nextGroups,
        previousGroupKeys,
        previousStageKeys,
        previousStatusKeys,
        -1,
        columnType,
      );
    }
  }

  if (currentMatches) {
    const currentGroupKeys = getGroupKeys(event.ticket, request.groupBy);
    if (currentGroupKeys.length > 0) {
      const currentStageKeys = getStageKeys(event.ticket);
      const currentStatusKeys = getStatusKeys(event.ticket);
      nextGroups = applyGroupDelta(
        nextGroups,
        currentGroupKeys,
        currentStageKeys,
        currentStatusKeys,
        1,
        columnType,
      );
    }
  }

  return { groups: [...nextGroups] };
};

const normalizeDynamicFields = (
  dynamicFields?: TicketFilters['dynamicFields'],
): KanbanCountsFilters['dynamicFields'] | undefined => {
  if (!dynamicFields) return undefined;

  const entries: Array<readonly [string, string[] | { start?: number; end?: number }]> = [];

  for (const [fieldId, filterValue] of Object.entries(dynamicFields).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (Array.isArray(filterValue)) {
      const normalizedValues = sortUniqueValues(filterValue);
      if (!normalizedValues) continue;

      entries.push([fieldId, normalizedValues]);
      continue;
    }

    const normalizedRange: { start?: number; end?: number } = {};
    if (filterValue.start !== undefined) normalizedRange.start = filterValue.start;
    if (filterValue.end !== undefined) normalizedRange.end = filterValue.end;

    if (Object.keys(normalizedRange).length === 0) continue;

    entries.push([fieldId, normalizedRange]);
  }

  if (entries.length === 0) return undefined;

  return Object.fromEntries(entries);
};

const normalizeFilters = (filters?: TicketFilters): KanbanCountsFilters | undefined => {
  if (!filters) return undefined;

  const normalized: KanbanCountsFilters = {};

  const priority = sortUniqueValues(filters.priority);
  if (priority) normalized.priority = priority;

  const assignee = sortUniqueValues(filters.assignee);
  if (assignee) normalized.assignee = assignee;

  const userGroups = sortUniqueValues(filters.userGroups);
  if (userGroups) normalized.userGroups = userGroups;

  const createdBy = sortUniqueValues(filters.createdBy);
  if (createdBy) normalized.createdBy = createdBy;

  if (filters.roleAssignments?.length) {
    const roleAssignments = filters.roleAssignments
      .filter(ra => ra.userIds.length > 0)
      .map(ra => ({
        roleId: ra.roleId,
        userIds: sortUniqueValues(ra.userIds) ?? [],
      }))
      .sort((a, b) => a.roleId.localeCompare(b.roleId));
    if (roleAssignments.length) normalized.roleAssignments = roleAssignments;
  }

  if (filters.dueDateStart !== undefined) normalized.dueDateStart = filters.dueDateStart;
  if (filters.dueDateEnd !== undefined) normalized.dueDateEnd = filters.dueDateEnd;
  if (filters.createdDateStart !== undefined)
    normalized.createdDateStart = filters.createdDateStart;
  if (filters.createdDateEnd !== undefined) normalized.createdDateEnd = filters.createdDateEnd;

  const boards = sortUniqueValues(filters.boards);
  if (boards) normalized.boards = boards;

  const sourceChannels = sortUniqueValues(filters.sourceChannels);
  if (sourceChannels) normalized.sourceChannels = sourceChannels;

  const tags = sortUniqueValues(filters.tags);
  if (tags) normalized.tags = tags;

  if (filters.assigned !== undefined) normalized.assigned = filters.assigned;
  if (filters.created !== undefined) normalized.created = filters.created;

  const stages = sortUniqueValues(filters.stages);
  if (stages) normalized.stages = stages;

  const ticketTypes = sortUniqueValues(filters.ticketTypes);
  if (ticketTypes) normalized.ticketTypes = ticketTypes;

  const dynamicFields = normalizeDynamicFields(filters.dynamicFields);
  if (dynamicFields) normalized.dynamicFields = dynamicFields;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const toRequest = (options: UseKanbanCountsOptions): KanbanCountsRequest => {
  const request: KanbanCountsRequest = {
    viewMode: options.viewMode,
  };

  if (options.columnType !== undefined) request.columnType = options.columnType;
  if (options.projectId !== undefined) request.projectId = options.projectId;
  if (options.boardId !== undefined) request.boardId = options.boardId;
  if (options.userId !== undefined) request.userId = options.userId;
  if (options.groupId !== undefined) request.groupId = options.groupId;
  if (options.excludeFlowSteps !== undefined) request.excludeFlowSteps = options.excludeFlowSteps;

  const normalizedFilters = normalizeFilters(options.filters);
  if (normalizedFilters) request.filters = normalizedFilters;

  if (options.groupBy !== undefined) request.groupBy = options.groupBy;
  if (options.showOverdueOnly !== undefined) request.showOverdueOnly = options.showOverdueOnly;

  return request;
};

export const useKanbanCounts = (options: UseKanbanCountsOptions): UseKanbanCountsResult => {
  const rawRequest = toRequest(options);
  const requestKey = JSON.stringify(rawRequest);
  const request = useMemo(() => rawRequest, [requestKey]);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['tickets', 'kanban-counts', request],
    queryFn: () => getKanbanCounts(request),
    enabled: options.enabled ?? true,
    staleTime: 10 * 60 * 1000,
  });

  const groups = useMemo(() => query.data?.groups ?? [], [query.data?.groups]);
  const groupsByKey = useMemo(
    () => new Map(groups.map(group => [group.groupKey, group])),
    [groups],
  );
  const ticketCountsRoom = useMemo(
    () => getTicketCountsRoom(request, options.currentUserId),
    [options.currentUserId, request],
  );

  useEffect(() => {
    if (!(options.enabled ?? true)) return;
    if (!ticketCountsRoom) return;

    let cancelled = false;
    const handleCountsUpdate = (event: TicketCountsUpdateEvent): void => {
      if (cancelled) return;

      // Live count snapshots do not carry rootId. Refetch aggregate-board
      // counts so materialized flow steps cannot leak into the total.
      if (request.excludeFlowSteps) {
        void queryClient.invalidateQueries({ queryKey: ['tickets', 'kanban-counts', request] });
        return;
      }

      queryClient.setQueryData<{ groups: KanbanCountGroup[] }>(
        ['tickets', 'kanban-counts', request],
        current => applyTicketCountsUpdate(current, request, event, options.currentUserId),
      );
    };
    const handleSocketConnect = (): void => {
      if (cancelled) return;
      websocketService.emit('subscribe_to_ticket_counts', { room: ticketCountsRoom });
    };

    const subscribe = async (): Promise<void> => {
      try {
        if (!websocketService.isConnectedToServer()) {
          await websocketService.connect();
        }
        if (cancelled) return;
        websocketService.on<TicketCountsUpdateEvent>(
          'ticket_counts_room_updated',
          handleCountsUpdate,
        );
        websocketService.on('connect', handleSocketConnect);
        websocketService.emit('subscribe_to_ticket_counts', { room: ticketCountsRoom });
      } catch {
        // Ignore websocket failures; counts will continue to work from the API snapshot.
      }
    };

    void subscribe();

    return () => {
      cancelled = true;
      websocketService.removeListener<TicketCountsUpdateEvent>(
        'ticket_counts_room_updated',
        handleCountsUpdate,
      );
      websocketService.removeListener('connect', handleSocketConnect);
      websocketService.emit('unsubscribe_from_ticket_counts', { room: ticketCountsRoom });
    };
  }, [options.currentUserId, options.enabled, queryClient, requestKey, ticketCountsRoom]);

  return {
    groups,
    groupsByKey,
    isLoading: query.isLoading,
    error: query.error,
  };
};
