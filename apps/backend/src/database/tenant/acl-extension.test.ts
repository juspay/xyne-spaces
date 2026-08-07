/**
 * Behavioural lock on the tenant filter.
 *
 * `withAclExtension` hands its hook to `$extends`, so a stub client captures the hook and
 * each test drives it directly: `query` is a spy, which makes the assertion "what filter
 * reached the database, or what was refused" rather than anything about Prisma itself.
 *
 * Models are real (`Prisma.dmmf` loads from the generated client, no connection needed):
 * Message/User carry workspaceId, Workspace/WorkflowMapping do not.
 */

const WS = 'ws-1';
const OTHER_WS = 'ws-2';

type Hook = (p: {
  model?: string;
  operation: string;
  args: unknown;
  query: (a: unknown) => unknown;
}) => Promise<unknown>;

const ctxState: { ctx: unknown; ws: string | null; isRequest: boolean } = {
  ctx: null,
  ws: null,
  isRequest: true,
};

jest.mock('@/database/tenant/context', () => ({
  getContextOrNull: () => ctxState.ctx,
  currentWorkspaceId: () => ctxState.ws,
  isRequestContext: () => ctxState.isRequest,
}));

const getACL = jest.fn();
jest.mock('@/database/acl', () => ({ ACLFactory: { getACL: () => getACL() } }));

// The real env.ts validates the whole schema on import and needs JWT_SECRET.
const enforce = { noContext: false, workspaceImmutable: false };
jest.mock('@/config/env', () => ({ config: { aclEnforcement: enforce } }));

const warn = jest.fn();
jest.mock('@/utils/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: jest.fn() } }));

// Imported once. Re-importing per test would rebuild the generated Prisma client's DMMF
// (176 models) each time, which exhausts the heap.
// eslint-disable-next-line import/first
import { withAclExtension } from './acl-extension';

/** Build the extension over a stub client and return the captured hook. */
function build(delegates: Record<string, unknown> = {}) {
  const captured: { hook?: Hook; txWrapper?: (...a: unknown[]) => unknown } = {};
  const stub: Record<string, unknown> = {
    ...delegates,
    // Stands in for a real interactive transaction: run the callback, hand it a tx client.
    $transaction: jest.fn((arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)({}) : undefined)),
    $extends(config: {
      query?: { $allModels?: { $allOperations?: Hook } };
      client?: { $transaction?: (...a: unknown[]) => unknown };
    }) {
      if (config.query?.$allModels?.$allOperations) captured.hook = config.query.$allModels.$allOperations;
      if (config.client?.$transaction) captured.txWrapper = config.client.$transaction;
      return stub;
    },
  };
  const client = (withAclExtension as unknown as (p: unknown) => unknown)(stub);
  return { hook: captured.hook!, txWrapper: captured.txWrapper!, client, stub };
}

/** A caller acting as themselves inside a resolved workspace. */
function asUser(role = 'MEMBER') {
  ctxState.ctx = { actor: 'user', userId: 'u-1', workspaceId: WS, role, orgRole: 'MEMBER', memberId: 'm-1' };
  ctxState.ws = WS;
  ctxState.isRequest = true;
}

beforeEach(() => {
  warn.mockReset();
  enforce.noContext = false;
  enforce.workspaceImmutable = false;
  getACL.mockReset();
  ctxState.ctx = null;
  ctxState.ws = null;
  ctxState.isRequest = true;
});

/** Tags emitted during a test, in order. */
const tags = (): string[] => warn.mock.calls.map((c) => c[0] as string);

