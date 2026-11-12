/**
 * Which Spaces user routes a Claw agent may call on behalf of a user, and the
 * scope each needs. Default deny: a route not listed here rejects agent tokens,
 * even if the user could call it (account, admin, auth, billing, ...).
 *
 * On these routes the request runs as the user (req.user = the human), so the
 * user's own permissions and per-table ACLs apply; the scope is an additional,
 * narrower limit from the user's delegation and the admin-approved agent grants.
 *
 * Patterns: METHOD + path with `:param` segments, or a trailing `/*` for
 * "this prefix and anything below". The most specific (longest) match wins.
 */

/**
 * Scope value for a route that checks scopes itself, per request (e.g. the agent
 * query route checks the queried model). The route is open to agents, and the
 * route handler must enforce scopes from req.auth.permissions.
 */
export const ROUTE_ENFORCED = '@route-enforced';

export interface RouteScopeRule {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*';
  path: string;
  scope: string;
}

/**
 * Seeded from the user routes Claw's tools call today (2026-11-11 audit), only
 * routes that exist in this backend. Deliberately NOT listed:
 *  - POST /api/query (generic "query any model"): needs a per-model, scope-gated
 *    replacement before agents may use it.
 *  - /api/internal/*: service routes, not user routes.
 *  - account, admin, auth (except /api/auth/me), billing, settings: never for agents.
 */
export const CLAW_ROUTE_SCOPES: RouteScopeRule[] = [
  // Messages / channels
  { method: 'POST', path: '/api/conversations/:id/messages', scope: 'chat:write' },
  { method: 'POST', path: '/api/channels/:channelId/conversations', scope: 'chat:write' },
  // Users
  { method: 'GET', path: '/api/auth/me', scope: 'users:read' },
  { method: 'GET', path: '/api/users/:id/picture', scope: 'users:read' },
  // Tickets / desk / email
  { method: 'GET', path: '/api/tickets/board-fields', scope: 'tickets:read' },
  { method: 'POST', path: '/api/tickets', scope: 'tickets:write' },
  { method: 'POST', path: '/api/tickets/:id/attachments/from-conversation', scope: 'tickets:write' },
  { method: 'PATCH', path: '/api/tickets/:ticketId', scope: 'tickets:write' },
  { method: 'GET', path: '/api/desk-metrics/desks', scope: 'desk:read' },
  { method: 'POST', path: '/api/email/:conversationId/reply', scope: 'email:write' },
  // Files
  { method: 'GET', path: '/api/attachments/:id/download', scope: 'files:read' },
  // Knowledge base
  { method: 'GET', path: '/api/collections/accessible', scope: 'kb:read' },
  { method: 'GET', path: '/api/collections/items/:itemId/download', scope: 'kb:read' },
  { method: 'POST', path: '/api/collections/:collectionId/upload', scope: 'kb:write' },
  // Canvas
  { method: 'POST', path: '/api/canvas/create', scope: 'canvas:write' },
  // Search
  { method: 'GET', path: '/api/vespaSearch', scope: 'search:read' },
  // Read queries: the route checks a scope per queried model (claw/agentQuery.ts)
  { method: 'POST', path: '/api/agent-query', scope: ROUTE_ENFORCED },
  // Calls
  { method: 'GET', path: '/api/calls/:callId/download-transcript', scope: 'calls:read' },
  { method: 'POST', path: '/api/calls/schedule', scope: 'calls:write' },
  { method: 'POST', path: '/api/calls/initiate', scope: 'calls:write' },
  // Automations
  { method: 'GET', path: '/api/automations/schema/*', scope: 'automations:read' },
  { method: 'GET', path: '/api/automations/runs/:id', scope: 'automations:read' },
  { method: 'GET', path: '/api/automations/:id', scope: 'automations:read' },
  { method: 'GET', path: '/api/automations/:id/runs', scope: 'automations:read' },
  { method: 'GET', path: '/api/automations/:id/versions', scope: 'automations:read' },
  { method: 'GET', path: '/api/automations/:id/webhook', scope: 'automations:read' },
  { method: 'POST', path: '/api/automations/validate', scope: 'automations:read' },
  { method: 'POST', path: '/api/automations', scope: 'automations:write' },
  { method: 'PUT', path: '/api/automations/:id', scope: 'automations:write' },
  { method: 'POST', path: '/api/automations/:id/submit', scope: 'automations:write' },
  { method: 'POST', path: '/api/automations/:id/webhook', scope: 'automations:write' },
  { method: 'DELETE', path: '/api/automations/:id', scope: 'automations:write' },
  // SDLC
  { method: 'POST', path: '/api/sdlc/claw/links', scope: 'sdlc:write' },
  { method: 'POST', path: '/api/sdlc/claw/artifacts', scope: 'sdlc:write' },
  { method: 'GET', path: '/api/sdlc/repositories/context', scope: 'sdlc:read' },
  { method: 'GET', path: '/api/sdlc/repositories/:repoId/context', scope: 'sdlc:read' },
  { method: 'GET', path: '/api/sdlc/channels/:channelId/context', scope: 'sdlc:read' },
];

interface Compiled extends RouteScopeRule {
  re: RegExp;
  weight: number;
}

function compile(rule: RouteScopeRule): Compiled {
  const wildcard = rule.path.endsWith('/*');
  const base = wildcard ? rule.path.slice(0, -2) : rule.path;
  const body = base
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  const re = new RegExp(`^${body}${wildcard ? '(?:/.*)?' : ''}/?$`);
  // Literal segments outweigh params; exact rules outweigh wildcards.
  const weight = base.split('/').reduce((w, seg) => w + (seg.startsWith(':') ? 1 : 3), 0) + (wildcard ? 0 : 1);
  return { ...rule, re, weight };
}

let compiled: Compiled[] | null = null;
let compiledFrom: RouteScopeRule[] | null = null;

/** The scope a Claw agent needs for METHOD path, or undefined when the route is not open to agents. */
export function requiredScopeFor(method: string, path: string, rules: RouteScopeRule[] = CLAW_ROUTE_SCOPES): string | undefined {
  if (compiledFrom !== rules || compiled?.length !== rules.length) {
    compiled = rules.map(compile);
    compiledFrom = rules;
  }
  const m = method.toUpperCase();
  const clean = (path.split('?')[0] ?? '').replace(/\/{2,}/g, '/');
  let best: Compiled | undefined;
  for (const r of compiled!) {
    if (r.method !== '*' && r.method !== m) continue;
    if (!r.re.test(clean)) continue;
    if (!best || r.weight > best.weight) best = r;
  }
  return best?.scope;
}
