/**
 * Per-owner Redis key scoping for the Digital Twin.
 *
 * A twin thread shares one conversationId across every mentioned user, but each
 * owner has a PRIVATE claw session (see buildSandboxStoreKey). So the busy slot,
 * busy meta, mid-run queue, seen set and the session-by-conv index must all be
 * per-owner: otherwise user B's tag serializes behind user A's run, and two
 * twins in one thread clobber each other's conv-index row so the /result
 * fallback resolves the wrong user.
 *
 * Only `digital-twin` opts in; every other agent, or an omitted scope, keeps the
 * legacy 2-part key. Every twin-reachable caller MUST pass twinUserScopeId:
 * omitting it mis-keys to the 2-part key, which is what caused the 2026-08-19
 * slot leak (a release that missed the real 3-part busy marker).
 *
 * Dependency-free on purpose: message-queue.ts and session-context.ts both use
 * it, and session-context -> run-recovery-worker -> message-queue must not
 * gain an import cycle.
 */
export const twinScopedKey = (base: string, agentSlug: string, twinUserScopeId?: string): string =>
  agentSlug === "digital-twin" && twinUserScopeId ? `${base}:${twinUserScopeId}` : base;
