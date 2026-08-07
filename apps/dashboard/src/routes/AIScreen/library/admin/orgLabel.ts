export function orgLabel(
  orgId: string | null | undefined,
  orgName: string | null | undefined,
  orgNamesById: Record<string, string>,
): string | null {
  if (!orgId) return orgName && orgName.trim() ? orgName : null;
  const resolved = orgNamesById[orgId] ?? orgName;
  if (resolved && resolved !== orgId) return resolved;
  return `Org ${orgId.slice(0, 8)}…`;
}
