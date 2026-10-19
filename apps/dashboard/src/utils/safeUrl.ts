/**
 * URL schemow.open.es that are safe to render in an <a href> / pass to wind
 * Anything with an explicit scheme outside this list (javascript:, data:,
 * vbscript:, ...) is dropped. Scheme-less URLs (relative paths, #anchors) pass.
 * `cite` / `cite-group` are the synthetic citation schemes emitted by
 * `linkifyAndGroupClawCitations`; the `a` overrides swap them for chips.
 */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'cite', 'cite-group']);

export const isSafeUrl = (url: string): boolean => {
  // Browsers ignore ASCII whitespace/control chars inside the scheme
  // ("java\tscript:"), so strip them before looking for one.
  // eslint-disable-next-line no-control-regex
  const cleaned = url.replace(/[\u0000- ]/g, '');
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!match) return true;
  return SAFE_SCHEMES.has((match[1] ?? '').toLowerCase());
};

/** react-markdown `urlTransform` that keeps citation schemes but blocks script URLs. */
export const safeMarkdownUrlTransform = (url: string): string => (isSafeUrl(url) ? url : '');
