/**
 * Client-side dual-write + union-read for Zero custom mutators, so that shared (sync-engine)
 * queries reflect a mutation optimistically and mutator reads of hosted data still resolve.
 *
 * The sync engine serves some tables (see `hostedTables()`) from a local IVM host INSTEAD of
 * Zero's client store. That breaks two things for a mutator running optimistically on the
 * client: (1) a `tx.run` read of a hosted row misses (it's not in Zero's store) — and an
 * uncaught throw would abort the whole mutation; (2) a `tx.mutate` write lands only in Zero's
 * store, invisible to the shared view. `syncMutatorFn` wraps the mutator's `tx` to fix both:
 *   - `tx.run`  → UNION read: Zero's store first, and if it misses on a hosted table, the host.
 *   - `tx.mutate.<hosted>.<op>` → DUAL write: forward to Zero AND mirror into the host overlay.
 *
 * Additive and client-only: non-hosted writes and non-missing reads are untouched, and the
 * server transaction (`tx.location === 'server'`) is never wrapped. Records on both the
 * optimistic and rebase runs (the host overlay REPLACES per mutationID). Retirement of the
 * overlay (on confirm-echo / reject) is the reconcile step, wired separately.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSyncHost } from './runtime.js';
import { hostedTables } from './registry.js';
import { obsEmit } from './obs.js';
import type { OptimisticOp } from './ivmHost.js';

const OP_KIND: Record<string, OptimisticOp['kind']> = {
  insert: 'set',
  upsert: 'set',
  update: 'patch',
  delete: 'delete',
};

function makeSyncTx(tx: any, host: any, hosted: ReadonlySet<string>, ops: OptimisticOp[]): any {
  const mutateProxy = new Proxy(tx.mutate, {
    get(target, table: string) {
      const api = target[table];
      if (typeof table !== 'string' || !hosted.has(table) || !api) return api;
      return new Proxy(api, {
        get(tableApi, op: string) {
          const fn = tableApi[op];
          if (typeof op !== 'string' || typeof fn !== 'function' || !(op in OP_KIND)) return fn;
          return (arg: any) => {
            const promise = fn.call(tableApi, arg); // real Zero write (optimism + server push)
            ops.push({ kind: OP_KIND[op], table, row: arg });
            return promise;
          };
        },
      });
    },
  });
  return new Proxy(tx, {
    get(target, prop: string) {
      if (prop === 'mutate') return mutateProxy;
      if (prop === 'run') {
        return async (query: any, opts?: any): Promise<unknown> => {
          const zeroResult = await target.run(query, opts);
          const singular = !!query?.format?.singular;
          const missed = singular
            ? zeroResult == null
            : Array.isArray(zeroResult) && zeroResult.length === 0;
          if (!missed || !hosted.has(query?.ast?.table)) return zeroResult;
          try {
            return host.runOnce(query.ast, query.format);
          } catch {
            return zeroResult;
          }
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Wrap a mutator's implementation `fn` (the `({ tx, ctx, args }) => …` body). On the client,
 * runs it against a proxied `tx` (union-read + dual-write) and folds the captured hosted-table
 * ops into the host overlay keyed by `tx.mutationID`. Pass-through on the server or before the
 * engine initializes. Preserves `fn`'s type.
 */
export function syncMutatorFn<T extends (opts: any) => Promise<any>>(fn: T): T {
  return (async (opts: any): Promise<any> => {
    const host = getSyncHost();
    const tx = opts?.tx;
    if (!host || !tx || tx.location !== 'client') return fn(opts);
    const ops: OptimisticOp[] = [];
    const proxied = makeSyncTx(tx, host, hostedTables(), ops);
    const result = await fn({ ...opts, tx: proxied });
    if (ops.length > 0) {
      host.applyOptimistic(tx.mutationID, ops);
      obsEmit('mutation', {
        action: 'optimistic',
        mutationID: tx.mutationID,
        reason: tx.reason,
        ops: ops.length,
      });
    }
    return result;
  }) as T;
}
