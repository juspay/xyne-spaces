import type { AnyQuery } from '@rocicorp/zero';
import { schema, type BaseQueryResolver, type Context } from '@xyne/shared';
import { zql } from '../queries';
import { syncContext } from './serviceIdentity';
import { SENTINEL_USER, SENTINEL_WORKSPACE, isSubscriberSentinel, sentinelAclWhere, type Cond } from './aclGate';

/**
 * ROW-LEVEL ROUTING PLANE — the second shared-engine mechanism (the query-level GATE is the first).
 *
 * A self-scoped query (`userId == me`) has one subscriber per user, so there is no subscriber-sharing
 * to collapse — moving it to a per-user tap instance just relocates the Zero pipeline (writerate ×
 * #pipelines is unchanged). The win requires a COARSER partition than userId: materialize ONE pipeline
 * per WORKSPACE and route each row to its owner at fan-out. N_users pipelines → K_workspaces pipelines.
 *
 * Instance   = one per active workspace (`partitionColumn = workspaceId`, an `=`-literal ⇒ queryMetaFor
 *              derives it UNCHANGED).
 * Routing    = by `routeColumn` (the owner column) at fan-out, using the socket's userId. Self-scoped
 *              ACL is `owner == me`, so routing-by-owner IS the ACL, reproduced exactly ⇒ no gate, no
 *              grant instances.
 *
 * ELIGIBILITY (R-1, mechanical — see `rowLevelEligibility`): routing reproduces native IFF the ACL's
 * only subscriber-dependent top-level term is the owner pin (`routeColumn == SENTINEL_USER`). Enforced
 * three ways like the gate: this registry's CI guard, the runtime refuse in the R2 gateway branch, and
 * keeping these names OUT of SHARED_BASE_QUERIES (two allowlists, two guards). Owner pins are normalized
 * INTO the ACL (design principle: adapt the query/ACL to the simple engine, not the engine to the query)
 * so eligibility is ACL-only and uniform.
 */

export interface RowLevelSpec {
  /** Column on the ROOT row naming its owner user (the route target). REAL per-query — senderId ≠ userId. */
  routeColumn: string;
  /** Workspace-partitioned, ACL-stripped base: ONE pipeline per workspace, routed to users at fan-out. */
  base: BaseQueryResolver;
  /** Per-related-table ACL audit recorded at onboarding (R-1(d)); undefined ⇒ the base has no related. */
  relatedAudit?: string;
}

/** The partition column of every row-level instance — the tenant boundary forced from the socket (R2). */
export const ROW_LEVEL_PARTITION_COLUMN = 'workspaceId';

const wsOf = (args: unknown): string => {
  const ws = (args as { workspaceId?: unknown } | undefined)?.workspaceId;
  if (typeof ws !== 'string' || ws === '') {
    // R2 forces workspaceId from the socket, so a missing value here is an internal misuse, not client
    // input — fail loud rather than materialize a garbage `where('workspaceId','')` instance.
    throw new Error('rowLevelQueries: workspaceId is required to build a row-level base');
  }
  return ws;
};

/**
 * The row-level allowlist. Each base drops the per-user owner pin (routing does it) and partitions by
 * workspaceId, keeping every subscriber-independent literal the native query applies. Adding an entry
 * turns the CI guard RED unless its ACL is row-level eligible.
 */
export const ROW_LEVEL_QUERIES: ReadonlyMap<string, RowLevelSpec> = new Map<string, RowLevelSpec>([
  // bookmarks: ACL `userId == me`; native query adds `isDeleted == false` (subscriber-independent).
  ['userBookmarks', {
    routeColumn: 'userId',
    base: ({ args }) =>
      zql.bookmarks
        .where('workspaceId', wsOf(args))
        .where('isDeleted', false)
        .orderBy('createdAt', 'desc'),
  }],
  // user_preferences: ACL `userId == me`. Native `.one()` is a per-subscriber projection dropped here —
  // the workspace instance holds every user's row; fan-out routes each user their single row.
  ['getCurrentUserPreference', {
    routeColumn: 'userId',
    base: ({ args }) => zql.user_preferences.where('workspaceId', wsOf(args)),
  }],
  // draft_messages: owner pin normalized into the ACL (draft-messages-acl.ts) so it is ACL-eligible.
  ['userDrafts', {
    routeColumn: 'userId',
    base: ({ args }) => zql.draft_messages.where('workspaceId', wsOf(args)).related('attachments'),
    relatedAudit:
      'attachments → message_attachments joined by draft.id = entityId (1:1-owned: each attachment ' +
      "belongs to one draft ⇒ one owner). Native serves it via message_attachments' own createdBy ACL arm.",
  }],
]);

