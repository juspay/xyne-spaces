/**
 * The tenant filter. This IS the `db` every caller uses (see client.ts).
 *
 * Reads: the table's getWhereClause() is ANDed onto the query.
 * Writes: canCreate() gates inserts, getMutateWhere() gates updates/deletes.
 * Either falling back to plain `{ workspaceId }` when the table has no opinion.
 *
 * Scoping is applied per query, from the tenant context open at call time.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { getContextOrNull, currentWorkspaceId, isRequestContext } from './context';
import { ACLFactory } from '@/database/acl';
import { logger } from '@/utils/logger';

const txStorage = new AsyncLocalStorage<boolean>();

/** Model names (lowercased) with a scalar workspaceId column. */
const WORKSPACE_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'workspaceId' && f.kind === 'scalar'))
    .map((m) => m.name.toLowerCase()),
);

/**
 * True when a model carries a scalar workspaceId. There is no opt-out list — a table that
 * must not be scoped says so by extending `UnscopedACL`, so policy lives with the table.
 */
export function isWorkspaceScopedModel(name: string): boolean {
  return WORKSPACE_MODELS.has(name.toLowerCase());
}

/** An explicit "no restriction" from a table's ACL (see UnscopedACL). */
function isUnrestricted(where: Record<string, unknown>): boolean {
  return Object.keys(where).length === 0;
}

/**
 * True when the filter is exactly the plain workspace scalar. Drives the transaction-safe
 * findUnique post-filter: a relational filter has to be redirected to findFirst on the base
 * client, so we only do that when we must.
 */
function isWorkspaceOnly(where: Record<string, unknown>, ws: string): boolean {
  const keys = Object.keys(where);
  return keys.length === 1 && keys[0] === 'workspaceId' && where.workspaceId === ws;
}

/**
 * Diagnostic counter for queries the extension could not scope, deduped by
 * `model:operation:reason` and capped at 500 entries.
 */
const unscopedSeen = new Set<string>();

/** No stack capture on purpose: `model` + `operation` + the pod label is enough to grep. */
function warnUnscoped(model: string | undefined, operation: string, reason: string): void {
  const key = `${model ?? '?'}:${operation}:${reason}`;
  if (unscopedSeen.has(key) || unscopedSeen.size >= 500) return;
  unscopedSeen.add(key);
  logger.warn('[acl] query ran with no tenant scope', { model, operation, reason });
}

/** Counts query shapes worth reviewing, deduped by tag:model:operation and capped like the above. */
const patternSeen = new Set<string>();

function notePattern(tag: string, model: string | undefined, operation: string, detail: Record<string, unknown> = {}): void {
  const key = `${tag}:${model ?? '?'}:${operation}`;
  if (patternSeen.has(key) || patternSeen.size >= 500) return;
  patternSeen.add(key);
  logger.warn(tag, { model, operation, ...detail });
}

/**
 * Build the error thrown when a row is out of the caller's scope, logging it first.
 * Every denial in this file goes through here or `denyCreate` so refusals are never silent.
 */
function deny(model: string, operation: string, reason: string): Error {
  logger.warn('[acl] blocked', { model, operation, reason });
  return new Error(`No ${model} found for the current workspace`);
}

function denyCreate(model: string, operation: string): Error {
  logger.warn('[acl] blocked create', { model, operation, reason: 'canCreate returned false' });
  return new Error(`Not authorized to create ${model}`);
}

/**
 * Report an insert that names a workspace other than the one being enforced.
 *
 * Diagnostic only. Workspace provisioning legitimately writes rows carrying a newly
 * created workspace's id while a different workspace is the enforced one, so this is
 * reported rather than rejected.
 *
 * Not deduped — a repeat is itself the signal.
 */
function assertSameWorkspace(model: string, operation: string, row: unknown, ws: string): void {
  if (!row || typeof row !== 'object') return;
  const given = (row as { workspaceId?: unknown }).workspaceId;
  // undefined -> stamp fills it. null -> a deliberate row on a nullable column.
  if (typeof given !== 'string' || given === ws) return;
  logger.warn('[acl] create names a different workspace', { model, operation, given, enforced: ws });
  throw deny(model, operation, 'create names a different workspace');
}

