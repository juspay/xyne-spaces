/**
 * Strip a leftover leading "@<agent mention>" so a slash command lands at byte
 * zero. Matches only the given names verbatim (display name first, slug as
 * fallback) — never a generic @-token+words pattern, which cannot distinguish
 * a multi-word display name from the user's own prose.
 */
export function stripLeadingAgentMention(text: string, names: Array<string | null | undefined>): string {
  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^@${escaped}(?=\\s|$)`, "i");
    if (re.test(text)) return text.replace(re, "").trimStart();
  }
  return text;
}
