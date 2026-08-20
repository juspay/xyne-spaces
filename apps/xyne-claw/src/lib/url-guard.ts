/**
 * Helpers for turning a caller-supplied URL into one we are willing to fetch.
 *
 * The SSRF fences in this service (callback/progress URLs from the /run body,
 * signed download URLs for attachment ingest) all validate the *origin* of a
 * caller-supplied URL against an allowlist. Validation alone is not enough,
 * though: the value that reaches `fetch` must be assembled from parts we
 * control, not the caller's string, so a check-vs-use mismatch can't creep in
 * and so static analysis (CodeQL js/request-forgery) can see that the host and
 * scheme never derive from request data.
 *
 * `rebuildUrlOnTrustedOrigin` does exactly that: the origin comes from the
 * allowlist entry that matched (never from the parsed URL), every path segment
 * is re-encoded with `encodeURIComponent`, and the query is carried over
 * verbatim after a literal `?` — query data can't influence the host.
 */

/**
 * RFC 3986 "unreserved-only" percent-encoding of a single path segment.
 * `encodeURIComponent` leaves `!'()*` bare; GCS/S3 signed-URL canonical paths
 * encode them, so match that form to keep signatures valid after the rebuild.
 */
function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Rebuild `parsed` on top of `trustedOrigin` (a `scheme://host[:port]` string
 * taken from configuration, NOT from the caller).
 *
 * Path segments are decoded then re-encoded so an already-encoded signed URL
 * round-trips byte-for-byte (`%2F` stays `%2F`, `a%20b` stays `a%20b`); a
 * segment with a malformed percent-escape is rejected by returning undefined.
 */
export function rebuildUrlOnTrustedOrigin(parsed: URL, trustedOrigin: string): string | undefined {
  const segments: string[] = [];
  for (const raw of parsed.pathname.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    segments.push(encodePathSegment(decoded));
  }
  const path = segments.join("/");
  const origin = trustedOrigin.replace(/\/+$/, "");
  if (parsed.search.length > 1) {
    return `${origin}${path}?${parsed.search.slice(1)}`;
  }
  return `${origin}${path}`;
}