describe('gates before any scoping', () => {
  /** Run an operation from inside the transaction wrapper, as $transaction(fn) would. */
  const inTransaction = (txWrapper: unknown, fn: () => unknown) =>
    (txWrapper as (f: unknown) => Promise<unknown>).call({}, fn);

  it('bounds the query by workspace inside an interactive transaction', async () => {
    asUser();
    const { hook, txWrapper } = build();
    const query = jest.fn().mockResolvedValue('row');

    const result = await inTransaction(txWrapper, () =>
      hook({ model: 'Message', operation: 'findMany', args: { where: { id: 'm' } }, query }),
    );

    // The normal path's pre-query reads would escape the transaction, so the boundary is
    // applied to the arguments instead.
    expect(query).toHaveBeenCalledWith({ where: { AND: [{ id: 'm' }, { workspaceId: WS }] } });
    expect(result).toBe('row');
    expect(tags()).toContain('[acl] ran inside a transaction');
  });

  it('passes through in a transaction with no workspace while enforcement is off', async () => {
    ctxState.ctx = { actor: 'user', userId: 'u-1', workspaceId: null };
    ctxState.ws = null;
    enforce.noContext = false;
    const { hook, txWrapper } = build();
    const query = jest.fn().mockResolvedValue(null);

    await inTransaction(txWrapper, () =>
      hook({ model: 'Message', operation: 'findMany', args: {}, query }),
    );

    expect(query).toHaveBeenCalledWith({});
    expect(tags()).toContain('[acl] query ran with no tenant scope');
  });

  it('refuses a tenant table in a transaction with no workspace once enforcement is on', async () => {
    ctxState.ctx = { actor: 'user', userId: 'u-1', workspaceId: null };
    ctxState.ws = null;
    enforce.noContext = true;
    const { hook, txWrapper } = build();
    const query = jest.fn();

    await expect(
      inTransaction(txWrapper, () =>
        hook({ model: 'Message', operation: 'findMany', args: {}, query }),
      ),
    ).rejects.toThrow(/workspaceId required for Message.findMany/);
    expect(query).not.toHaveBeenCalled();
  });

  it('lets a model with no workspaceId column through even with enforcement on', async () => {
    ctxState.ctx = { actor: 'user', userId: 'u-1', workspaceId: null };
    ctxState.ws = null;
    enforce.noContext = true;
    const { hook, txWrapper } = build();
    const query = jest.fn().mockResolvedValue([]);

    await inTransaction(txWrapper, () =>
      hook({ model: 'Workspace', operation: 'findMany', args: {}, query }),
    );

    expect(query).toHaveBeenCalledWith({});
  });

  // Authentication resolves the session before it knows a workspace, and UserSession is a
  // workspace-scoped table. It runs outside a transaction, so the switch must not reach it —
  // enforcing here would make it impossible to log in.
  it('lets a workspace-scoped read through outside a transaction even with enforcement on', async () => {
    ctxState.ctx = { actor: 'user', userId: 'u-1', workspaceId: null };
    ctxState.ws = null;
    enforce.noContext = true;
    const { hook } = build();
    const query = jest.fn().mockResolvedValue({ id: 's-1' });

    const row = await hook({
      model: 'UserSession',
      operation: 'findUnique',
      args: { where: { id: 's-1' } },
      query,
    });

    expect(query).toHaveBeenCalledWith({ where: { id: 's-1' } });
    expect(row).toEqual({ id: 's-1' });
  });

  it('passes through when no workspace is resolved, and says why', async () => {
    ctxState.ctx = { actor: 'user', userId: 'u-1', workspaceId: null };
    ctxState.ws = null;
    const { hook } = build();
    const query = jest.fn().mockResolvedValue(null);

    await hook({ model: 'Message', operation: 'findMany', args: {}, query });

    expect(query).toHaveBeenCalledWith({});
    expect(tags()).toContain('[acl] query ran with no tenant scope');
  });

  it('stays silent for a system actor with no workspace', async () => {
    ctxState.ctx = { actor: 'system' };
    ctxState.ws = null;
    const { hook } = build();

    await hook({ model: 'Message', operation: 'findMany', args: {}, query: jest.fn() });

    expect(tags()).toHaveLength(0);
  });

  it('passes through an operation it does not classify', async () => {
    asUser();
    const { hook } = build();
    const query = jest.fn().mockResolvedValue(1);

    await hook({ model: 'Message', operation: 'executeRaw', args: { sql: 'x' }, query });

    expect(query).toHaveBeenCalledWith({ sql: 'x' });
  });
});

