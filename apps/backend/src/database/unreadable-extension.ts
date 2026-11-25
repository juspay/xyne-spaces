import { Prisma, type PrismaClient } from '@prisma/client';
import { UnreadableString, reveal } from '@xyne/shared';
import type { DerivedSpec, FieldDerived } from '@xyne/shared';
import { UNREADABLE_COLUMNS } from '@/zero/unreadableColumns';
import { deriveRowFacts } from '@/zero/unreadableTransaction';
import { isInUnreadableScope } from '@/services/encryption/unreadableScope';

type UnreadableTable = keyof typeof UNREADABLE_COLUMNS;

/**
 * The Prisma model of each table in UNREADABLE_COLUMNS, the one list of unreadable columns
 * (Zero's; its column names are the Prisma field names). A table added there without its
 * model here is a compile error.
 */
const MODEL_OF_TABLE = {
  canvas_comment_threads: 'CanvasCommentThread',
  canvas_comments: 'CanvasComment',
  canvases: 'Canvas',
  channel_user_status: 'ChannelUserStatus',
  channels: 'Channel',
  coes: 'COE',
  collections: 'Collection',
  dashboards: 'Dashboard',
  delayed_messages: 'DelayedMessage',
  draft_messages: 'DraftMessage',
  email_drafts: 'EmailDraft',
  email_channel_preferences: 'EmailChannelPreference',
  email_signatures: 'EmailSignature',
  impacts: 'Impact',
  links: 'Link',
  message_artifacts: 'MessageArtifact',
  message_attachments: 'MessageAttachment',
  messages: 'Message',
  rcas: 'RCA',
  roles: 'Role',
  sdlc_tracks: 'SdlcTrack',
  sub_tickets: 'SubTicket',
  ticket_descriptions: 'TicketDescription',
  tickets: 'Ticket',
  user_presence: 'UserPresence',
  users: 'User',
  workspaces: 'Workspace',
} as const satisfies { readonly [T in UnreadableTable]: Prisma.ModelName };

type UnreadableModel = (typeof MODEL_OF_TABLE)[UnreadableTable];

/** The table of model `M`. */
type TableOf<M> = { [T in UnreadableTable]: (typeof MODEL_OF_TABLE)[T] extends M ? T : never }[UnreadableTable];

/** The unreadable fields of model `M`; `never` for a model with none. */
type UnreadableField<M> = (typeof UNREADABLE_COLUMNS)[TableOf<M>][number];

/** The table of each model in MODEL_OF_TABLE. */
const TABLE_OF_MODEL = Object.fromEntries(
  (Object.keys(MODEL_OF_TABLE) as UnreadableTable[]).map(table => [MODEL_OF_TABLE[table], table]),
) as Record<UnreadableModel, UnreadableTable>;

/** Per Prisma model, its unreadable fields. */
const FIELDS_OF_MODEL: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  (Object.keys(MODEL_OF_TABLE) as UnreadableTable[]).map(table => [MODEL_OF_TABLE[table], UNREADABLE_COLUMNS[table]]),
);

/** The unreadable fields of a model at runtime; empty for a model with none. */
function unreadableFieldsOf(model: string | undefined): readonly string[] {
  return (model && FIELDS_OF_MODEL[model]) || [];
}

type Scalars<M extends Prisma.ModelName> = Prisma.TypeMap['model'][M]['payload']['scalars'];

/** The stored type of field `F` of model `M`. */
type ScalarOf<M extends Prisma.ModelName, F> = Scalars<M>[F & keyof Scalars<M>];

type Unreadable<V> = UnreadableString | Extract<V, null | undefined>;

/** The `result` component: each unreadable field computed from itself, as `UnreadableString`. */
type UnreadableResultConfig = {
  [M in UnreadableModel as Uncapitalize<M>]: {
    [F in UnreadableField<M>]: {
      needs: { [K in F]: true };
      compute: (row: { [K in F]: ScalarOf<M, K> }) => Unreadable<ScalarOf<M, F>>;
    };
  };
};

function wrap(value: unknown): unknown {
  return typeof value === 'string' ? UnreadableString.make(value) : value;
}

