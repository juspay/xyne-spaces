/**
 * Insertion stamper — a Prisma client extension that fills `workspaceId` from the
 * request context on every create-family op (create, createMany,
 * createManyAndReturn, and any future `create*` variant — matched by prefix, not
 * a hand-kept allowlist).
 *
 * Best-effort and non-breaking (this PR only): it stamps ONLY when
 *   - the model actually has a scalar `workspaceId` column (DMMF-derived), and
 *   - a tenant context is open with a workspaceId, and
 *   - the caller hasn't already set `workspaceId` or a `workspace` relation
 *     (so we never produce the scalar-plus-relation conflict Prisma rejects).
 * No context / no column / caller-provided value → left untouched, never throws.
 * There is no read filtering and no NOT NULL here — those are later ("tighten").
 *
 * Scope (intentional): covers all top-level `create*` ops. `upsert` (its create
 * branch), nested relation creates, and raw-SQL inserts are NOT stamped yet —
 * deferred to a follow-up PR (nested/upsert) or a DB-level default (raw SQL).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { getContextOrNull } from './context';

/** Models with a scalar `workspaceId` column — the ones we can stamp. */
const STAMPABLE = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'workspaceId' && f.kind === 'scalar'))
    .map((m) => m.name),
);

/** The workspaceId to stamp for the current context, or null (no ctx / system). */
function ctxWorkspaceId(): string | null {
  const ctx = getContextOrNull();
  return ctx && !ctx.system ? ctx.workspaceId : null;
}

/** A single new-row payload. Values are unknown — we only ever add `workspaceId`. */
type CreateRow = Record<string, unknown>;
/** The slice of a create-op's args we touch: one row (create) or many (create*Many). */
type CreateArgs = { data?: CreateRow | CreateRow[] };

/**
 * Return a COPY of `row` with workspaceId added — never mutate the caller's object.
 * Mutating in place would leak across tenants: if a caller reuses a data object
 * between requests, request A's stamp would stick and request B would then be
 * skipped (workspaceId already present) and write A's workspaceId.
 * Skip (return as-is) when the caller already set workspaceId (any non-undefined
 * value, so an explicit `null` for a cross-workspace row is respected) or a
 * `workspace` relation (avoids Prisma's scalar-plus-relation conflict).
 */
function withWorkspaceId(row: CreateRow, workspaceId: string): CreateRow {
  if (!row || typeof row !== 'object') return row;
  if (row.workspaceId !== undefined || 'workspace' in row) return row;
  return { ...row, workspaceId };
}

/** New `data` for a create-op with workspaceId stamped onto each row (copies only). */
function stampData(data: CreateArgs['data'], workspaceId: string): CreateArgs['data'] {
  if (Array.isArray(data)) return data.map((row) => withWorkspaceId(row, workspaceId));
  if (data) return withWorkspaceId(data, workspaceId);
  return data;
}

/** Wrap a Prisma client so create-family ops stamp workspaceId from context. */
export function withWorkspaceStamp<T extends PrismaClient>(prisma: T): T {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Structural classification, not an operation allowlist: every insert in
          // Prisma is a `create*` op (create, createMany, createManyAndReturn, and
          // any future variant), all carrying new-row data in `args.data` (object
          // for create, array for the *Many forms). Matching the prefix covers new
          // create ops automatically — nothing to remember to add. `upsert` carries
          // its insert in `args.create`, so it is intentionally out of this rule
          // (deferred; see header). Update/delete ops never match.
          if (operation.startsWith('create') && STAMPABLE.has(model)) {
            const ws = ctxWorkspaceId();
            if (ws) {
              // Pass FRESH args to query — never mutate the caller's args or data
              // objects (see withWorkspaceId: prevents cross-request leakage).
              const data = stampData((args as CreateArgs).data, ws);
              return query({ ...(args as Record<string, unknown>), data } as typeof args);
            }
          }
          return query(args);
        },
      },
    },
  }) as unknown as T;
}
