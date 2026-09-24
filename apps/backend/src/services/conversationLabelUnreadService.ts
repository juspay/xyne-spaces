import { Prisma } from '@prisma/client';
import { parseAssigneeFilter } from '@xyne/shared/zero/queries';
import { db } from '@/database/client';

/**
 * Desk-list filter payload. Field names mirror supportTicketsPageV4
 * (src/zero/queries.ts ~L2023) — NOT the kanban query builder: there is
 * deliberately no ticketType exclusion, no sourceChannels/stages/dynamicFields
 * renames, and no mailboxFolder/search keyword (excluded by contract).
 */
export interface LabelUnreadFilters {
  assignedTo?: string[];
  createdBy?: string[];
  priority?: string[];
  stageName?: string[];
  aiCategory?: string[];
  conversationIds?: string[];
  hasAiDraft?: boolean;
  hasSubTickets?: boolean;
  userGroups?: string[];
  lastEmailAtStart?: number;
  lastEmailAtEnd?: number;
  createdAtStart?: number;
  createdAtEnd?: number;
  dynamicFieldFilters?: Array<{
    fieldId: string;
    values?: Array<string | number | boolean>;
  }>;
}

type AuthScope = { userId: string; workspaceId: string };

/**
 * Translates the desk filter payload into ticket where-clauses matching the
 * clause set of supportTicketsPageV4 (src/zero/queries.ts) field-for-field.
 */
function buildDeskFilterWhere(filters: LabelUnreadFilters): Prisma.TicketWhereInput[] {
  const clauses: Prisma.TicketWhereInput[] = [];

  // Mirrors supportTicketsV4 assignee handling (src/zero/queries.ts): the
  // 'unassigned' sentinel matches tickets with no assignee (null OR ''), the
  // '!invert' marker negates the selection. An empty array means "no constraint".
  if (filters.assignedTo?.length) {
    const { inverted, includeUnassigned, ids } = parseAssigneeFilter(filters.assignedTo);
    if (!inverted) {
      const orClauses: Prisma.TicketWhereInput[] = [
        ...(ids.length ? [{ assignedTo: { in: ids } }] : []),
        ...(includeUnassigned ? [{ assignedTo: null }, { assignedTo: '' }] : []),
      ];
      if (orClauses.length) clauses.push({ OR: orClauses });
    } else if (includeUnassigned) {
      clauses.push({
        AND: [
          ...(ids.length ? [{ assignedTo: { notIn: ids } }] : []),
          { assignedTo: { not: null } },
          { assignedTo: { not: '' } },
        ],
      });
    } else {
      clauses.push({
        OR: [{ assignedTo: { notIn: ids } }, { assignedTo: null }, { assignedTo: '' }],
      });
    }
  }
  if (filters.createdBy?.length) clauses.push({ createdBy: { in: filters.createdBy } });
  if (filters.priority?.length) clauses.push({ priority: { in: filters.priority } });
  if (filters.stageName?.length) clauses.push({ stageName: { in: filters.stageName } });
  if (filters.aiCategory?.length) clauses.push({ aiCategory: { in: filters.aiCategory } });
  if (filters.userGroups?.length) clauses.push({ userGroupId: { in: filters.userGroups } });

  // Present-but-empty whitelist means "match NOTHING" (the client sends [] while a
  // tag-filter whitelist is still loading); Prisma's `in: []` matches no rows.
  if (filters.conversationIds !== undefined) {
    clauses.push({ conversationId: { in: filters.conversationIds } });
  }

  // Mirrors supportTicketsPageV4: exists('emailDrafts', d => d.userId IS null) —
  // shared/system drafts only.
  if (filters.hasAiDraft === true) {
    clauses.push({ conversation: { emailDrafts: { some: { userId: null } } } });
  }

  // Mirrors supportTicketsPageV4: exists('subTicketMappings') — this ticket is the parent.
  if (filters.hasSubTickets === true) clauses.push({ subTicketMappings: { some: {} } });

  if (filters.lastEmailAtStart !== undefined) {
    clauses.push({ lastEmailAt: { gte: new Date(filters.lastEmailAtStart) } });
  }
  if (filters.lastEmailAtEnd !== undefined) {
    clauses.push({ lastEmailAt: { lte: new Date(filters.lastEmailAtEnd) } });
  }
  if (filters.createdAtStart !== undefined) {
    clauses.push({ createdAt: { gte: new Date(filters.createdAtStart) } });
  }
  if (filters.createdAtEnd !== undefined) {
    clauses.push({ createdAt: { lte: new Date(filters.createdAtEnd) } });
  }

  return clauses;
}

/** Stays well under Postgres' 32767 bind-parameter limit for `entityId IN (...)`. */
const DYNAMIC_FIELD_ID_CHUNK = 10_000;

/**
 * Mirrors applySupportDynamicFieldFilters (src/zero/queries.ts): each entry must match
 * (AND across entries); an entry's values are OR'd; an entry with no values matches on
 * field presence alone. Json `equals` compares against the JSON-encoded value
 * ("x" / 5 / true), which is how actualFieldValue is stored.
 *
 * form_entity_values has no Prisma relation to tickets (entityId is polymorphic), so this
 * can't be a relation filter. Instead of loading every workspace ticket that carries the
 * field value, it narrows an already-scoped candidate set (the caller's unread tickets
 * under one label) through the (entityId, entityType) index — the lookups are bounded by
 * that set, not by how common the value is across the workspace.
 */
