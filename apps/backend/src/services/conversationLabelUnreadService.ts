import { Prisma } from '@prisma/client';
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

  // Desk V4 filters assignees with a plain `IN` — the 'unassigned'/'!invert'
  // sentinels handled by parseAssigneeFilter are kanban-only, so they are
  // intentionally NOT special-cased here. An empty array means "no constraint".
  if (filters.assignedTo?.length) clauses.push({ assignedTo: { in: filters.assignedTo } });
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

  // Mirrors applySupportDynamicFieldFilters (src/zero/queries.ts): each entry is its
  // own EXISTS (AND across entries); an entry's values are OR'd; an entry with no
  // values matches on field presence alone. Json `equals` compares against the
  // JSON-encoded value ("x" / 5 / true), which is how actualFieldValue is stored.
  for (const fieldFilter of filters.dynamicFieldFilters ?? []) {
    clauses.push({
      formEntityValues: {
        some: {
          entityType: 'TICKET',
          fieldId: fieldFilter.fieldId,
          ...(fieldFilter.values?.length
            ? { OR: fieldFilter.values.map(value => ({ actualFieldValue: { equals: value } })) }
            : {}),
        },
      },
    });
  }

  return clauses;
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
 * Tickets counted for one label. `isArchived = false` aligns with the desk list
 * base constraint (supportTicketsPageV3/V4) so badges equal what the list shows.
 * Tenant/channel ACL is applied on top by the Prisma ACL extension.
 */
function unreadLabeledTicketWhere(
  auth: AuthScope,
  channelId: string,
  labelId: string,
  filters?: LabelUnreadFilters,
): Prisma.TicketWhereInput {
  return {
    channelId,
    workspaceId: auth.workspaceId,
    isArchived: false,
    conversation: { labelMappings: { some: labelMappingScope(auth, channelId, labelId) } },
    AND: [unreadForUserWhere(auth.userId), ...(filters ? buildDeskFilterWhere(filters) : [])],
  };
}

/**
 * Mode A: unread count per label for a channel. Labels with zero unread are
 * omitted from the map. One COUNT per label the caller owns in this desk (a
 * handful per agent), each evaluated entirely in Postgres.
 */
export async function getLabelUnreadCounts(
  auth: AuthScope,
  channelId: string,
): Promise<Record<string, number>> {
  const labels = await db.conversationLabelMapping.findMany({
    where: labelMappingScope(auth, channelId),
    distinct: ['labelId'],
    select: { labelId: true },
  });

  const entries = await Promise.all(
    labels.map(async ({ labelId }) => {
      const count = await db.ticket.count({
        where: unreadLabeledTicketWhere(auth, channelId, labelId),
      });
      return [labelId, count] as const;
    }),
  );

  const counts: Record<string, number> = {};
  for (const [labelId, count] of entries) {
    if (count > 0) counts[labelId] = count;
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
  return db.ticket.count({
    where: unreadLabeledTicketWhere(auth, channelId, labelId, filters),
  });
}