describe('reads', () => {
  it('ANDs the plain workspace filter when the table has no opinion', async () => {
    asUser();
    getACL.mockReturnValue({ getWhereClause: async () => null });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue([]);

    await hook({ model: 'Message', operation: 'findMany', args: { where: { id: 'm' } }, query });

    expect(query).toHaveBeenCalledWith({ where: { AND: [{ id: 'm' }, { workspaceId: WS }] } });
  });

  it('applies the filter alone when the caller passed no where', async () => {
    asUser();
    getACL.mockReturnValue({ getWhereClause: async () => null });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue([]);

    await hook({ model: 'Message', operation: 'findMany', args: {}, query });

    expect(query).toHaveBeenCalledWith({ where: { workspaceId: WS } });
  });

  it("ANDs a table's own clause rather than replacing it", async () => {
    asUser();
    getACL.mockReturnValue({ getWhereClause: async () => ({ workspaceId: WS, authorId: 'u-1' }) });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue([]);

    await hook({ model: 'Message', operation: 'findMany', args: { where: { id: 'm' } }, query });

    expect(query).toHaveBeenCalledWith({
      where: { AND: [{ id: 'm' }, { workspaceId: WS, authorId: 'u-1' }] },
    });
  });

  it('passes through unscoped when a table opts out', async () => {
    asUser();
    getACL.mockReturnValue({ getWhereClause: async () => ({}) });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue([]);

    await hook({ model: 'Message', operation: 'findMany', args: { where: { id: 'm' } }, query });

    expect(query).toHaveBeenCalledWith({ where: { id: 'm' } });
  });

  it('passes through a model with no workspaceId column', async () => {
    asUser();
    getACL.mockReturnValue({ getWhereClause: async () => null });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue([]);

    await hook({ model: 'Workspace', operation: 'findMany', args: {}, query });

    expect(query).toHaveBeenCalledWith({});
    expect(tags()).toContain('[acl] query ran with no tenant scope');
  });

  // A distinct model from the test above: `clauseWider` is a once-per-shape line, and that
  // test already consumed the slot for Message/findMany.
  it('reports a clause reaching past the workspace but still applies it', async () => {
    asUser();
    getACL.mockReturnValue({ getWhereClause: async () => ({ authorId: 'u-1' }) });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue([]);

    await hook({ model: 'User', operation: 'findMany', args: {}, query });

    expect(tags()).toContain('[acl] clause wider than the workspace');
    expect(query).toHaveBeenCalledWith({ where: { authorId: 'u-1' } });
  });

  describe('findUnique, which cannot take a filter', () => {
    it('returns null for a row in another workspace', async () => {
      asUser();
      getACL.mockReturnValue({ getWhereClause: async () => null });
      const { hook } = build();
      const query = jest.fn().mockResolvedValue({ id: 'm', workspaceId: OTHER_WS });

      const row = await hook({ model: 'Message', operation: 'findUnique', args: { where: { id: 'm' } }, query });

      expect(row).toBeNull();
      expect(tags()).toContain('[acl] blocked');
    });

    it('throws for findUniqueOrThrow on a row in another workspace', async () => {
      asUser();
      getACL.mockReturnValue({ getWhereClause: async () => null });
      const { hook } = build();
      const query = jest.fn().mockResolvedValue({ id: 'm', workspaceId: OTHER_WS });

      await expect(
        hook({ model: 'Message', operation: 'findUniqueOrThrow', args: { where: { id: 'm' } }, query }),
      ).rejects.toThrow(/No Message found for the current workspace/);
    });

    it('returns the row when it belongs to the caller', async () => {
      asUser();
      getACL.mockReturnValue({ getWhereClause: async () => null });
      const { hook } = build();
      const query = jest.fn().mockResolvedValue({ id: 'm', workspaceId: WS });

      const row = await hook({ model: 'Message', operation: 'findUnique', args: { where: { id: 'm' } }, query });

      expect(row).toEqual({ id: 'm', workspaceId: WS });
    });

    it('forces workspaceId into a narrow select, then strips it back out', async () => {
      asUser();
      getACL.mockReturnValue({ getWhereClause: async () => null });
      const { hook } = build();
      const query = jest.fn().mockResolvedValue({ id: 'm', workspaceId: WS });

      const row = await hook({
        model: 'Message',
        operation: 'findUnique',
        args: { where: { id: 'm' }, select: { id: true } },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { id: 'm' },
        select: { id: true, workspaceId: true },
      });
      expect(row).toEqual({ id: 'm' });
    });

    it('keeps workspaceId when the caller asked for it', async () => {
      asUser();
      getACL.mockReturnValue({ getWhereClause: async () => null });
      const { hook } = build();
      const query = jest.fn().mockResolvedValue({ id: 'm', workspaceId: WS });

      const row = await hook({
        model: 'Message',
        operation: 'findUnique',
        args: { where: { id: 'm' }, select: { id: true, workspaceId: true } },
        query,
      });

      expect(row).toEqual({ id: 'm', workspaceId: WS });
    });

    it('redirects to findFirst on the base client for a relational clause', async () => {
      asUser();
      getACL.mockReturnValue({ getWhereClause: async () => ({ channel: { is: { workspaceId: WS } } }) });
      const findFirst = jest.fn().mockResolvedValue({ id: 'm' });
      const { hook } = build({ message: { findFirst, count: jest.fn() } });
      const query = jest.fn();

      const row = await hook({ model: 'Message', operation: 'findUnique', args: { where: { id: 'm' } }, query });

      expect(query).not.toHaveBeenCalled();
      expect(findFirst).toHaveBeenCalledWith({
        where: { AND: [{ id: 'm' }, { channel: { is: { workspaceId: WS } } }] },
      });
      expect(row).toEqual({ id: 'm' });
    });
  });
});

