import { Prisma } from '@prisma/client';
import { db } from '@/database/client';

interface LabelUnreadRow {
  labelId: string;
  unreadCount: number;
}

interface LabelUnreadCountRow {
  unreadCount: number;
}

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

const sqlInList = (values: readonly string[]): Prisma.Sql =>
  Prisma.join(values.map(v => Prisma.sql`${v}`));

/**
 * Translates the desk filter payload into SQL fragments matching the clause set
 * of supportTicketsPageV4 (src/zero/queries.ts) field-for-field.
 */
function buildDeskFilterSql(filters: LabelUnreadFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];

  // Desk V4 (L2053-2055) filters assignees with a plain `IN` — the
  // 'unassigned'/'!invert' sentinels handled by parseAssigneeFilter are
  // kanban-only (queries.ts L331), so they are intentionally NOT special-cased
  // here. Like the desk query, an empty array means "no constraint".
  if (filters.assignedTo?.length) {
    clauses.push(Prisma.sql`AND t."assignedTo" IN (${sqlInList(filters.assignedTo)})`);
  }

  if (filters.createdBy?.length) {
    clauses.push(Prisma.sql`AND t."createdBy" IN (${sqlInList(filters.createdBy)})`);
  }

  if (filters.priority?.length) {
    clauses.push(Prisma.sql`AND t."priority" IN (${sqlInList(filters.priority)})`);
  }

  if (filters.stageName?.length) {
    clauses.push(Prisma.sql`AND t."stageName" IN (${sqlInList(filters.stageName)})`);
  }

  if (filters.aiCategory?.length) {
    clauses.push(Prisma.sql`AND t."aiCategory" IN (${sqlInList(filters.aiCategory)})`);
  }

  if (filters.conversationIds !== undefined) {
    // Present-but-empty whitelist means "match NOTHING" (the client sends []
    // while a tag-filter whitelist is still loading and expects 0 rows, not
    // all rows). An empty IN () is invalid SQL, so force zero rows explicitly.
    clauses.push(
      filters.conversationIds.length === 0
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND t."conversationId" IN (${sqlInList(filters.conversationIds)})`,
    );
  }

  if (filters.hasAiDraft === true) {
    // Mirrors supportTicketsPageV4: exists('emailDrafts', d => d.userId IS
    // null) — shared/system drafts only, joined on the ticket's conversation.
    clauses.push(Prisma.sql`AND EXISTS (
      SELECT 1 FROM "email_drafts" ed
      WHERE ed."conversationId" = t."conversationId"
        AND ed."userId" IS NULL
    )`);
  }

  if (filters.hasSubTickets === true) {
    // Mirrors supportTicketsPageV4: exists('subTicketMappings') — rows where
    // this ticket is the PARENT (ticket_sub_ticket_mappings.ticketId).
    clauses.push(Prisma.sql`AND EXISTS (
      SELECT 1 FROM "ticket_sub_ticket_mappings" stm
      WHERE stm."ticketId" = t."id"
    )`);
  }

  if (filters.userGroups?.length) {
    clauses.push(Prisma.sql`AND t."userGroupId" IN (${sqlInList(filters.userGroups)})`);
  }

  if (filters.lastEmailAtStart !== undefined) {
    clauses.push(Prisma.sql`AND t."lastEmailAt" >= ${new Date(filters.lastEmailAtStart)}`);
  }

  if (filters.lastEmailAtEnd !== undefined) {
    clauses.push(Prisma.sql`AND t."lastEmailAt" <= ${new Date(filters.lastEmailAtEnd)}`);
  }

  if (filters.createdAtStart !== undefined) {
    clauses.push(Prisma.sql`AND t."createdAt" >= ${new Date(filters.createdAtStart)}`);
  }

  if (filters.createdAtEnd !== undefined) {
    clauses.push(Prisma.sql`AND t."createdAt" <= ${new Date(filters.createdAtEnd)}`);
  }

  // Mirrors applySupportDynamicFieldFilters (src/zero/queries.ts L193-215):
  // every entry is its own EXISTS (AND across entries); an entry's values are
  // OR'd; an entry with no values matches on field presence alone.
  // Value comparison follows Zero's toActualFieldValueQueryValue: scalars are
  // compared against the JSONB-encoded form (JSON.stringify semantics:
  // "x" / 5 / true). Binding JSON.stringify(v) with a ::jsonb cast reproduces
  // that byte-for-byte.
  for (const fieldFilter of filters.dynamicFieldFilters ?? []) {
    const valueClause = fieldFilter.values?.length
      ? Prisma.sql`AND (${Prisma.join(
          fieldFilter.values.map(v => Prisma.sql`fev."actualFieldValue" = ${JSON.stringify(v)}::jsonb`),
          ' OR ',
        )})`
      : Prisma.empty;
    clauses.push(Prisma.sql`AND EXISTS (
      SELECT 1 FROM "form_entity_values" fev
      WHERE fev."entityId" = t."id"
        AND fev."entityType" = 'TICKET'
        AND fev."fieldId" = ${fieldFilter.fieldId}
        ${valueClause}
    )`);
  }

  return clauses.length > 0 ? Prisma.join(clauses, '\n') : Prisma.empty;
}

/**
 * Unread predicate (mirrors TicketListRow.tsx): a ticket is unread for a user iff
 * emailCount > 0 AND (no email_reads row exists for (ticketId, userId)
 * OR email_reads.lastReadEmailAt < ticket.lastEmailAt).
 * Labels with zero unread are omitted from the map.
 *
 * `t."isArchived" = false` was ADDED to align with the desk list base
 * constraint (supportTicketsPageV3/V4 both start from `isArchived = false`):
 * badge counts must equal what the desk list would show. This changes mode A
 * behavior — archived tickets are no longer counted.
 */
export async function getLabelUnreadCounts(
  auth: { userId: string; workspaceId: string },
  channelId: string,
): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<LabelUnreadRow[]>(Prisma.sql`
    SELECT m."labelId" AS "labelId", COUNT(*)::int AS "unreadCount"
    FROM "conversation_label_mappings" m
    JOIN "tickets" t ON t."conversationId" = m."conversationId"
    LEFT JOIN "email_reads" er
      ON er."ticketId" = t."id" AND er."userId" = ${auth.userId}
    WHERE m."channelId" = ${channelId}
      AND m."workspaceId" = ${auth.workspaceId}
      AND t."isArchived" = false
      AND t."emailCount" > 0
      AND (er."lastReadEmailAt" IS NULL OR er."lastReadEmailAt" < t."lastEmailAt")
    GROUP BY m."labelId"
  `);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.labelId] = row.unreadCount;
  }
  return counts;
}

/**
 * Mode B: unread count for ONE label restricted by a desk filter payload.
 * Same base query as mode A (including the isArchived alignment and the
 * verbatim unread predicate), pinned to a single labelId.
 */
export async function getLabelUnreadCount(
  auth: { userId: string; workspaceId: string },
  channelId: string,
  labelId: string,
  filters?: LabelUnreadFilters,
): Promise<number> {
  const filtersSql = filters ? buildDeskFilterSql(filters) : Prisma.empty;
  const rows = await db.$queryRaw<LabelUnreadCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::int AS "unreadCount"
    FROM "conversation_label_mappings" m
    JOIN "tickets" t ON t."conversationId" = m."conversationId"
    LEFT JOIN "email_reads" er
      ON er."ticketId" = t."id" AND er."userId" = ${auth.userId}
    WHERE m."channelId" = ${channelId}
      AND m."workspaceId" = ${auth.workspaceId}
      AND m."labelId" = ${labelId}
      AND t."isArchived" = false
      AND t."emailCount" > 0
      AND (er."lastReadEmailAt" IS NULL OR er."lastReadEmailAt" < t."lastEmailAt")
      ${filtersSql}
  `);

  return rows[0]?.unreadCount ?? 0;
}
