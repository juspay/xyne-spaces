/**
 * Exact-prefix prompt tiers for xyne-claw runs.
 * Static tiers first (cache-friendly); Vespa / tool output last.
 */

export interface PromptPrefixTiers {
  /** Tier 1 — platform directives */
  platform: string;
  /** Tier 2 — tool schemas summary (already sorted by slug upstream) */
  tools: string;
  /** Tier 3 — compiled guidance chain */
  guidance: string;
  /** Tier 4 — dynamic user / vespa / tools (assembled by the runner) */
}

export function assembleStaticPrefix(tiers: Omit<PromptPrefixTiers, never>): string {
  const parts = [tiers.platform.trim(), tiers.tools.trim(), tiers.guidance.trim()].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Document that tool schemas must be sorted by slug before injection so MCP
 * list_changed notifications do not reshuffle the KV cache prefix.
 */
export function sortToolSlugsForPrefix(slugs: string[]): string[] {
  return [...slugs].sort((a, b) => a.localeCompare(b));
}