/**
 * workspaceId is the tenant key: once a row exists it must not move between workspaces.
 * Applies to every write that carries a data payload, including the update half of upsert.
 */
function assertWorkspaceNotReassigned(
  model: string,
  operation: string,
  data: unknown,
  ws: string,
): void {
  const rows: unknown[] = Array.isArray(data) ? data : data != null ? [data] : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const given = (row as { workspaceId?: unknown }).workspaceId;
    if (given === undefined || given === null) continue;
    const value = typeof given === 'object' && given !== null && 'set' in given
      ? (given as { set?: unknown }).set
      : given;
    if (typeof value !== 'string' || value === ws) continue;
    logger.warn('[acl] update reassigns workspaceId', { model, operation, given: value, enforced: ws });
    throw deny(model, operation, 'workspaceId is immutable');
  }
}

const WHERE_OPS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow']);
const BULK_MUTATE_OPS = new Set(['updateMany', 'updateManyAndReturn', 'deleteMany']);
const UNIQUE_MUTATE_OPS = new Set(['update', 'delete']);

/**
 * Per-model set of compound unique/PK accessor names (e.g. 'channelId_userId'). Their value is
 * an object of scalar fields — valid in a WhereUniqueInput but NOT in the WhereInput that
 * count()/findFirst() accept (they throw "Unknown argument 'channelId_userId'").
 */
const COMPOUND_UNIQUE_ACCESSORS = new Map<string, Set<string>>(
  Prisma.dmmf.datamodel.models.map((m) => {
    const names = new Set<string>();
    for (const u of m.uniqueIndexes ?? []) if (u.fields.length > 1) names.add(u.name ?? u.fields.join('_'));
    if (m.primaryKey && m.primaryKey.fields.length > 1) names.add(m.primaryKey.name ?? m.primaryKey.fields.join('_'));
    return [m.name.toLowerCase(), names] as const;
  }),
);

/** Rewrite a WhereUniqueInput into a count()/findFirst()-safe WhereInput by expanding any
 *  compound-unique accessor ({ channelId_userId: {...} }) into its scalar fields. */
