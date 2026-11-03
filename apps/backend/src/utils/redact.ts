// Incoming webhook URLs carry the secret as their last path segment. Strip it
// before any URL reaches the logs:
//   /api/automation-webhooks/<seriesId>/<secret>
//   /api/apps/webhooks/[<type>/]<workspaceId>/<appId>/<secret>
const WEBHOOK_SECRET_URLS = [
  /(\/api\/automation-webhooks\/[^/?#]+\/)([^/?#]+)/g,
  /(\/api\/apps\/webhooks\/(?:[^/?#]+\/)?[^/?#]+\/[^/?#]+\/)([^/?#]+)/g,
];

export function redactSensitiveUrl(url: string | undefined | null): string {
  if (!url) return url ?? '';
  return WEBHOOK_SECRET_URLS.reduce(
    (acc, pattern) => acc.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`),
    url,
  );
}
