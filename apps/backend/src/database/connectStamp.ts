/**
 * Slack Connect — connect-handle stamper (the "write-once" chokepoint).
 *
 * Every table in a channel's subtree carries its channel's connect_group handle in `channelConnectId`
 * (the root `channels` row keeps it in `connectId`). Instead of editing every insert site, the handle
 * is filled in the two places every insert already flows through:
 *   - Prisma writes (plain + interactive-transaction) → `withConnectStamp`
 *   - Zero writes                                     → `stampConnectIdForZero` (in wrapMutateWithACL)
 * Both resolve the value through ONE registry (`STAMP_TABLES`). Covering a table = one entry.
 *
 * The rule:
 *   - strong link: the row (or the parent it requires) always has a channel → always stamped.
 *   - weak link: the channel / parent FK is optional → stamped only when the link is present; a row with
 *     no channel stays NULL and keeps plain workspaceId truth.
 * Resolution is one hop: the row names a parent table + the FK holding the parent's id, and the
 * parent's handle column is copied down. Deeper chains (workflow_steps → workflow_executions →
 * workflows → tickets → channels) work hop by hop because each parent is itself stamped on write.
 *
 * The parent is read with one pk lookup per stamped row, on the SAME connection as the write (the
 * interactive-transaction client, or the Zero mutation's db transaction), so a parent created earlier
 * in the same transaction is visible. No cache: every lookup reads the parent's current value.
 *
 * Not covered here (by design): nested relation creates (`parent: { children: { create } }`) and raw
 * SQL — those few sites pass the handle explicitly; `$use` middlewares that write on the raw client copy
 * it from the parent result. Moving a row to another channel does not re-stamp its descendants.
 *
 * This file works on untyped rows, so tsc cannot catch a wrong column name here — the column names
 * below must match schema.prisma (and the Zero schema for Zero tables).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { schema as zeroSchema } from '@xyne/shared';
import { logger } from '@/utils/logger';

const CHANNEL_HANDLE = 'channelConnectId';

/**
 * One way to resolve a handle: walk to a row of `via` whose id is in the child's `field`, and copy the
 * parent's `from` column (default: `channels.connectId`, or the parent's own `channelConnectId`).
 * `when` restricts a strategy to some rows (polymorphic parents); `isCreate` lets it apply a column
 * default that a create may omit.
 */
type ParentStrategy = {
  via: string;
  field: string;
  from?: string;
  when?: (row: Record<string, unknown>, isCreate: boolean) => boolean;
};

/** A column this table carries + the strategies that fill it, tried in order (first value wins). */
type Stamp = { col: string; strategies: ParentStrategy[] };

const fromChannel = (field = 'channelId'): Stamp[] => [
  { col: CHANNEL_HANDLE, strategies: [{ via: 'channels', field }] },
];
const fromParent = (via: string, field: string): Stamp[] => [
  { col: CHANNEL_HANDLE, strategies: [{ via, field }] },
];
const externalEntity = (entityType: string, via: string): ParentStrategy => ({
  via,
  field: 'entityId',
  // `entityType` defaults to MESSAGE in the schema, so a create that omits it is a MESSAGE row.
  when: (row, isCreate) => row.entityType === entityType || (entityType === 'MESSAGE' && isCreate && row.entityType === undefined),
});