function toWhereInput(model: string, where: unknown): Record<string, unknown> {
  const w = (where ?? {}) as Record<string, unknown>;
  const accessors = COMPOUND_UNIQUE_ACCESSORS.get(model.toLowerCase());
  if (!accessors || accessors.size === 0) return w;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) {
    if (accessors.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function toCamel(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** Minimal shape of a Prisma model delegate on the base client, for the write pre-checks. */
type ModelDelegate = {
  count: (args: { where?: unknown }) => Promise<number>;
  findFirst: (args: unknown) => Promise<unknown>;
};

export function withAclExtension<T extends PrismaClient>(prisma: T): T {
  // `base` = the un-filtered client, reused for ACL construction and the pre-check/redirect
  // reads so neither recurses back through this extension.
  const base = prisma as unknown as PrismaClient;
  const queryExtended = prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (txStorage.getStore() === true) {
            // Interactive transactions run on the base client; record what goes through.
            notePattern('[acl] ran inside a transaction', model, operation);
            return query(args);
          }
          const ctx = getContextOrNull();
          const ws = currentWorkspaceId();
          // Raw queries carry no model and are handled by their call sites.
          if (!ws || !model) {
            // `system` is intentional; anything else reaching here has no scope to apply.
            if (ctx?.actor !== 'system')
              warnUnscoped(model, operation, ctx ? 'no-workspace' : 'no-context');
            // Fail closed: a workspace-scoped model requires a resolved workspace.
            if (ctx && ctx.actor !== 'system' && model && isWorkspaceScopedModel(model)) {
              throw deny(model, operation, 'no workspace resolved for a workspace-scoped model');
            }
            return query(args);
          }

          // Prisma types `operation` as a partial union (omits create/upsert literals), so
          // compare against a plain string to classify every op the hook actually receives.
          const op: string = operation;
          const isRead = WHERE_OPS.has(op) || UNIQUE_OPS.has(op);
          const isCreate = op.startsWith('create');
          const isBulkMutate = BULK_MUTATE_OPS.has(op);
          const isUniqueMutate = UNIQUE_MUTATE_OPS.has(op);
          const isUpsert = op === 'upsert';
          if (!isRead && !isCreate && !isBulkMutate && !isUniqueMutate && !isUpsert) {
            return query(args);
          }

          const camel = toCamel(model);
          // The table's per-user ACL applies only to a principal asking on their own behalf.
          // Every other caller acts for the workspace and gets workspace scope alone.
          const acl = !isRequestContext()
            ? null
            : ACLFactory.getACL(
                camel as Uncapitalize<Prisma.ModelName>,
                {
                  userId: ctx!.userId,
                  workspaceId: ws,
                  role: ctx!.role,
                  orgRole: ctx!.orgRole,
                  memberId: ctx!.memberId,
                },
                base,
              );

          if (isRead) {
            let aclWhere = acl ? ((await acl.getWhereClause()) as Record<string, unknown> | null) : null;
            if (!aclWhere) {
              // Reached when the table's ACL expressed no opinion, or the caller is a
              // service actor: fall back to plain workspace scope.
              if (!isWorkspaceScopedModel(model)) {
                warnUnscoped(model, operation, 'no-workspace-column');
                return query(args);
              }
              aclWhere = { workspaceId: ws };
            }
            // A model carrying workspaceId is always scoped to the caller's workspace,
            // whatever its ACL returned: a table may widen within a tenant, never across one.
            // Models without the column pass through so findUnique keeps its native,
            // transaction-safe behaviour.
            if (isUnrestricted(aclWhere)) {
              if (!isWorkspaceScopedModel(String(model))) {
                return query(args);
              }
              notePattern('[acl] table opted out of scoping', model, operation, { side: 'read' });
              aclWhere = { workspaceId: ws };
            } else if (isWorkspaceScopedModel(String(model)) && !isWorkspaceOnly(aclWhere, ws)) {
              aclWhere = { AND: [aclWhere, { workspaceId: ws }] };
              notePattern('[acl] clause wider than the workspace', model, operation, { side: 'read' });
            }
            const scalarDefault = isWorkspaceOnly(aclWhere, ws);

            if (WHERE_OPS.has(operation)) {
              const a = (args ?? {}) as Record<string, unknown> & { where?: object };
              const where = a.where ? { AND: [a.where, aclWhere] } : aclWhere;
              return query({ ...a, where } as typeof args);
            }

            // findUnique cannot take our filter, so fetch the row and check it here instead.
            // Safe inside a transaction. workspaceId is forced into the projection (on a copy)
            // so a narrow `select` cannot hide the column we need, then removed if unasked for.
            if (scalarDefault) {
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
                if (operation === 'findUniqueOrThrow') throw deny(model, operation, 'row in another workspace');
                logger.warn('[acl] blocked', { model, operation, reason: 'row in another workspace' });
                return null;
              }
              if (row && !wanted) delete (row as { workspaceId?: string }).workspaceId;
              return row;
            }

            // A relational filter cannot go in a findUnique where at all, so re-run it as
            // findFirst on the base client.
            const a = (args ?? {}) as Record<string, unknown> & { where?: object };
            const where = a.where ? { AND: [toWhereInput(model, a.where), aclWhere] } : aclWhere;
            const delegate = (base as unknown as Record<
              string,
              { findFirst: (x: unknown) => Promise<unknown> }
            >)[camel];
            const row = await delegate.findFirst({ ...a, where });
            if (!row && operation === 'findUniqueOrThrow') {
              throw deny(model, operation, 'no row matched the relational ACL');
            }
            return row;
          }

          // Authorize every new row via the table's canCreate.
          if (isCreate) {
            const data = (args as { data?: unknown }).data;
            const rows: unknown[] = Array.isArray(data) ? data : data != null ? [data] : [];
            for (const row of rows) {
              assertSameWorkspace(model, operation, row, ws);
              if (acl) {
                const ok = await acl.canCreate(row as Record<string, unknown>);
                if (!ok) throw denyCreate(model, operation);
              }
            }
            return query(args);
          }

          // workspaceId is immutable. Checked before the mutate filter so it holds even on
          // tables whose ACL opts out of scoping.
          if (ctx?.actor !== 'system' && isWorkspaceScopedModel(model)) {
            assertWorkspaceNotReassigned(model, operation, (args as { data?: unknown }).data, ws);
          }

          let mutateWhere = acl ? ((await acl.getMutateWhere()) as Record<string, unknown> | null) : null;
          if (!mutateWhere) {
            // Service actors only — see the read branch.
            if (!isWorkspaceScopedModel(model)) {
              warnUnscoped(model, operation, 'no-workspace-column');
              return query(args);
            }
            mutateWhere = { workspaceId: ws };
          }

          // A guest writes only what a guest can read: intersect the write filter with the
          // read filter rather than relying on every table clause to restate it.
          if (ctx?.role === 'GUEST' && acl) {
            const guestRead = (await acl.getWhereClause()) as Record<string, unknown> | null;
            if (guestRead && !isUnrestricted(guestRead)) {
              mutateWhere = isUnrestricted(mutateWhere)
                ? guestRead
                : { AND: [mutateWhere, guestRead] };
            }
          }

          // Same tenant rule as reads.
          if (isUnrestricted(mutateWhere)) {
            if (!isWorkspaceScopedModel(String(model))) {
              return query(args);
            }
            notePattern('[acl] table opted out of scoping', model, operation, { side: 'write' });
            mutateWhere = { workspaceId: ws };
          } else if (isWorkspaceScopedModel(String(model)) && !isWorkspaceOnly(mutateWhere, ws)) {
            mutateWhere = { AND: [mutateWhere, { workspaceId: ws }] };
            notePattern('[acl] clause wider than the workspace', model, operation, { side: 'write' });
          }

          // Bulk ops accept a non-unique/relational where — AND the mutate filter directly.
          if (isBulkMutate) {
            const a = (args ?? {}) as Record<string, unknown> & { where?: object };
            const where = a.where ? { AND: [a.where, mutateWhere] } : mutateWhere;
            return query({ ...a, where } as typeof args);
          }

          const delegate = (base as unknown as Record<string, ModelDelegate>)[camel];

          // Upsert: create-or-update — authorize whichever branch will actually run.
          if (isUpsert) {
            const a = (args ?? {}) as { where?: object; create?: unknown; update?: unknown };
            // upsert carries its payload as create/update rather than data, so the generic
            // immutability check above does not see it.
            if (ctx?.actor !== 'system' && isWorkspaceScopedModel(model)) {
              assertWorkspaceNotReassigned(model, operation, a.update, ws);
            }
            const scoped = toWhereInput(model, a.where);
            const inScope = await delegate.count({ where: { AND: [scoped, mutateWhere] } });
            if (inScope === 0) {
              const exists = await delegate.count({ where: scoped });
              if (exists > 0) {
                // The row exists, but not in the caller's scope — an upsert would update it.
                throw deny(model, operation, 'upsert target in another workspace');
              }
              // Row doesn't exist → this upsert will insert; gate it like a create.
              assertSameWorkspace(model, operation, a.create, ws);
              if (acl) {
                const ok = await acl.canCreate((a.create ?? {}) as Record<string, unknown>);
                if (!ok) throw denyCreate(model, operation);
              }
            }
            return query(args);
          }

          // Single update/delete by unique key: Prisma forbids a non-unique/relational where
          // here, so pre-authorize the target row with a scoped count on the base client.
          const a = (args ?? {}) as { where?: object };
          const n = await delegate.count({ where: { AND: [toWhereInput(model, a.where), mutateWhere] } });
          if (n === 0) {
            throw deny(model, operation, 'target row not in the caller\'s scope');
          }
          return query(args);
        },
      },
    },
  });

  const runTransaction = queryExtended.$transaction.bind(queryExtended) as (...a: unknown[]) => unknown;
  return queryExtended.$extends({
    client: {
      $transaction(...args: unknown[]) {
        if (typeof args[0] === 'function') {
          const fn = args[0] as (tx: unknown) => unknown;
          return runTransaction((tx: unknown) => txStorage.run(true, () => fn(tx)), ...args.slice(1));
        }
        return runTransaction(...args);
      },
    },
  }) as unknown as T;
}
