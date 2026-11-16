/**
 * The tenant filter. This IS the `db` every caller uses (see client.ts).
 *
 * Reads: the table's getWhereClause() is ANDed onto the query.
 * Writes: canCreate() gates inserts (top-level and nested), canUpdate() gates update payloads,
 * getMutateWhere() gates which rows an update/delete may touch (told which of the two it is).
 * Either falling back to plain `{ workspaceId }` when the table has no opinion.
 * Workspace: a user principal may not insert into another workspace (backend callers only log
 * it), and no caller except `system` may move a row to another workspace.
 * Results: each table's hiddenFields() are stripped from what a user request gets back.
 *
 * Every table's rule lives in the policy map (database/acl/policy/policy-map.ts).
 *
 * Scoping is applied per query, from the tenant context open at call time.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { getContextOrNull, currentWorkspaceId, isRequestContext } from './context';
import { ACLFactory } from '@/database/acl';
import { isOwnWorkspace, namedWorkspaceId, type ACLContext } from '@/database/acl/base-acl';
import { forEachNestedInsert } from './stamp';
import { UnscopedACL } from '@/database/acl/tables/unscoped-acl';
import { logger } from '@/utils/logger';

type TransactionFrame = { tx: Prisma.TransactionClient; open: boolean };
const txStorage = new AsyncLocalStorage<TransactionFrame>();

/**
 * The client of the interactive transaction the caller is running in, or undefined outside
 * one. Work scheduled inside a transaction keeps its frame, so the frame is closed once the
 * transaction callback settles.
 */
export function currentTransactionClient(): Prisma.TransactionClient | undefined {
  const frame = txStorage.getStore();
  return frame?.open ? frame.tx : undefined;
}

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
 * Refuse an insert that names a workspace other than the one being enforced.
 *
 * Enforced (`enforce`) whenever a real user is behind the write (actor 'user'): the caller
 * supplied the payload, so a foreign workspaceId is a cross-tenant write. Tables that span
 * workspaces (UnscopedACL) are exempt.
 *
 * Service actors only log it. Workspace provisioning and similar jobs legitimately write rows
 * for a workspace other than the enforced one; most of those run in `$transaction` or
 * `asSystem` and never reach here, but a service caller that does is reported, not refused.
 *
 * Covers the scalar `workspaceId` and a `workspace: { connect }` relation. Not deduped — a
 * repeat is itself the signal.
 */
function checkForeignWorkspace(
  model: string,
  operation: string,
  row: unknown,
  ws: string,
  enforce: boolean,
): void {
  if (isOwnWorkspace(row, ws)) return;
  const given = namedWorkspaceId(row);
  if (enforce) {
    logger.warn('[acl] blocked create', { model, operation, reason: 'names a different workspace', given, enforced: ws });
    throw new Error(`Not authorized to create ${model}`);
  }
  logger.warn('[acl] create names a different workspace', { model, operation, given, enforced: ws });
}

/**
 * Run `checkForeignWorkspace` on every row a write inserts through nested relation writes
 * (`data.<relation>.create`, `createMany`, `connectOrCreate`, nested `upsert`, at any depth,
 * including the nested creates inside an update). Enforced for a user request unless the
 * nested row's own table spans workspaces (UnscopedACL); logged otherwise.
 */
function checkNestedInserts(
  model: string,
  operation: string,
  args: unknown,
  ws: string,
  userPrincipal: boolean,
  base: PrismaClient,
): void {
  const a = (args ?? {}) as { data?: unknown; create?: unknown; update?: unknown };
  const payloads = [a.data, a.create, a.update].flatMap((p) => (Array.isArray(p) ? p : [p]));
  for (const payload of payloads) {
    forEachNestedInsert(model, payload, (childModel, row) => {
      if (isOwnWorkspace(row, ws)) return;
      const enforce = userPrincipal && !isUnscopedModel(childModel, base);
      checkForeignWorkspace(childModel, operation, row, ws, enforce);
    });
  }
}

