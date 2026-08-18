/**
 * Naming-convention check for SDLC-owned mutator/query wire names, used by
 * zeroController.ts to decide whether a push/query should be proxied to the
 * SDLC backend. A pattern rather than an explicit allowlist, so a new
 * sdlc.* mutator or sdlc-named query is picked up without touching this file
 * or redeploying CORE.
 */
const SDLC_NAME_PATTERN = /sdlc/i;

function isSdlcOwnedName(name: unknown): boolean {
  return typeof name === 'string' && SDLC_NAME_PATTERN.test(name);
}

// conversations.send's name doesn't match SDLC_NAME_PATTERN, but its args
// carry an optional `sdlcDiscussion` payload that touches SDLC-owned tables
// — route to SDLC only when that payload is present.
const SDLC_CONDITIONAL_MUTATOR_NAMES = new Set<string>(['conversations.send']);

function hasSdlcDiscussionArg(mutation: unknown): boolean {
  if (!mutation || typeof mutation !== 'object') return false;
  const args = (mutation as { args?: unknown }).args;
  return !!args && typeof args === 'object' && (args as Record<string, unknown>).sdlcDiscussion != null;
}

// Push wire shape: { clientGroupID, mutations: [{ type: "custom"|"crud", name, args, ... }], ... }
export function isSdlcScopedPush(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const mutations = (body as { mutations?: unknown }).mutations;
  if (!Array.isArray(mutations)) return false;
  return mutations.some(m => {
    if (!m || typeof m !== 'object') return false;
    const name = (m as { name?: unknown }).name;
    if (isSdlcOwnedName(name)) return true;
    if (SDLC_CONDITIONAL_MUTATOR_NAMES.has(name as string) && hasSdlcDiscussionArg(m)) return true;
    return false;
  });
}

// Query wire shape: ["transform", [{ id, name, args }, ...]]
export function isSdlcScopedQuery(body: unknown): boolean {
  if (!Array.isArray(body) || body.length < 2) return false;
  const requests = body[1];
  if (!Array.isArray(requests)) return false;
  return requests.some(r => r && typeof r === 'object' && isSdlcOwnedName((r as { name?: unknown }).name));
}
