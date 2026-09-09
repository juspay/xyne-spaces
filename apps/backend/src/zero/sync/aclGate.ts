import { QueryACLFactory, type Context } from '@xyne/shared';
import { zql } from '../queries';

/**
 * Dynamically derives a shared query's ACL gate from the table's own `canSelect`.
 *
 * We resolve the ACL with SENTINEL values in place of `ctx.userID`/`ctx.workspaceId`,
 * so the resolved AST is a per-user TEMPLATE: wherever a sentinel appears is the
 * "hole" bound to the actual subscriber at evaluation time. The gate then:
 *   - lists the grant tables the ACL's `whereExists` chain references (materialized
 *     as live sibling instances), and
 *   - evaluates the ACL's own boolean (and/or/simple/EXISTS) per user against those
 *     snapshots — no per-query or per-grant hardcoding; change the ACL and the gate
 *     follows. An ACL that uses an unsupported node is not shareable (fail-safe).
 */
export const SENTINEL_USER = '__sync_acl_user__';
export const SENTINEL_WORKSPACE = '__sync_acl_workspace__';

const sentinelCtx: Context = {
  userID: SENTINEL_USER,
  workspaceId: SENTINEL_WORKSPACE,
  role: 'MEMBER',
  orgRole: 'MEMBER',
  memberId: '__sync_acl_member__',
};

type Row = Record<string, unknown>;
/** Rows of a materialized grant table (its snapshot). */
export type SnapshotProvider = (table: string) => Row[];

interface SimpleCond {
  type: 'simple';
  left: { name: string };
  op: string;
  right: { value: unknown };
}
interface BoolCond {
  type: 'and' | 'or';
  conditions: Cond[];
}
interface ExistsCond {
  type: 'correlatedSubquery';
  op: 'EXISTS' | 'NOT EXISTS';
  related: {
    correlation: { parentField: string[]; childField: string[] };
    subquery: { table: string; where?: Cond };
  };
}
/** Synthetic node: a per-row admission arm the shared path cannot serve, replaced by
 *  `excludePerRowArms` so it never grants (evalCond returns false). See buildAclGate. */
interface ExcludedCond {
  type: 'excluded';
}
export type Cond = SimpleCond | BoolCond | ExistsCond | ExcludedCond;

/**
 * A grant table the gate reads, classified for the two-plane partition (final plan):
 *  - `per-user`: the ACL binds a leaf column to SENTINEL_USER (e.g. `channel_participants.userId`),
 *    so the instance partitions PER USER (`__grant__<table>{<boundColumn>: U}` = all of U's rows).
 *    A membership delta arrives pre-keyed to U → O(subs_U) targeted recompute, no del-enrichment.
 *  - `per-scope`: a uniform scope-root row (visibility/workspace) or a structure table with no
 *    direct subscriber binding — materialized per SCOPE and shared (a flip re-gates the scope).
 * `scopeColumn` is the correlation's childField — how the instance is filtered to the query's scope.
 */
export interface GrantSource {
  table: string;
  scopeColumn: string;
  kind: 'per-user' | 'per-scope';
  /** per-user only: the leaf column bound to SENTINEL_USER — the partition key. */
  boundColumn?: string;
}

export interface AclGate {
  rootTable: string;
  /** Grant sources to materialize as live instances (table + scope column), from the ACL's whereExists chain. */
  grantSources: GrantSource[];
  /** Distinct grant tables (for the evaluator's snapshot lookups). */
  grantTables: string[];
  /** True if the ACL had a top-level per-row arm (a data-row column bound to the subscriber, e.g.
   *  `createdBy==me`) that was EXCLUDED from the gate. The shared per-scope instance serves scope-join
   *  admission only; the allowlist must assert this exclusion is safe for the query (e.g. attachments:
   *  the createdBy arm only covers unlinked drafts, which never enter a channel-scoped instance). */
  perRowExcluded: boolean;
  /**
   * Is `userId` (in `workspaceId`) granted a row of the root scope? `rootRow` is the
   * scope binding (the root table's key columns, e.g. `{ channelId }`); `snapshot`
   * returns each grant table's current rows.
   */
  evaluate(rootRow: Row, userId: string, workspaceId: string, snapshot: SnapshotProvider): boolean;
}

