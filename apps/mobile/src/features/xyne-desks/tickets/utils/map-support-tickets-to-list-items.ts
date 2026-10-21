import type { TicketListItemData } from '../types';
import type { TicketWithDynamicFieldValuesLike } from './dynamic-field-filters';
import { mapTicketListItem } from './map-ticket-list-item';
import { parseTicketSender } from './parse-ticket-sender';

export type SupportTicketRowLike = TicketWithDynamicFieldValuesLike & {
  id: string;
  xyneId?: string | null;
  title?: string | null;
  description?: string | null;
  stageName?: string | null;
  emailCount?: number | null;
  lastEmailAt?: number | null;
  createdAt?: number | null;
  isArchived?: boolean | null;
  metadata?: unknown;
  emailReads?: ReadonlyArray<{ lastReadEmailAt?: number | null }> | null;
  userMailbox?: ReadonlyArray<{ state?: string | null; starred?: boolean | null }> | null;
};

function isTicketUnread(row: SupportTicketRowLike): boolean {
  const lastEmailAt = row.lastEmailAt ?? 0;
  if (!lastEmailAt) return false;
  const read = row.emailReads?.[0];
  const lastRead = read?.lastReadEmailAt ?? 0;
  return lastEmailAt > lastRead;
}

function senderFromMetadata(metadata: unknown): string {
  const from =
    metadata && typeof metadata === 'object' && 'fromEmailAddress' in metadata
      ? (metadata as { fromEmailAddress?: string | null }).fromEmailAddress
      : null;
  return parseTicketSender(from).senderName;
}

function filterSupportTicketsByTimestampField(
  rows: readonly SupportTicketRowLike[],
  field: 'createdAt' | 'lastEmailAt',
  start?: number,
  end?: number,
): SupportTicketRowLike[] {
  // x != null              // skips both null and undefined
  // x !== undefined        // skips only undefined; null still passes
  if (start == null && end == null) return [...rows];

  return rows.filter(row => {
    const value = row[field] ?? 0;
    if (start != null && value < start) return false;
    if (end != null && value > end) return false;
    return true;
  });
}

/**
 * Client-side createdAt range filter (dashboard Created At semantics).
 * Used because supportTicketsPageV3 has no date args — no shared/query changes.
 */
export function filterSupportTicketsByCreatedAt(
  rows: readonly SupportTicketRowLike[],
  createdDateStart?: number,
  createdDateEnd?: number,
): SupportTicketRowLike[] {
  return filterSupportTicketsByTimestampField(rows, 'createdAt', createdDateStart, createdDateEnd);
}

/**
 * Client-side lastEmailAt range filter (dashboard Last updated semantics).
 * Used because supportTicketsPageV3 has no date args — no shared/query changes.
 */
export function filterSupportTicketsByLastEmailAt(
  rows: readonly SupportTicketRowLike[],
  lastEmailAtStart?: number,
  lastEmailAtEnd?: number,
): SupportTicketRowLike[] {
  return filterSupportTicketsByTimestampField(
    rows,
    'lastEmailAt',
    lastEmailAtStart,
    lastEmailAtEnd,
  );
}

export type MapSupportTicketsToListItemsOptions = {
  /** When true, include archived tickets (All Mail). Inbox hides them. */
  includeArchived?: boolean;
};

/** Pure map from supportTicketsPageV3 rows → UI model. */
export function mapSupportTicketsToListItems(
  rows: readonly SupportTicketRowLike[] | null | undefined,
  options?: MapSupportTicketsToListItemsOptions,
): TicketListItemData[] {
  const includeArchived = options?.includeArchived === true;
  const seen = new Set<string>();
  const items: TicketListItemData[] = [];

  for (const row of rows ?? []) {
    if (!row.id || seen.has(row.id)) continue;
    // Hide archived tickets so Zero sync (app ↔ dashboard) drops them from the inbox.
    if (!includeArchived && row.isArchived) continue;
    seen.add(row.id);
    const desc = (row.description ?? '').trim();
    items.push(
      mapTicketListItem({
        id: row.id,
        xyneId: row.xyneId ?? null,
        title: row.title ?? null,
        stageName: row.stageName ?? null,
        emailCount: row.emailCount ?? null,
        lastEmailAt: row.lastEmailAt ?? null,
        isUnread: isTicketUnread(row),
        isStarred: row.userMailbox?.[0]?.starred === true,
        senderName: senderFromMetadata(row.metadata),
        snippet: desc ? desc.replace(/\s+/g, ' ').slice(0, 120) : null,
      }),
    );
  }

  items.sort((a, b) => {
    if (b.lastEmailAt !== a.lastEmailAt) return b.lastEmailAt - a.lastEmailAt;
    return b.id.localeCompare(a.id);
  });

  return items;
}