/** DB table (@@map) name → its stamped column(s). THE registry. */
const STAMP_TABLES: Record<string, Stamp[]> = {
  // ── channelId on the row ──────────────────────────────────────────────────────────────────────
  // strong (channelId required)
  channel_participants: fromChannel(),
  channel_stats: fromChannel(),
  channel_user_status: fromChannel(),
  conversations: fromChannel(),
  message_artifacts: fromChannel(),
  recurring_call_series: fromChannel(),
  draft_messages: fromChannel(),
  scheduled_messages: fromChannel(),
  delayed_messages: fromChannel(),
  links: fromChannel(),
  channel_recaps: fromChannel(),
  channel_daily_recaps: fromChannel(),
  tickets: fromChannel(),
  ticket_descriptions: fromChannel(),
  ticket_user_mailbox: fromChannel(),
  emails: fromChannel(),
  email_drafts: fromChannel(),
  email_channel_preferences: fromChannel(),
  conversation_labels: fromChannel(),
  conversation_label_mappings: fromChannel(),
  classification_mappings: fromChannel(),
  desk_auto_label_rule_references: fromChannel(),
  channel_board_mappings: fromChannel(),
  channel_published_tabs: fromChannel(),
  sdlc_entity_links: fromChannel(),
  release_events: fromChannel(),
  app_incoming_webhooks: fromChannel(),
  execution_items: fromChannel(),
  execution_thread_states: fromParent('conversations', 'conversationId'),
  execution_item_mutations: fromParent('conversations', 'conversationId'),
  execution_run_logs: fromParent('conversations', 'conversationId'),
  pr_thread_links: fromChannel(),
  radar_pr_links: fromChannel(),
  // weak (channelId optional → null when the row has no channel)
  conversation_participants: fromChannel(),
  calls: fromChannel(), // DM calls have no channel
  entity_access: fromChannel(),
  activities: fromChannel(),
  surface_nudge_counts: fromChannel(),
  canvases: fromChannel(), // the canvas's own `connectId` is minted by canvasService, not here
  canvas_participants: fromChannel(), // the participant row's OWN channel (the channel it is shared into)
  canvas_folders: fromChannel(),
  invitations: fromChannel(),
  external_sources: fromChannel(),
  repos: fromChannel(),
  collection_permissions: fromChannel(),
  applications: fromChannel(),

  // ── one hop via a required parent FK (strong when the parent is) ──────────────────────────────
  messages: fromParent('conversations', 'conversationId'),
  reactions: fromParent('messages', 'messageId'),
  reaction_counts: fromParent('messages', 'messageId'),
  proactive_nudges: fromParent('messages', 'messageId'),
  call_participants: fromParent('calls', 'callId'),
  call_recordings: fromParent('calls', 'callId'),
  call_messages: fromParent('calls', 'callId'),
  recurring_call_participants: fromParent('recurring_call_series', 'recurringSeriesId'),
  link_access: fromParent('links', 'linkId'),
  // ticket_activities walks the ticket, not its own channelId: that column is filled by a `$use`
  // middleware that runs AFTER this stamper.
  ticket_activities: fromParent('tickets', 'ticketId'),
  ticket_tags: fromParent('tickets', 'ticketId'),
  ticket_assignments: fromParent('tickets', 'ticketId'),
  ticket_entity_mappings: fromParent('tickets', 'ticketId'),
  ticket_stage_eta: fromParent('tickets', 'ticketId'),
  ticket_sub_ticket_mappings: fromParent('tickets', 'ticketId'),
  email_reads: fromParent('tickets', 'ticketId'),
  ticket_reference_mappings: fromParent('tickets', 'sourceTicketId'), // the source ticket owns the row
  ticket_tag_mappings: fromParent('tickets', 'ticketId'),
  ticket_stage_requests: fromParent('tickets', 'ticketId'),
  rcas: fromParent('tickets', 'ticketId'),
  impacts: fromParent('tickets', 'ticketId'),
  release_attributions: fromParent('tickets', 'ticketId'), // the newly reported issue's ticket
  application_release_tickets: fromParent('tickets', 'ticketId'), // the dev ticket
  coes: fromParent('rcas', 'rcaId'),
  release_changes: fromParent('tickets', 'releaseId'), // the release ticket
  release_change_types: fromParent('tickets', 'releaseId'), // the release ticket (optional)
  release_repositories: fromParent('tickets', 'releaseId'), // the release ticket
  // workflow tree — the root's ticket is optional, so the whole tree is weak
  workflow_executions: fromParent('workflows', 'workflowId'),
  workflow_execution_states: fromParent('workflow_executions', 'workflowExecutionId'),
  workflow_execution_users: fromParent('workflow_executions', 'workflowExecutionId'),
  workflow_knowledge: fromParent('workflow_executions', 'workflowExecutionId'),
  workflow_execution_locks: fromParent('workflow_executions', 'workflowExecutionId'),
  workflow_steps: fromParent('workflow_executions', 'workflowExecutionId'),
  external_step_responses: fromParent('workflow_executions', 'workflowExecutionId'),

  // ── one hop via an optional parent FK (weak) ──────────────────────────────────────────────────
  message_attachments: fromParent('conversations', 'conversationId'), // draft attachments have none yet
  workflows: fromParent('tickets', 'ticketId'),
  sub_tickets: fromParent('conversations', 'conversationId'), // re-stamped when the conversation changes
  pull_requests: [
    {
      col: CHANNEL_HANDLE,
      strategies: [
        { via: 'tickets', field: 'ticketId' },
        { via: 'workflow_executions', field: 'workflowExecutionId' },
      ],
    },
  ],
  // the polymorphic entity the row mirrors
  external_messages: [
    {
      col: CHANNEL_HANDLE,
      strategies: [
        externalEntity('MESSAGE', 'messages'),
        externalEntity('EMAIL', 'emails'),
        externalEntity('TICKET', 'tickets'),
        externalEntity('ATTACHMENT', 'message_attachments'),
        externalEntity('CANVAS', 'canvases'),
      ],
    },
  ],
  // artifactId IS the canvas id: carries both the canvas's own handle and the canvas's channel handle
  sdlc_artifacts: [
    { col: 'canvasConnectId', strategies: [{ via: 'canvases', field: 'artifactId', from: 'connectId' }] },
    { col: CHANNEL_HANDLE, strategies: [{ via: 'canvases', field: 'artifactId' }] },
  ],
  // sdlc_tracks: no FK to its channel — the track's creators pass the handle of the channel its
  // CHANNEL → TRACK membership edge is written for (same transaction).
};