/** deriveAclGate is pure per rootTable and its result is immutable (ACLs change only at deploy),
 *  but it runs on EVERY subscribe (QueryACLFactory + canSelect + AST walk + validate) — reconnect
 *  storms multiply it. Memoize per rootTable; a throw (ungateable ACL) is not cached so it keeps
 *  refusing. The cached gate is read-only shared (evaluate is a pure closure; grantSources are
 *  read-only), safe across subscribers. */
const gateCache = new Map<string, AclGate>();

export function deriveAclGate(rootTable: string): AclGate {
  const cached = gateCache.get(rootTable);
  if (cached) return cached;
  const gate = buildAclGate(rootTable);
  gateCache.set(rootTable, gate);
  return gate;
}

function buildAclGate(rootTable: string): AclGate {
  const acl = QueryACLFactory.getACL(rootTable as never, sentinelCtx);
  const query = acl.canSelect((zql as unknown as Record<string, never>)[rootTable]);
  const where = (query as { ast?: { where?: Cond } }).ast?.where;
  // Enforce the fail-safe contract at derivation (subscribe) time: an ACL that uses a
  // node/op the evaluator can't handle is NOT shareable. Without this the gap surfaces
  // only at evaluate time — per grant delta, per client — where it would fail closed but
  // silently (a table that never admits). Refuse the subscribe instead.
  if (where) validateGateAst(where);
  const grantSources = where ? collectGrantSources(where) : [];
  // Exclude top-level per-row arms (a data-row column bound to the subscriber, e.g. createdBy==me):
  // the shared per-scope instance admits at SCOPE granularity, so a per-row predicate can't be a
  // scope-level boolean — drop it (fail-closed: it never grants). scope-join leaves (SENTINEL_USER
  // INSIDE a whereExists) are untouched — that's the legit membership check.
  const gated = where ? excludePerRowArms(where) : undefined;
  return {
    rootTable,
    grantSources,
    grantTables: [...new Set(grantSources.map((s) => s.table))],
    perRowExcluded: gated?.excluded ?? false,
    evaluate(rootRow, userId, workspaceId, snapshot) {
      // No ACL predicate = unrestricted at the row level (workspace backstop lives outside canSelect).
      return gated ? evalCond(gated.cond, rootRow, { userId, workspaceId }, snapshot) : true;
    },
  };
}

const SUPPORTED_OPS = new Set(['=', 'IS', '!=', 'IS NOT']);

/**
 * Statically assert the whole ACL AST is one the evaluator supports (the same node types
 * `evalCond` handles + the same ops `compare` handles). Throws on the first unsupported
 * node/op so `deriveAclGate` can refuse the subscribe — the "unsupported ⇒ not shareable"
 * fail-safe, enforced once up front rather than discovered per delta at eval time.
 */
export function validateGateAst(cond: Cond): void {
  switch (cond.type) {
    case 'and':
    case 'or':
      cond.conditions.forEach(validateGateAst);
      return;
    case 'simple':
      if (!SUPPORTED_OPS.has(cond.op)) {
        throw new Error(`ACL gate: unsupported operator '${cond.op}'`);
      }
      return;
    case 'correlatedSubquery':
      if (cond.op !== 'EXISTS' && cond.op !== 'NOT EXISTS') {
        throw new Error(`ACL gate: unsupported subquery op '${cond.op}'`);
      }
      if (cond.related.subquery.where) validateGateAst(cond.related.subquery.where);
      return;
    default:
      throw new Error(`ACL gate: unsupported condition '${(cond as { type: string }).type}'`);
  }
}

/**
 * Replace top-level per-row arms — a data-row `simple` bound to SENTINEL_USER (e.g. `createdBy==me`)
 * — with an `excluded` node (never grants). Descends and/or but NOT into correlatedSubquery: a
 * SENTINEL_USER simple INSIDE a whereExists is the membership leaf and must stay. Returns whether
 * anything was excluded (for the allowlist's per-query safety assertion).
 */
function excludePerRowArms(cond: Cond): { cond: Cond; excluded: boolean } {
  switch (cond.type) {
    case 'simple':
      return (cond.op === '=' || cond.op === 'IS') && cond.right.value === SENTINEL_USER
        ? { cond: { type: 'excluded' }, excluded: true }
        : { cond, excluded: false };
    case 'and':
    case 'or': {
      let excluded = false;
      const conditions = cond.conditions.map((c) => {
        const r = excludePerRowArms(c);
        excluded = excluded || r.excluded;
        return r.cond;
      });
      return { cond: { type: cond.type, conditions }, excluded };
    }
    case 'correlatedSubquery':
    case 'excluded':
      return { cond, excluded: false };
  }
}

