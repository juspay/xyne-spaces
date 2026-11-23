import type {
  DefaultSchema,
  DefaultWrappedTransaction,
  DeleteID,
  HumanReadable,
  InsertValue,
  Query,
  RunOptions,
  Transaction,
  UpdateValue,
  UpsertValue,
} from '@rocicorp/zero';
import { UnreadableString, reveal, runExtractors } from '@xyne/shared';
import type { DerivedSpec, ExtractorName, FieldDerived, FieldFacts } from '@xyne/shared';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';
import { type UnreadableColumn, unreadableColumnsOf } from './unreadableColumns';
import { recordFactsDerived, recordFactsError, recordUnreadableWrapped } from './zeroMetrics';

type Tx = Transaction<DefaultSchema, DefaultWrappedTransaction>;
type TableName = keyof DefaultSchema['tables'] & string;

type Unreadable<V> = UnreadableString | Extract<V, null | undefined>;

/** Row `R` of table `T` with its unreadable columns as `UnreadableString`. */
type UnreadableRow<T, R> = { [K in keyof R]: K extends UnreadableColumn<T> ? Unreadable<R[K]> : R[K] };

/** What `run` returns for table `T`: an array of rows, or one row or `undefined` for `.one()`. */
export type UnreadableResult<T, R> = R extends undefined
  ? R
  : R extends readonly (infer E)[]
    ? UnreadableRow<T, E>[]
    : UnreadableRow<T, R>;

/**
 * The facts a `tx.read` asks for, per unreadable column of table `T`, in the same form as a
 * contract's `sourceToDerived`: `{ content: { textIsEmpty: derive.textIsEmpty } }`.
 */
export type ReadFactsSpec<T> = { readonly [C in UnreadableColumn<T>]?: DerivedSpec };

/** `S`, with any key that is not an unreadable column of `T` a compile error. */
type OnlyUnreadableColumns<T, S> = S & { readonly [K in Exclude<keyof S, UnreadableColumn<T>>]: never };

/**
 * One row read with `tx.read`: the row (unreadable columns wrapped) and, per column, the facts
 * asked for. A column's facts are absent when it is null.
 */
type RowWithFacts<T, R, S> = { row: UnreadableRow<T, R>; facts: { [C in keyof S]?: FieldDerived<S, C> } };

/** What `tx.read` returns: like `run`, with each row as `{ row, facts }`. */
export type ReadResult<T, R, S> = R extends undefined
  ? R
  : R extends readonly (infer E)[]
    ? RowWithFacts<T, E, S>[]
    : RowWithFacts<T, R, S>;

/** A write's value for table `T`: its unreadable columns also take `UnreadableString`. */
type AcceptUnreadable<T, V> = { [K in keyof V]: K extends UnreadableColumn<T> ? V[K] | UnreadableString : V[K] };

/** `tx.mutate` where the unreadable columns can be written as they were read or received. */
type UnreadableMutate = {
  [T in TableName]: {
    insert(value: AcceptUnreadable<T, InsertValue<DefaultSchema['tables'][T]>>): Promise<void>;
    upsert(value: AcceptUnreadable<T, UpsertValue<DefaultSchema['tables'][T]>>): Promise<void>;
    update(value: AcceptUnreadable<T, UpdateValue<DefaultSchema['tables'][T]>>): Promise<void>;
    delete(id: DeleteID<DefaultSchema['tables'][T]>): Promise<void>;
  };
};

/**
 * The transaction a mutator defined with defineContractMutator gets: the same as Zero's,
 * except
 *
 * - `run` returns the table's unreadable columns (UNREADABLE_COLUMNS) as `UnreadableString`;
 * - `read(query, facts)` does the same and also returns the facts asked for from those
 *   columns, so the body decides on facts instead of the text;
 * - `mutate` takes an `UnreadableString` for those columns and stores the value it holds;
 * - the deprecated `tx.query`, which would read them plainly, is not there;
 * - a query whose `.related()` reaches a table with unreadable columns is refused: those
 *   nested rows would come back plain. Read that table with its own `tx.read` / `tx.run`.
 */
export type UnreadableTransaction = Tx extends infer X
  ? X extends unknown
    ? Omit<X, 'run' | 'query' | 'mutate'> & {
        mutate: UnreadableMutate;
        run<TTable extends TableName, TReturn>(
          query: Query<TTable, DefaultSchema, TReturn>,
          options?: RunOptions,
        ): Promise<UnreadableResult<TTable, HumanReadable<TReturn>>>;
        read<TTable extends TableName, TReturn, const S extends ReadFactsSpec<TTable>>(
          query: Query<TTable, DefaultSchema, TReturn>,
          facts: OnlyUnreadableColumns<TTable, S>,
          options?: RunOptions,
        ): Promise<ReadResult<TTable, HumanReadable<TReturn>, S>>;
      }
    : never
  : never;

