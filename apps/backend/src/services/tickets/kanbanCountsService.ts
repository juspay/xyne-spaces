import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { FormFieldType } from '@xyne/shared';
import {
  buildKanbanTicketWhere,
  type KanbanFormFieldGroup,
  type KanbanGroupBy,
  type KanbanTicketQueryContext,
} from './kanbanQueryBuilder';

export const TICKET_ENTITY_TYPE = 'TICKET';
export const NO_VALUE_GROUP = 'No Value';
export const UNASSIGNED_GROUP = 'Unassigned';
export const ALL_TICKETS_GROUP = 'All Tickets';

type KanbanCountTicket = {
  id: string;
  stageName: string;
  assignedTo: string | null;
  statusV2: string;
  priority: string;
  createdBy: string | null;
};

type KanbanCountGroupedRow = {
  id: string;
  stageName?: string;
  statusV2?: string;
  assignedTo: string | null;
  priority: string;
  createdBy: string | null;
  _count: {
    _all: number;
  };
};

export type FormEntityValueRow = {
  entityId: string;
  fieldId: string;
  actualFieldValue: Prisma.JsonValue | null;
};

export type KanbanStageCounts = Record<string, number>;

export type KanbanCountGroup = {
  groupKey: string;
  displayName: string;
  totalCount: number;
  stages: KanbanStageCounts;
  statuses: KanbanStageCounts;
};

export type KanbanCountsResponse = {
  groups: KanbanCountGroup[];
};

type KanbanCountColumnType = 'stage' | 'status';
type KanbanCountField = 'stageName' | 'statusV2';

export const isFormFieldGroup = (
  groupBy: KanbanGroupBy | undefined,
): groupBy is KanbanFormFieldGroup =>
  typeof groupBy === 'object' && groupBy !== null && groupBy.type === 'formField';

const getScalarValue = (value: Prisma.JsonValue | null): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const getJsonValueStrings = (value: Prisma.JsonValue | null): string[] => {
  if (value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap(item => getJsonValueStrings(item));
  }

  const scalar = getScalarValue(value);
  if (scalar) return [scalar];

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate = record.id ?? record.value ?? record.label ?? record.name ?? record.fieldValue;
    if (typeof candidate === 'string' && candidate.length > 0) return [candidate];
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return [String(candidate)];
  }

  return [];
};

export const getFormEntityValuesByTicketId = (
  formEntityValues: FormEntityValueRow[],
): Map<string, FormEntityValueRow[]> => {
  const valuesByTicketId = new Map<string, FormEntityValueRow[]>();

  for (const formEntityValue of formEntityValues) {
    const values = valuesByTicketId.get(formEntityValue.entityId) ?? [];
    values.push(formEntityValue);
    valuesByTicketId.set(formEntityValue.entityId, values);
  }

  return valuesByTicketId;
};

const matchesDynamicFilter = (
  value: Prisma.JsonValue | null,
  filterValue: string[] | { start?: number; end?: number },
): boolean => {
  if (Array.isArray(filterValue)) {
    const normalizedValues = getJsonValueStrings(value);
    if (normalizedValues.length === 0) return false;

    if (filterValue.length === 1) {
      const needle = filterValue[0].toLowerCase();
      return normalizedValues.some(item => item.toLowerCase().includes(needle));
    }

    return normalizedValues.some(item => filterValue.includes(item));
  }

  const scalarValue = getScalarValue(value);
  if (!scalarValue) return false;

  const timestamp = new Date(scalarValue).getTime();
  if (Number.isNaN(timestamp)) return false;
  if (filterValue.start !== undefined && timestamp < filterValue.start) return false;
  if (filterValue.end !== undefined && timestamp > filterValue.end) return false;
  return true;
};

export const filterTicketsByDynamicFields = <T extends { id: string }>(
  tickets: T[],
  dynamicFields: NonNullable<KanbanTicketQueryContext['filters']>['dynamicFields'],
  formValuesByTicketId: Map<string, FormEntityValueRow[]>,
): T[] => {
  if (!dynamicFields || Object.keys(dynamicFields).length === 0) return tickets;

  return tickets.filter(ticket => {
    const ticketFormValues = formValuesByTicketId.get(ticket.id) ?? [];

    for (const [fieldId, filterValue] of Object.entries(dynamicFields)) {
      const fieldEntry = ticketFormValues.find(value => value.fieldId === fieldId);
      if (!fieldEntry || !matchesDynamicFilter(fieldEntry.actualFieldValue, filterValue)) {
        return false;
      }
    }

    return true;
  });
};

