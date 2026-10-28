/**
 * Path shapes the mobile app deep-links. Mirrors `APP_PATH_PREFIXES` in
 * `plugins/withDeepLinks.cjs` so the runtime normalizer and the native
 * intent-filter / associated-domain config stay in agreement.
 */
const PUBLIC_DEEP_LINK_PATH_PREFIXES = ['/call/', '/chat/dir/'] as const;

/** Leading segments a deep-link path may carry before the known prefix: the web app
 *  emits `/:workspaceId/:projectId/chat/dir/:channelId`, and older links carry only
 *  `/:workspaceId`. Keep in sync with `CHAT_DIR_PATH` in `messageDeepLinkCore.ts`. */
const MAX_LEADING_DEEP_LINK_SEGMENTS = 2;

/**
 * True when `pathname` is a Xyne Spaces deep-link path.
 *
 * Deep links may be workspace- and project-scoped (e.g.
 * `/:workspaceId/:projectId/chat/dir/:channelId`), so we also accept the known
 * prefixes behind up to two optional leading segments. Those segments are never
 * stripped — `canonicalizePublicDeepLink` preserves the full pathname and only
 * rewrites the origin.
 */
function isPublicDeepLinkPath(pathname: string): boolean {
  let candidate = pathname;
  for (let dropped = 0; dropped <= MAX_LEADING_DEEP_LINK_SEGMENTS; dropped += 1) {
    if (PUBLIC_DEEP_LINK_PATH_PREFIXES.some(prefix => candidate.startsWith(prefix))) {
      return true;
    }
    const next = candidate.replace(/^\/[^/]+/, '');
    if (next === candidate) return false;
    candidate = next;
  }
  return false;
}

/**
 * Normalize a Xyne Spaces link at the app boundary: rewrite one of `alternateOrigins`
 * (the dashboard / API host and any retired public origins — see
 * `ALTERNATE_PUBLIC_DEEP_LINK_ORIGINS` in `src/config.ts`; call sites must never
 * hardcode or scatter replacements) to the canonical public origin while preserving
 * the workspace segment, path, entity ids, query, and hash. OS Universal / App Link
 * verification and the in-app router are registered only for the canonical host (see
 * `plugins/withDeepLinks.cjs`), so such a link would otherwise open in the browser.
 * Non-Xyne hosts, non-deep-link paths (e.g. `/apps/downloads`), and the retired
 * `lotus:` scheme are returned untouched. New links must be emitted with
 * PUBLIC_DEEP_LINK_ORIGIN directly.
 */
export function canonicalizePublicDeepLink(
  value: string,
  publicDeepLinkOrigin: string,
  alternateOrigins: Iterable<string> = [],
): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return value;
  }

  const rewritableOrigins = new Set(
    Array.from(alternateOrigins, origin => origin.replace(/\/$/, '')),
  );
  if (!rewritableOrigins.has(parsed.origin) || !isPublicDeepLinkPath(parsed.pathname)) {
    return value;
  }

  return `${publicDeepLinkOrigin.replace(/\/$/, '')}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
