import { Prisma, TicketPriority, TicketStatusV2 } from '@prisma/client';

// Identity prefixes ticket columns are stored with. Longest first so a value is
// stripped to its bare id regardless of which form the caller supplied.
const IDENTITY_PREFIXES = ['userGroup:', 'user:', 'group:'] as const;

const stripIdentityPrefix = (id: string): string => {
  for (const prefix of IDENTITY_PREFIXES) {
    if (id.startsWith(prefix)) return id.slice(prefix.length);
  }
  return id;
};

/**
 * Expand a caller-supplied identity id into every stored representation the
 * ticket columns use, so a filter by a raw id matches rows persisted in the
 * prefixed form — and a filter by a prefixed id matches raw rows too. The input
 * is first normalized to its bare id, then re-expanded to all forms. This mirrors
 * `prefixedIdentityValues` in services/tickets/kanbanQueryBuilder.ts — the
 * established read convention for assignedTo / createdBy (user:<id>) and
 * userGroupId (group:<id> / userGroup:<id>). Replicated locally (rather than
 * imported) to keep this module dependency-free and unit-testable in isolation.
 */
const expandIdentityValues = (id: string): string[] => {
  const base = stripIdentityPrefix(id);
  return [base, `user:${base}`, `group:${base}`, `userGroup:${base}`];
};

/**
 * Expand a list of identity ids to all stored representations, de-duplicated and
 * order-stable. Empty in → empty out.
 */
const expandIdentityList = (ids: string[]): string[] => [
  ...new Set(ids.flatMap(expandIdentityValues)),
];

/**
 * Normalized (post-validation) filter set accepted by the `filters` block of
 * POST /api/apps/ticket/list/search. All list-valued filters are already coerced
 * to arrays by the schema so this builder stays a pure, side-effect-free function
 * that is easy to unit test.
 *
 * - Core ticket columns: statusV2, priority, stageName, ticketType, assignedTo,
 *   createdBy, userGroupId, isArchived, createdAfter/createdBefore. Identity
 *   columns (assignedTo/createdBy/userGroupId) are matched against both the raw
 *   id and the stored prefixed forms (user:/group:/userGroup:).
 * - Related-table data: tags (ticket_tags via the `tags` relation — the same
 *   read convention used by the main Kanban query builder).
 *
 * Custom form fields live in form_entity_values and are matched separately by the
 * controller (see findTicketIdsByCustomFields) because they cannot be expressed as
 * a single Ticket WHERE clause.
 */
export interface TicketFilters {
  statusV2?: TicketStatusV2[];
  priority?: TicketPriority[];
  stageName?: string[];
  ticketType?: string[];
  assignedTo?: string[];
  createdBy?: string[];
  userGroupId?: string[];
  tags?: string[];
  isArchived?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

/**
 * Translate the optional `filters` block into a partial Prisma Ticket WHERE.
 *
 * Returns ONLY the predicates it owns; the caller merges the result into its base
 * where (channel scope, board scope, sender scope, keyset cursor). It deliberately
 * does not touch channelId/boardId and only sets `isArchived` when the caller
 * explicitly provided it, so the caller keeps ownership of the default and of the
 * ACL/scoping predicates. Empty filter arrays are ignored (no predicate emitted).
 */
export const buildTicketFilterWhere = (
  filters: TicketFilters = {},
): Prisma.TicketWhereInput => {
  const where: Prisma.TicketWhereInput = {};

  if (filters.statusV2 && filters.statusV2.length > 0) {
    where.statusV2 = { in: filters.statusV2 };
  }
  if (filters.priority && filters.priority.length > 0) {
    where.priority = { in: filters.priority };
  }
  if (filters.stageName && filters.stageName.length > 0) {
    where.stageName = { in: filters.stageName };
  }
  if (filters.ticketType && filters.ticketType.length > 0) {
    where.ticketType = { in: filters.ticketType };
  }
  // Identity columns store either the raw id or a prefixed form (user:<id>,
  // group:<id>, userGroup:<id>). Expand so a filter by a plain id still matches
  // tickets persisted in the prefixed representation — same convention as the
  // Kanban query builder.
  if (filters.assignedTo && filters.assignedTo.length > 0) {
    where.assignedTo = { in: expandIdentityList(filters.assignedTo) };
  }
  if (filters.createdBy && filters.createdBy.length > 0) {
    where.createdBy = { in: expandIdentityList(filters.createdBy) };
  }
  if (filters.userGroupId && filters.userGroupId.length > 0) {
    where.userGroupId = { in: expandIdentityList(filters.userGroupId) };
  }

  // Related-table filter: ticket has ANY of the requested tags (ticket_tags),
  // matching the main Kanban query builder's read convention.
  if (filters.tags && filters.tags.length > 0) {
    where.tags = { some: { name: { in: filters.tags } } };
  }

  if (filters.isArchived !== undefined) {
    where.isArchived = filters.isArchived;
  }

  if (filters.createdAfter || filters.createdBefore) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.createdAfter) createdAt.gte = filters.createdAfter;
    if (filters.createdBefore) createdAt.lte = filters.createdBefore;
    where.createdAt = createdAt;
  }

  return where;
};