export function isRowLevelQuery(name: string): boolean {
  return ROW_LEVEL_QUERIES.has(name);
}

/** The owner column to route a row-level query's rows by, or undefined if the query is not row-level. */
export function routeColumnOf(name: string): string | undefined {
  return ROW_LEVEL_QUERIES.get(name)?.routeColumn;
}

/** Resolve a row-level query's workspace-partitioned base, or undefined if the query is not row-level. */
export function resolveRowLevelBase(name: string, ctx: Context, args: unknown): AnyQuery | undefined {
  const spec = ROW_LEVEL_QUERIES.get(name);
  return spec?.base({ ctx, args: args as Parameters<BaseQueryResolver>[0]['args'] });
}

// ── R-1 eligibility predicate ────────────────────────────────────────────────────────────────────

export interface RowLevelEligibility {
  ok: boolean;
  /** the offending term/reason (present iff !ok) — for the CI failure / runtime refuse log. */
  reason?: string;
}

/** A workspace id used only to materialize the base AST for structural inspection. Exported so the CI
 *  guard can build synthetic bases that satisfy the partition check with the same probe value. */
export const PROBE_WORKSPACE = '__row_level_probe_ws__';

interface BaseAst {
  table?: string;
  where?: Cond;
  start?: unknown;
  related?: Array<{
    subquery?: { table?: string };
    correlation?: { parentField: string[]; childField: string[] };
  }>;
}

/**
 * Is `queryName` safe to serve via the row-level plane? Structural, no DB. Reads the workspace-
 * partitioned base AST (for cursor + related shape) and the table's sentinel-resolved canSelect (for
 * the owner-pin classification). Returns the first offending term. Mirrors the gate's collapsibility.
 */
export function rowLevelEligibility(queryName: string): RowLevelEligibility {
  const spec = ROW_LEVEL_QUERIES.get(queryName);
  if (!spec) return { ok: false, reason: `'${queryName}' is not registered in ROW_LEVEL_QUERIES` };
  const base = resolveRowLevelBase(queryName, syncContext(), { workspaceId: PROBE_WORKSPACE });
  return rowLevelEligibilityForBase(base, spec.routeColumn);
}

/**
 * Structural eligibility over an already-built workspace-partitioned base + routeColumn. Split out of
 * `rowLevelEligibility` so the CI guard can exercise the base-shape branches (cursor / many:1 related /
 * missing partition) with synthetic bases, without a throwaway registry entry.
 */
export function rowLevelEligibilityForBase(
  base: AnyQuery | undefined,
  routeColumn: string,
): RowLevelEligibility {
  const ast = (base as { ast?: BaseAst } | undefined)?.ast;
  if (!ast?.table) return { ok: false, reason: 'base resolves no root table' };

  // The base MUST partition by workspaceId (the tenant boundary; forced from the socket at R2). A base
  // that forgot it would let queryMetaFor pick a wrong partition column and mix tenants.
  if (!hasTopLevelPartition(ast.where, ROW_LEVEL_PARTITION_COLUMN, PROBE_WORKSPACE)) {
    return {
      ok: false,
      reason: `base does not filter '${ROW_LEVEL_PARTITION_COLUMN}' at the top level`,
    };
  }

  // (c) cursor: a per-subscriber `.start()` scroll fragments into per-subscriber instances ⇒ not a
  // shared workspace instance. A fixed `.limit()` window would be shared, but these queries take none.
  if (ast.start !== undefined) {
    return {
      ok: false,
      reason: 'base uses a cursor (.start) — per-subscriber pagination is not row-level routable',
    };
  }

  // (d) every `.related()` must be 1:1-OWNED: the child follows a single parent (its correlation binds
  // the root PK) ⇒ each child row has exactly one owner. A many:1 related (parentField = a non-PK FK)
  // would duplicate one child across many owners on the wire — out of scope for the row-level plane.
  const rootPk = tablePrimaryKey(ast.table);
  for (const rel of ast.related ?? []) {
    const parentField = rel.correlation?.parentField ?? [];
    const childTable = rel.subquery?.table ?? '(unknown)';
    if (parentField.length !== 1 || rootPk.length !== 1 || parentField[0] !== rootPk[0]) {
      return {
        ok: false,
        reason: `.related('${childTable}') is not 1:1-owned (parentField ${JSON.stringify(
          parentField,
        )} ≠ single-column root PK ${JSON.stringify(rootPk)})`,
      };
    }
  }

  // (a)/(b): classify the ACL's top-level terms. Routing-by-routeColumn reproduces the ACL IFF the ONLY
  // subscriber-dependent top-level term is `routeColumn == SENTINEL_USER`; every other term is the
  // workspace partition or a subscriber-independent literal. Any subquery / other sentinel / OR ⇒ per-row.
  return rowLevelEligibleForTable(ast.table, routeColumn);
}

