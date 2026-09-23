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
 *
 * CONTAINMENT CONTRACT (one-way): the wrapper's failure mode is "behave as if the wrapper
 * was not there" for the USER'S MUTATION — every sync-side seam (proxy setup, the overlay
 * fold) is guarded and degrades to the plain mutator, loudly, while Zero-side errors (the
 * real write failing, the mutator's own throws) propagate UNTOUCHED. A contained fold
 * failure leaves the host view stale → the shadow diff reports a divergence → that is the
 * system working: mutation-path bugs become promotion-gate signal, never user write errors.
 *
 * Deliberate client-visible effect (the ONE, in every mode including shadow): the union-read
 * serves a Zero-miss on a hosted table from the host — required for honest shadow comparison
 * (mutators must read the same optimistic state the engine will show) and benign-direction
 * (host state is closer to server truth than a miss).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSyncHost } from './runtime.js';
import { hostedTables } from './registry.js';
import { obsEmit, reportMutationHealth } from './obs.js';
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
    // Setup containment: a throw in proxy construction (hostedTables/makeSyncTx) must not
    // reject the user's mutation — run it UN-proxied instead.
    let ops: OptimisticOp[] = [];
    let proxied = tx;
    try {
      ops = [];
      proxied = makeSyncTx(tx, host, hostedTables(), ops);
    } catch (e) {
      obsEmit('mutation', { action: 'wrap-failed', mutationID: tx.mutationID, error: String(e) });
      reportMutationHealth('wrap_failed');
      return fn(opts);
    }
    // The real Zero write runs inside `fn` via the proxy, which forwards to Zero FIRST and
    // returns Zero's promise verbatim — the capture can never reject the write. Zero-side /
    // mutator-own errors propagate from this await untouched (one-way containment).
    const result = await fn({ ...opts, tx: proxied });
    if (ops.length > 0) {
      // Fold containment: a throw here (row shape the normalizer/pkOf chokes on, any overlay
      // bug) must never reject the user's already-succeeded mutation. Drop the possibly
      // half-applied overlay (worse than none: it would mask rows wrongly and retirement
      // would manage a corrupt entry) and report; the stale host view surfaces as a shadow
      // divergence — the intended failure signal.
      try {
        host.applyOptimistic(tx.mutationID, ops);
        obsEmit('mutation', {
          action: 'optimistic',
          mutationID: tx.mutationID,
          reason: tx.reason,
          ops: ops.length,
        });
      } catch (e) {
        try {
          host.dropOptimistic(tx.mutationID);
        } catch {
          /* the drop is best-effort cleanup of a failed fold */
        }
        obsEmit('mutation', {
          action: 'fold-failed',
          mutationID: tx.mutationID,
          reason: tx.reason,
          ops: ops.length,
          error: String(e),
        });
        reportMutationHealth('fold_failed');
      }
    }
    return result;
  }) as T;
}