/**
 * The column a whereExists subquery binds to SENTINEL_USER, or null if it does not pin the row to
 * the subscriber. `and` binds if ANY conjunct does (the row then pertains to the subscriber); `or`
 * binds ONLY if EVERY arm binds on the SAME column (a non-binding arm would grant regardless of the
 * subscriber ⇒ not per-user); a nested correlatedSubquery's binding belongs to ITS table, not this.
 */
export function boundColumnOf(where: Cond | undefined): string | null {
  if (!where) return null;
  switch (where.type) {
    case 'simple':
      return (where.op === '=' || where.op === 'IS') && where.right.value === SENTINEL_USER
        ? where.left.name
        : null;
    case 'and': {
      for (const c of where.conditions) {
        const b = boundColumnOf(c);
        if (b) return b;
      }
      return null;
    }
    case 'or': {
      let col: string | null = null;
      for (const c of where.conditions) {
        const b = boundColumnOf(c);
        if (!b) return null;
        if (col && col !== b) return null;
        col = b;
      }
      return col;
    }
    case 'correlatedSubquery':
    case 'excluded':
      return null;
  }
}

/**
 * Walk the ACL's correlatedSubqueries → each grant table (deduped by table:scopeColumn),
 * classified per-user (binds SENTINEL_USER on a consistent column) vs per-scope. A table that
 * appears with INCONSISTENT binding across arms is downgraded to per-scope (conservative: a
 * user-targeted partition would miss the unbound arm's grants).
 */
function collectGrantSources(root: Cond): GrantSource[] {
  const byKey = new Map<string, { table: string; scopeColumn: string; boundColumn: string | null; conflict: boolean }>();
  const walk = (cond: Cond): void => {
    if (cond.type === 'and' || cond.type === 'or') cond.conditions.forEach(walk);
    else if (cond.type === 'correlatedSubquery') {
      const table = cond.related.subquery.table;
      const scopeColumn = cond.related.correlation.childField[0];
      const key = `${table}:${scopeColumn}`;
      const boundColumn = boundColumnOf(cond.related.subquery.where);
      const existing = byKey.get(key);
      if (!existing) byKey.set(key, { table, scopeColumn, boundColumn, conflict: false });
      else if (existing.boundColumn !== boundColumn) existing.conflict = true;
      if (cond.related.subquery.where) walk(cond.related.subquery.where);
    }
  };
  walk(root);
  return [...byKey.values()].map((e) =>
    e.boundColumn !== null && !e.conflict
      ? { table: e.table, scopeColumn: e.scopeColumn, kind: 'per-user' as const, boundColumn: e.boundColumn }
      : { table: e.table, scopeColumn: e.scopeColumn, kind: 'per-scope' as const },
  );
}

interface Bindings {
  userId: string;
  workspaceId: string;
}

function resolveValue(value: unknown, b: Bindings): unknown {
  if (value === SENTINEL_USER) return b.userId;
  if (value === SENTINEL_WORKSPACE) return b.workspaceId;
  return value;
}

function evalCond(cond: Cond, row: Row, b: Bindings, snapshot: SnapshotProvider): boolean {
  switch (cond.type) {
    case 'and':
      return cond.conditions.every((c) => evalCond(c, row, b, snapshot));
    case 'or':
      return cond.conditions.some((c) => evalCond(c, row, b, snapshot));
    case 'simple':
      return compare(row[cond.left.name], cond.op, resolveValue(cond.right.value, b));
    case 'excluded':
      return false; // a per-row arm the shared path doesn't serve — never grants
    case 'correlatedSubquery': {
      const { correlation, subquery } = cond.related;
      const parentValue = row[correlation.parentField[0]];
      const childRows = snapshot(subquery.table).filter(
        (r) => r[correlation.childField[0]] === parentValue,
      );
      const exists = subquery.where
        ? childRows.some((r) => evalCond(subquery.where as Cond, r, b, snapshot))
        : childRows.length > 0;
      return cond.op === 'NOT EXISTS' ? !exists : exists;
    }
    default:
      throw new Error(`ACL gate: unsupported condition '${(cond as { type: string }).type}'`);
  }
}

function compare(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case '=':
    case 'IS':
      return actual === expected;
    case '!=':
    case 'IS NOT':
      return actual !== expected;
    default:
      throw new Error(`ACL gate: unsupported operator '${op}'`);
  }
}
