/**
 * Explicit allowlist of SDLC-owned mutator/query wire names, used by
 * zeroController.ts to decide whether a push/query request should be
 * proxied to the SDLC backend. Deliberately not a string-prefix check:
 * mutators are namespaced dotted names ("sdlc.createLink", see the `sdlc`
 * block in mutators.ts), while queries are flat sdlc-prefixed camelCase
 * names (see queries.ts) — an allowlist keeps both conventions unambiguous
 * and stays trivial to keep in sync since both registries are small.
 */
export const SDLC_MUTATOR_NAMES = new Set<string>(['sdlc.createLink', 'sdlc.deleteLink']);

export const SDLC_QUERY_NAMES = new Set<string>([
  'sdlcTicketsByIds',
  'sdlcDiscussionConversations',
  'sdlcDiscussionConversation',
  'sdlcUserActivities',
  'sdlcRelatedConversations',
]);

// Push wire shape: { clientGroupID, mutations: [{ type: "custom"|"crud", name, ... }], ... }
export function isSdlcScopedPush(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const mutations = (body as { mutations?: unknown }).mutations;
  if (!Array.isArray(mutations)) return false;
  return mutations.some(
    m =>
      m &&
      typeof m === 'object' &&
      SDLC_MUTATOR_NAMES.has((m as { name?: unknown }).name as string)
  );
}

// Query wire shape: ["transform", [{ id, name, args }, ...]]
export function isSdlcScopedQuery(body: unknown): boolean {
  if (!Array.isArray(body) || body.length < 2) return false;
  const requests = body[1];
  if (!Array.isArray(requests)) return false;
  return requests.some(
    r =>
      r && typeof r === 'object' && SDLC_QUERY_NAMES.has((r as { name?: unknown }).name as string)
  );
}