describe('creates', () => {
  it('refuses when the table says no', async () => {
    asUser();
    getACL.mockReturnValue({ canCreate: async () => false });
    const { hook } = build();
    const query = jest.fn();

    await expect(
      hook({ model: 'Message', operation: 'create', args: { data: { id: 'm' } }, query }),
    ).rejects.toThrow(/Not authorized to create Message/);
    expect(query).not.toHaveBeenCalled();
    expect(tags()).toContain('[acl] blocked create');
  });

  it('lets an authorized create through', async () => {
    asUser();
    getACL.mockReturnValue({ canCreate: async () => true });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue({ id: 'm' });

    await hook({ model: 'Message', operation: 'create', args: { data: { id: 'm' } }, query });

    expect(query).toHaveBeenCalledWith({ data: { id: 'm' } });
  });

  it('checks every row of a createMany', async () => {
    asUser();
    const canCreate = jest.fn().mockResolvedValue(true);
    getACL.mockReturnValue({ canCreate });
    const { hook } = build();

    await hook({
      model: 'Message',
      operation: 'createMany',
      args: { data: [{ id: 'a' }, { id: 'b' }] },
      query: jest.fn(),
    });

    expect(canCreate).toHaveBeenCalledTimes(2);
  });

  it('records an insert naming another workspace', async () => {
    asUser();
    getACL.mockReturnValue({ canCreate: async () => true });
    const { hook } = build();

    await hook({
      model: 'Message',
      operation: 'create',
      args: { data: { id: 'm', workspaceId: OTHER_WS } },
      query: jest.fn(),
    });

    expect(tags()).toContain('[acl] create names a different workspace');
  });
});

