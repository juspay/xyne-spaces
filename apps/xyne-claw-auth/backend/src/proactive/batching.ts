export function groupByUser<T extends { userId: string }>(candidates: T[]): T[][] {
  const byUser = new Map<string, T[]>();
  for (const c of candidates) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  return [...byUser.values()];
}
