import { TicketPriority } from '@xyne/shared';

/** Preserve `user:` prefix when the ticket already stores assignedTo that way. */
export function toAssignedToValue(
  userId: string,
  currentAssignedTo: string | null | undefined,
): string {
  if ((currentAssignedTo ?? '').startsWith('user:')) return `user:${userId}`;
  return userId;
}

export function parseTicketPriority(value: string | null | undefined): TicketPriority | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === TicketPriority.LOW) return TicketPriority.LOW;
  if (upper === TicketPriority.MEDIUM) return TicketPriority.MEDIUM;
  if (upper === TicketPriority.HIGH) return TicketPriority.HIGH;
  if (upper === TicketPriority.CRITICAL) return TicketPriority.CRITICAL;
  const lower = raw.toLowerCase();
  if (lower.includes('critical')) return TicketPriority.CRITICAL;
  if (lower.includes('high')) return TicketPriority.HIGH;
  if (lower.includes('medium')) return TicketPriority.MEDIUM;
  if (lower.includes('low')) return TicketPriority.LOW;
  return null;
}

/** Strip `group:` / `userGroup:` prefixes used in assignee refs and ticket fields. */
export function normalizeGroupId(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('group:') || value.startsWith('userGroup:')) {
    return value.slice(value.indexOf(':') + 1).trim();
  }
  return value;
}

/**
 * Authoritative ticket.userGroupId once the ticket row is hydrated.
 * Do not fall through to assignee-as-group — that mislabels the User Group field.
 * Always returns a bare group id (`group:` / `userGroup:` stripped) so name
 * lookup, picker selectedValue, and equality checks match `group.id`.
 */
export function resolveTicketUserGroupId(
  ticketLoaded: boolean,
  ticketUserGroupId: string | null | undefined,
  fallbackUserGroupId: string | null | undefined,
): string | null {
  const raw = ticketLoaded ? (ticketUserGroupId ?? null) : (fallbackUserGroupId ?? null);
  const normalized = normalizeGroupId(raw);
  return normalized || null;
}

/** Assignee picker scopes candidates to ticket group, else assignee-as-group. */
export function resolveAssigneePickerGroupId(
  ticketUserGroupId: string | null,
  assigneeGroupId: string | null,
): string | null {
  const resolved = ticketUserGroupId ?? assigneeGroupId;
  const normalized = normalizeGroupId(resolved);
  return normalized || null;
}

export function formatUserGroupDisplayName(
  groupName: string | null | undefined,
  ticketUserGroupId: string | null,
): string {
  const trimmed = (groupName ?? '').trim();
  if (trimmed) return trimmed;
  if (ticketUserGroupId) return 'Unknown';
  return 'Assign Group';
}
