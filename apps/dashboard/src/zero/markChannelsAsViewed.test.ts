import { describe, expect, it } from 'vitest';
import { mutators } from './mutators';

/**
 * Minimal in-memory Zero transaction: evaluates the simple ANDed `where`,
 * `orderBy`, `limit` and `.one()` shapes these mutators use, and records writes.
 */
type Row = Record<string, unknown>;
type Condition =
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] }
  | { type: 'simple'; op: string; left: { name: string }; right: { value: unknown } };

const PRIMARY_KEY: Record<string, string> = {
  messages: 'messageId',
  conversations: 'conversationId',
};

const matches = (row: Row, cond: Condition | undefined): boolean => {
  if (!cond) return true;
  if (cond.type === 'and') return cond.conditions.every(c => matches(row, c));
  if (cond.type === 'or') return cond.conditions.some(c => matches(row, c));
  const value = row[cond.left.name];
  const target = cond.right.value;
  switch (cond.op) {
    case '=':
      return value === target;
    case 'IS':
      return (value ?? null) === target;
    case 'IN':
      return (target as unknown[]).includes(value);
    case '<=':
      return (value as number) <= (target as number);
    default:
      throw new Error(`fake tx: unsupported op ${cond.op}`);
  }
};

type FakeQuery = {
  ast: { table: string; where?: Condition; orderBy?: [string, 'asc' | 'desc'][]; limit?: number };
  format?: { singular?: boolean };
};

const createFakeTx = (
  tables: Record<string, Row[]>,
): { tx: unknown; writes: { table: string; op: string; row: Row }[] } => {
  const writes: { table: string; op: string; row: Row }[] = [];
  const tx = {
    location: 'client',
    run: (query: FakeQuery): Promise<Row | Row[] | undefined> => {
      const { table, where, orderBy, limit } = query.ast;
      let rows = (tables[table] ?? []).filter(r => matches(r, where));
      for (const [col, dir] of [...(orderBy ?? [])].reverse()) {
        rows = [...rows].sort((a, b) =>
          dir === 'asc'
            ? (a[col] as number) - (b[col] as number)
            : (b[col] as number) - (a[col] as number),
        );
      }
      if (limit !== undefined) rows = rows.slice(0, limit);
      return Promise.resolve(query.format?.singular ? rows[0] : rows);
    },
    mutate: new Proxy(
      {},
      {
        get: (_t, table: string) => {
          const key = PRIMARY_KEY[table] ?? 'id';
          const write =
            (op: string) =>
            (row: Row): Promise<void> => {
              writes.push({ table, op, row });
              const rows = (tables[table] ??= []);
              const existing = rows.find(r => r[key] === row[key]);
              if (op === 'delete') {
                tables[table] = rows.filter(r => r !== existing);
              } else if (existing) {
                Object.assign(existing, row);
              } else {
                rows.push({ ...row });
              }
              return Promise.resolve();
            };
          return {
            update: write('update'),
            upsert: write('upsert'),
            insert: write('insert'),
            delete: write('delete'),
          };
        },
      },
    ),
  };
  return { tx, writes };
};

const USER = 'u1';
const ctx = { userID: USER, workspaceId: 'w1' };

const status = (channelId: string, extra: Row = {}): Row => ({
  id: `cus-${channelId}`,
  channelId,
  userId: USER,
  isDeleted: false,
  lastViewedAt: 1,
  unreadCount: 4,
  ...extra,
});

const seedChannel = (tables: Record<string, Row[]>, channelId: string): void => {
  const msg = `m-${channelId}`;
  const conv = `c-${channelId}`;
  tables.messages!.push({ messageId: msg, conversationId: conv });
  tables.conversations!.push({
    conversationId: conv,
    channelId,
    initialMessageId: msg,
    createdAt: 50,
  });
  tables.activities!.push({
    id: `a-${channelId}`,
    userId: USER,
    channelId,
    isRead: false,
    actionSourceId: msg,
  });
};

const baseTables = (): Record<string, Row[]> => ({
  channel_user_status: [],
  messages: [],
  conversations: [],
  activities: [],
  draft_messages: [],
});

type MutatorFn = (opts: { tx: unknown; ctx: unknown; args: unknown }) => Promise<void>;
const run = (mutator: unknown, tx: unknown, args: unknown): Promise<void> =>
  (mutator as { fn: MutatorFn }).fn({ tx, ctx, args });

