/**
 * Strips escape artifacts that can leak into a URL emitted by an agent flow
 * (a trailing backslash, its percent-encoded form `%5C`, and surrounding whitespace).
 * Without this, a URL ending in a stray backslash is opened as
 * `https://github.com/org/repo/pull/329%5C`, which GitHub 404s.
 */
export const sanitizeFlowUrl = (value: string): string => {
  let url = value.trim();
  let previous = '';
  while (url !== previous) {
    previous = url;
    url = url.replace(/(?:\\|%5c|\s)+$/i, '');
  }
  return url;
};
