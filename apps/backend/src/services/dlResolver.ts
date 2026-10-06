/**
 * DL routing primitives shared by the push (resolveDlChannel) and refetch
 * paths across both providers. Anchor: dlEmail, or any configured alias,
 * appearing in From, To, or Cc (case-insensitive). Microsoft classic
 * Distribution Groups don't emit List-ID, so we don't rely on it —
 * header-based matching is universal.
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

/** Desk row fields that together define which addresses route into it. */
export interface DlTarget {
  dlEmail?: string | null;
  dlAliases?: string | null;
}

/**
 * Entries that are not plain addresses are dropped rather than trusted: the
 * Gmail refetch path interpolates these into a search query, where a space or
 * a paren would rewrite its boolean structure.
 */
const PLAIN_ADDRESS = /^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]+$/;

/**
 * Parse the JSON-serialised alias list. Anything unparseable is treated as
 * "no aliases" — a malformed column must not take a desk offline.
 */
export function parseDlAliases(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is string => typeof a === 'string')
      .map(a => a.trim().toLowerCase())
      .filter(a => PLAIN_ADDRESS.test(a));
  } catch {
    return [];
  }
}

/** Every lowercase address that routes into a desk: primary DL plus aliases. */
export function dlAddressesFor(target: DlTarget): string[] {
  const primary = target.dlEmail?.trim().toLowerCase();
  return Array.from(new Set([...(primary ? [primary] : []), ...parseDlAliases(target.dlAliases)]));
}

/**
 * Single source of truth for "does this message belong to the given DL?"
 * Used by both push (resolveDlChannel) and refetch paths, both providers.
 * Accepts a single address or the desk's full address set (primary + aliases).
 */
export function emailMatchesDl(input: DlMatchInput, dlEmail: string | string[]): boolean {
  const targets = new Set(
    (Array.isArray(dlEmail) ? dlEmail : [dlEmail]).map(a => a.trim().toLowerCase()).filter(Boolean),
  );
  if (targets.size === 0) return false;
  if (input.from && targets.has(input.from.toLowerCase())) return true;
  for (const list of [input.to ?? [], input.cc ?? []]) {
    for (const addr of list) {
      if (addr && targets.has(addr.toLowerCase())) return true;
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