/** Per-model cache: does the table's ACL declare it cross-workspace (UnscopedACL)? */
const unscopedModels = new Map<string, boolean>();
/** A caller-less context for reading per-table facts (unscoped? hidden columns?) once per model. */
const PROBE_CTX: ACLContext = { userId: '', workspaceId: '' };

/** True when `model`'s ACL is UnscopedACL. Independent of the caller, so cached per model. */
function isUnscopedModel(model: string, base: PrismaClient): boolean {
  let unscoped = unscopedModels.get(model);
  if (unscoped === undefined) {
    unscoped =
      ACLFactory.getACL(toCamel(model) as Uncapitalize<Prisma.ModelName>, PROBE_CTX, base) instanceof UnscopedACL;
    unscopedModels.set(model, unscoped);
  }
  return unscoped;
}

/**
 * workspaceId is the tenant key: once a row exists it never moves to another workspace.
 *
 * Refuses an update payload that sets workspaceId (directly, via `{ set }`, or through a
 * `workspace` relation) to anything but the enforced workspace. Applies to every caller except
 * `system`, which is where one-off backfills and cross-workspace migrations belong. Setting it to
 * the enforced workspace's own id is a no-op and allowed.
 *
 * Covers every write that carries a data payload, including the update half of upsert.
 */
function assertWorkspaceUnchanged(
  model: string,
  operation: string,
  data: unknown,
  ws: string,
): void {
  const rows: unknown[] = Array.isArray(data) ? data : data != null ? [data] : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    let given: unknown = r.workspaceId;
    if (given && typeof given === 'object' && 'set' in given) given = (given as { set?: unknown }).set;
    if (given === undefined && r.workspace && typeof r.workspace === 'object') {
      given = namedWorkspaceId({ workspace: r.workspace }) ?? undefined;
    }
    if (given === undefined || given === ws) continue;
    logger.warn('[acl] blocked', { model, operation, reason: 'update changes workspaceId', given, enforced: ws });
    throw new Error(`Not authorized to move ${model} to another workspace`);
  }
}

function denyUpdate(model: string, operation: string): Error {
  logger.warn('[acl] blocked update', { model, operation, reason: 'canUpdate returned false' });
  return new Error(`Not authorized to update ${model}`);
}

/** The policy layer's "match nothing" clause (`{ OR: [] }`). */
function isDeny(where: Record<string, unknown>): boolean {
  const keys = Object.keys(where);
  return keys.length === 1 && Array.isArray(where.OR) && (where.OR as unknown[]).length === 0;
}

// ── column masking ────────────────────────────────────────────────────────────

/** Every model's relation fields, to walk nested rows in a result. */
const RELATIONS = new Map<string, { field: string; child: string }[]>(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    m.fields.filter((f) => f.kind === 'object').map((f) => ({ field: f.name, child: f.type })),
  ]),
);

/**
 * Hidden columns per model, from each table's hiddenFields(). Built once: hiddenFields() is a
 * property of the table, not of the caller, so it must not depend on ctx.
 */
let hiddenByModel: Map<string, string[]> | null = null;

function hiddenColumns(base: PrismaClient): Map<string, string[]> {
  if (!hiddenByModel) {
    const map = new Map<string, string[]>();
    for (const m of Prisma.dmmf.datamodel.models) {
      const cols = ACLFactory.getACL(toCamel(m.name) as Uncapitalize<Prisma.ModelName>, PROBE_CTX, base).hiddenFields();
      if (cols.length) map.set(m.name, cols);
    }
    hiddenByModel = map;
  }
  return hiddenByModel;
}