/** The parent column a strategy copies: a channel's own handle, or any other parent's channel handle. */
const handleColumn = (strategy: ParentStrategy): string =>
  strategy.from ?? (strategy.via === 'channels' ? 'connectId' : CHANNEL_HANDLE);

// ── DMMF-derived model metadata ───────────────────────────────────────────────────────────────────
type ModelMeta = {
  model: string;
  delegate: string;
  idField: string;
  /** the id field's DB column name, for the raw Zero lookup */
  idColumn: string;
  /** scalar FK field → relation field name, for `relation: { connect: { … } }` writes */
  relationByFk: Record<string, string>;
};
const META_BY_TABLE = new Map<string, ModelMeta>();
const TABLE_BY_MODEL = new Map<string, string>();
for (const m of Prisma.dmmf.datamodel.models) {
  const table = m.dbName ?? m.name;
  TABLE_BY_MODEL.set(m.name, table);
  const relationByFk: Record<string, string> = {};
  for (const f of m.fields) {
    if (f.kind === 'object' && f.relationFromFields?.length === 1) relationByFk[f.relationFromFields[0]] = f.name;
  }
  const id = m.fields.find((f) => f.isId);
  META_BY_TABLE.set(table, {
    model: m.name,
    delegate: m.name.charAt(0).toLowerCase() + m.name.slice(1),
    idField: id?.name ?? 'id',
    idColumn: id?.dbName ?? id?.name ?? 'id',
    relationByFk,
  });
}

// ── parent lookups ────────────────────────────────────────────────────────────────────────────────
/** Reads one column of one parent row by id, on the connection the write runs on. */
type Lookup = (table: string, id: string, col: string) => Promise<unknown>;

/** Lookup through a Prisma client: the base client, or an interactive-transaction client. */
const prismaLookup =
  (client: unknown): Lookup =>
  async (table, id, col) => {
    const meta = META_BY_TABLE.get(table)!;
    const delegate = (client as Record<string, { findUnique: (a: unknown) => Promise<unknown> }>)[meta.delegate];
    const row = (await delegate.findUnique({ where: { [meta.idField]: id }, select: { [col]: true } })) as
      | Record<string, unknown>
      | null;
    return row?.[col];
  };

/** Zero server db transaction (node-pg): the subset this file uses. */
type ZeroDb = { query: (sql: string, args: unknown[]) => Promise<Iterable<Record<string, unknown>>> };

/** Lookup inside a Zero mutation's own db transaction. Table/column names come from the registry + DMMF. */
const zeroLookup =
  (db: ZeroDb): Lookup =>
  async (table, id, col) => {
    const meta = META_BY_TABLE.get(table)!;
    for (const row of await db.query(`SELECT "${col}" FROM "${table}" WHERE "${meta.idColumn}" = $1`, [id])) {
      return row[col];
    }
    return undefined;
  };

// Base (unextended) client for lookups on writes outside a transaction (their parent is already
// committed) — set once at client init. Using the base avoids re-entering the ACL/stamp extensions.
let base: PrismaClient | null = null;
export function setConnectStampBase(client: PrismaClient): void {
  base = client;
}
const baseLookup = (): Lookup | null => (base ? prismaLookup(base) : null);

/** A parent row's handle column, or null (no lookup available / not found / parent has no handle). */
async function parentHandle(lookup: Lookup | null, table: string, id: string, col: string): Promise<string | null> {
  if (!META_BY_TABLE.has(table)) return null;
  if (!lookup) {
    logger.warn('[CONNECT-STAMP] base client not set; skipping connect handle stamp');
    return null;
  }
  try {
    const handle = await lookup(table, id, col);
    return typeof handle === 'string' && handle ? handle : null;
  } catch (error) {
    // Inside a transaction a failed statement aborts it, so the write itself fails next; this log
    // carries the real cause.
    logger.error('[CONNECT-STAMP] parent handle lookup failed', { table, id, col, error });
    return null;
  }
}

