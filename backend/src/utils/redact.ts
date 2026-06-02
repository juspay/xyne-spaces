// The automation webhook ingest URL carries the secret as a path segment
// (/api/automation-webhooks/<seriesId>/<secret>). Strip the secret before any
// URL reaches the logs.
const WEBHOOK_SECRET_URL = /(\/api\/automation-webhooks\/[^/?#]+\/)([^/?#]+)/g;

export function redactSensitiveUrl(url: string | undefined | null): string {
  if (!url) return url ?? '';
  return url.replace(WEBHOOK_SECRET_URL, (_match, prefix: string) => `${prefix}[REDACTED]`);
}
