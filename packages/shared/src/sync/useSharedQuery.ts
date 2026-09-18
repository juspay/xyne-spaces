/**
 * Drives a shared (fan-out) query on the client: hosts its base (ACL-free) pipeline in
 * the local IVM, subscribes to the backend fan-out, and returns the pipeline's live
 * result. `useQuery` returns this directly for shared queries (Zero disabled), and
 * `useCachedQuery` caches it exactly as it caches a Zero result — so nothing that
 * writes/reads `queryCacheMachine` changes. Returns `undefined` when the query isn't
 * shared or the sync engine isn't initialized (caller falls back to Zero).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import type { QueryResult } from '@rocicorp/zero/react';
import type { Context } from '../zero/schema.js';
import {
  getSyncHost,
  getSyncClient,
  isSyncEngineReady,
  subscribeSyncEngineReady,
  isSyncUnavailable,
  subscribeSyncServing,
} from './runtime.js';
import { resolveBaseAst, astToFormat } from './registry.js';

/** Reactive: re-renders when the sync engine initializes (which may be post-first-render). */
export function useSyncEngineReady(): boolean {
  return useSyncExternalStore(subscribeSyncEngineReady, isSyncEngineReady, isSyncEngineReady);
}

/**
 * Reactive: true while the server is willing to serve this principal through the shared engine.
 * Flips false on `sync:unavailable` (guest/unknown role) so `useQuery` falls back to native Zero,
 * and back true on a later `sync:ready`. Re-renders subscribers on the transition.
 */
export function useSyncServing(): boolean {
  const unavailable = useSyncExternalStore(subscribeSyncServing, isSyncUnavailable, isSyncUnavailable);
  return !unavailable;
}

export function useSharedQuery<TReturn>(
  enabled: boolean,
  hash: string | undefined,
  queryName: string | undefined,
  args: ReadonlyJSONValue | undefined,
  ctx: Context,
): QueryResult<TReturn> | undefined {
  const [rows, setRows] = useState<readonly unknown[] | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);

  // The query object (and thus `args`) is recreated every render, so it can't be an
  // effect dependency without churning the subscription. Read the latest values via
  // refs and key the effect on `hash`, a stable string that already encodes args+ctx.
  const argsRef = useRef(args);
  argsRef.current = args;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    const host = getSyncHost();
    const client = getSyncClient();
    if (!enabled || !hash || !queryName || !host || !client) {
      setRows(undefined);
      setHydrated(false);
      return;
    }

    const baseAst = resolveBaseAst(queryName, ctxRef.current, argsRef.current);
    if (!baseAst) {
      setRows(undefined);
      setHydrated(false);
      return;
    }

    const wireArgs: ReadonlyJSONValue[] = [argsRef.current ?? null];
    host.materialize(hash, baseAst, astToFormat(baseAst), (next) => setRows(next));

    // Register before subscribing so a fast snapshot isn't missed; also catch an already-
    // hydrated instance (a second subscriber to the same query).
    const offHydration = client.onHydration(queryName, wireArgs, () => setHydrated(true));
    client.subscribe(queryName, wireArgs);
    if (client.isHydrated(queryName, wireArgs)) setHydrated(true);

    return () => {
      offHydration();
      client.unsubscribe(queryName, wireArgs);
      host.release(hash);
      setRows(undefined);
      setHydrated(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hash, queryName]);

  if (!enabled) return undefined;
  // `complete` once the fan-out snapshot has arrived (even if empty) — not before, so a
  // consumer doesn't treat "still loading" as "loaded, no rows".
  const data = (rows ?? []) as TReturn;
  const details = hydrated ? { type: 'complete' as const } : { type: 'unknown' as const };
  return [data, details] as QueryResult<TReturn>;
}
