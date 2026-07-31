/**
 * Read-side tenant filter — read counterpart to the insertion stamper (stamp.ts).
 * Scopes Prisma reads to the current context's workspace so a query can't return another
 * tenant's rows. Structural (DMMF-derived), best-effort, non-breaking: only models with a
 * scalar workspaceId column, only when a non-system tenant context is open, never for
 * opted-out (cross-workspace/global or non-workspace-scoped) models.
 *
 * where-flexible reads get an ANDed workspaceId filter. findUnique* are post-filtered by the
 * returned row's workspaceId (findUnique -> null, findUniqueOrThrow -> throw), since Prisma
 * forbids non-unique fields in a unique where. include/relations and $queryRaw are NOT covered
 * — this is defense-in-depth, not a hermetic guarantee.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { getContextOrNull } from './context';

/** Model names (lowercased) with a scalar workspaceId column. */
const WORKSPACE_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'workspaceId' && f.kind === 'scalar'))
    .map((m) => m.name.toLowerCase()),
);
/**
 * Models whose reads must NOT be workspace-scoped:
 *  - apps: GLOBAL marketplace, cross-org by design.
 *  - team-intelligence v2 tables: external org/team analytics; workspaceId is nullable and rows
 *    legitimately have none, so an equality filter would wrongly hide them.
 */
const OPT_OUT = new Set([
  'apps',
  'teamintelligenceuseringestionv2',
  'teamintelligenceteamsummaryv2',
  'teamintelligenceorgsummaryv2',
]);

/** True when a model carries a scalar workspaceId and isn't opted out. Case-insensitive
 *  (accepts both the DMMF model name and the camelCase client accessor). */
export function isWorkspaceScopedModel(name: string): boolean {
  const n = name.toLowerCase();
  return WORKSPACE_MODELS.has(n) && !OPT_OUT.has(n);
}

/** The workspaceId to scope by for the current context, or null (no ctx / system). */
function ctxWorkspaceId(): string | null {
  const ctx = getContextOrNull();
  return ctx && !ctx.system ? ctx.workspaceId : null;
}

const WHERE_OPS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow']);

/** Wrap a Prisma client so read ops filter by the context workspace. */
export function withWorkspaceReadFilter<T extends PrismaClient>(prisma: T): T {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ws = ctxWorkspaceId();
          if (!ws || !isWorkspaceScopedModel(model)) return query(args);

          // where-flexible reads: AND the workspace filter onto the caller's where.
          if (WHERE_OPS.has(operation)) {
            const a = (args ?? {}) as Record<string, unknown> & { where?: object };
            const where = a.where ? { AND: [a.where, { workspaceId: ws }] } : { workspaceId: ws };
            return query({ ...a, where } as typeof args);
          }

          // findUnique*: Prisma rejects non-unique fields in the where, so post-filter the row.
          // The post-filter needs row.workspaceId, but the caller's select/omit controls which
          // columns come back. Force workspaceId into the projection (on a COPY — never mutate the
          // caller's args), then strip it from the result if the caller didn't ask for it. Without
          // this, `findUnique({ where, select: { title: true } })` returns a row with no
          // workspaceId, so `undefined !== ws` drops the valid same-workspace row.
          if (UNIQUE_OPS.has(operation)) {
            const a = (args ?? {}) as Record<string, unknown> & {
              select?: Record<string, unknown>;
              omit?: Record<string, unknown>;
            };
            const wanted = a.select
              ? a.select.workspaceId === true
              : a.omit
                ? a.omit.workspaceId !== true
                : true;
            let patched: Record<string, unknown> = a;
            if (a.select) {
              patched = { ...a, select: { ...a.select, workspaceId: true } };
            } else if (a.omit) {
              const omit = { ...a.omit };
              delete omit.workspaceId;
              patched = { ...a, omit };
            }
            const row = (await query(patched as typeof args)) as { workspaceId?: string } | null;
            if (row && row.workspaceId !== ws) {
              if (operation === 'findUniqueOrThrow') {
                throw new Error(`No ${model} found for the current workspace`);
              }
              return null;
            }
            if (row && !wanted) delete (row as { workspaceId?: string }).workspaceId;
            return row;
          }

          return query(args);
        },
      },
    },
  }) as unknown as T;
}
