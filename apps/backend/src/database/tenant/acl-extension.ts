/**
 * ACL-aware Prisma extension — this IS the `db` every caller uses. Reads AND the model's
 * getWhereClause() onto the query; writes authorize via canCreate() / getMutateWhere()
 * (falling back to scalar `{ workspaceId }`). Only under a live non-system context; service
 * actors get workspace scope only. Relation includes / $queryRaw are not covered.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { getContextOrNull } from './context';
import { ACLFactory } from '@/database/acl';

const txStorage = new AsyncLocalStorage<boolean>();

/** Model names (lowercased) with a scalar workspaceId column. */
const WORKSPACE_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'workspaceId' && f.kind === 'scalar'))
    .map((m) => m.name.toLowerCase()),
);

/** Models that must never be workspace-scoped (external org/team analytics with nullable workspaceId). */
const OPT_OUT = new Set([
  'teamintelligenceuseringestionv2',
  'teamintelligenceteamsummaryv2',
  'teamintelligenceorgsummaryv2',
]);

/** True when a model carries a scalar workspaceId and isn't opted out. */
export function isWorkspaceScopedModel(name: string): boolean {
  const n = name.toLowerCase();
  return WORKSPACE_MODELS.has(n) && !OPT_OUT.has(n);
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
          if (txStorage.getStore() === true) return query(args);
          const ctx = getContextOrNull();
          const ws = ctx && !ctx.system ? ctx.workspaceId : null;
          if (!ws || !model) return query(args);
          if (OPT_OUT.has(model.toLowerCase())) return query(args);

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
          // Service actors (synthetic userId) get workspace scope only — skip the per-table ACL.
          const acl = ctx!.serviceCall
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
            let scalarDefault = false;
            if (!aclWhere) {
              if (!isWorkspaceScopedModel(model)) return query(args);
              aclWhere = { workspaceId: ws };
              scalarDefault = true;
            }

            if (WHERE_OPS.has(operation)) {
              const a = (args ?? {}) as Record<string, unknown> & { where?: object };
              const where = a.where ? { AND: [a.where, aclWhere] } : aclWhere;
              return query({ ...a, where } as typeof args);
            }

            // findUnique* + scalar workspaceId default: post-filter the row (tx-safe). Force
            // workspaceId into the projection on a copy so a narrow select can't hide it, then strip.
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
                if (operation === 'findUniqueOrThrow') {
                  throw new Error(`No ${model} found for the current workspace`);
                }
                return null;
              }
              if (row && !wanted) delete (row as { workspaceId?: string }).workspaceId;
              return row;
            }

            // findUnique* + relational ACL: unique where can't hold relations, so redirect to
            // findFirst on the base client (CAVEAT: escapes an interactive tx).
            const a = (args ?? {}) as Record<string, unknown> & { where?: object };
            const where = a.where ? { AND: [toWhereInput(model, a.where), aclWhere] } : aclWhere;
            const delegate = (base as unknown as Record<
              string,
              { findFirst: (x: unknown) => Promise<unknown> }
            >)[camel];
            const row = await delegate.findFirst({ ...a, where });
            if (!row && operation === 'findUniqueOrThrow') {
              throw new Error(`No ${model} found for the current workspace`);
            }
            return row;
          }

          // Authorize every new row via the table's canCreate. Base ACL allows all, so no-op
          // tables and service actors are unaffected; workspaceId itself is filled by stamp.ts.
          if (isCreate) {
            if (acl) {
              const data = (args as { data?: unknown }).data;
              const rows: unknown[] = Array.isArray(data) ? data : data != null ? [data] : [];
              for (const row of rows) {
                const ok = await acl.canCreate(row as Record<string, unknown>);
                if (!ok) throw new Error(`Not authorized to create ${model}`);
              }
            }
            return query(args);
          }

          let mutateWhere = acl ? ((await acl.getMutateWhere()) as Record<string, unknown> | null) : null;
          if (!mutateWhere) {
            if (!isWorkspaceScopedModel(model)) return query(args);
            mutateWhere = { workspaceId: ws };
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
            const a = (args ?? {}) as { where?: object; create?: unknown };
            const scoped = toWhereInput(model, a.where);
            const inScope = await delegate.count({ where: { AND: [scoped, mutateWhere] } });
            if (inScope === 0) {
              const exists = await delegate.count({ where: scoped });
              if (exists > 0) {
                // Row exists but outside the caller's mutate scope → cross-tenant update.
                throw new Error(`No ${model} found for the current workspace`);
              }
              // Row doesn't exist → this upsert will insert; gate it like a create.
              if (acl) {
                const ok = await acl.canCreate((a.create ?? {}) as Record<string, unknown>);
                if (!ok) throw new Error(`Not authorized to create ${model}`);
              }
            }
            return query(args);
          }

          // Single update/delete by unique key: Prisma forbids a non-unique/relational where
          // here, so pre-authorize the target row with a scoped count on the base client.
          const a = (args ?? {}) as { where?: object };
          const n = await delegate.count({ where: { AND: [toWhereInput(model, a.where), mutateWhere] } });
          if (n === 0) {
            throw new Error(`No ${model} found for the current workspace`);
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
