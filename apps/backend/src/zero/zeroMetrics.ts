import { AsyncLocalStorage } from 'async_hooks';
import {
  getComposeErrors,
  getComposed,
  getContractApplied,
  getFactsDerived,
  getFactsErrors,
  getStorageWrites,
  getUnreadableWrapped,
} from '@/services/otel/cryptoMetrics';

/**
 * Metrics of the unreadable / derived-facts mutators. Each is a count, labelled with the
 * mutator and, where there is one, the table and column:
 *
 * - `zero_contract_applied`: a mutation ran with a request contract;
 * - `zero_facts_derived`: a value facts were derived from (`side` args or db_read, `source`
 *   local or enc-rust); `zero_facts_errors` when that failed;
 * - `zero_unreadable_wrapped`: a value turned into an UnreadableString (args or db_read);
 * - `zero_storage_writes`: an encrypted column written plaintext and encrypted at rest
 *   (`dek_at_rest`), or written already encrypted (`dek_passthrough`);
 * - `zero_composed`: a value built by a compose template (`source` local or enc-rust, `result`
 *   changed or unchanged); `zero_compose_errors` when that failed.
 *
 * Args have no table: their `table` is `args` and `column` the arg field.
 */

export type MetricSide = 'args' | 'db_read';
export type MetricSource = 'local' | 'enc-rust';
export type StorageMode = 'dek_at_rest' | 'dek_passthrough';

const ARGS_TABLE = 'args';
const mutatorNameContext = new AsyncLocalStorage<string>();

/** Runs `fn` with `name` as the mutator its counts are labelled with. */
export function runWithMutatorName<T>(name: string, fn: () => T): T {
  return mutatorNameContext.run(name, fn);
}

/** The mutator running now (see runWithMutatorName), or `unknown`. */
export function currentMutatorName(): string {
  return mutatorNameContext.getStore() ?? 'unknown';
}

/** Adds one per entry of `columns`, labelled with its column. */
function addPerColumn(
  counter: ReturnType<typeof getFactsDerived>,
  labels: Record<string, string>,
  columns: readonly string[],
): void {
  const counts = new Map<string, number>();
  for (const column of columns) counts.set(column, (counts.get(column) ?? 0) + 1);
  for (const [column, count] of counts) counter.add(count, { ...labels, column });
}

export function recordContractApplied(mutator = currentMutatorName()): void {
  getContractApplied().add(1, { mutator });
}

/** `columns`: one entry per value facts were derived from (a column repeats per row). */
export function recordFactsDerived(input: {
  mutator?: string;
  side: MetricSide;
  source: MetricSource;
  table?: string;
  columns: readonly string[];
}): void {
  addPerColumn(
    getFactsDerived(),
    {
      mutator: input.mutator ?? currentMutatorName(),
      side: input.side,
      source: input.source,
      table: input.table ?? ARGS_TABLE,
    },
    input.columns,
  );
}

export function recordFactsError(input: { mutator?: string; side: MetricSide; source: MetricSource }): void {
  getFactsErrors().add(1, { mutator: input.mutator ?? currentMutatorName(), side: input.side, source: input.source });
}

/** `columns`: one entry per value wrapped (a column repeats per row). */
export function recordUnreadableWrapped(input: { side: MetricSide; table?: string; columns: readonly string[] }): void {
  addPerColumn(
    getUnreadableWrapped(),
    { mutator: currentMutatorName(), side: input.side, table: input.table ?? ARGS_TABLE },
    input.columns,
  );
}

/** `columns`: the encrypted columns of one write of `table`, stored as `mode`. */
export function recordStorageWrites(table: string, mode: StorageMode, columns: readonly string[]): void {
  addPerColumn(getStorageWrites(), { mutator: currentMutatorName(), table, mode }, columns);
}

/** `unchanged`: one entry per value built by `template`, whether it equalled the stored one. */
export function recordComposed(input: { template: string; source: MetricSource; unchanged: readonly boolean[] }): void {
  const mutator = currentMutatorName();
  const unchanged = input.unchanged.filter(Boolean).length;
  const changed = input.unchanged.length - unchanged;
  if (changed > 0) getComposed().add(changed, { mutator, template: input.template, source: input.source, result: 'changed' });
  if (unchanged > 0) getComposed().add(unchanged, { mutator, template: input.template, source: input.source, result: 'unchanged' });
}

export function recordComposeError(input: { template: string; source: MetricSource }): void {
  getComposeErrors().add(1, { mutator: currentMutatorName(), template: input.template, source: input.source });
}
