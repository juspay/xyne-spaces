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
type Cond = SimpleCond | BoolCond | ExistsCond;

/** A grant table the gate reads + the column its instance is scoped by (from the ACL correlation). */
export interface GrantSource {
  table: string;
  scopeColumn: string;
}

export interface AclGate {
  rootTable: string;
  /** Grant sources to materialize as live instances (table + scope column), from the ACL's whereExists chain. */
  grantSources: GrantSource[];
  /** Distinct grant tables (for the evaluator's snapshot lookups). */
  grantTables: string[];
  /**
   * Is `userId` (in `workspaceId`) granted a row of the root scope? `rootRow` is the
   * scope binding (the root table's key columns, e.g. `{ channelId }`); `snapshot`
   * returns each grant table's current rows.
   */
  evaluate(rootRow: Row, userId: string, workspaceId: string, snapshot: SnapshotProvider): boolean;
}

export function deriveAclGate(rootTable: string): AclGate {
  const acl = QueryACLFactory.getACL(rootTable as never, sentinelCtx);
  const query = acl.canSelect((zql as unknown as Record<string, never>)[rootTable]);
  const where = (query as { ast?: { where?: Cond } }).ast?.where;
  const grantSources = where ? collectGrantSources(where) : [];
  return {
    rootTable,
    grantSources,
    grantTables: [...new Set(grantSources.map((s) => s.table))],
    evaluate(rootRow, userId, workspaceId, snapshot) {
      // No ACL predicate = unrestricted at the row level (workspace backstop lives outside canSelect).
      return where ? evalCond(where, rootRow, { userId, workspaceId }, snapshot) : true;
    },
  };
}

/** Walk the ACL's correlatedSubqueries → each grant table + the column its standalone instance is keyed by. */
function collectGrantSources(root: Cond): GrantSource[] {
  const sources: GrantSource[] = [];
  const seen = new Set<string>();
  const walk = (cond: Cond): void => {
    if (cond.type === 'and' || cond.type === 'or') cond.conditions.forEach(walk);
    else if (cond.type === 'correlatedSubquery') {
      const table = cond.related.subquery.table;
      const scopeColumn = cond.related.correlation.childField[0];
      const key = `${table}:${scopeColumn}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push({ table, scopeColumn });
      }
      if (cond.related.subquery.where) walk(cond.related.subquery.where);
    }
  };
  walk(root);
  return sources;
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
