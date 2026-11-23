import { Prisma, type PrismaClient } from '@prisma/client';
import { UnreadableString, reveal, runExtractors } from '@xyne/shared';
import type { DerivedSpec, ExtractorName, FieldDerived, FieldFacts } from '@xyne/shared';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';
import { UNREADABLE_FIELDS, type UnreadableField, type UnreadableModel, unreadableFieldsOf } from './unreadableFields';

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
  for (const [model, fields] of Object.entries(UNREADABLE_FIELDS)) {
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

/**
 * The Prisma counterpart of zero/unreadableTransaction.ts, for `unreadableDb`:
 *
 * - every read returns the fields in UNREADABLE_FIELDS as `UnreadableString`, including on
 *   rows reached through `include` / `select` of a relation and on rows a write returns;
 * - a write takes an `UnreadableString` for those fields and stores the value it holds;
 * - an `UnreadableString` anywhere else in the arguments (another field, a nested write, a
 *   filter) is refused rather than stored or compared as "<redacted>".
 *
 * Raw SQL queries bypass it: they return plain values.
 */
export const unreadableExtension = Prisma.defineExtension({
  name: 'unreadable-fields',
  result: buildResultConfig(),
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        return query(unwrapArgs(model, operation, args) as typeof args);
      },
    },
  },
});

/** The facts a read asks for, per unreadable field of model `M`: `{ content: { textIsEmpty: derive.textIsEmpty } }`. */
export type FieldFactsSpec<M> = { readonly [F in UnreadableField<M>]?: DerivedSpec };

/** `S`, with any key that is not an unreadable field of `M` a compile error. */
type OnlyUnreadableFields<M, S> = S & { readonly [K in Exclude<keyof S, UnreadableField<M>>]: never };

/** Per row (in order), per field, the facts asked for. A field's facts are absent when it is null or not selected. */
export type RowFacts<S> = { [F in keyof S]?: FieldDerived<S, F> };

/**
 * The facts `spec` asks for from rows read through `unreadableDb`, so a handler decides on
 * facts instead of the text (the Prisma counterpart of `tx.read`). With DB encryption on, one
 * encryption-service call for all of them (a value may be workspace-DEK ciphertext); off,
 * extracted here from the plaintext. This module is where the values are revealed for it.
 */
export async function readFacts<M extends UnreadableModel, const S extends FieldFactsSpec<M>>(
  model: M,
  rows: readonly object[],
  spec: OnlyUnreadableFields<M, S>,
  workspaceId: string,
): Promise<RowFacts<S>[]> {
  const fields = unreadableFieldsOf(model);
  const wanted: [string, ExtractorName[]][] = [];
  for (const [field, derived] of Object.entries(spec as Record<string, DerivedSpec | undefined>)) {
    if (!fields.includes(field)) throw new Error(`readFacts: ${model}.${field} is not an unreadable field`);
    const names = Object.values(derived ?? {}).flatMap(d => (d ? [d.name] : []));
    if (names.length > 0) wanted.push([field, names]);
  }

  const items: { row: number; field: string; value: string; derive: ExtractorName[] }[] = [];
  rows.forEach((row, index) => {
    for (const [field, names] of wanted) {
      const value = (row as Record<string, unknown>)[field];
      if (value instanceof UnreadableString) items.push({ row: index, field, value: reveal(value), derive: names });
      else if (typeof value === 'string') items.push({ row: index, field, value, derive: names });
    }
  });

  const facts: Record<string, FieldFacts>[] = rows.map(() => ({}));
  if (items.length === 0) return facts as RowFacts<S>[];

  let results: FieldFacts[];
  if (config.enc.enableDbEncryption) {
    results = await getEncryptionProvider().deriveFacts({
      items: items.map(({ value, derive }) => ({ value, derive })),
      entityId: workspaceId,
      entityType: 'WORKSPACE',
    });
    if (results.length !== items.length) {
      throw new Error('readFacts: the encryption service returned facts for a different number of values');
    }
  } else {
    results = items.map(({ field, value, derive }) => {
      if (value.startsWith('ENC:')) throw new Error(`readFacts: ${model}.${field} is ciphertext and DB encryption is off`);
      return runExtractors(value, derive);
    });
  }
  logger.info(`[unreadableDb] ${model}: derived facts extracted via ${config.enc.enableDbEncryption ? 'encryption-service' : 'local'}`);

  items.forEach(({ row, field }, index) => {
    facts[row][field] = results[index];
  });
  return facts as RowFacts<S>[];
}

/** `client` with unreadable fields (see `unreadableExtension`); extends the ACL-wrapped client, so scoping still applies. */
export function withUnreadableFields(client: PrismaClient) {
  return client.$extends(unreadableExtension);
}

/** The client `unreadableDb` is: Prisma's, with the unreadable fields typed as `UnreadableString`. */
export type UnreadableDb = ReturnType<typeof withUnreadableFields>;
