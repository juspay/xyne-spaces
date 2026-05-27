/**
 * DL routing primitives shared by the push (resolveDlChannel) and refetch
 * paths across both providers. Anchor: dlEmail appearing in From, To, or Cc
 * (case-insensitive). Microsoft classic Distribution Groups don't emit
 * List-ID, so we don't rely on it — header-based matching is universal.
 */

/**
 * Normalized message fields used for DL routing. Populated by both Google
 * and Microsoft transformers — same shape regardless of provider.
 */
export interface DlMatchInput {
  from?: string | null;
  to?: string[] | null;
  cc?: string[] | null;
}

/**
 * Single source of truth for "does this message belong to the given DL?"
 * Used by both push (resolveDlChannel) and refetch paths, both providers.
 */
export function emailMatchesDl(input: DlMatchInput, dlEmail: string): boolean {
  const target = dlEmail.toLowerCase();
  if (input.from && input.from.toLowerCase() === target) return true;
  for (const list of [input.to ?? [], input.cc ?? []]) {
    for (const addr of list) {
      if (addr && addr.toLowerCase() === target) return true;
    }
  }
  return false;
}

/**
 * Collect lowercase, deduped from/to/cc addresses for a DB `IN` lookup
 * against EmailChannelPreference.dlEmail. Used by the push path when we
 * don't know the target DL up-front (have to discover it from the message).
 */
export function collectDlCandidates(input: DlMatchInput): string[] {
  const all = [
    ...(input.from ? [input.from] : []),
    ...(input.to ?? []),
    ...(input.cc ?? []),
  ];
  return Array.from(new Set(all.map(a => a.trim().toLowerCase()).filter(Boolean)));
}
