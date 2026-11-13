/**
 * URL construction shared by the request path and the event stream.
 */

/**
 * Join `baseUrl` and `path`, appending any defined query values.
 *
 * Tolerates a trailing slash on the base and a missing leading slash on the path,
 * because hosts configure `baseUrl` by hand and both slips are common.
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${normalizedPath}`;

  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    if (qs) {
      url = `${url}?${qs}`;
    }
  }

  return url;
}
