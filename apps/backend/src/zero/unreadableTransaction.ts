import type {
  DefaultSchema,
  DefaultWrappedTransaction,
  HumanReadable,
  Query,
  RunOptions,
  Transaction,
} from '@rocicorp/zero';
import { UnreadableString, runExtractors } from '@xyne/shared';
import type { DerivedSpec, ExtractorName, FieldDerived, FieldFacts } from '@xyne/shared';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';
import { type UnreadableColumn, unreadableColumnsOf } from './unreadableColumns';

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

/**
 * The transaction a mutator defined with defineContractMutator gets: the same as Zero's,
 * except
 *
 * - `run` returns the table's unreadable columns (UNREADABLE_COLUMNS) as `UnreadableString`;
 * - `read(query, facts)` does the same and also returns the facts asked for from those
 *   columns, so the body decides on facts instead of the text;
 * - the deprecated `tx.query`, which would read them plainly, is not there.
 *
 * Rows loaded through `.related()` are not wrapped yet.
 */
export type UnreadableTransaction = Tx extends infer X
  ? X extends unknown
    ? Omit<X, 'run' | 'query'> & {
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

function wrapRow(table: string, columns: readonly string[], row: unknown): unknown {
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
    if (value !== undefined && value !== null) wrapped[column] = UnreadableString.make(value as string);
  }
  return wrapped;
}

/** Logs that a read got its derived facts and where they came from. */
function logDerivedFacts(table: string, source: 'local' | 'encryption-service'): void {
  logger.info(`[unreadableTransaction] ${table}: derived facts extracted via ${source}`);
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
  if (config.enc.enableDbEncryption) {
    results = await getEncryptionProvider().deriveFacts({
      items: items.map(({ value, derive }) => ({ value, derive })),
      entityId: workspaceId,
      entityType: 'WORKSPACE',
    });
    if (results.length !== items.length) {
      throw new Error('tx.read: the encryption service returned facts for a different number of values');
    }
    logDerivedFacts(table, 'encryption-service');
  } else {
    results = items.map(({ column, value, derive }) => {
      if (value.startsWith('ENC:')) throw new Error(`tx.read: ${table}.${column} is ciphertext and DB encryption is off`);
      return runExtractors(value, derive);
    });
    logDerivedFacts(table, 'local');
  }
  items.forEach(({ row, column }, index) => {
    facts[row][column] = results[index];
  });
  return facts;
}

/** `tx` with unreadable reads: see `UnreadableTransaction`. `workspaceId` owns the rows read. */
export function unreadableTransaction(tx: Tx, workspaceId: string): UnreadableTransaction {
  const tableOf = (query: unknown) => (query as { ast: { table: string } }).ast.table;
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === 'run') {
        return async (query: Query<TableName, DefaultSchema, unknown>, options?: RunOptions) => {
          const result: unknown = await target.run(query, options);
          const table = tableOf(query);
          const columns = unreadableColumnsOf(table);
          return Array.isArray(result) ? result.map(row => wrapRow(table, columns, row)) : wrapRow(table, columns, result);
        };
      }
      if (prop === 'read') {
        return async (
          query: Query<TableName, DefaultSchema, unknown>,
          spec: Record<string, DerivedSpec | undefined>,
          options?: RunOptions,
        ) => {
          const result: unknown = await target.run(query, options);
          if (result === undefined) return undefined;
          const table = tableOf(query);
          const columns = unreadableColumnsOf(table);
          const rows = Array.isArray(result) ? result : [result];
          const facts = await deriveRowFacts(table, rows, spec, workspaceId);
          const read = rows.map((row, index) => ({ row: wrapRow(table, columns, row), facts: facts[index] }));
          return Array.isArray(result) ? read : read[0];
        };
      }
      if (prop === 'query') {
        throw new Error('tx.query is not available here; use tx.run(zql.<table>...)');
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as UnreadableTransaction;
}
