/** Count `<mention>` tags in composer HTML (used to detect corrupted native echoes). */
export function countComposerMentions(html: string): number {
  return (html.match(/<mention\b/gi) ?? []).length;
}

/** Count broadcast mention metadata on native `<mention>` tags (@channel / @here). */
export function countSpecialMentionTypeAttrs(html: string): number {
  return (html.match(/\bdata-mention-type=["'](?:channel|here)["']/gi) ?? []).length;
}