function buildResultConfig(): UnreadableResultConfig {
  const result: Record<string, Record<string, { needs: Record<string, true>; compute: (row: Record<string, unknown>) => unknown }>> = {};
  for (const [model, fields] of Object.entries(FIELDS_OF_MODEL)) {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    result[key] = Object.fromEntries(
      fields.map(field => [field, { needs: { [field]: true }, compute: (row: Record<string, unknown>) => wrap(row[field]) }]),
    );
  }
  return result as unknown as UnreadableResultConfig;
}

const WRITE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert']);

/** Where inside `value` an `UnreadableString` sits, if anywhere. */
function unreadablePath(value: unknown, path: string, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  if (value instanceof UnreadableString) return path;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const found = unreadablePath(child, `${path}.${key}`, seen);
    if (found) return found;
  }
  return undefined;
}

/**
 * One write payload (`data`, or upsert's `create` / `update`) with its top-level unreadable
 * fields unwrapped, so a value read through `unreadableDb` can be stored again as it is.
 * Anywhere else an `UnreadableString` would be stored as its toJSON ("<redacted>"): refused.
 */
function unwrapPayload(model: string, payload: unknown, path: string): unknown {
  if (Array.isArray(payload)) return payload.map((row, index) => unwrapPayload(model, row, `${path}[${index}]`));
  if (!payload || typeof payload !== 'object') return payload;
  const fields = unreadableFieldsOf(model);
  let unwrapped: Record<string, unknown> | undefined;
  for (const [field, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value instanceof UnreadableString) {
      if (!fields.includes(field)) {
        throw new Error(`${model}.${field} is not an unreadable field; it cannot be written from an UnreadableString`);
      }
      unwrapped ??= { ...(payload as Record<string, unknown>) };
      unwrapped[field] = reveal(value);
      continue;
    }
    const nested = unreadablePath(value, `${path}.${field}`);
    if (nested) throw new Error(`${nested} is an UnreadableString inside a nested value; it cannot be stored there`);
  }
  return unwrapped ?? payload;
}

/** `args` with the write payloads unwrapped; an `UnreadableString` anywhere else (a filter) is refused. */
function unwrapArgs(model: string, operation: string, args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const record = args as Record<string, unknown>;
  const payloadKeys = !WRITE_OPERATIONS.has(operation) ? [] : operation === 'upsert' ? ['create', 'update'] : ['data'];
  let next: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(record)) {
    if (payloadKeys.includes(key)) {
      const unwrapped = unwrapPayload(model, value, `${model}.${operation}.${key}`);
      if (unwrapped !== value) {
        next ??= { ...record };
        next[key] = unwrapped;
      }
      continue;
    }
    const nested = unreadablePath(value, `${model}.${operation}.${key}`);
    if (nested) throw new Error(`${nested} is an UnreadableString; filter on facts or ids, not on unreadable text`);
  }
  return next ?? args;
}

/** Throws when `what` runs outside an unreadable scope (a request of an encryptedRoute route). */
function assertInScope(what: string): void {
  if (!isInUnreadableScope()) {
    throw new Error(`${what} outside an unreadable route; mount encryptedRoute(contract) on the route`);
  }
}

/**
 * Writes, on the main client (`db`), so every repository's `this.db.<model>.create(...)` takes
 * an `UnreadableString` for a field in UNREADABLE_COLUMNS and stores the value it holds:
 * the REST counterpart of `unwrapForWrite` in zero/unreadableTransaction.ts. An
 * `UnreadableString` anywhere else in the arguments (another field, a nested write, a filter)
 * is refused rather than stored or compared as "<redacted>".
 *
 * Only inside an unreadable scope, the one place an `UnreadableString` can come from (the
 * route's body, or a read through `unreadableDb`); every other query goes straight through.
 *
 * A `$use` middleware, not a query extension, and installed before every other middleware:
 * Prisma deep-copies a query's arguments after the middlewares and before the first query
 * extension, which turns an `UnreadableString` (its value is held outside the object) into
 * `{}`. Only a middleware still sees it, so the encryption extension gets the value it holds.
 */
export function installUnreadableWrites(client: PrismaClient): void {
  client.$use(async (params, next) => {
    if (!params.model || !isInUnreadableScope()) return next(params);
    const args = unwrapArgs(params.model, params.action, params.args);
    return next(args === params.args ? params : { ...params, args });
  });
}

