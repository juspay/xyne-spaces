import type { ChannelTicketAssignee } from '../types';

/**
 * `assignedTo` is stored as a bare id, `user:<id>` or `group:<id>` (the dashboard
 * writes prefixed values; older rows are bare). Bare ids are treated as users.
 */
export function parseAssigneeRef(assignedTo: string | null | undefined): ChannelTicketAssignee {
  const raw = (assignedTo ?? '').trim();
  if (!raw) return null;

  if (raw.startsWith('user:')) {
    const id = raw.slice('user:'.length).trim();
    return id ? { kind: 'user', id } : null;
  }
  if (raw.startsWith('group:') || raw.startsWith('userGroup:')) {
    const id = raw.slice(raw.indexOf(':') + 1).trim();
    return id ? { kind: 'group', id } : null;
  }
  return { kind: 'user', id: raw };
}
