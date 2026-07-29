/**
 * Per-request audit actor context.
 *
 * Agent config writes are audited at the agentRepository choke point (see
 * agent-config-audit.ts) so we catch EVERY writer — including non-HTTP ones
 * (seed, bootstrap, workers). The repo layer has no `req`, so the HTTP layer
 * stashes the verified actor (x-user-id) in this AsyncLocalStorage and the
 * audit helper reads it back. Callers with no context (a deploy-time script, a
 * background worker) resolve to `undefined` → audit actorUserId=null, which is
 * itself the "this was not a logged-in human" signal we want to be able to see.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface AuditContext {
  actorUserId?: string;
}

const storage = new AsyncLocalStorage<AuditContext>();

/** Run `fn` with the given audit actor bound for the duration of the async call tree. */
export function runWithAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Current audit actor, or undefined when running outside any request context. */
export function getAuditActor(): string | undefined {
  return storage.getStore()?.actorUserId;
}