async function narrowByDynamicFields(
  auth: AuthScope,
  candidateTicketIds: string[],
  dynamicFieldFilters: NonNullable<LabelUnreadFilters['dynamicFieldFilters']>,
): Promise<string[]> {
  let remaining = candidateTicketIds;
  for (const fieldFilter of dynamicFieldFilters) {
    if (remaining.length === 0) break;
    const matched = new Set<string>();
    for (let offset = 0; offset < remaining.length; offset += DYNAMIC_FIELD_ID_CHUNK) {
      const rows = await db.formEntityValues.findMany({
        where: {
          workspaceId: auth.workspaceId,
          entityType: 'TICKET',
          entityId: { in: remaining.slice(offset, offset + DYNAMIC_FIELD_ID_CHUNK) },
          fieldId: fieldFilter.fieldId,
          ...(fieldFilter.values?.length
            ? { OR: fieldFilter.values.map(value => ({ actualFieldValue: { equals: value } })) }
            : {}),
        },
        distinct: ['entityId'],
        select: { entityId: true },
      });
      for (const row of rows) matched.add(row.entityId);
    }
    remaining = remaining.filter(id => matched.has(id));
  }
  return remaining;
}

/** Private labels: only mappings the caller applied, in this desk. */
function labelMappingScope(
  auth: AuthScope,
  channelId: string,
  labelId?: string,
): Prisma.ConversationLabelMappingWhereInput {
  return {
    channelId,
    workspaceId: auth.workspaceId,
    createdBy: auth.userId,
    ...(labelId ? { labelId } : {}),
  };
}

/**
 * Unread predicate (mirrors TicketListRow.tsx): a ticket is unread for a user iff
 * emailCount > 0 AND (no email_reads row exists for (ticketId, userId)
 * OR email_reads.lastReadEmailAt < ticket.lastEmailAt).
 *
 * The timestamp comparison spans two tables, so it is denormalized into
 * email_reads.hasNewEmail (set by advanceLastEmailAt when lastEmailAt changes,
 * cleared on read), which keeps the whole count in Postgres.
 */
function unreadForUserWhere(userId: string): Prisma.TicketWhereInput {
  return {
    emailCount: { gt: 0 },
    OR: [
      { emailReads: { none: { userId } } },
      { emailReads: { some: { userId, hasNewEmail: true } } },
    ],
  };
}

/**
 * Unread tickets in the desk. `isArchived = false` aligns with the desk list base
 * constraint (supportTicketsPageV3/V4) so badges equal what the list shows.
 */
function unreadTicketWhere(
  auth: AuthScope,
  channelId: string,
  filterClauses: Prisma.TicketWhereInput[] = [],
): Prisma.TicketWhereInput {
  return {
    channelId,
    workspaceId: auth.workspaceId,
    isArchived: false,
    AND: [unreadForUserWhere(auth.userId), ...filterClauses],
  };
}

/**
 * Mode A: unread count per label for a channel, in one grouped query (same shape as
 * kanbanCountsService.getKanbanCounts). Labels with zero unread are omitted.
 *
 * A label isn't a ticket column, so the groupBy runs on the mappings: one row per
 * (conversation, label), kept when that conversation's ticket is unread. That counts
 * conversations, which equals tickets because a desk conversation carries one ticket.
 *
 * The caller's label ids come from the catalog first (its (channelId, createdBy, name)
 * unique index) so the grouped scan reaches mappings through their labelId index
 * rather than scanning by channel.
 */
export async function getLabelUnreadCounts(
  auth: AuthScope,
  channelId: string,
): Promise<Record<string, number>> {
  const labels = await db.conversationLabel.findMany({
    where: { channelId, workspaceId: auth.workspaceId, createdBy: auth.userId },
    select: { id: true },
  });
  if (labels.length === 0) return {};

  const rows = await db.conversationLabelMapping.groupBy({
    by: ['labelId'],
    where: {
      ...labelMappingScope(auth, channelId),
      labelId: { in: labels.map(label => label.id) },
      conversation: { tickets: { some: unreadTicketWhere(auth, channelId) } },
    },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row._count._all > 0) counts[row.labelId] = row._count._all;
  }
  return counts;
}

/**
 * Mode B: unread count for ONE label restricted by a desk filter payload.
 * Same scope and unread predicate as mode A, plus the desk filters.
 */
export async function getLabelUnreadCount(
  auth: AuthScope,
  channelId: string,
  labelId: string,
  filters?: LabelUnreadFilters,
): Promise<number> {
  const where: Prisma.TicketWhereInput = {
    ...unreadTicketWhere(auth, channelId, filters ? buildDeskFilterWhere(filters) : []),
    conversation: { labelMappings: { some: labelMappingScope(auth, channelId, labelId) } },
  };

  if (!filters?.dynamicFieldFilters?.length) {
    return db.ticket.count({ where });
  }

  // Dynamic fields: resolve the scoped candidates first, then narrow them (see
  // narrowByDynamicFields).
  const candidates = await db.ticket.findMany({ where, select: { id: true } });
  const matched = await narrowByDynamicFields(
    auth,
    candidates.map(ticket => ticket.id),
    filters.dynamicFieldFilters,
  );
  return matched.length;
}
