/**
 * Which claw-auth routes the SDK may reach through `/api/sdk/v2/claw/api/*`.
 *
 * Deny by default. A path is matched against the part after claw-auth's
 * `/claw/api/v1` prefix; denies are checked before allows, so a deny carves an
 * exception out of a broad allow.
 *
 * The proxy acts as the signed-in user's own session, so claw-auth's ACL still
 * decides every call. This list is about *surface*, not permission: it keeps out
 * routes that are not for people at all (pod callbacks, webhooks, OAuth
 * redirects, the CLI device flow), and the admin screens, which the SDK does
 * not expose by design.
 *
 * Patterns: `:name` matches one segment, a trailing `**` matches the rest of the
 * path (one segment or more).
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Rule {
  readonly methods: readonly Method[] | '*';
  readonly pattern: string;
}

const ANY = '*' as const;

function rule(pattern: string, methods: readonly Method[] | '*' = ANY): Rule {
  return { methods, pattern };
}

/** A mount and everything under it. */
function mount(prefix: string, methods: readonly Method[] | '*' = ANY): Rule[] {
  return [rule(prefix, methods), rule(`${prefix}/**`, methods)];
}

const ALLOW: readonly Rule[] = [
  // Agent authoring and use.
  ...mount('/agents'),
  ...mount('/subagents'),
  ...mount('/skills'),
  rule('/tools', ['GET']),
  rule('/tools/available', ['GET']),
  ...mount('/memory'),
  ...mount('/knowledge-base'),

  // Runs: history, and control of the caller's own runs. Starting a run goes
  // through the typed `/claw/runs` and `/claw/runs/stream` routes instead.
  ...mount('/runs'),
  rule('/run/:sessionId/cancel', ['POST']),
  rule('/run/:sessionId/interrupt-with-reply', ['POST']),
  rule('/run/stream/cancel', ['POST']),

  // Chat (includes chat projects, attachments and the /live rejoin stream).
  ...mount('/agent-chat'),
  ...mount('/scheduled-jobs'),
  ...mount('/conversation-artifacts'),
  ...mount('/chain-workflows'),

  // The caller's own account: identity, connections, connector sign-in.
  rule('/users/me', ['GET']),
  rule('/users', ['GET']),
  rule('/users/:userId', ['GET']),
  ...mount('/users/:userId/connections'),
  rule('/users/:userId/oauth/:provider/authorize', ['POST']),
  rule('/users/:userId/oauth/:provider/callback', ['POST']),
  rule('/users/:userId/oauth/rapidapi-linkedin/connect', ['POST']),
  ...mount('/servers'),
  ...mount('/settings'),

  // Everything else a user does in Claw.
  ...mount('/artifact-apps'),
  ...mount('/artifact-app-agents'),
  ...mount('/design-systems'),
  ...mount('/design-shares'),
  ...mount('/spaces'),
  ...mount('/organizations', ['GET']),
  ...mount('/daily-brief'),
  ...mount('/proactive-inbox'),
  rule('/agent-warm/:slug', ['POST']),
  ...mount('/sandbox', ['GET']),
  ...mount('/digital-twin'),
  ...mount('/local-harness'),
  ...mount('/gateway-registry'),
  rule('/dashboard', ['GET']),
  ...mount('/research-agent', ['GET']),
];

const DENY: readonly Rule[] = [
  // Service-to-service routes that sit inside otherwise user-facing mounts.
  rule('/runs/by-agent/**'),
  rule('/scheduled-jobs/:id/result'),
  rule('/chain-workflows/:id/trigger'),
  rule('/memory/recall-hits'),

  // Admin-only, kept out of the SDK by design (claw-auth would refuse a
  // non-admin anyway).
  rule('/agents/:slug/promote'),
  rule('/agents/:slug/demote'),
  rule('/agents/requests/**'),
  rule('/skills/:slug/promote'),
  rule('/skills/:slug/demote'),
  rule('/memory/reviews'),
  rule('/memory/reviews/**'),
  rule('/memory/review/**'),
  rule('/memory/batches/:id/approve'),
  rule('/memory/batches/:id/reject'),
  rule('/memory/banks/:agent/retention-sweep'),
  rule('/servers/publish-requests'),
  rule('/servers/publish-requests/**'),
  rule('/servers/edit-requests', ['GET']),
  rule('/servers/edit-requests/:id/approve'),
  rule('/servers/edit-requests/:id/reject'),
  rule('/chain-workflows/global-requests', ['GET']),
  rule('/chain-workflows/global-requests/:id/approve'),
  rule('/chain-workflows/global-requests/:id/reject'),
  rule('/sandbox/repos/:key'),
  rule('/gateway-registry/requests'),
  rule('/gateway-registry/requests/**'),
  rule('/gateway-registry/:serviceName', ['DELETE']),

  // A connector's raw OAuth token is for the agent pod, never for a caller.
  rule('/users/:userId/oauth/:provider/token'),
];

function matches(pattern: string, segments: readonly string[]): boolean {
  const parts = pattern.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '**') return segments.length > i;
    const segment = segments[i];
    if (segment === undefined) return false;
    if (part.startsWith(':')) continue;
    if (part !== segment) return false;
  }
  return segments.length === parts.length;
}

function hit(rules: readonly Rule[], method: Method, segments: readonly string[]): boolean {
  return rules.some(
    (r) => (r.methods === ANY || r.methods.includes(method)) && matches(r.pattern, segments),
  );
}

/**
 * Split a request path into decoded segments, or `undefined` when it cannot be
 * forwarded safely: dot segments, empty segments, or an encoded `/` or `\` that
 * would change which route claw-auth resolves.
 */
export function clawPathSegments(path: string): string[] | undefined {
  if (!path.startsWith('/')) return undefined;
  const raw = path.slice(1).split('/');
  if (raw.length === 1 && raw[0] === '') return undefined;
  const segments: string[] = [];
  for (const segment of raw) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (!decoded || decoded === '.' || decoded === '..' || /[/\\]/.test(decoded)) return undefined;
    segments.push(decoded);
  }
  return segments;
}

/** Whether `method path` (relative to claw-auth's `/claw/api/v1`) may be proxied. */
export function isClawRouteAllowed(method: string, path: string): boolean {
  const upper = method.toUpperCase() as Method;
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) return false;
  const segments = clawPathSegments(path);
  if (!segments) return false;
  if (hit(DENY, upper, segments)) return false;
  return hit(ALLOW, upper, segments);
}
