/**
 * First token of a display name for compact filter chips.
 * Emails without spaces → local-part before @.
 */
export function getAssigneeFilterFirstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '';

  if (!trimmed.includes(' ') && trimmed.includes('@')) {
    return trimmed.split('@')[0] || trimmed;
  }

  return trimmed.split(/\s+/)[0] || trimmed;
}

/**
 * Gmail-style assignee chip label:
 * - none → "Assignee"
 * - one  → "Krishna"
 * - many → "Krishna + 2 more"
 */
export function formatAssigneeFilterLabel(displayNames: readonly string[]): string {
  if (displayNames.length === 0) return 'Assignee';

  const first = getAssigneeFilterFirstName(displayNames[0]!) || 'Assignee';
  if (displayNames.length === 1) return first;

  const more = displayNames.length - 1;
  return `${first} + ${more} more`;
}
