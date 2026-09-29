import type { FTicket } from './portfolio';

/** Tickets that look abandoned: open more than `age` days with no update in more than `idle` days. */
export const CLEANUP = { age: 90, idle: 30 };

/**
 * Worth offering to close in bulk. Left out: a ticket with an ETA still ahead, or with an open
 * ticket anywhere below it (someone is still working under it).
 */
export function isAbandoned(t: FTicket, byId: Map<string, FTicket>, cfg = CLEANUP): boolean {
  if (!t.open || t.d <= cfg.age || t.u <= cfg.idle) return false;
  if (t.eta !== null && t.eta > 0) return false;
  const openBelow = (x: FTicket, seen: Set<string>): boolean =>
    x.kids.some(id => {
      const k = byId.get(id);
      if (!k || seen.has(id)) return false;
      seen.add(id);
      return k.open || openBelow(k, seen);
    });
  return !openBelow(t, new Set([t.id]));
}
