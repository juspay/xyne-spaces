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
export const SENTINEL_MEMBER = '__sync_acl_member__';

const sentinelCtx: Context = {
  userID: SENTINEL_USER,
  workspaceId: SENTINEL_WORKSPACE,
  role: 'MEMBER',
  orgRole: 'MEMBER',
  memberId: SENTINEL_MEMBER,
};

/**
 * Every value `sentinelCtx` stamps that VARIES per subscriber — a base-row `simple` binding any of
 * these is per-subscriber admission. Kept at the sentinel source so adding a field to `sentinelCtx`
 * is covered here by construction (add the sentinel to this set where it's minted, one place).
 * NOT included: `role`/`orgRole` — they resolve to the real enum `'MEMBER'`, indistinguishable from a
 * row literal, so an ACL simple binding `ctx.role` classifies as a literal; soundness for role-bound
 * ACLs rests on the gateway's MEMBER-only serving guard (same standing assumption as the gate plane).
 */
export const SUBSCRIBER_SENTINEL_VALUES: ReadonlySet<unknown> = new Set<unknown>([
  SENTINEL_USER,
  SENTINEL_WORKSPACE,
  SENTINEL_MEMBER,
]);

/** Is `value` a subscriber-varying sentinel (userID/workspaceId/memberId)? See SUBSCRIBER_SENTINEL_VALUES. */
export function isSubscriberSentinel(value: unknown): boolean {
  return SUBSCRIBER_SENTINEL_VALUES.has(value);
}

/**
 * The WorkspaceRole values the sync engine ADMITS. The gate is derived under a non-guest sentinel
 * (sentinelCtx.role = MEMBER), so it encodes the non-guest ACL branch; these roles all share that
 * branch, so the same gate is CORRECT for every one of them — an invariant the shareability CI guard
 * enforces (deriving each role's ACL and asserting it equals MEMBER's). GUEST is deliberately absent:
 * a guest ACL is stricter, so a guest under this gate would be OVER-admitted (a leak) — guests fall
 * back to native Zero. (Mirror of WorkspaceRole in @xyne/shared minus GUEST; kept as strings so the
 * gateway and the CI guard share one source and stay in lock-step.)
 */
export const NON_GUEST_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'MEMBER', 'COMMUNITY_MEMBER'];

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
export type Cond = SimpleCond | BoolCond | ExistsCond;

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
  /**
   * SHAREABILITY CONTRACT (gate-only): does this ACL collapse to ONE boolean per (user, instance),
   * CONSTANT across every row of the instance? True iff every TOP-LEVEL term resolves from ctx
   * constants or the instance's partition/scope — a `simple` on `partitionColumn`, or an `exists`
   * correlated on `partitionColumn`. Any per-row-varying reference (a base column other than the
   * partition, or a join keyed on such — e.g. calls' `callId`/`channelId` membership arms, or a
   * per-row `createdBy==me`) makes admission PER-ROW ⇒ NOT shareable ⇒ served by native Zero.
   * `partitionDetermines` is the audited escape hatch: columns functionally determined by the
   * partition through a DB-enforced FK (NO silent data invariants). See checkGateCollapsible.
   * NOTE (dead plumbing today — neither the CI guard nor the runtime refuse passes it): when first
   * plumbed it must reach BOTH call sites AND the determined columns must be re-added to
   * `client.scope` in clientGateway — else `evaluate` reads the top-level simple's column from a
   * scope missing it → undefined → silent deny-all. (review-6aa1638218 scope-column rider.)
   */
  collapsibility(partitionColumn: string, partitionDetermines?: readonly string[]): CollapseResult;
  /**
   * Is `userId` (in `workspaceId`) granted a row of the root scope? `rootRow` is the
   * scope binding (the root table's key columns, e.g. `{ channelId }`); `snapshot`
   * returns each grant table's current rows.
   */
  evaluate(rootRow: Row, userId: string, workspaceId: string, snapshot: SnapshotProvider): boolean;
}