/** A helper that both defineContractMutator and plain mutators call takes either transaction. */
export type AnyTransaction = Tx | UnreadableTransaction;

/** Wraps `row`'s unreadable columns; adds each column it wrapped to `wrappedColumns`. */
function wrapRow(table: string, columns: readonly string[], row: unknown, wrappedColumns: string[]): unknown {
  if (!row || typeof row !== 'object') return row;
  const record = row as Record<string, unknown>;
  for (const [column, value] of Object.entries(record)) {
    // Ciphertext in a column not listed: the list is behind the database. Fail here, not
    // later where the value would be used as text.
    if (typeof value === 'string' && value.startsWith('ENC:') && !columns.includes(column)) {
      throw new Error(`${table}.${column} holds ciphertext but is not in UNREADABLE_COLUMNS`);
    }
  }
  if (columns.length === 0) return row;
  const wrapped = { ...record };
  for (const column of columns) {
    const value = wrapped[column];
    if (value !== undefined && value !== null) {
      wrapped[column] = UnreadableString.make(value as string);
      wrappedColumns.push(column);
    }
  }
  return wrapped;
}

type QueryAst = { table: string; related?: readonly { subquery: QueryAst }[] };

/** Throws if `.related()` anywhere in the query reaches a table with unreadable columns. */
function assertNoUnreadableRelated(ast: QueryAst): void {
  for (const { subquery } of ast.related ?? []) {
    if (unreadableColumnsOf(subquery.table).length > 0) {
      throw new Error(
        `${ast.table}.related(...) reaches ${subquery.table}, which has unreadable columns; ` +
          `read ${subquery.table} with its own tx.read / tx.run instead`,
      );
    }
    assertNoUnreadableRelated(subquery);
  }
}

/** Logs that a read got its derived facts and where they came from. */
type FactsSource = 'local' | 'encryption-service';

function logDerivedFacts(table: string, source: FactsSource): void {
  logger.info(`[unreadableTransaction] ${table}: derived facts extracted via ${source}`);
}

/**
 * A write's value with each `UnreadableString` replaced by the value it holds, right before it
 * goes to the database. This module is the one place that unwraps one. An `UnreadableString`
 * in a column that is not unreadable, or nested inside any value (a JSON column), would store
 * the value where it is not expected: refused.
 */
/** Where inside `value` (a nested object or array) an `UnreadableString` sits, if anywhere. */
function nestedUnreadablePath(value: unknown, path: string, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  if (value instanceof UnreadableString) return path;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const found = nestedUnreadablePath(child, `${path}.${key}`, seen);
    if (found) return found;
  }
  return undefined;
}

function unwrapForWrite(table: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const columns = unreadableColumnsOf(table);
  let unwrapped: Record<string, unknown> | undefined;
  for (const [column, field] of Object.entries(value as Record<string, unknown>)) {
    if (!(field instanceof UnreadableString)) {
      // Inside a JSON column it would be stored as its toJSON ("<redacted>"), silently.
      const nested = nestedUnreadablePath(field, `${table}.${column}`);
      if (nested) throw new Error(`${nested} is an UnreadableString inside a value; it cannot be stored there`);
      continue;
    }
    if (!columns.includes(column)) {
      throw new Error(`${table}.${column} is not an unreadable column; it cannot be written from an UnreadableString`);
    }
    unwrapped ??= { ...(value as Record<string, unknown>) };
    unwrapped[column] = reveal(field);
  }
  return unwrapped ?? value;
}

/** `tx.mutate` that unwraps unreadable values on insert / upsert / update (see unwrapForWrite). */
function unreadableMutate(mutate: Tx['mutate']): UnreadableMutate {
  return new Proxy(mutate, {
    get(target, table, receiver) {
      const ops = Reflect.get(target, table, receiver) as Record<string, unknown> | undefined;
      if (typeof table !== 'string' || !ops || typeof ops !== 'object') return ops;
      return new Proxy(ops, {
        get(opsTarget, op, opsReceiver) {
          const fn = Reflect.get(opsTarget, op, opsReceiver);
          if (typeof fn !== 'function') return fn;
          if (op === 'insert' || op === 'upsert' || op === 'update') {
            return (value: unknown) => fn.call(opsTarget, unwrapForWrite(table, value));
          }
          return fn.bind(opsTarget);
        },
      });
    },
  }) as unknown as UnreadableMutate;
}

