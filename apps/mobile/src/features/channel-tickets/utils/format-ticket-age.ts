const DAY_MS = 86_400_000;

/**
 * Whole days since `createdAt`, dashboard Age column semantics ("12d").
 * Never negative; invalid input renders the em dash.
 */
export function formatTicketAge(createdAt: number | null | undefined, now: number): string {
  if (!createdAt || !Number.isFinite(createdAt)) return '—';
  const days = Math.max(0, Math.floor((now - createdAt) / DAY_MS));
  return `${days}d`;
}
