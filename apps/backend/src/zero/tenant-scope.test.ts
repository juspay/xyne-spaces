// Unit tests for the Zero read-path tenant boundary. The Zero query builder is replaced by a
// small recorder so each test can assert exactly which predicate was appended to the root table.

jest.mock('#zero-internal/query-internals', () => ({
  asQueryInternals: (q: { table: string }) => ({ ast: { table: q.table } }),
}));

jest.mock('@/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('@xyne/shared', () => ({
  CONNECT_SCOPED_TABLES: new Set(['messages']),
  schema: {
    tables: {
      // apps carries a workspaceId column (the creating workspace), like the real schema.
      apps: { columns: { id: {}, workspaceId: {}, orgId: {}, scope: {} } },
      installed_apps: { columns: { id: {}, workspaceId: {}, appId: {} } },
      tickets: { columns: { id: {}, workspaceId: {} } },
      workspaces: { columns: { id: {}, orgId: {} } },
      lookup_values: { columns: { id: {} } },
      unknown_table: { columns: { id: {} } },
    },
  },
}));

import type { Context } from '@xyne/shared';
import { scopeQueryToTenant } from './tenant-scope';

type Expr =
  | { op: 'cmp'; field: string; operator: string; value: unknown }
  | { op: 'or'; args: Expr[] }
  | { op: 'exists'; relation: string; sub: Recorded };

type Recorded = { table: string; wheres: unknown[]; where: (...a: unknown[]) => Recorded; whereExists: (...a: unknown[]) => Recorded };

function recorder(table: string): Recorded {
  const q: Recorded = {
    table,
    wheres: [],
    where(...args: unknown[]) {
      if (typeof args[0] === 'function') {
        const builder = {
          cmp: (field: string, operator: string, value?: unknown): Expr =>
            value === undefined
              ? { op: 'cmp', field, operator: '=', value: operator }
              : { op: 'cmp', field, operator, value },
          or: (...a: Expr[]): Expr => ({ op: 'or', args: a }),
          exists: (relation: string, cb: (s: Recorded) => Recorded): Expr => ({
            op: 'exists',
            relation,
            sub: cb(recorder(relation)),
          }),
        };
        q.wheres.push((args[0] as (b: typeof builder) => Expr)(builder));
      } else {
        q.wheres.push({ op: 'cmp', field: args[0], operator: '=', value: args[args.length - 1] });
      }
      return q;
    },
    whereExists(...args: unknown[]) {
      q.wheres.push({ op: 'whereExists', relation: args[0] });
      return q;
    },
  };
  return q;
}

const ctx: Context = {
  userID: 'user-1',
  workspaceId: 'ws-1',
  role: 'MEMBER',
  orgRole: 'MEMBER',
  memberId: 'member-1',
};

describe('scopeQueryToTenant', () => {
  describe('apps (org catalog / marketplace)', () => {
    it('does NOT pin apps to the caller workspace', () => {
      const q = scopeQueryToTenant(recorder('apps'), ctx, 'getOrgApps');
      const pinned = q.wheres.some(
        (w) => (w as Expr).op === 'cmp' && (w as { field: string }).field === 'workspaceId',
      );
      expect(pinned).toBe(false);
    });

    it('allows GLOBAL apps or apps whose org contains the caller workspace — and nothing else', () => {
      const q = scopeQueryToTenant(recorder('apps'), ctx, 'getOrgApps');
      expect(q.wheres).toHaveLength(1);
      const rule = q.wheres[0] as Extract<Expr, { op: 'or' }>;
      expect(rule.op).toBe('or');
      expect(rule.args).toHaveLength(2);
      expect(rule.args[0]).toEqual({ op: 'cmp', field: 'scope', operator: '=', value: 'GLOBAL' });
      const orgRule = rule.args[1] as Extract<Expr, { op: 'exists' }>;
      expect(orgRule.op).toBe('exists');
      expect(orgRule.relation).toBe('orgWorkspaces');
      // The org match is derived from the server-side ctx.workspaceId, never a client argument.
      expect(orgRule.sub.wheres).toEqual([{ op: 'cmp', field: 'id', operator: '=', value: 'ws-1' }]);
    });

    it('uses the caller context, not whatever workspace the query was built for', () => {
      const q = scopeQueryToTenant(recorder('apps'), { ...ctx, workspaceId: 'ws-other' }, 'getMarketplaceApps');
      const orgRule = (q.wheres[0] as Extract<Expr, { op: 'or' }>).args[1] as Extract<Expr, { op: 'exists' }>;
      expect(orgRule.sub.wheres).toEqual([{ op: 'cmp', field: 'id', operator: '=', value: 'ws-other' }]);
    });
  });

  describe('other tables are unchanged', () => {
    it.each(['installed_apps', 'tickets'])('%s is still pinned to the caller workspace', (table) => {
      const q = scopeQueryToTenant(recorder(table), ctx, 'q');
      expect(q.wheres).toEqual([{ op: 'cmp', field: 'workspaceId', operator: '=', value: 'ws-1' }]);
    });

    it('connect-scoped tables are left to the define-query backstop', () => {
      const q = scopeQueryToTenant(recorder('messages'), ctx, 'q');
      expect(q.wheres).toEqual([]);
    });

    it('global reference tables are served as-is', () => {
      const q = scopeQueryToTenant(recorder('lookup_values'), ctx, 'q');
      expect(q.wheres).toEqual([]);
    });

    it('an unscoped table is refused', () => {
      expect(() => scopeQueryToTenant(recorder('unknown_table'), ctx, 'q')).toThrow(/has no tenant scope/);
    });
  });
});