/**
 * The facts `spec` asks for, for each row, from the stored values (before they are wrapped).
 * With DB encryption on, one encryption-service call for all of them (a value may be
 * workspace-DEK ciphertext); off, extracted here from the plaintext.
 */
async function deriveRowFacts(
  table: string,
  rows: unknown[],
  spec: Record<string, DerivedSpec | undefined>,
  workspaceId: string,
): Promise<Record<string, FieldFacts>[]> {
  const columns = unreadableColumnsOf(table);
  const wanted: [string, ExtractorName[]][] = [];
  for (const [column, derived] of Object.entries(spec)) {
    if (!columns.includes(column)) throw new Error(`tx.read: ${table}.${column} is not an unreadable column`);
    const names = Object.values(derived ?? {}).flatMap(d => (d ? [d.name] : []));
    if (names.length > 0) wanted.push([column, names]);
  }

  const items: { row: number; column: string; value: string; derive: ExtractorName[] }[] = [];
  rows.forEach((row, index) => {
    for (const [column, names] of wanted) {
      const value = (row as Record<string, unknown>)[column];
      if (typeof value === 'string') items.push({ row: index, column, value, derive: names });
    }
  });

  const facts: Record<string, FieldFacts>[] = rows.map(() => ({}));
  if (items.length === 0) return facts;

  let results: FieldFacts[];
  const source: FactsSource = config.enc.enableDbEncryption ? 'encryption-service' : 'local';
  const metricSource = source === 'local' ? 'local' : 'enc-rust';
  try {
    if (source === 'encryption-service') {
      results = await getEncryptionProvider().deriveFacts({
        items: items.map(({ value, derive }) => ({ value, derive })),
        entityId: workspaceId,
        entityType: 'WORKSPACE',
      });
      if (results.length !== items.length) {
        throw new Error('tx.read: the encryption service returned facts for a different number of values');
      }
    } else {
      results = items.map(({ column, value, derive }) => {
        if (value.startsWith('ENC:')) throw new Error(`tx.read: ${table}.${column} is ciphertext and DB encryption is off`);
        return runExtractors(value, derive);
      });
    }
  } catch (error) {
    recordFactsError({ side: 'db_read', source: metricSource });
    throw error;
  }
  logDerivedFacts(table, source);

  items.forEach(({ row, column }, index) => {
    facts[row][column] = results[index];
  });
  recordFactsDerived({ side: 'db_read', source: metricSource, table, columns: items.map(({ column }) => column) });
  return facts;
}

/** `tx` with unreadable reads: see `UnreadableTransaction`. `workspaceId` owns the rows read. */
export function unreadableTransaction(tx: Tx, workspaceId: string): UnreadableTransaction {
  const tableOf = (query: unknown) => {
    const { ast } = query as { ast: QueryAst };
    assertNoUnreadableRelated(ast);
    return ast.table;
  };
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === 'run') {
        return async (query: Query<TableName, DefaultSchema, unknown>, options?: RunOptions) => {
          const table = tableOf(query);
          const result: unknown = await target.run(query, options);
          const columns = unreadableColumnsOf(table);
          const wrappedColumns: string[] = [];
          const wrapped = Array.isArray(result)
            ? result.map(row => wrapRow(table, columns, row, wrappedColumns))
            : wrapRow(table, columns, result, wrappedColumns);
          recordUnreadableWrapped({ side: 'db_read', table, columns: wrappedColumns });
          return wrapped;
        };
      }
      if (prop === 'read') {
        return async (
          query: Query<TableName, DefaultSchema, unknown>,
          spec: Record<string, DerivedSpec | undefined>,
          options?: RunOptions,
        ) => {
          const table = tableOf(query);
          const result: unknown = await target.run(query, options);
          if (result === undefined) return undefined;
          const columns = unreadableColumnsOf(table);
          const rows = Array.isArray(result) ? result : [result];
          const facts = await deriveRowFacts(table, rows, spec, workspaceId);
          const wrappedColumns: string[] = [];
          const read = rows.map((row, index) => ({ row: wrapRow(table, columns, row, wrappedColumns), facts: facts[index] }));
          recordUnreadableWrapped({ side: 'db_read', table, columns: wrappedColumns });
          return Array.isArray(result) ? read : read[0];
        };
      }
      if (prop === 'mutate') {
        return unreadableMutate(target.mutate);
      }
      if (prop === 'query') {
        throw new Error('tx.query is not available here; use tx.run(zql.<table>...)');
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as UnreadableTransaction;
}
