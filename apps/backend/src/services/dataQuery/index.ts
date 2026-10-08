import type { Prisma } from '@prisma/client';
import type { AnyCustomQuery } from '@rocicorp/zero';
import { defineQuery, schema, type Context } from '@xyne/shared';
import { z } from 'zod';
import { config } from '@/config/env';
import { ACLFactory } from '@/database/acl';
import { readReplicaDb } from '@/database/client';
import { isWorkspaceScopedModel } from '@/database/tenant/acl-extension';
import { MAX_WHERE_DEPTH, WhereInputSchema } from '@/services/pythonQuery';
import { zql } from '@/zero/queries';
import { compileQueryDefinition, dbProvider, executeQueryDefinition, replicaDbProvider } from '@/zero/server';
import { aggregateSql, innerSelect, runSql, toNumbers } from './aggregate';

// SDK data query (`POST /api/sdk/v1/data/query`): one table, under that table's read ACL.
// Zero tables use the Zero ACL; other tables must be in PRISMA_TABLES.

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const alias = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
/** min/max per group, optionally filtered by equality / IN. */
const MeasuresSchema = z
  .record(alias, z.object({ column: z.string().min(1), where: z.record(z.string(), z.union([scalar, z.array(scalar).max(100)])).optional() }).strict())
  .optional();

