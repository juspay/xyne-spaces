/**
 * Insertion stamper — a Prisma client extension that fills `workspaceId` from the
 * request context onto every NEW row a write produces, wherever that row appears:
 *   - top-level `create` / `createMany` / `createManyAndReturn` (+ future create*),
 *   - `upsert`'s create branch (its insert half),
 *   - nested relation creates carried inside ANY of the above, or inside an
 *     `update` / `upsert.update` payload (`data.<rel>.create` / `.createMany.data` /
 *     `.connectOrCreate.create` / nested `upsert.create`), at any depth.
 * Each row is stamped against its OWN model.
 *
 * It NEVER stamps a row that is being UPDATED (the top-level `update`/`updateMany`
 * data, or an `upsert`/nested-`update` update branch) — rewriting a live row's
 * tenant key could move it across tenants. Those payloads are only recursed for
 * nested creates.
 *
 * Best-effort and non-breaking: a row is stamped ONLY when
 *   - its model has a scalar `workspaceId` column (DMMF-derived), and
 *   - a tenant context is open with a workspaceId, and
 *   - the caller hasn't already set `workspaceId` or a `workspace` relation
 *     (so we never produce the scalar-plus-relation conflict Prisma rejects).
 * No context / no column / caller-provided value → left untouched, never throws.
 * Copy-on-write throughout — the caller's args/data objects are never mutated.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { currentWorkspaceId } from './context';
import { logger } from '@/utils/logger';

// ── schema-derived lookups, built once at startup ────────────────────────────

/** Model names that have a scalar `workspaceId` column — the only ones we stamp. */
const STAMPABLE = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((f) => f.name === 'workspaceId' && f.kind === 'scalar'))
    .map((model) => model.name),
);

/** One relation field of a model: its name, the model it points to, and to-one vs to-many. */
type Relation = { field: string; child: string; isList: boolean };

/** Every model's relation fields — used to walk into nested relation writes. */
const RELATIONS = new Map<string, readonly Relation[]>(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    model.fields
      .filter((f) => f.kind === 'object')
      .map((f) => ({ field: f.name, child: f.type, isList: f.isList === true })),
  ]),
);

/**
 * Insert sites that rely on the stamper rather than passing workspaceId explicitly,
 * deduped by `model:op`. Prisma types workspaceId as required, so entries here come from
 * dynamically built payloads.
 */
const stamped = new Set<string>();

// ── small helpers ────────────────────────────────────────────────────────────

/** A write payload object (create data, update data, or a nested sub-object). */
type Row = Record<string, unknown>;

/**
 * A plain (non-array) object. Arrays are excluded deliberately: a Row is spread with
 * `{ ...row, workspaceId }`, and spreading an array would yield a malformed
 * `{ 0: …, 1: …, workspaceId }` instead of stamping its elements. Callers that legitimately
 * accept "one object OR an array" must go through `stampObjectOrArray`, which handles both.
 */
