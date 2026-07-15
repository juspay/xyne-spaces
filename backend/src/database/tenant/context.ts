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

export type TenantCtx = { userId: string; workspaceId: string; system?: boolean };

type CtxSource = { kind: 'explicit'; ctx: TenantCtx } | { kind: 'request'; req: Request };

const storage = new AsyncLocalStorage<CtxSource>();

function resolve(source: CtxSource | undefined): TenantCtx | null {
  if (!source) return null;
  if (source.kind === 'explicit') return source.ctx;
  const user = source.req.user;
  if (!user?.id || !user?.workspaceId) return null;
  return { userId: user.id, workspaceId: user.workspaceId };
}

/** Read the current tenant context, or null when none is open / resolvable. */
export function getContextOrNull(): TenantCtx | null {
  return resolve(storage.getStore());
}

/** Run `fn` with an explicit tenant context. */
export function runWithContext<T>(ctx: TenantCtx, fn: () => T): T {
  return storage.run({ kind: 'explicit', ctx }, fn);
}

/** System/background scope — no workspaceId stamped (cross-workspace jobs). */
export function runAsSystem<T>(workspaceId: string | undefined, fn: () => T): T {
  return storage.run(
    { kind: 'explicit', ctx: { userId: 'system', workspaceId: workspaceId ?? 'system', system: true } },
    fn,
  );
}

/**
 * Express middleware: open a request-backed tenant scope. Mount ONCE, globally,
 * before any route. Auth-agnostic — resolves req.user lazily at DB-call time.
 */
export function tenantScopeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  storage.run({ kind: 'request', req }, () => next());
}
