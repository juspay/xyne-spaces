/** Internal slug for the default Xyne AI chat agent (formerly ask-ai). */
export const XYNE_AI_DEFAULT_AGENT_SLUG = 'digital-twin';

/** Legacy slug retained for dual-read of older default conversations. */
export const XYNE_AI_LEGACY_AGENT_SLUG = 'ask-ai';

const HIDDEN_PICKER_SLUGS = new Set([XYNE_AI_DEFAULT_AGENT_SLUG, XYNE_AI_LEGACY_AGENT_SLUG]);

/** Map sidebar selection to the stream / API agent slug. */
export function resolveStreamAgentSlug(selectedAgentSlug: string | null | undefined): string {
  return selectedAgentSlug ?? XYNE_AI_DEFAULT_AGENT_SLUG;
}

/** Normalize persisted picker values: default Xyne AI is `null` in UI state. */
export function normalizeSelectedAgentSlug(slug: string | null | undefined): string | null {
  if (!slug || slug === XYNE_AI_LEGACY_AGENT_SLUG || slug === XYNE_AI_DEFAULT_AGENT_SLUG) {
    return null;
  }
  return slug;
}

export function isHiddenPickerAgentSlug(slug: string): boolean {
  return HIDDEN_PICKER_SLUGS.has(slug);
}