describe('channel.markChannelsAsViewed', () => {
  it('clears unread state and root activities for every channel in one call', async () => {
    const tables = baseTables();
    for (const id of ['ch1', 'ch2', 'ch3']) {
      tables.channel_user_status!.push(status(id));
      seedChannel(tables, id);
    }
    const { tx } = createFakeTx(tables);

    await run(mutators.channel.markChannelsAsViewed, tx, {
      channelIds: ['ch1', 'ch2', 'ch3'],
      timestamp: 1000,
    });

    for (const row of tables.channel_user_status!) {
      expect(row).toMatchObject({ lastViewedAt: 1000, unreadCount: 0, updatedAt: 1000 });
    }
    expect(tables.activities!.every(a => a.isRead === true)).toBe(true);
  });

  it('skips channels the user is no longer in instead of failing the call', async () => {
    const tables = baseTables();
    tables.channel_user_status!.push(status('member'), status('left', { isDeleted: true }));
    const { tx } = createFakeTx(tables);

    await expect(
      run(mutators.channel.markChannelsAsViewed, tx, {
        channelIds: ['member', 'left', 'never-joined'],
        timestamp: 1000,
      }),
    ).resolves.toBeUndefined();

    expect(tables.channel_user_status!.find(r => r.channelId === 'member')).toMatchObject({
      unreadCount: 0,
    });
    expect(tables.channel_user_status!.find(r => r.channelId === 'left')).toMatchObject({
      unreadCount: 4,
      lastViewedAt: 1,
    });
  });

  it('never touches drafts', async () => {
    const tables = baseTables();
    tables.channel_user_status!.push(status('ch1'));
    tables.draft_messages!.push({
      id: 'd1',
      channelId: 'ch1',
      userId: USER,
      conversationId: null,
      content: '',
      hasAttachment: false,
      origin: null,
    });
    const { tx, writes } = createFakeTx(tables);

    await run(mutators.channel.markChannelsAsViewed, tx, { channelIds: ['ch1'], timestamp: 1000 });

    expect(writes.some(w => w.table === 'draft_messages')).toBe(false);
    expect(tables.draft_messages).toHaveLength(1);
  });

  it('leaves thread-reply activities unread', async () => {
    const tables = baseTables();
    tables.channel_user_status!.push(status('ch1'));
    tables.messages!.push({ messageId: 'reply', conversationId: 'thread' });
    tables.conversations!.push({
      conversationId: 'thread',
      channelId: 'ch1',
      initialMessageId: 'root',
      createdAt: 50,
    });
    tables.activities!.push({
      id: 'a-reply',
      userId: USER,
      channelId: 'ch1',
      isRead: false,
      actionSourceId: 'reply',
    });
    const { tx } = createFakeTx(tables);

    await run(mutators.channel.markChannelsAsViewed, tx, { channelIds: ['ch1'], timestamp: 1000 });

    expect(tables.activities![0]).toMatchObject({ isRead: false });
  });

  it('rejects more channels than one call allows', async () => {
    const { tx } = createFakeTx(baseTables());
    await expect(
      run(mutators.channel.markChannelsAsViewed, tx, {
        channelIds: Array.from({ length: 26 }, (_, i) => `ch${i}`),
        timestamp: 1000,
      }),
    ).rejects.toThrow();
  });
});

describe('channel.markChannelAsViewed (single, refactored onto the shared helpers)', () => {
  it('still clears one channel and throws for a non-member', async () => {
    const tables = baseTables();
    tables.channel_user_status!.push(status('ch1'));
    seedChannel(tables, 'ch1');
    const { tx } = createFakeTx(tables);

    await run(mutators.channel.markChannelAsViewed, tx, { channelId: 'ch1', timestamp: 1000 });
    expect(tables.channel_user_status![0]).toMatchObject({ unreadCount: 0, lastViewedAt: 1000 });
    expect(tables.activities![0]).toMatchObject({ isRead: true });

    await expect(
      run(mutators.channel.markChannelAsViewed, tx, { channelId: 'nope', timestamp: 1000 }),
    ).rejects.toThrow('Not a channel participant');
  });

  it('still deletes an empty channel draft when draft args are passed', async () => {
    const tables = baseTables();
    tables.channel_user_status!.push(status('ch1'));
    tables.draft_messages!.push({
      id: 'd1',
      channelId: 'ch1',
      userId: USER,
      conversationId: null,
      content: '',
      hasAttachment: false,
      origin: null,
    });
    const { tx } = createFakeTx(tables);

    await run(mutators.channel.markChannelAsViewed, tx, {
      channelId: 'ch1',
      timestamp: 1000,
      draftMessageId: 'new',
      draftMessage: '',
    });
    expect(tables.draft_messages).toHaveLength(0);
  });
});
