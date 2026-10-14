export type MentionIndicator = '@' | '#';

/** Strip repeated leading `@` or `#` from a mention label (attrs / inner text / native `text`). */
export function stripLeadingMentionPrefix(
  label: string,
  indicator: MentionIndicator = '@',
): string {
  const trimmed = label.trim();
  if (!trimmed) return '';
  const prefixPattern = indicator === '@' ? /^@+/ : /^#+/;
  return trimmed.replace(prefixPattern, '').trim();
}

/** Visible mention label with exactly one indicator prefix (e.g. `@Aryan Pidiha`). */
export function formatMentionDisplay(name: string, indicator: MentionIndicator = '@'): string {
  const clean = stripLeadingMentionPrefix(name, indicator);
  if (!clean) return indicator;
  return `${indicator}${clean}`;
}

/** Canonical stored name for `data-username` / attrs — no indicator prefix. */
export function normalizeMentionName(name: string, indicator: MentionIndicator = '@'): string {
  return stripLeadingMentionPrefix(name, indicator);
}

/** Pick the best username from dashboard span attrs + inner HTML. */
export function resolveUserMentionName(attrUsername: string, innerText: string): string {
  const fromInner = stripLeadingMentionPrefix(innerText, '@');
  const fromAttr = stripLeadingMentionPrefix(attrUsername, '@');
  if (!fromInner) return fromAttr;
  if (!fromAttr) return fromInner;
  return fromInner.length >= fromAttr.length ? fromInner : fromAttr;
}

/** Pick the best channel name from dashboard span attrs + inner HTML. */
export function resolveChannelMentionName(attrChannelName: string, innerText: string): string {
  const fromInner = stripLeadingMentionPrefix(innerText, '#');
  const fromAttr = stripLeadingMentionPrefix(attrChannelName, '#');
  if (!fromInner) return fromAttr;
  if (!fromAttr) return fromInner;
  return fromInner.length >= fromAttr.length ? fromInner : fromAttr;
}

/** Pick the best group display name from dashboard span attrs + inner HTML. */
export function resolveGroupMentionName(
  groupAlias: string,
  groupName: string,
  innerText: string,
): string {
  const fromInner = stripLeadingMentionPrefix(innerText, '@');
  const fromAttr = stripLeadingMentionPrefix(groupAlias || groupName, '@');
  if (!fromInner) return fromAttr;
  if (!fromAttr) return fromInner;
  return fromInner.length >= fromAttr.length ? fromInner : fromAttr;
}

/** Resolve user mention name from native `<mention>` attrs (incl. iOS `username` / `text`). */
export function resolveUserMentionNameFromNativeAttrs(
  attrs: Record<string, string>,
  innerContent: string,
): string {
  const raw = attrs['data-username'] ?? attrs['username'] ?? attrs['text'] ?? innerContent.trim();
  return normalizeMentionName(raw, '@');
}

/**
 * Stored messages use `&nbsp;` between mention spans for bubble spacing.
 * Normalize to a single regular space when loading into the composer for edit.
 */
export function normalizeInterMentionWhitespaceForEdit(html: string): string {
  if (!html) return html;
  return html.replace(
    /(<\/(?:span|mention)>)(?:\s|&nbsp;|\u00a0)+(?=<(?:span|mention)\b)/gi,
    '$1 ',
  );
}