/**
 * The ACL-only slice of eligibility: classify a table's sentinel-resolved canSelect against a candidate
 * routeColumn. Exposed (like the gate's `collapsibility`) so the CI guard can assert that non-eligible
 * tables are REJECTED — e.g. `delayed_messages` (its channel-access `whereExists` is a per-row arm).
 */
export function rowLevelEligibleForTable(rootTable: string, routeColumn: string): RowLevelEligibility {
  return classifyAclTerms(sentinelAclWhere(rootTable), routeColumn);
}

/**
 * Classify a sentinel-resolved ACL's top-level terms for owner-only routability. Exported for the CI
 * guard's synthetic-ACL fixtures (memberId conjunct / OR / no-ACL) that don't map to a real table.
 */
export function classifyAclTerms(where: Cond | undefined, routeColumn: string): RowLevelEligibility {
  if (!where) {
    // No ACL predicate = unrestricted read (every row to everyone). Routing by routeColumn would HIDE
    // rows native serves ⇒ not native-parity. Fail closed.
    return { ok: false, reason: `ACL has no predicate — no owner pin to route by (routeColumn '${routeColumn}')` };
  }
  const terms = flattenTopLevelAnd(where);
  if (terms === null) {
    return { ok: false, reason: 'ACL top level contains an OR — alternative admission paths are not pure owner routing' };
  }
  let ownerPins = 0;
  for (const t of terms) {
    if (t.type !== 'simple') {
      return {
        ok: false,
        reason: `top-level '${t.type}' term is per-row (only owner-pin / partition / literal simples are routable)`,
      };
    }
    const value = t.right.value;
    if (value === SENTINEL_USER) {
      if (t.left.name !== routeColumn) {
        return { ok: false, reason: `top-level '${t.left.name}' binds the subscriber but is not the routeColumn '${routeColumn}'` };
      }
      if (t.op !== '=' && t.op !== 'IS') {
        return { ok: false, reason: `owner pin '${routeColumn} ${t.op} …' must use '=' or 'IS'` };
      }
      ownerPins++;
    } else if (value === SENTINEL_WORKSPACE) {
      // the workspace-partition term — the tenant scope the engine partitions by. allowed.
      continue;
    } else if (isSubscriberSentinel(value)) {
      // Any OTHER subscriber-varying binding (e.g. memberId == ctx.memberId, org-members-acl.ts) is
      // per-subscriber admission the ACL-stripped base + owner-only routing does NOT reproduce — the
      // base drops the conjunct, so the engine would OVER-deliver. Reject: this is the fail-open hole
      // the classifier must not have (same class as the gate's compound-correlation hole).
      return {
        ok: false,
        reason: `top-level '${t.left.name}' binds a subscriber value other than the owner pin (routeColumn '${routeColumn}') — per-subscriber admission is not routable`,
      };
    }
    // else: a subscriber-independent literal filter (e.g. isDeleted == false). allowed. NOTE: an ACL
    // simple binding ctx.role/ctx.orgRole resolves to the enum 'MEMBER' — indistinguishable from a row
    // literal here, so it lands in this branch; soundness rests on the gateway MEMBER-only guard.
  }
  if (ownerPins !== 1) {
    return {
      ok: false,
      reason: `expected exactly one owner pin (routeColumn '${routeColumn}' == subscriber), found ${ownerPins}`,
    };
  }
  return { ok: true };
}

/**
 * Flatten AND-nesting into a flat list of leaf terms (simple / correlatedSubquery). Returns null when a
 * top-level OR is present anywhere in the conjunction — an OR is alternative admission, not pure routing.
 */
function flattenTopLevelAnd(where: Cond): Cond[] | null {
  if (where.type === 'or') return null;
  if (where.type === 'and') {
    const out: Cond[] = [];
    for (const c of where.conditions) {
      const sub = flattenTopLevelAnd(c);
      if (sub === null) return null;
      out.push(...sub);
    }
    return out;
  }
  return [where];
}

/** Does the base's top-level where pin `column == partitionValue` (the workspace partition)? */
function hasTopLevelPartition(where: Cond | undefined, column: string, partitionValue: string): boolean {
  if (!where) return false;
  const terms = flattenTopLevelAnd(where);
  if (terms === null) return false;
  return terms.some(
    (t) =>
      t.type === 'simple' &&
      t.left.name === column &&
      (t.op === '=' || t.op === 'IS') &&
      t.right.value === partitionValue,
  );
}

function tablePrimaryKey(table: string): readonly string[] {
  const t = (schema as unknown as { tables: Record<string, { primaryKey?: readonly string[] }> }).tables[table];
  return t?.primaryKey ?? [];
}
