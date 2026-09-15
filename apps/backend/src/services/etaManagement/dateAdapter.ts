/**
 * Boundary conversion between Zero's epoch-ms timestamps and the domain
 * service's `Date`-based pure functions. Zero mutators (mutators.ts) work
 * entirely in epoch ms; Prisma call sites work entirely in `Date`. The
 * domain service itself stays `Date`-based (matching Prisma, its first
 * integration) - Zero call sites convert at the boundary instead of
 * threading a second unit system through the pure functions.
 */
export function msToDate(ms: number | null | undefined): Date | null {
  return ms === null || ms === undefined ? null : new Date(ms);
}

export function dateToMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}