/**
 * The parent id a write names for `strategy`: the scalar FK, or a Prisma relation write
 * `relation: { connect: { <parent id field>: … } }`. `null` = explicitly cleared, `undefined` = not named.
 */
function parentIdOf(childTable: string, strategy: ParentStrategy, row: Record<string, unknown>): string | null | undefined {
  const scalar = row[strategy.field];
  if (typeof scalar === 'string') return scalar || undefined;
  if (scalar === null) return null;
  const relation = META_BY_TABLE.get(childTable)?.relationByFk[strategy.field];
  const connect = relation ? (row[relation] as { connect?: Record<string, unknown> } | undefined)?.connect : undefined;
  const parentIdField = META_BY_TABLE.get(strategy.via)?.idField ?? 'id';
  const viaConnect = connect?.[parentIdField];
  return typeof viaConnect === 'string' && viaConnect ? viaConnect : undefined;
}

/**
 * Copy-on-write: return the row with its handle column(s) filled, or the same reference if nothing to
 * do. A column the caller already set is left alone. When a single-strategy table's FK is explicitly
 * cleared (e.g. a canvas moved out of its channel), the handle is cleared too, never left stale.
 */
async function stampRow(
  row: unknown,
  stamps: Stamp[],
  childTable: string,
  isCreate: boolean,
  lookup: Lookup | null,
): Promise<unknown> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  let r = row as Record<string, unknown>;
  let changed = false;
  for (const stamp of stamps) {
    if (r[stamp.col] !== undefined) continue;
    let value: string | null = null;
    let cleared = false;
    for (const strategy of stamp.strategies) {
      if (strategy.when && !strategy.when(r, isCreate)) continue;
      const parentId = parentIdOf(childTable, strategy, r);
      if (parentId === null) {
        cleared = stamp.strategies.length === 1;
        continue;
      }
      if (parentId === undefined) continue;
      value = await parentHandle(lookup, strategy.via, parentId, handleColumn(strategy));
      if (value) break;
    }
    if (value) {
      r = { ...r, [stamp.col]: value };
      changed = true;
    } else if (cleared) {
      r = { ...r, [stamp.col]: null };
      changed = true;
    }
  }
  return changed ? r : row;
}

/**
 * Stamp one object OR an array of objects (createMany), copy-on-write. Rows go one at a time: inside a
 * transaction every lookup shares the one connection anyway.
 */
async function stampData(
  data: unknown,
  stamps: Stamp[],
  childTable: string,
  isCreate: boolean,
  lookup: Lookup | null,
): Promise<unknown> {
  if (Array.isArray(data)) {
    const out: unknown[] = [];
    for (const row of data) out.push(await stampRow(row, stamps, childTable, isCreate, lookup));
    return out.some((v, i) => v !== data[i]) ? out : data;
  }
  return stampRow(data, stamps, childTable, isCreate, lookup);
}

const isWriteOp = (op: string): boolean =>
  op.startsWith('create') || op.startsWith('update') || op === 'upsert';

/**
 * Run a write op with the handle stamped. Covers create*, update* and upsert. Stamping is FK-driven — a
 * column is filled only when the payload names the parent and the column isn't set yet — so an UPDATE
 * that links a previously unlinked row (e.g. a draft attachment gaining its conversationId) gets
 * stamped, while updates that don't touch the FK are left alone.
 */
async function runWrite(
  table: string,
  stamps: Stamp[],
  op: string,
  args: unknown,
  exec: (a: unknown) => Promise<unknown>,
  lookup: Lookup | null,
): Promise<unknown> {
  let outArgs = args;
  const a = (args ?? {}) as Record<string, unknown>;
  if (op === 'upsert') {
    const create = await stampRow(a.create, stamps, table, true, lookup);
    const update = await stampRow(a.update, stamps, table, false, lookup);
    if (create !== a.create || update !== a.update) outArgs = { ...a, create, update };
  } else if ('data' in a) {
    // create / createMany / update / updateMany — all carry rows under `data`.
    const data = await stampData(a.data, stamps, table, op.startsWith('create'), lookup);
    if (data !== a.data) outArgs = { ...a, data };
  }
  return exec(outArgs);
}

/**
 * Wrap an interactive-transaction client so registered writes get stamped — the outer $extends query
 * hook does NOT fire inside `$transaction` (the ACL extension runs the callback on a tx client that only
 * carries the ACL extension), so we stamp here instead. Lookups run on this same tx client, so a parent
 * created earlier in the transaction is visible.
 */