export const getFormFieldGroupKeys = (
  ticketId: string,
  groupBy: KanbanFormFieldGroup,
  formValuesByTicketId: Map<string, FormEntityValueRow[]>,
): Array<{ groupKey: string; displayName: string }> => {
  const fieldEntry = formValuesByTicketId
    .get(ticketId)
    ?.find(value => value.fieldId === groupBy.fieldId);
  const actualValue = fieldEntry?.actualFieldValue ?? null;

  if (groupBy.fieldType === FormFieldType.MULTI_SELECT) {
    const values = getJsonValueStrings(actualValue);
    if (values.length === 0) {
      return [{ groupKey: NO_VALUE_GROUP, displayName: NO_VALUE_GROUP }];
    }

    return values.map(value => ({ groupKey: value, displayName: value }));
  }

  if (groupBy.fieldType === FormFieldType.USER) {
    const userIds = getJsonValueStrings(actualValue);
    if (userIds.length === 0) {
      return [{ groupKey: UNASSIGNED_GROUP, displayName: UNASSIGNED_GROUP }];
    }

    return userIds.map(userId => ({ groupKey: userId, displayName: userId }));
  }

  const scalarValue = getScalarValue(actualValue);
  const groupKey = scalarValue || NO_VALUE_GROUP;
  return [{ groupKey, displayName: groupKey }];
};

const getBuiltInGroupKey = (
  ticket: Pick<KanbanCountTicket, 'assignedTo' | 'createdBy'> & {
    statusV2?: string;
    priority?: string;
  },
  groupBy: Exclude<KanbanGroupBy, KanbanFormFieldGroup> | undefined,
): { groupKey: string; displayName: string } => {
  if (groupBy === 'assignee') {
    const groupKey = ticket.assignedTo ?? UNASSIGNED_GROUP;
    return { groupKey, displayName: groupKey };
  }

  if (groupBy === 'createdBy') {
    const raw = ticket.createdBy ?? '';
    const groupKey = raw.replace(/^user:/, '') || 'Unknown';
    return { groupKey, displayName: groupKey };
  }

  if (groupBy === 'status') {
    const groupKey = ticket.statusV2 ?? '';
    return { groupKey, displayName: groupKey };
  }

  if (groupBy === 'priority') {
    const groupKey = ticket.priority ?? '';
    return { groupKey, displayName: groupKey };
  }

  return { groupKey: ALL_TICKETS_GROUP, displayName: ALL_TICKETS_GROUP };
};

const addTicketToGroup = (
  groupsByKey: Map<string, KanbanCountGroup>,
  groupKey: string,
  displayName: string,
  columnType: KanbanCountColumnType,
  columnValue: string,
): void => {
  const group = groupsByKey.get(groupKey) ?? {
    groupKey,
    displayName,
    totalCount: 0,
    stages: {},
    statuses: {},
  };

  group.totalCount += 1;
  if (columnType === 'status') {
    group.statuses[columnValue] = (group.statuses[columnValue] ?? 0) + 1;
  } else {
    group.stages[columnValue] = (group.stages[columnValue] ?? 0) + 1;
  }
  groupsByKey.set(groupKey, group);
};

const addAggregateRowToGroup = (
  groupsByKey: Map<string, KanbanCountGroup>,
  groupKey: string,
  displayName: string,
  columnType: KanbanCountColumnType,
  columnValue: string,
  count: number,
): void => {
  const group = groupsByKey.get(groupKey) ?? {
    groupKey,
    displayName,
    totalCount: 0,
    stages: {},
    statuses: {},
  };

  group.totalCount += count;
  if (columnType === 'status') {
    group.statuses[columnValue] = (group.statuses[columnValue] ?? 0) + count;
  } else {
    group.stages[columnValue] = (group.stages[columnValue] ?? 0) + count;
  }
  groupsByKey.set(groupKey, group);
};

const getBuiltInGroupByFields = (
  groupBy: Exclude<KanbanGroupBy, KanbanFormFieldGroup> | undefined,
): Array<'assignedTo' | 'statusV2' | 'priority' | 'createdBy'> => {
  if (groupBy === 'assignee') return ['assignedTo'];
  if (groupBy === 'createdBy') return ['createdBy'];
  if (groupBy === 'status') return ['statusV2'];
  if (groupBy === 'priority') return ['priority'];
  return [];
};