function isObject(v: unknown): v is Row {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** True when every element of `after` is the same reference as `before` (nothing was replaced). */
function unchanged(after: readonly unknown[], before: readonly unknown[]): boolean {
  return after.length === before.length && after.every((v, i) => v === before[i]);
}

/**
 * Apply `stamp` to a value that is either one object or an array of objects.
 * Returns the original reference when nothing changed, so callers can skip copying.
 */
function stampObjectOrArray(value: unknown, stamp: (row: Row) => Row): unknown {
  if (Array.isArray(value)) {
    const result = value.map((v) => (isObject(v) ? stamp(v) : v));
    return unchanged(result, value) ? value : result;
  }
  return isObject(value) ? stamp(value) : value;
}

/**
 * Return a COPY of `row` with `workspaceId` added — we never mutate the caller's object,
 * because a caller may reuse the same data object across requests, and an in-place stamp
 * would carry one request's workspaceId into another's write.
 *
 * Leaves the row untouched when the caller already set `workspaceId` (any value, including
 * an explicit `null` for a deliberate cross-workspace row) or set a `workspace` relation
 * (setting the scalar too would trigger Prisma's scalar-plus-relation conflict).
 */
function addWorkspaceId(
  row: Row,
  workspaceId: string,
  model: string,
  op: string,
): Row {
  if (row.workspaceId !== undefined || 'workspace' in row) return row;
  const key = `${model}:${op}`;
  if (!stamped.has(key) && stamped.size < 500) {
    stamped.add(key);
    logger.warn(`[STAMP] filled a missing workspaceId — caller should pass it explicitly`, {
      model,
      op,
    });
  }
  return { ...row, workspaceId };
}

/** Return a copy of `entry` with `entry[key]` stamped; the original reference if unchanged. */
function stampField(entry: Row, key: string, stamp: (row: Row) => Row): Row {
  const sub = entry[key];
  if (!isObject(sub)) return entry;
  const stamped = stamp(sub);
  return stamped === sub ? entry : { ...entry, [key]: stamped };
}

// ── recursive stamping ───────────────────────────────────────────────────────

/** Every occurrence: a repeat is itself the signal, and the count decides when to enforce. */
function logForeignWorkspace(
  model: string,
  op: string,
  given: string,
  ws: string,
  refused: boolean,
): void {
  logger.warn('[acl] create names a different workspace', {
    model,
    operation: op,
    given,
    enforced: ws,
    refused,
  });
}

/**
 * Stamp one write payload for `model`.
 *  - isInsert=true  → the row is being INSERTED: add its own workspaceId (if stampable),
 *                     then recurse into its nested relation writes.
 *  - isInsert=false → the row is being UPDATED: leave its own key alone (never move a live
 *                     row across tenants), but still recurse into nested writes — which may
 *                     themselves insert new rows.
 * Copy-on-write: returns `row` unchanged (same reference) when nothing needed stamping.
 */
function stampPayload(
  model: string,
  row: Row,
  ws: string,
  isInsert: boolean,
  op: string,
  rejectForeignWorkspace: boolean,
): Row {
  if (!isObject(row)) return row;

  let out: Row = row;
  const copyBeforeEdit = (): void => {
    if (out === row) out = { ...row };
  };

  // A payload naming another workspace. Reported every time in both positions: refused when
  // the switch is on, corrected to the enforced workspace when it is off — so the boundary
  // holds either way, and the log says how much is relying on the correction.
  if (STAMPABLE.has(model)) {
    const given = row.workspaceId;
    if (typeof given === 'string' && given !== ws) {
      logForeignWorkspace(model, op, given, ws, rejectForeignWorkspace);
      if (rejectForeignWorkspace) {
        throw new Error(
          `Cannot write ${model} for a different workspace inside a scoped transaction`,
        );
      }
      copyBeforeEdit();
      out.workspaceId = ws;
    }
    const relation = row.workspace;
    if (isObject(relation)) {
      const connect = relation.connect;
      if (isObject(connect) && typeof connect.id === 'string' && connect.id !== ws) {
        logForeignWorkspace(model, op, connect.id, ws, rejectForeignWorkspace);
        if (rejectForeignWorkspace) {
          throw new Error(
            `Cannot connect ${model} to a different workspace inside a scoped transaction`,
          );
        }
        copyBeforeEdit();
        out.workspace = { ...relation, connect: { ...connect, id: ws } };
      }
    }
  }

  if (isInsert && STAMPABLE.has(model)) {
    // Fills only when absent, so a value corrected above is left alone.
    out = addWorkspaceId(out, ws, model, op);
  }

  for (const { field, child, isList } of RELATIONS.get(model) ?? []) {
    const nestedWrite = row[field];
    if (!isObject(nestedWrite)) continue;

    const stamped = stampNestedWrite(child, isList, nestedWrite, ws, op, rejectForeignWorkspace);
    if (stamped !== nestedWrite) {
      copyBeforeEdit();
      out[field] = stamped;
    }
  }
  return out;
}

/**
 * Stamp a nested relation write whose target model is `child`. Only the branches that
 * INSERT new rows are stamped — create / createMany.data / connectOrCreate.create /
 * upsert.create. The branches that touch existing rows (upsert.update, update) are
 * recursed for their own nested creates but never self-stamped. `isList` tells us the
 * shape of `update` (to-one vs to-many). Copy-on-write.
 */
function stampNestedWrite(
  child: string,
  isList: boolean,
  write: Row,
  ws: string,
  op: string,
  rejectForeignWorkspace: boolean,
): Row {
  let out = write;
  const replace = (key: string, value: unknown): void => {
    if (value === write[key]) return;
    if (out === write) out = { ...write };
    out[key] = value;
  };
  const asInsert = (row: Row): Row =>
    stampPayload(child, row, ws, true, op, rejectForeignWorkspace);
  const asUpdate = (row: Row): Row =>
    stampPayload(child, row, ws, false, op, rejectForeignWorkspace);

  // create: {…} | [{…}]  → new row(s)
  if ('create' in write) replace('create', stampObjectOrArray(write.create, asInsert));

  // createMany: { data: [{…}] }  → new rows
  const createMany = write.createMany;
  if (isObject(createMany) && Array.isArray(createMany.data)) {
    const rows: unknown[] = createMany.data;
    const data = rows.map((row) => (isObject(row) ? asInsert(row) : row));
    if (!unchanged(data, rows)) replace('createMany', { ...createMany, data });
  }

  // connectOrCreate: { where, create }  → only `create` inserts
  if ('connectOrCreate' in write)
    replace('connectOrCreate', stampObjectOrArray(write.connectOrCreate, (entry) => stampField(entry, 'create', asInsert)));

  // upsert: { where?, create, update }  → create inserts, update recurses only
  if ('upsert' in write)
    replace('upsert', stampObjectOrArray(write.upsert, (entry) => stampField(stampField(entry, 'create', asInsert), 'update', asUpdate)));

  // update: to-many → [{ where, data }] | { where, data } (recurse `data`);
  //         to-one  → the update data itself.
  // NB: guard on `typeof`, not `isObject`, because the to-many form is legitimately an ARRAY
  // (isObject excludes arrays); `stampObjectOrArray` then handles array-or-single.
  const update = write.update;
  if ('update' in write && update && typeof update === 'object')
    replace('update', isList ? stampObjectOrArray(update, (entry) => stampField(entry, 'data', asUpdate)) : asUpdate(update as Row));

  // NOTE: `updateMany` is intentionally NOT recursed. Prisma types its payload as
  // `XUpdateManyMutationInput` — scalar fields only, no nested relation writes — so it can
  // never carry a create to stamp. (`createMany` IS handled above because it does insert.)

  return out;
}

// ── the extension ────────────────────────────────────────────────────────────

function isWriteOp(op: string): boolean {
  return op.startsWith('create') || op.startsWith('update') || op === 'upsert';
}

/**
 * Apply the workspace stamper to one Prisma operation.
 *
 * Kept separate from the client extension so the interactive-transaction guard can apply
 * exactly the same top-level and nested-create rules to Prisma's transaction client. Prisma
 * does not return the outer extended client to an interactive transaction callback.
 */
export function stampArgsForWorkspace(
  model: string,
  operation: string,
  args: unknown,
  workspaceId: string,
  rejectForeignWorkspace = false,
): unknown {
  if (!isWriteOp(operation) || !isObject(args)) return args;

  // create* → every row in `data` is a new insert (plus its nested creates).
  if (operation.startsWith('create')) {
    const data = stampObjectOrArray(args.data, (row) =>
      stampPayload(model, row, workspaceId, true, operation, rejectForeignWorkspace),
    );
    return data === args.data ? args : { ...args, data };
  }

  // upsert → `create` inserts (self + nested); `update` touches an existing row
  // and therefore only its nested creates are stamped.
  if (operation === 'upsert') {
    const create = isObject(args.create)
      ? stampPayload(model, args.create, workspaceId, true, operation, rejectForeignWorkspace)
      : args.create;
    const update = isObject(args.update)
      ? stampPayload(model, args.update, workspaceId, false, operation, rejectForeignWorkspace)
      : args.update;
    return create === args.create && update === args.update
      ? args
      : { ...args, create, update };
  }

  // update* → do not stamp the existing row; only stamp nested creates.
  const data = isObject(args.data)
    ? stampPayload(model, args.data, workspaceId, false, operation, rejectForeignWorkspace)
    : args.data;
  return data === args.data ? args : { ...args, data };
}

/** Wrap a Prisma client so every write stamps workspaceId onto the rows it inserts, from context. */
export function withWorkspaceStamp<T extends PrismaClient>(prisma: T): T {
  logger.info('[STAMP] withWorkspaceStamp extension, registered');
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          // Prisma types `operation` without the write-creating ops, so widen to string to compare.
          const op: string = operation;
          const ws = isWriteOp(op) ? currentWorkspaceId() : null;
          if (!ws) return query(args); // reads/deletes, or no tenant context → untouched

          const stamped = stampArgsForWorkspace(model, op, args, ws);
          return stamped === args ? query(args) : query(stamped as typeof args);
        },
      },
    },
  }) as unknown as T;
}