/** Remove hidden columns from `value` (a row, a list of rows, or nested relation rows), in place. */
function stripHidden(model: string, value: unknown, hidden: Map<string, string[]>, depth: number): void {
  if (depth > 12 || value === null || typeof value !== 'object' || value instanceof Date) return;
  if (Array.isArray(value)) {
    for (const v of value) stripHidden(model, v, hidden, depth);
    return;
  }
  const row = value as Record<string, unknown>;
  for (const col of hidden.get(model) ?? []) {
    delete row[col];
    // aggregate / groupBy: { _min: { col }, _max: { col } }
    for (const agg of ['_min', '_max']) {
      const a = row[agg];
      if (a && typeof a === 'object') delete (a as Record<string, unknown>)[col];
    }
  }
  for (const { field, child } of RELATIONS.get(model) ?? []) {
    if (row[field] !== undefined) stripHidden(child, row[field], hidden, depth + 1);
  }
}

/**
 * Column masking: strip every table's hidden columns from what a user request gets back,
 * including rows nested through include/select and rows returned by writes. Only user requests
 * (the same callers per-table ACLs apply to): jobs, login and agent code still read the columns
 * they need. A request handler that genuinely needs a hidden column reads it inside
 * withWorkspaceScope.
 */
function maskHiddenColumns(model: string | undefined, result: unknown, base: PrismaClient): unknown {
  if (!model || result === null || typeof result !== 'object') return result;
  if (txStorage.getStore()?.open || !isRequestContext() || !currentWorkspaceId()) return result;
  const hidden = hiddenColumns(base);
  if (hidden.size > 0) stripHidden(model, result, hidden, 0);
  return result;
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

  /** Scope and authorize one query, then run it. Masking is applied to its result afterwards. */
  const scoped = async (
    model: string | undefined,
    operation: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (a: any) => Promise<unknown>,
  ): Promise<unknown> => {
    if (txStorage.getStore()?.open) {
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
    // A real user is behind this write: an HTTP request (including a workspaceScopedRoute)
    // or a runWithContext scope such as a Zero mutator side effect. Their payload may only
    // insert into their own workspace, unless the table spans workspaces by design.
    // Jobs, webhooks and withWorkspaceScope fan-outs (actor 'service') only log.
    const userPrincipal = ctx?.actor === 'user';
    const enforceForeignWorkspace = userPrincipal && !isUnscopedModel(model, base);

    // Rows inserted through nested relation writes get the same workspace check, judged
    // by each nested row's own table. Any write op can carry them (create, upsert, and
    // the nested creates inside an update).
    if (!isRead) checkNestedInserts(model, op, args, ws, userPrincipal, base);

    if (isRead) {
      // Hand the caller's own `where` to the ACL so a single-entity read can scope by the
      // query's connectId/canvasId (Slack Connect canvas-child gate); most ACLs ignore it.
      const queryWhere = (args as { where?: Record<string, unknown> } | undefined)?.where;
      let aclWhere = acl ? ((await acl.getWhereClause(queryWhere)) as Record<string, unknown> | null) : null;
      if (!aclWhere) {
        // Reached when the table's ACL expressed no opinion, or the caller is a
        // service actor: fall back to plain workspace scope.
        if (!isWorkspaceScopedModel(model)) {
          warnUnscoped(model, operation, 'no-workspace-column');
          return query(args);
        }
        aclWhere = { workspaceId: ws };
      }
      // A table that declared itself unscoped (UnscopedACL) — pass straight through so
      // findUnique keeps its native, transaction-safe behaviour.
      if (isUnrestricted(aclWhere)) {
        // Only worth noting when the model has the column; global tables are expected.
        if (isWorkspaceScopedModel(String(model))) {
          notePattern('[acl] table opted out of scoping', model, operation, { side: 'read' });
        }
        return query(args);
      } else if (isWorkspaceScopedModel(String(model)) && !isWorkspaceOnly(aclWhere, ws) && !isDeny(aclWhere)) {
        // A model carrying workspaceId should resolve within the caller's workspace whatever
        // its own clause returned. Reported here rather than applied: a table that
        // legitimately spans workspaces would return nothing instead of erroring, and the
        // only environment that can say which tables those are is one carrying real traffic.
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
        checkForeignWorkspace(model, operation, row, ws, enforceForeignWorkspace);
        if (acl) {
          const ok = await acl.canCreate(row as Record<string, unknown>);
          if (!ok) throw denyCreate(model, operation);
        }
      }
      return query(args);
    }

    const isDelete = op === 'delete' || op === 'deleteMany';
    // The update payload: `data` for update*, the update branch for upsert.
    const updateData = isDelete
      ? undefined
      : isUpsert
        ? (args as { update?: unknown }).update
        : (args as { data?: unknown }).data;

    // workspaceId is immutable. Checked before the mutate filter so it holds even on
    // tables whose ACL opts out of scoping.
    if (ctx?.actor !== 'system' && isWorkspaceScopedModel(model)) {
      assertWorkspaceUnchanged(model, operation, updateData, ws);
    }

    // Column rules: may the caller write these columns (e.g. not their own `role`)?
    if (acl && updateData && typeof updateData === 'object') {
      const updateWhere = (args as { where?: Record<string, unknown> } | undefined)?.where;
      if (!(await acl.canUpdate(updateData as Record<string, unknown>, updateWhere))) throw denyUpdate(model, operation);
    }

    // Hand the caller's own `where` to the ACL so a single-entity write can scope by the
    // query's connectId/canvasId (Slack Connect canvas-child gate); most ACLs ignore it.
    // The ACL is told whether this is an update or a delete (e.g. admins may revoke but not edit).
    const mutateQueryWhere = (args as { where?: Record<string, unknown> } | undefined)?.where;
    let mutateWhere = acl
      ? ((await acl.getMutateWhere(mutateQueryWhere, isDelete ? 'delete' : 'update')) as Record<string, unknown> | null)
      : null;
    if (!mutateWhere) {
      // Service actors only — see the read branch.
      if (!isWorkspaceScopedModel(model)) {
        warnUnscoped(model, operation, 'no-workspace-column');
        return query(args);
      }
      mutateWhere = { workspaceId: ws };
    }
    if (isUnrestricted(mutateWhere)) {
      if (isWorkspaceScopedModel(String(model))) {
        notePattern('[acl] table opted out of scoping', model, operation, { side: 'write' });
      }
      return query(args);
    } else if (isWorkspaceScopedModel(String(model)) && !isWorkspaceOnly(mutateWhere, ws) && !isDeny(mutateWhere)) {
      // Same reporting rule as reads.
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
      const scoped = toWhereInput(model, a.where);
      const inScope = await delegate.count({ where: { AND: [scoped, mutateWhere] } });
      if (inScope === 0) {
        const exists = await delegate.count({ where: scoped });
        if (exists > 0) {
          // The row exists, but not in the caller's scope — an upsert would update it.
          throw deny(model, operation, 'upsert target in another workspace');
        }
        // Row doesn't exist → this upsert will insert; gate it like a create.
        checkForeignWorkspace(model, operation, a.create, ws, enforceForeignWorkspace);
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
  };

  const queryExtended = prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await scoped(model, operation, args, query);
          return maskHiddenColumns(model, result, base);
        },
      },
    },
  });

  const runTransaction = queryExtended.$transaction.bind(queryExtended) as (...a: unknown[]) => unknown;
  return queryExtended.$extends({
    client: {
      $transaction(...args: unknown[]) {
        if (typeof args[0] === 'function') {
          const fn = args[0] as (tx: Prisma.TransactionClient) => unknown;
          return runTransaction(async (tx: Prisma.TransactionClient) => {
            const frame: TransactionFrame = { tx, open: true };
            try {
              return await txStorage.run(frame, () => fn(tx));
            } finally {
              frame.open = false;
            }
          }, ...args.slice(1));
        }
        return runTransaction(...args);
      },
    },
  }) as unknown as T;
}