const getCountColumnType = (context: KanbanTicketQueryContext): KanbanCountColumnType => {
  if (context.columnType) return context.columnType;
  if (context.viewMode === 'board' || context.boardId) return 'stage';
  return 'status';
};

const getCountField = (columnType: KanbanCountColumnType): KanbanCountField =>
  columnType === 'status' ? 'statusV2' : 'stageName';

export const getKanbanCounts = async (
  context: KanbanTicketQueryContext,
): Promise<KanbanCountsResponse> => {
  const where = buildKanbanTicketWhere(context);
  const dynamicFieldIds = Object.keys(context.filters?.dynamicFields ?? {});
  const groupBy = context.groupBy ?? 'none';
  const countColumnType = getCountColumnType(context);
  const countField = getCountField(countColumnType);
  const groupsByKey = new Map<string, KanbanCountGroup>();

  logger.info('[KanbanCountsService] Building ticket count query', {
    viewMode: context.viewMode,
    projectId: context.projectId ?? null,
    boardId: context.boardId ?? null,
    userId: context.userId ?? null,
    groupId: context.groupId ?? null,
    groupBy,
    countColumnType,
    hasDynamicFields: dynamicFieldIds.length > 0,
    where,
  });

  if (!isFormFieldGroup(groupBy) && dynamicFieldIds.length === 0) {
    const groupFields = getBuiltInGroupByFields(groupBy);
    const aggregateGroupFields = [...new Set([...groupFields, countField])] as Array<
      'assignedTo' | 'stageName' | 'statusV2' | 'priority' | 'createdBy'
    >;

    logger.info('[KanbanCountsService] Executing aggregate counts query', {
      by: aggregateGroupFields,
      where,
      mode: 'aggregate',
    });

    const aggregateRows = (await db.ticket.groupBy({
      by: aggregateGroupFields,
      where,
      _count: {
        _all: true,
      },
    })) as unknown as KanbanCountGroupedRow[];

    for (const row of aggregateRows) {
      const group = getBuiltInGroupKey(
        {
          assignedTo: row.assignedTo,
          createdBy: row.createdBy,
          statusV2: row.statusV2,
          priority: row.priority,
        },
        groupBy,
      );
      addAggregateRowToGroup(
        groupsByKey,
        group.groupKey,
        group.displayName,
        countColumnType,
        row[countField] ?? '',
        row._count._all,
      );
    }

    return {
      groups: [...groupsByKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    };
  }

  const fallbackGroupFields = isFormFieldGroup(groupBy)
    ? []
    : getBuiltInGroupByFields(groupBy);
  const fallbackFields = [...new Set(['id', countField, ...fallbackGroupFields])] as Array<
    'id' | 'assignedTo' | 'stageName' | 'statusV2' | 'priority' | 'createdBy'
  >;

  const tickets = (await db.ticket.groupBy({
    by: fallbackFields,
    where,
    _count: {
      _all: true,
    },
  })) as unknown as KanbanCountGroupedRow[];

  const formFieldIds = new Set<string>(dynamicFieldIds);
  if (isFormFieldGroup(groupBy)) {
    formFieldIds.add(groupBy.fieldId);
  }

  logger.info('[KanbanCountsService] Executing fallback count query', {
    mode: 'grouped-row-fallback',
    by: fallbackFields,
    where,
    formFieldIds: [...formFieldIds],
  });

  const formEntityValues =
    tickets.length > 0 && formFieldIds.size > 0
      ? await db.formEntityValues.findMany({
          where: {
            entityType: TICKET_ENTITY_TYPE,
            entityId: { in: tickets.map(ticket => ticket.id) },
            fieldId: { in: [...formFieldIds] },
          },
          select: {
            entityId: true,
            fieldId: true,
            actualFieldValue: true,
          },
        })
      : [];

  const formValuesByTicketId = getFormEntityValuesByTicketId(formEntityValues);
  const filteredTickets = filterTicketsByDynamicFields(
    tickets,
    context.filters?.dynamicFields,
    formValuesByTicketId,
  );

  for (const ticket of filteredTickets) {
    const groupKeys = isFormFieldGroup(groupBy)
      ? getFormFieldGroupKeys(ticket.id, groupBy, formValuesByTicketId)
      : [getBuiltInGroupKey(ticket, groupBy)];

    for (const group of groupKeys) {
      addTicketToGroup(
        groupsByKey,
        group.groupKey,
        group.displayName,
        countColumnType,
        ticket[countField] ?? '',
      );
    }
  }

  return {
    groups: [...groupsByKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
};