function wrapTxWithConnectStamp(tx: unknown): unknown {
  const lookup = prismaLookup(tx);
  return new Proxy(tx as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !value || typeof value !== 'object') {
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      }
      const model = prop.charAt(0).toUpperCase() + prop.slice(1);
      const table = TABLE_BY_MODEL.get(model);
      const stamps = table ? STAMP_TABLES[table] : undefined;
      if (!stamps || !table) return value;
      // Wrap this model delegate's write ops.
      return new Proxy(value as Record<string, unknown>, {
        get(dTarget, op, dRecv) {
          const fn = Reflect.get(dTarget, op, dRecv);
          if (typeof fn !== 'function' || typeof op !== 'string') {
            return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown).bind(dTarget) : fn;
          }
          const call = fn as (...a: unknown[]) => Promise<unknown>;
          if (isWriteOp(op)) {
            return (args: unknown) => runWrite(table, stamps, op, args, (a) => call.call(dTarget, a), lookup);
          }
          return call.bind(dTarget);
        },
      });
    },
  });
}

/**
 * Prisma extension — stamp registered tables on create*, update* and upsert. Covers BOTH plain writes
 * (query hook; lookups on the base client, since the parent is already committed) and
 * interactive-transaction writes (a $transaction override that wraps the tx client). Leaves a
 * caller-provided handle untouched. Copy-on-write.
 */
export function withConnectStamp<T extends PrismaClient>(prisma: T): T {
  logger.info('[CONNECT-STAMP] withConnectStamp extension registered');
  const queryExtended = prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          const op: string = operation;
          if (!isWriteOp(op)) return query(args);
          const table = TABLE_BY_MODEL.get(model);
          const stamps = table ? STAMP_TABLES[table] : undefined;
          if (!stamps || !table) return query(args);
          return runWrite(table, stamps, op, args, (a) => query(a as typeof args), baseLookup());
        },
      },
    },
  });

  const runTransaction = queryExtended.$transaction.bind(queryExtended) as (...a: unknown[]) => unknown;
  return queryExtended.$extends({
    client: {
      $transaction(...args: unknown[]) {
        // Interactive form: wrap the tx client so registered writes inside it get stamped.
        if (typeof args[0] === 'function') {
          const fn = args[0] as (tx: unknown) => unknown;
          return runTransaction((tx: unknown) => fn(wrapTxWithConnectStamp(tx)), ...args.slice(1));
        }
        // Sequential/array form: no tx callback to wrap; each op still hits the query hook.
        return runTransaction(...args);
      },
    },
  }) as unknown as T;
}

// Zero's server CRUD rejects a column its schema doesn't declare, so on the Zero path a handle is only
// stamped into tables whose Zero schema carries that column.
const zeroTables = zeroSchema.tables as unknown as Record<string, { columns: Record<string, unknown> } | undefined>;
const zeroHasColumn = (table: string, col: string): boolean => !!zeroTables[table]?.columns[col];

/**
 * Zero side — fill the handle on an insert/upsert/update row for a registered table. Called from
 * `wrapMutateWithACL` (Zero mutators write via tx.mutate, bypassing the Prisma extension above) with the
 * mutation's transaction, whose db transaction the lookups run on — so a parent inserted earlier in the
 * same mutation (e.g. a conversation before its first message) is visible.
 * Returns the same reference when there is nothing to stamp.
 */
export async function stampConnectIdForZero(
  tableName: string,
  operation: string,
  args: unknown,
  tx: unknown,
): Promise<unknown> {
  const stamps = STAMP_TABLES[tableName];
  if (!stamps || (operation !== 'insert' && operation !== 'upsert' && operation !== 'update')) return args;
  const zeroStamps = stamps.filter((s) => {
    if (zeroHasColumn(tableName, s.col)) return true;
    logger.error('[CONNECT-STAMP] Zero schema is missing the handle column; not stamped', { table: tableName, col: s.col });
    return false;
  });
  if (!zeroStamps.length) return args;
  const db = (tx as { dbTransaction?: ZeroDb } | undefined)?.dbTransaction;
  if (!db) logger.warn('[CONNECT-STAMP] Zero transaction has no db transaction; looking up on the base client', { table: tableName });
  return stampRow(args, zeroStamps, tableName, operation !== 'update', db ? zeroLookup(db) : baseLookup());
}

/** Resolve a channel's connect handle — for the few writers that pass it explicitly (channel already exists). */
export async function channelConnectIdFor(channelId: string | null | undefined): Promise<string | null> {
  return channelId ? parentHandle(baseLookup(), 'channels', channelId, 'connectId') : null;
}