export interface CollapseResult {
  ok: boolean;
  /** the offending top-level term (present iff !ok) — for the refuse log / CI failure message. */
  reason?: string;
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

/**
 * The table's `canSelect` ACL resolved against the sentinel context, as a raw where-AST (or
 * undefined when the ACL adds no predicate). Same resolution `buildAclGate` uses, exposed for the
 * row-level plane's eligibility predicate — which classifies the ACL's top-level terms directly and
 * does NOT want the gate's grant-source collection or fail-safe validation. Shares `sentinelCtx` so
 * SENTINEL_USER/SENTINEL_WORKSPACE mark the subscriber holes identically to the gate.
 */
export function sentinelAclWhere(rootTable: string): Cond | undefined {
  return sentinelAclWhereForRole(rootTable, sentinelCtx.role as string);
}

/**
 * The table's sentinel-resolved canSelect for an ARBITRARY workspace role — the derivation the gate
 * uses, but with `ctx.role` overridden. Exposed for the shareability CI guard, which asserts every
 * NON_GUEST_ROLES role yields the SAME ACL as MEMBER (so the member-derived gate serves them all
 * correctly). A role whose ACL diverges must go native or get a per-role gate, not be silently
 * under/over-served.
 */
export function sentinelAclWhereForRole(rootTable: string, role: string): Cond | undefined {
  const ctx = { ...sentinelCtx, role, orgRole: role } as Context;
  const acl = QueryACLFactory.getACL(rootTable as never, ctx);
  const query = acl.canSelect((zql as unknown as Record<string, never>)[rootTable]);
  return (query as { ast?: { where?: Cond } }).ast?.where;
}

function buildAclGate(rootTable: string): AclGate {
  const where = sentinelAclWhere(rootTable);
  // Enforce the fail-safe contract at derivation (subscribe) time: an ACL that uses a
  // node/op the evaluator can't handle is NOT shareable. Without this the gap surfaces
  // only at evaluate time — per grant delta, per client — where it would fail closed but
  // silently (a table that never admits). Refuse the subscribe instead.
  if (where) validateGateAst(where);
  const grantSources = where ? collectGrantSources(where) : [];
  return {
    rootTable,
    grantSources,
    grantTables: [...new Set(grantSources.map((s) => s.table))],
    collapsibility(partitionColumn, partitionDetermines = []) {
      return checkGateCollapsible(where, partitionColumn, partitionDetermines);
    },
    evaluate(rootRow, userId, workspaceId, snapshot) {
      // Evaluate the FULL ACL per row. `collapsibility` (enforced at subscribe + CI) guarantees an
      // admitted query has no top-level per-row arm, so per-instance admission is one boolean per
      // user — no arm needs excluding. No ACL predicate = unrestricted (workspace backstop is outside).
      return where ? evalCond(where, rootRow, { userId, workspaceId }, snapshot) : true;
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
    case 'correlatedSubquery': {
      if (cond.op !== 'EXISTS' && cond.op !== 'NOT EXISTS') {
        throw new Error(`ACL gate: unsupported subquery op '${cond.op}'`);
      }
      // Both the collapsibility partition-anchor check AND evalCond's join read only
      // parentField[0]/childField[0]. A COMPOUND correlation would (a) pass collapsibility on [0]
      // while varying per row at [1], and (b) have evalCond drop the remaining join conjuncts →
      // match MORE child rows → EXISTS over-fires → OVER-ADMISSION (leak-shaped). Refuse the shape
      // here (→ ungateable-refuse path) so the single-field read in both places stays sound.
      const { parentField, childField } = cond.related.correlation;
      if (parentField.length !== 1 || childField.length !== 1) {
        throw new Error('ACL gate: unsupported compound correlation');
      }
      if (cond.related.subquery.where) validateGateAst(cond.related.subquery.where);
      return;
    }
    default:
      throw new Error(`ACL gate: unsupported condition '${(cond as { type: string }).type}'`);
  }
}

/**
 * Gate-only shareability predicate (see AclGate.collapsibility). Walk the TOP-LEVEL where — descend
 * `and`/`or`, but NOT into a correlatedSubquery (inside a subquery you're on the grant/scope side,
 * free to reference anything). Every top-level leaf must be INSTANCE-CONSTANT:
 *  - `simple`: its column must be `partitionColumn` (or an escape-hatch column). A base-row column
 *    other than the partition varies per row ⇒ per-row admission ⇒ reject. (This covers ctx-bound
 *    `createdBy==me`, per-row `visibleTo==me`, and a global `workspaceId==me`.)
 *  - `correlatedSubquery`: its parentField[0] (the base-side join key) must be `partitionColumn` (or
 *    an escape-hatch column). A membership/scope join keyed on any other per-row column (calls'
 *    `callId`/`channelId` arms) ⇒ per-row ⇒ reject.
 * Returns the first offending term. `where === undefined` (no ACL predicate) is trivially collapsible.
 */
function checkGateCollapsible(
  where: Cond | undefined,
  partitionColumn: string,
  partitionDetermines: readonly string[],
): CollapseResult {
  if (!where) return { ok: true };
  const anchored = new Set<string>([partitionColumn, ...partitionDetermines]);
  let reason: string | undefined;
  const walk = (c: Cond): void => {
    if (reason) return;
    switch (c.type) {
      case 'and':
      case 'or':
        c.conditions.forEach(walk);
        return;
      case 'simple':
        if (!anchored.has(c.left.name)) {
          reason = `top-level '${c.left.name} ${c.op} …' is a per-row predicate (not the partition column '${partitionColumn}')`;
        }
        return;
      case 'correlatedSubquery': {
        // validateGateAst already refused compound correlations, so parentField is single-field
        // here; check EVERY field anyway (belt-and-braces) so a per-row join key can never anchor.
        const unanchored = c.related.correlation.parentField.find((k) => !anchored.has(k));
        if (unanchored !== undefined) {
          reason = `top-level exists('${c.related.subquery.table}') is correlated on per-row column '${unanchored}', not the partition '${partitionColumn}'`;
        }
        return; // do NOT descend — inside the subquery is the grant/scope side
      }
    }
  };
  walk(where);
  return reason ? { ok: false, reason } : { ok: true };
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
