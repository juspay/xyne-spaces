/**
 * Request-scoped tenant context ("the whiteboard").
 *
 * An AsyncLocalStorage scope carries the authenticated principal for the
 * lifetime of a request / job so the workspaceId stamper can read who is asking
 * without threading it through every call.
 *
 * Auth-agnostic: `tenantScopeMiddleware` mounts ONCE, globally, before routes.
 * It stores a reference to `req` and resolves workspaceId LAZILY from `req.user`
 * at DB-call time — after whichever per-route auth populated it. Adding a new
 * auth path later needs no wiring here.
 *
 * For non-HTTP entry points (workers, cron, sockets) with no `req`, wrap the
 * work in `runWithContext` / `runAsSystem`.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';

/**
 * Who is asking. Exactly one per context, ordered by privilege.
 *
 * `user`    — real principal: workspace scope + per-table user ACLs.
 * `service` — worker/webhook bound to one workspace: workspace scope only. Its userId is
 *             synthetic, so per-table user ACLs would match nothing and are skipped.
 * `system`  — no workspace bound: used for cross-workspace maintenance work.
 */
export type ActorKind = 'user' | 'service' | 'system';

export type TenantCtx = {
  userId: string;
  workspaceId: string;
  role?: string;
  orgRole?: string;
  memberId?: string;
  /** Required: every construction site must state the privilege level it is opening. */
  actor: ActorKind;
};

/**
 * Placeholders for a `runAsSystem` context. Not real ids — no row has them. They mark rows
 * written by a system flow so those are greppable in prod.
 *
 * Enforcement never sees these: `currentWorkspaceId()` returns null under `system`. Only
 * direct `getContextOrNull()` readers observe them, and must treat them as "no workspace".
 */
export const SYSTEM_USER_ID = 'system';
export const SYSTEM_WORKSPACE_ID = 'system';

type CtxSource = { kind: 'explicit'; ctx: TenantCtx } | { kind: 'request'; req: Request };

const storage = new AsyncLocalStorage<CtxSource>();

function resolve(source: CtxSource | undefined): TenantCtx | null {
  if (!source) return null;
  if (source.kind === 'explicit') return source.ctx;
  const user = source.req.user;
  if (!user?.id || !user?.workspaceId) return null;
  return {
    userId: user.id,
    workspaceId: user.workspaceId,
    role: user.role,
    orgRole: user.orgRole,
    memberId: user.memberId,
    actor: 'user',
  };
}

/** Read the current tenant context, or null when none is open / resolvable. */
export function getContextOrNull(): TenantCtx | null {
  return resolve(storage.getStore());
}

/**
 * The workspace to enforce, or null for "do not scope" (no context, or a `system` bypass).
 * The stamper and the ACL extension both derive their scope from here — keep it that way so
 * `system` has one definition.
 */
export function currentWorkspaceId(): string | null {
  const ctx = getContextOrNull();
  return ctx && ctx.actor !== 'system' ? ctx.workspaceId : null;
}

/** What a caller may set. `actor` is excluded so privilege is only chosen by the helpers below. */
export type PrincipalCtx = Omit<TenantCtx, 'actor'>;

/**
 * WIDEN the context already open — `runAsServiceActor` OPENS one, this does not. Swaps the
 * table's user predicate for plain workspace scope, so "my rows" becomes "this workspace's
 * rows". The tenant boundary is unchanged.
 *
 * Only for one operation that genuinely spans the workspace's users (a recipient fan-out).
 * Keep the scope that small: ids resolved inside it lose the ACL that would have rejected them.
 */
export function elevateToServiceActor<T>(fn: () => T): T {
  const ctx = getContextOrNull();
  if (!ctx) return fn();
  // Don't narrow a `system` bypass into a workspace filter.
  if (ctx.actor === 'system') return fn();
  return storage.run({ kind: 'explicit', ctx: { ...ctx, actor: 'service' } }, fn);
}

/** Open a tenant scope for a non-HTTP entry point (worker, cron, socket, webhook). */
export function runWithContext<T>(ctx: PrincipalCtx, fn: () => T): T {
  return storage.run({ kind: 'explicit', ctx: { ...ctx, actor: 'user' } }, fn);
}

/**
 * Open a scope for a background actor with no ambient context. Bound to one workspace; the
 * per-table user ACLs are skipped because `userId` is synthetic.
 *
 * Wrap the narrowest span you can — ids taken from a job payload and resolved inside are
 * resolved without the ACL that would have rejected them.
 */
export function runAsServiceActor<T>(userId: string, workspaceId: string, fn: () => T): T {
  return storage.run({ kind: 'explicit', ctx: { userId, workspaceId, actor: 'service' } }, fn);
}

/**
 * Cross-workspace scope. Takes no workspace on purpose: one would be ignored by
 * enforcement but still visible to `getContextOrNull()` readers.
 */
export function runAsSystem<T>(fn: () => T): T {
  return storage.run(
    { kind: 'explicit', ctx: { userId: SYSTEM_USER_ID, workspaceId: SYSTEM_WORKSPACE_ID, actor: 'system' } },
    fn,
  );
}

/** True when `workspaceId` is the system sentinel rather than a real tenant. */
export function isSystemWorkspaceId(workspaceId: string | null | undefined): boolean {
  return workspaceId === SYSTEM_WORKSPACE_ID;
}

/**
 * Express middleware: open a request-backed tenant scope. Mount ONCE, globally,
 * before any route. Auth-agnostic — resolves req.user lazily at DB-call time.
 */
export function tenantScopeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  storage.run({ kind: 'request', req }, () => next());
}