describe('writes', () => {
  it('ANDs the mutate filter onto updateMany', async () => {
    asUser();
    getACL.mockReturnValue({ getMutateWhere: async () => ({ workspaceId: WS }) });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue({ count: 1 });

    await hook({ model: 'Message', operation: 'updateMany', args: { where: { id: 'm' }, data: {} }, query });

    expect(query).toHaveBeenCalledWith({
      where: { AND: [{ id: 'm' }, { workspaceId: WS }] },
      data: {},
    });
  });

  it('refuses a single update whose target is out of scope', async () => {
    asUser();
    getACL.mockReturnValue({ getMutateWhere: async () => ({ workspaceId: WS }) });
    const count = jest.fn().mockResolvedValue(0);
    const { hook } = build({ message: { count, findFirst: jest.fn() } });
    const query = jest.fn();

    await expect(
      hook({ model: 'Message', operation: 'update', args: { where: { id: 'm' }, data: {} }, query }),
    ).rejects.toThrow(/No Message found for the current workspace/);
    expect(query).not.toHaveBeenCalled();
    expect(tags()).toContain('[acl] blocked');
  });

  it('allows a single update whose target is in scope', async () => {
    asUser();
    getACL.mockReturnValue({ getMutateWhere: async () => ({ workspaceId: WS }) });
    const count = jest.fn().mockResolvedValue(1);
    const { hook } = build({ message: { count, findFirst: jest.fn() } });
    const query = jest.fn().mockResolvedValue({ id: 'm' });

    await hook({ model: 'Message', operation: 'update', args: { where: { id: 'm' }, data: {} }, query });

    expect(query).toHaveBeenCalled();
  });

  it('records an update moving a row between workspaces', async () => {
    asUser();
    getACL.mockReturnValue({ getMutateWhere: async () => ({ workspaceId: WS }) });
    const { hook } = build({ message: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn() } });

    await hook({
      model: 'Message',
      operation: 'update',
      args: { where: { id: 'm' }, data: { workspaceId: OTHER_WS } },
      query: jest.fn(),
    });

    expect(tags()).toContain('[acl] update reassigns workspaceId');
  });

  it('sees a reassignment expressed as { set }', async () => {
    asUser();
    getACL.mockReturnValue({ getMutateWhere: async () => ({ workspaceId: WS }) });
    const { hook } = build({ message: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn() } });

    await hook({
      model: 'Message',
      operation: 'update',
      args: { where: { id: 'm' }, data: { workspaceId: { set: OTHER_WS } } },
      query: jest.fn(),
    });

    expect(tags()).toContain('[acl] update reassigns workspaceId');
  });

  it('passes through unscoped when the table opts out of write scoping', async () => {
    asUser();
    getACL.mockReturnValue({ getMutateWhere: async () => ({}) });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue({ count: 0 });

    await hook({ model: 'Message', operation: 'updateMany', args: { where: { id: 'm' }, data: {} }, query });

    expect(query).toHaveBeenCalledWith({ where: { id: 'm' }, data: {} });
  });
});

describe('upsert, which is create or update', () => {
  it('refuses when the target exists in another workspace', async () => {
    asUser();
    getACL.mockReturnValue({ getMutateWhere: async () => ({ workspaceId: WS }), canCreate: async () => true });
    const count = jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1); // out of scope, but exists
    const { hook } = build({ message: { count, findFirst: jest.fn() } });
    const query = jest.fn();

    await expect(
      hook({
        model: 'Message',
        operation: 'upsert',
        args: { where: { id: 'm' }, create: { id: 'm' }, update: {} },
        query,
      }),
    ).rejects.toThrow(/No Message found for the current workspace/);
    expect(query).not.toHaveBeenCalled();
  });

  it('gates an inserting upsert through canCreate', async () => {
    asUser();
    const canCreate = jest.fn().mockResolvedValue(false);
    getACL.mockReturnValue({ getMutateWhere: async () => ({ workspaceId: WS }), canCreate });
    const count = jest.fn().mockResolvedValue(0); // not in scope, does not exist
    const { hook } = build({ message: { count, findFirst: jest.fn() } });

    await expect(
      hook({
        model: 'Message',
        operation: 'upsert',
        args: { where: { id: 'm' }, create: { id: 'm' }, update: {} },
        query: jest.fn(),
      }),
    ).rejects.toThrow(/Not authorized to create Message/);
    expect(canCreate).toHaveBeenCalledWith({ id: 'm' });
  });

  it('lets an in-scope upsert through without touching canCreate', async () => {
    asUser();
    const canCreate = jest.fn();
    getACL.mockReturnValue({ getMutateWhere: async () => ({ workspaceId: WS }), canCreate });
    const count = jest.fn().mockResolvedValue(1);
    const { hook } = build({ message: { count, findFirst: jest.fn() } });
    const query = jest.fn().mockResolvedValue({ id: 'm' });

    await hook({
      model: 'Message',
      operation: 'upsert',
      args: { where: { id: 'm' }, create: { id: 'm' }, update: {} },
      query,
    });

    expect(canCreate).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
  });
});

describe('service actors', () => {
  it('get plain workspace scope instead of the per-user clause', async () => {
    asUser();
    ctxState.isRequest = false; // acting for the workspace, not as the user
    const getWhereClause = jest.fn();
    getACL.mockReturnValue({ getWhereClause });
    const { hook } = build();
    const query = jest.fn().mockResolvedValue([]);

    await hook({ model: 'Message', operation: 'findMany', args: {}, query });

    expect(getWhereClause).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith({ where: { workspaceId: WS } });
  });
});