/**
 * Reads, for `unreadableDb` only: every read returns the fields in UNREADABLE_COLUMNS as
 * `UnreadableString`, including on rows reached through `include` / `select` of a relation and
 * on rows a write returns. Opt-in per route: a query through it outside an unreadable scope
 * throws, so only the routes moved to unreadable values read this way; the rest of the backend
 * keeps reading text through `db` until it moves.
 *
 * Raw SQL queries bypass it: they return plain values.
 */
export const unreadableReadsExtension = Prisma.defineExtension({
  name: 'unreadable-reads',
  result: buildResultConfig(),
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        assertInScope(`unreadableDb.${model}.${operation}`);
        return query(args);
      },
    },
  },
});

/** `client` with unreadable reads (see `unreadableReadsExtension`); extends the ACL-wrapped client, so scoping still applies. */
export function withUnreadableReads(client: PrismaClient) {
  return client.$extends(unreadableReadsExtension);
}

/** The client `unreadableDb` is: Prisma's, with the unreadable fields typed as `UnreadableString`. */
export type UnreadableDb = ReturnType<typeof withUnreadableReads>;

/**
 * An unreadable value typed as the string a Prisma write argument declares, for a write
 * through `db` or `unreadableDb`: `installUnreadableWrites` unwraps it before the
 * query, so the code writing it never reads it. Only for a field in UNREADABLE_COLUMNS
 * (anything else is refused), and only inside an unreadable scope (outside one nothing would
 * unwrap it, so it throws here instead of storing "<redacted>").
 */
export function unreadableWriteValue(value: UnreadableString): string {
  assertInScope('unreadableWriteValue');
  return value as unknown as string;
}

/**
 * The facts a readWithFacts asks for, per unreadable field of model `M`, in the same form as a
 * contract's `sourceToDerived`: `{ content: { textIsEmpty: derive.textIsEmpty } }`.
 */
export type ReadFactsSpec<M extends UnreadableModel> = { readonly [F in UnreadableField<M>]?: DerivedSpec };

/** One row read with readWithFacts: the row as `unreadableDb` returned it and, per field, the facts asked for. */
type RowWithFacts<R, S> = { row: R; facts: { [F in keyof S]?: FieldDerived<S, F> } };

/** `row`'s stored values of `fields`, which the wrapping holds: read at this layer's edge, as tx.read does. */
function storedValues(row: unknown, fields: string[]): Record<string, unknown> {
  const record = (row ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    fields.map(field => {
      const value = record[field];
      return [field, value instanceof UnreadableString ? reveal(value) : value];
    }),
  );
}

/**
 * `tx.read` for the Prisma layer: the rows of `read`, a query on `unreadableDb` (so their
 * unreadable fields are `UnreadableString`), each with the facts `spec` asks for from those
 * fields' stored values, derived as tx.read derives them (deriveRowFacts: the encryption service
 * with DB encryption on, extracted here with it off). A field's facts are absent when it is null.
 * Facts are a step of their own because Prisma computes result fields synchronously: the
 * wrapping cannot call the encryption service.
 *
 *   const read = await readWithFacts('Message', unreadableDb.message.findUnique({ where }),
 *     { content: { forwardedHasOptionalText: derive.forwardedHasOptionalText } }, workspaceId);
 */
export async function readWithFacts<M extends UnreadableModel, R, const S extends ReadFactsSpec<M>>(
  model: M,
  read: Promise<R>,
  spec: S,
  workspaceId: string,
): Promise<R extends null | undefined ? R : R extends readonly (infer E)[] ? RowWithFacts<E, S>[] : RowWithFacts<R, S>> {
  const result: unknown = await read;
  if (result === null || result === undefined) return result as never;
  const rows: unknown[] = Array.isArray(result) ? result : [result];
  const stored = rows.map(row => storedValues(row, Object.keys(spec)));
  const facts = await deriveRowFacts(TABLE_OF_MODEL[model], stored, spec, workspaceId);
  const withFacts = rows.map((row, index) => ({ row, facts: facts[index] }));
  return (Array.isArray(result) ? withFacts : withFacts[0]) as never;
}
