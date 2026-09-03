/**
 * Parse the INTERNAL_APP_HOST_MAP env var (stringified JSON) into a
 * { externalHost -> internalBaseUrl } map. Used by the app URL resolver to
 * rewrite INTERNAL app webhook URLs to in-cluster pod URLs at dispatch time.
 */
export function parseInternalAppHostMap(raw: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [host, base] of Object.entries(parsed)) {
      if (typeof host === 'string' && typeof base === 'string' && host && base) {
        out[host.toLowerCase()] = base.replace(/\/+$/, '');
      }
    }
    return out;
  } catch {
    return {};
  }
}
