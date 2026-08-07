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

const SEEN_CAP = 1000;
const seen = new Set<string>();

/**
 * One line per shape per process: an inventory of what occurs, not a count. It goes quiet
 * after the first occurrence, so silence here is never evidence the condition stopped.
 *
 * No stack capture on purpose: model + operation + the pod label is enough to grep.
 */
function warnLogOnce(
  tag: string,
  model: string | undefined,
  operation: string,
  detail: Record<string, unknown> = {},
): void {
  const key = `${tag}:${model ?? '?'}:${operation}:${JSON.stringify(detail)}`;
  if (seen.has(key) || seen.size >= SEEN_CAP) return;
  seen.add(key);
  logger.warn(tag, { model, operation, ...detail });
}

/** Every occurrence, so it can be counted and alerted on. */
function warnLogEvery(
  tag: string,
  model: string | undefined,
  operation: string,
  detail: Record<string, unknown> = {},
): void {
  logger.warn(tag, { model, operation, ...detail });
}

/**
 * Reads as not-found on purpose. A caller probing another workspace must not be able to
 * tell "this row exists but you may not have it" from "this row does not exist".
 */
function outOfScope(model: string): Error {
  return new Error(`No ${model} found for the current workspace`);
}

function notAllowedToCreate(model: string): Error {
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
function reportForeignWorkspace(model: string, operation: string, row: unknown, ws: string): void {
  if (!row || typeof row !== 'object') return;
  const given = (row as { workspaceId?: unknown }).workspaceId;
  // undefined -> stamp fills it. null -> a deliberate row on a nullable column.
  if (typeof given !== 'string' || given === ws) return;
  warnLogEvery('[acl] create names a different workspace', model, operation, { given, enforced: ws });
}

/**
 * workspaceId is the tenant key: once a row exists it should not move between workspaces.
 *
 * Diagnostic only, matching reportForeignWorkspace above. Which callers write a foreign
 * workspaceId today is not answerable from the code, and the only place that can answer it
 * is an environment carrying real traffic, so this reports rather than refuses. Turn it into
 * a refusal once the log is quiet.
 *
 * Covers every write that carries a data payload, including the update half of upsert,
 * which the generic data path does not see.
 *
 * Not deduped -- a repeat is itself the signal.
 */
function reportWorkspaceReassignment(
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
    warnLogEvery('[acl] update reassigns workspaceId', model, operation, { given: value, enforced: ws });
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

/**
 * Turn a table's clause into the filter to apply, or null to pass through unscoped.
 * Reads and writes differ only in which clause they hand in, so the policy is stated once.
 */
function resolveScope(
  clause: Record<string, unknown> | null,
  model: string,
  operation: string,
  ws: string,
  side: 'read' | 'write',
): Record<string, unknown> | null {
  if (!clause) {
    // The table expressed no opinion, or the caller is a service actor: plain workspace scope.
    if (!isWorkspaceScopedModel(model)) {
      warnLogOnce('[acl] query ran with no tenant scope', model, operation, { reason: 'no-workspace-column' });
      return null;
    }
    return { workspaceId: ws };
  }
  // An explicit opt-out (UnscopedACL). Not logged: the tables that do this are a static list,
  // so `grep 'new UnscopedACL' acl-factory.ts` answers it without runtime noise.
  if (isUnrestricted(clause)) return null;
  if (isWorkspaceScopedModel(model) && !isWorkspaceOnly(clause, ws)) {
    // Reported rather than narrowed: a table that legitimately spans workspaces would return
    // nothing instead of erroring, and only an environment carrying real traffic can say which.
    warnLogOnce('[acl] clause wider than the workspace', model, operation, { side });
  }
  return clause;
}

/** One intercepted operation, with everything the three branches need resolved once. */
type Intercepted = {
  model: string;
  operation: string;
  args: unknown;
  query: (a: unknown) => unknown;
  acl: { getWhereClause(): unknown; getMutateWhere(): unknown; canCreate(row: Record<string, unknown>): Promise<boolean> } | null;
  ctx: { actor?: string } | null;
  ws: string;
  /** The model's delegate on the un-filtered client, for pre-check and redirect reads. */
  delegate: ModelDelegate;
};

async function applyReadScope(op: Intercepted): Promise<unknown> {
  const { model, operation, args, query, acl, ws, delegate } = op;
  // Passing through keeps findUnique's native, transaction-safe behaviour.
  const aclWhere = resolveScope(
    acl ? ((await acl.getWhereClause()) as Record<string, unknown> | null) : null,
    model,
    operation,
    ws,
    'read',
  );
  if (!aclWhere) return query(args);

  // (a) The operation accepts a where: AND the filter on and let the database do the rest.
  if (WHERE_OPS.has(operation)) {
    const a = (args ?? {}) as Record<string, unknown> & { where?: object };
    return query({ ...a, where: a.where ? { AND: [a.where, aclWhere] } : aclWhere });
  }

  // (b) findUnique takes no where, so run it and check the row after. workspaceId is forced
  // into the projection (on a copy) so a narrow `select` cannot hide it, then removed again.
  if (isWorkspaceOnly(aclWhere, ws)) {
    const a = (args ?? {}) as Record<string, unknown> & {
      select?: Record<string, unknown>;
      omit?: Record<string, unknown>;
    };
    // Did the caller ask for workspaceId themselves? No projection at all means every field.
    const wanted = a.select
      ? a.select.workspaceId === true
      : (a.omit ? a.omit.workspaceId !== true : true);
    let patched: Record<string, unknown> = a;
    if (a.select) {
      patched = { ...a, select: { ...a.select, workspaceId: true } };
    } else if (a.omit) {
      const omit = { ...a.omit };
      delete omit.workspaceId;
      patched = { ...a, omit };
    }
    const row = (await query(patched)) as { workspaceId?: string } | null;
    if (row && row.workspaceId !== ws) {
      warnLogEvery('[acl] blocked', model, operation, { reason: 'row in another workspace' });
      if (operation === 'findUniqueOrThrow') throw outOfScope(model);
      return null;
    }
    if (row && !wanted) delete row.workspaceId;
    return row;
  }

  // (c) A relational filter cannot be checked from the row either, so re-run as findFirst on
  // the un-filtered client — the one path here that leaves an open transaction.
  const a = (args ?? {}) as Record<string, unknown> & { where?: object };
  const where = a.where ? { AND: [toWhereInput(model, a.where), aclWhere] } : aclWhere;
  const row = await delegate.findFirst({ ...a, where });
  if (!row && operation === 'findUniqueOrThrow') {
    warnLogEvery('[acl] blocked', model, operation, { reason: 'no row matched the relational ACL' });
    throw outOfScope(model);
  }
  return row;
}

/** Authorize each new row through the table's canCreate. */
async function authorizeRows(op: Intercepted, rows: unknown[]): Promise<void> {
  const { model, operation, acl, ws } = op;
  for (const row of rows) {
    reportForeignWorkspace(model, operation, row, ws);
    if (!acl) continue;
    if (!(await acl.canCreate(row as Record<string, unknown>))) {
      warnLogEvery('[acl] blocked create', model, operation, { reason: 'canCreate returned false' });
      throw notAllowedToCreate(model);
    }
  }
}

async function applyCreateScope(op: Intercepted): Promise<unknown> {
  const data = (op.args as { data?: unknown }).data;
  await authorizeRows(op, Array.isArray(data) ? data : data != null ? [data] : []);
  return op.query(op.args);
}

async function applyWriteScope(op: Intercepted, kind: 'bulk' | 'unique' | 'upsert'): Promise<unknown> {
  const { model, operation, args, query, acl, ctx, ws, delegate } = op;

  // workspaceId is immutable. Checked before the mutate filter so it holds even on tables
  // whose ACL opts out of scoping.
  if (ctx?.actor !== 'system' && isWorkspaceScopedModel(model)) {
    reportWorkspaceReassignment(model, operation, (args as { data?: unknown }).data, ws);
  }

  const mutateWhere = resolveScope(
    acl ? ((await acl.getMutateWhere()) as Record<string, unknown> | null) : null,
    model,
    operation,
    ws,
    'write',
  );
  if (!mutateWhere) return query(args);

  if (kind === 'bulk') {
    const a = (args ?? {}) as Record<string, unknown> & { where?: object };
    return query({ ...a, where: a.where ? { AND: [a.where, mutateWhere] } : mutateWhere });
  }

  if (kind === 'upsert') {
    const a = (args ?? {}) as { where?: object; create?: unknown; update?: unknown };
    // upsert carries its payload as create/update rather than data, so the check above
    // does not see it.
    if (ctx?.actor !== 'system' && isWorkspaceScopedModel(model)) {
      reportWorkspaceReassignment(model, operation, a.update, ws);
    }
    const scoped = toWhereInput(model, a.where);
    if ((await delegate.count({ where: { AND: [scoped, mutateWhere] } })) === 0) {
      if ((await delegate.count({ where: scoped })) > 0) {
        // The row exists, but not in the caller's scope — an upsert would update it.
        warnLogEvery('[acl] blocked', model, operation, { reason: 'upsert target in another workspace' });
        throw outOfScope(model);
      }
      // Row doesn't exist → this upsert will insert; gate it like a create.
      await authorizeRows(op, [a.create ?? {}]);
    }
    return query(args);
  }

  // Single update/delete by unique key: Prisma forbids a non-unique/relational where here,
  // so pre-authorize the target row with a scoped count on the un-filtered client.
  const a = (args ?? {}) as { where?: object };
  if ((await delegate.count({ where: { AND: [toWhereInput(model, a.where), mutateWhere] } })) === 0) {
    warnLogEvery('[acl] blocked', model, operation, { reason: "target row not in the caller's scope" });
    throw outOfScope(model);
  }
  return query(args);
}

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
            warnLogOnce('[acl] ran inside a transaction', model, operation);
            return query(args);
          }
          const ctx = getContextOrNull();
          const ws = currentWorkspaceId();
          // Raw queries carry no model and are handled by their call sites.
          if (!ws || !model) {
            // `system` is intentional; anything else reaching here has no scope to apply.
            if (ctx?.actor !== 'system')
              warnLogOnce('[acl] query ran with no tenant scope', model, operation, { reason: ctx ? 'no-workspace' : 'no-context' });
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

          const intercepted: Intercepted = {
            model,
            operation,
            args,
            query: query as (a: unknown) => unknown,
            acl: acl as Intercepted['acl'],
            ctx,
            ws,
            delegate: (base as unknown as Record<string, ModelDelegate>)[camel],
          };

          if (isRead) return applyReadScope(intercepted);
          if (isCreate) return applyCreateScope(intercepted);
          if (isBulkMutate) return applyWriteScope(intercepted, 'bulk');
          if (isUpsert) return applyWriteScope(intercepted, 'upsert');
          return applyWriteScope(intercepted, 'unique');
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
