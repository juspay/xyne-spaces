// Incoming webhook URLs carry the secret as their last path segment. Strip it
// before any URL reaches the logs:
//   /api/automation-webhooks/<seriesId>/<secret>
//   /api/apps/webhooks/[<type>/]<workspaceId>/<appId>/<secret>
const WEBHOOK_SECRET_URLS = [
  /(\/api\/automation-webhooks\/[^/?#]+\/)([^/?#]+)/g,
  /(\/api\/apps\/webhooks\/(?:[^/?#]+\/)?[^/?#]+\/[^/?#]+\/)([^/?#]+)/g,
];

// Query params whose values are credentials (OAuth code/state, CSAT token, ...).
const SECRET_QUERY_PARAMS =
  /([?&](?:code|state|token|access_token|refresh_token|id_token|api_key|apikey|key|secret|client_secret|password|signature|sig|user_code)=)[^&#]*/gi;

export function redactSensitiveUrl(url: string | undefined | null): string {
  if (!url) return url ?? '';
  return WEBHOOK_SECRET_URLS.reduce(
    (acc, pattern) => acc.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`),
    url,
  ).replace(SECRET_QUERY_PARAMS, '$1[REDACTED]');
}
