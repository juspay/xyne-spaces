/**
 * Expand bare user ids to both bare and `user:` forms so assignedTo matches
 * dashboard-prefixed rows and older bare-id rows.
 */
export function expandAssignedToQueryValues(userIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of userIds) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const bare = trimmed.startsWith('user:') ? trimmed.slice('user:'.length).trim() : trimmed;
    if (!bare) continue;
    out.add(bare);
    out.add(`user:${bare}`);
  }
  return [...out].sort();
}