export const DataQuerySchema = z
  .object({
    table: z.string().min(1),
    operation: z.enum(['findMany', 'count', 'groupBy']).default('findMany'),
    where: WhereInputSchema,
    select: z.array(z.string().min(1)).max(100).optional(),
    orderBy: z.array(z.object({ by: z.string().min(1), dir: z.enum(['asc', 'desc']).default('asc') })).max(3).optional(),
    limit: z.number().int().positive().max(1000).default(100),
    by: z
      .array(
        z.union([
          z.string().min(1),
          z
            .object({
              column: z.string().min(1),
              bucket: z.enum(['hour', 'day', 'week', 'month']),
              timezone: z.string().regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/).default('UTC'),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(3)
      .optional(),
    min: MeasuresSchema,
    max: MeasuresSchema,
  })
  .strict()
  .superRefine((q, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (q.operation === 'groupBy' && !q.by) fail('groupBy needs `by`.');
    if (q.operation !== 'groupBy' && (q.by || q.min || q.max)) fail('`by`, `min` and `max` are only for groupBy.');
    if (q.operation !== 'findMany' && q.select) fail('`select` is only for findMany.');
  });
export type DataQuery = z.infer<typeof DataQuerySchema>;
export type DataQueryResult = { rows: Record<string, unknown>[] } | { count: number } | { groups: Record<string, unknown>[] };
type Where = Record<string, unknown>;

export class DataQueryError extends Error {
  constructor(
    message: string,
    readonly code: 'validation_failed' | 'forbidden' = 'validation_failed',
  ) {
    super(message);
    this.name = 'DataQueryError';
  }
}

/** Readable Prisma tables: safe columns only; rows are kept if the parent passes its ACL. */
const PRISMA_TABLES: Record<string, { columns: string[]; parent: { column: string; table: string } }> = {
  workflowExecution: {
    columns: ['id', 'workflowId', 'workflowType', 'status', 'mode', 'tag', 'parentWorkflowExecutionId', 'createdBy', 'createdAt', 'updatedAt', 'ignoreDuration'],
    parent: { column: 'workflowId', table: 'workflows' },
  },
  workflowStep: {
    columns: ['id', 'workflowExecutionId', 'stepExecutorType', 'stepSubType', 'stepName', 'type', 'previousStepId', 'status', 'createdAt', 'updatedAt'],
    parent: { column: 'workflowExecutionId', table: 'workflowExecution' },
  },
  tag: {
    columns: ['id', 'sourceId', 'sourceType', 'configKey', 'tagCategory', 'tag', 'method', 'isDeleted', 'createdAt'],
    parent: { column: 'sourceId', table: 'emails' },
  },
};

type Table =
  | { acl: 'zero'; name: string; columns: string[] }
  | { acl: 'prisma'; name: Uncapitalize<Prisma.ModelName>; columns: string[]; parent: { column: string; table: string } };

export function resolveTable(name: string): Table {
  const zeroTable = (schema.tables as Record<string, { columns: Record<string, unknown> }>)[name];
  if (zeroTable) return { acl: 'zero', name, columns: Object.keys(zeroTable.columns) };
  const listed = PRISMA_TABLES[name];
  if (listed) return { acl: 'prisma', name: name as Uncapitalize<Prisma.ModelName>, ...listed };
  throw new DataQueryError(`Unknown table "${name}".`);
}

function checkColumn(table: Table, column: string): void {
  if (!table.columns.includes(column)) throw new DataQueryError(`Unknown column "${column}" on "${table.name}".`);
}

/** Event tables: row reads need a time range of at most MAX_RANGE_DAYS on this column. */
const TIME_LIMITED: Record<string, string> = {
  ticket_activities: 'timestamp',
  messages: 'createdAt',
  emails: 'createdAt',
  conversations: 'createdAt',
  workflowExecution: 'createdAt',
  workflowStep: 'createdAt',
};
const MAX_RANGE_DAYS = 90;

const toMs = (v: unknown): number | null => {
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

export function checkTimeRange(table: Table, where: Where | undefined): void {
  const column = TIME_LIMITED[table.name];
  if (!column) return;
  const range = where?.[column];
  const from = range && typeof range === 'object' ? toMs((range as Where).gte ?? (range as Where).gt) : null;
  if (from === null) {
    throw new DataQueryError(`"${table.name}" needs a time range: where.${column} with gte (epoch ms or ISO date), up to ${MAX_RANGE_DAYS} days.`);
  }
  const to = toMs((range as Where).lte ?? (range as Where).lt) ?? Date.now();
  if (to - from > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new DataQueryError(`"${table.name}" queries are limited to ${MAX_RANGE_DAYS} days; narrow where.${column}.`);
  }
}

const zeroColumnType = (table: string, column: string): string | undefined =>
  (schema.tables as Record<string, { columns: Record<string, { type: string }> }>)[table]?.columns[column]?.type;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Zero stores timestamps as epoch ms: accept ISO strings, reject other strings. */
function toZeroNumber(column: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const ms = ISO_DATE.test(value) ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw new DataQueryError(`"${column}" expects a number (timestamps: epoch ms or ISO date).`);
  return ms;
}

type Scalar = string | number | boolean;
const isScalar = (v: unknown): v is Scalar => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isObject = (v: unknown): v is Where => typeof v === 'object' && v !== null && !Array.isArray(v);
const MAX_LIST = 1000;

/** Accepted value shapes, and how they're described in errors. */
const VALUES = {
  value: { accepts: isScalar, describe: 'a single value' },
  nullable: { accepts: (v: unknown) => v === null || isScalar(v), describe: 'a single value' },
  list: { accepts: (v: unknown) => Array.isArray(v) && v.length <= MAX_LIST && v.every(isScalar), describe: `a list of up to ${MAX_LIST} values` },
  text: { accepts: (v: unknown) => typeof v === 'string', describe: 'a string' },
};

interface Operator {
  value: keyof typeof VALUES;
  zql: string;
  nullZql?: string;
  /** ZQL operator with mode: 'insensitive'. */
  insensitive?: string;
  /** LIKE pattern; like Prisma, `%` and `_` in the value aren't escaped. */
  pattern?: (s: string) => string;
  /** An empty list: matches nothing (`in`) or everything (`notIn`). */
  emptyMatches?: boolean;
}

/** Supported operators (Prisma names); validation and ZQL translation both come from here. */
const OPERATORS: Record<string, Operator> = {
  equals: { value: 'nullable', zql: '=', nullZql: 'IS', insensitive: 'ILIKE' },
  not: { value: 'nullable', zql: '!=', nullZql: 'IS NOT' },
  lt: { value: 'value', zql: '<' },
  lte: { value: 'value', zql: '<=' },
  gt: { value: 'value', zql: '>' },
  gte: { value: 'value', zql: '>=' },
  in: { value: 'list', zql: 'IN', emptyMatches: false },
  notIn: { value: 'list', zql: 'NOT IN', emptyMatches: true },
  contains: { value: 'text', zql: 'LIKE', insensitive: 'ILIKE', pattern: (s) => `%${s}%` },
  startsWith: { value: 'text', zql: 'LIKE', insensitive: 'ILIKE', pattern: (s) => `${s}%` },
  endsWith: { value: 'text', zql: 'LIKE', insensitive: 'ILIKE', pattern: (s) => `%${s}` },
};
const INSENSITIVE_OPS = Object.keys(OPERATORS).filter((op) => OPERATORS[op]!.insensitive);

/** Validates the filter (only this table's columns, known operators and values) and returns it normalised. */
export function checkWhere(table: Table, where: Where, depth = 0): Where {
  if (depth > MAX_WHERE_DEPTH) throw new DataQueryError('Filter is nested too deeply.');
  const out: Where = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      const parts = [value].flat();
      if (!parts.every(isObject)) throw new DataQueryError(`${key} takes filter objects.`);
      if (key === 'OR' && parts.length === 0) throw new DataQueryError('OR needs at least one condition.');
      const checked = parts.map((part) => checkWhere(table, part, depth + 1));
      out[key] = Array.isArray(value) ? checked : checked[0];
      continue;
    }
    // Anything that isn't a column of this table would be a relation filter.
    checkColumn(table, key);
    const numeric = table.acl === 'zero' && zeroColumnType(table.name, key) === 'number';
    const fix = (v: unknown) => (numeric ? toZeroNumber(key, v) : v);
    const bad = (why: string) => new DataQueryError(`"${key}": ${why}`);

    if (!isObject(value)) {
      if (!VALUES.nullable.accepts(value)) throw bad('expected a value or an operator object.');
      out[key] = fix(value);
      continue;
    }
    const { mode, ...ops } = value;
    if (Object.keys(ops).length === 0) throw bad('empty operator object.');
    if (mode !== undefined && mode !== 'insensitive' && mode !== 'default') throw bad('mode is "insensitive" or "default".');
    const result: Where = mode === undefined ? {} : { mode };
    for (const [op, v] of Object.entries(ops)) {
      const spec = OPERATORS[op];
      if (!spec) throw bad(`unsupported operator "${op}".`);
      if (!VALUES[spec.value].accepts(v)) throw bad(`${op} takes ${VALUES[spec.value].describe}.`);
      if (mode === 'insensitive' && !spec.insensitive) throw bad(`mode "insensitive" works only with ${INSENSITIVE_OPS.join(', ')}.`);
      result[op] = Array.isArray(v) ? v.map(fix) : fix(v);
    }
    out[key] = result;
  }
  return out;
}

export async function runDataQuery(request: DataQuery, ctx: Context): Promise<DataQueryResult> {
  const table = resolveTable(request.table);
  const query = { ...request, where: request.where && checkWhere(table, request.where) };
  if (query.operation !== 'findMany') return aggregateZero(table, query, ctx);
  checkTimeRange(table, query.where);

  query.select?.forEach((c) => checkColumn(table, c));
  query.orderBy?.forEach((o) => checkColumn(table, o.by));
  return { rows: await read(table, query, query.select ?? table.columns, ctx) };
}

function read(table: Table, query: DataQuery, select: string[], ctx: Context): Promise<Where[]> {
  return table.acl === 'zero' ? readZero(table.name, query, select, ctx) : readPrisma(table, query, select, ctx);
}

// ── Zero tables: Zero ACL ─────────────────────────────────────────────────────

/** `defineQuery` adds the table's Zero ACL. */
function zeroDefinition(name: string, where: Where | undefined, extend: (q: any) => any = (q) => q) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return defineQuery(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table chosen at runtime
    let q = (zql as any)[name];
    if (where) q = q.where((eb: ExprBuilder) => toZql(where, eb));
    return extend(q);
  }) as unknown as AnyCustomQuery;
}

function readProvider() {
  const provider = replicaDbProvider ?? (config.sdk.allowPrimaryForReads ? dbProvider : null);
  if (!provider) throw new Error('Read replica is not configured.');
  return provider;
}

async function readZero(name: string, query: DataQuery, select: string[], ctx: Context) {
  const definition = zeroDefinition(name, query.where, (q) => {
    for (const o of query.orderBy ?? []) q = q.orderBy(o.by, o.dir);
    return q.limit(query.limit);
  });
  const rows = (await executeQueryDefinition(definition, `dataQuery:${name}`, {}, ctx, readProvider())) as Where[];
  return rows.map((row) => Object.fromEntries(select.map((c) => [c, row[c]])));
}

/** count / groupBy, run by Postgres on the replica. */
async function aggregateZero(table: Table, query: DataQuery, ctx: Context): Promise<DataQueryResult> {
  if (table.acl !== 'zero') {
    // The parent check runs after the query, so SQL can't aggregate these.
    throw new DataQueryError(`count and groupBy are only available on Zero tables, not "${table.name}".`);
  }
  const type = (c: string) => zeroColumnType(table.name, c);

  const keys = (query.by ?? []).map((b) => (typeof b === 'string' ? b : b.column));
  keys.forEach((c) => checkColumn(table, c));
  for (const b of query.by ?? []) {
    if (typeof b !== 'string' && type(b.column) !== 'number') throw new DataQueryError(`"${b.column}" is not a timestamp column.`);
  }
  const measures = { ...query.min, ...query.max };
  for (const [alias, m] of Object.entries(measures)) {
    if (keys.includes(alias) || alias === '_count') throw new DataQueryError(`"${alias}" clashes with a groupBy key.`);
    checkColumn(table, m.column);
    Object.keys(m.where ?? {}).forEach((c) => checkColumn(table, c));
  }
  const outputs = new Set([...keys, '_count', ...Object.keys(measures)]);
  for (const o of query.orderBy ?? []) {
    if (!outputs.has(o.by)) throw new DataQueryError(`orderBy "${o.by}" must be a groupBy key, _count, or a min/max name.`);
  }

  const compiled = await compileQueryDefinition(zeroDefinition(table.name, query.where), `dataQuery:${table.name}`, {}, ctx);
  const sql = aggregateSql(innerSelect(compiled.text), compiled.values, { ...query, operation: query.operation as 'count' | 'groupBy' });
  const rows = await runSql(readProvider(), sql.text, sql.values);

  if (query.operation === 'count') return { count: Number(rows[0]?._count ?? 0) };
  const numeric = [
    '_count',
    ...keys.filter((c) => type(c) === 'number'),
    ...Object.entries(measures).filter(([, m]) => type(m.column) === 'number').map(([a]) => a),
  ];
  return { groups: rows.map((r) => toNumbers(r, numeric)) };
}

export interface ExprBuilder {
  cmp(field: string, op: string, value: unknown): unknown;
  and(...conds: unknown[]): unknown;
  or(...conds: unknown[]): unknown;
  not(cond: unknown): unknown;
}

/** Prisma-style filter (already validated by checkWhere) → ZQL. */
export function toZql(where: Where, eb: ExprBuilder): unknown {
  const parts = Object.entries(where).map(([key, value]) => {
    const items = [value].flat() as Where[];
    if (key === 'AND') return eb.and(...items.map((w) => toZql(w, eb)));
    if (key === 'OR') return eb.or(...items.map((w) => toZql(w, eb)));
    if (key === 'NOT') return eb.and(...items.map((w) => eb.not(toZql(w, eb))));

    const { mode, ...ops } = isObject(value) ? value : { equals: value };
    const conds = Object.entries(ops).map(([op, v]) => {
      const spec = OPERATORS[op]!;
      if (v === null) return eb.cmp(key, spec.nullZql!, null);
      // ZQL rejects an empty IN list.
      if (Array.isArray(v) && v.length === 0) {
        return spec.emptyMatches ? eb.and() : eb.and(eb.cmp(key, 'IS', null), eb.cmp(key, 'IS NOT', null));
      }
      const zqlOp = mode === 'insensitive' && spec.insensitive ? spec.insensitive : spec.zql;
      return eb.cmp(key, zqlOp, spec.pattern ? spec.pattern(String(v)) : v);
    });
    return conds.length === 1 ? conds[0] : eb.and(...conds);
  });
  return eb.and(...parts);
}

// ── Listed Prisma tables: Prisma ACL + parent's ACL ───────────────────────────

async function readPrisma(table: Extract<Table, { acl: 'prisma' }>, query: DataQuery, select: string[], ctx: Context) {
  if (!readReplicaDb) throw new Error('Read replica is not configured.');
  const acl = ACLFactory.getACL(
    table.name,
    { userId: ctx.userID, workspaceId: ctx.workspaceId, memberId: ctx.memberId, orgRole: ctx.orgRole, role: ctx.role },
    readReplicaDb,
  );
  const where = await acl.applyToWhere(query.where);
  const { column, table: parentTable } = table.parent;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- model chosen at runtime
  const rows: Where[] = await (readReplicaDb as any)[table.name].findMany({
    // Workspace backstop, as in /api/query/claw.
    where: isWorkspaceScopedModel(table.name) ? { AND: [where, { workspaceId: ctx.workspaceId }] } : where,
    select: Object.fromEntries([...select, column].map((c) => [c, true])),
    orderBy: query.orderBy?.map((o) => ({ [o.by]: o.dir })),
    take: query.limit,
  });

  // Keep rows whose parent the user can see.
  const parentIds = [...new Set(rows.map((r) => r[column]).filter((id): id is string => typeof id === 'string'))];
  const visible = parentIds.length
    ? new Set(
        (await read(resolveTable(parentTable), { table: parentTable, operation: 'findMany', where: { id: { in: parentIds } }, limit: parentIds.length }, ['id'], ctx)).map(
          (p) => p.id,
        ),
      )
    : new Set();
  return rows.filter((r) => visible.has(r[column])).map((r) => Object.fromEntries(select.map((c) => [c, r[c]])));
}
