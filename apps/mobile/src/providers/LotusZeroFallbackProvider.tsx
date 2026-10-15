import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useConnectionState } from '@rocicorp/zero/react';
import {
  DEFAULT_ZERO_FALLBACK_CONFIG,
  FallbackExecutorProvider,
  ZeroFallbackContext,
  type FallbackQueryExecutor,
  type ZeroFallbackConfig,
} from '@xyne/shared/hooks';

import { executeFallbackQuery } from '@/src/services/zeroFallbackClient';
import { useZeroMetricValidity } from '@/src/observability/zero/useZeroMetricValidity';

const fallbackExecutor: FallbackQueryExecutor = (name, args) => executeFallbackQuery(name, args);

/**
 * Lotus dynamic fallback toggle.
 *
 * Cold start: fallbackEnabled = true → every useQuery call also fires the REST
 * /api/zero/query-fallback endpoint in parallel with Zero. Fallback returns in
 * ~430 ms p95 in prod, while Zero in production routinely takes seconds (p50
 * 2.3 s, p95 28 s, p99 141 s on iOS) to socket-connect + hydrate IVM + deliver
 * the first row.
 *
 * Latch trigger: the WebSocket is `connected` AND at least one Zero query has
 * emitted `details.type === 'complete'`. Either alone is insufficient:
 *  - `connected` alone means the socket is up, not that IVM has hydrated any
 *    query (heavy joined queries can stay un-hydrated long after connect).
 *  - `complete` alone can fire from Zero's persisted KV cache before the
 *    socket connects (`experimentalWatch({initialValuesInFirstDiff: true})` in
 *    queryManager), causing fallback to latch off while live deltas still
 *    aren't flowing — message previews then stay frozen on cached KV until
 *    Zero finally connects.
 * Once both conditions hold, we flip `hasZeroDelivered` for the rest of the
 * JS session. If the socket later drops (`error` / `disconnected` /
 * reconnecting / Rehome), fallback turns back on so opening a channel does
 * not wait on Zero `complete` with an empty in-memory replica.
 *
 * `hasZeroDelivered` stays true for the JS session. Fallback still re-arms
 * whenever the socket is not `connected`, so a Rehome/ping-fail reconnect
 * does not leave chat open waiting on Zero `complete`.
 *
 * Config exposes `keepZeroAlongsideFallback: true` so shared/useQuery keeps Zero
 * subscribed alongside fallback (the latch needs Zero to actually run to flip).
 * `onZeroComplete` is the latch trigger callback.
 */
export function LotusZeroFallbackProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const connectionState = useConnectionState();
  const isConnected = connectionState.name === 'connected';
  useZeroMetricValidity(isConnected);
  const [hasZeroDelivered, setHasZeroDelivered] = useState(false);
  const sawCompleteRef = useRef(false);
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;

  const markZeroDelivered = useCallback(() => {
    sawCompleteRef.current = true;
    if (!isConnectedRef.current) return;
    setHasZeroDelivered(prev => {
      if (prev) return prev;
      console.log('[fallback-latch] flipped source=mark_delivered_while_connected');
      return true;
    });
  }, []);

  useEffect(() => {
    if (isConnected && sawCompleteRef.current) {
      setHasZeroDelivered(prev => {
        if (prev) return prev;
        console.log('[fallback-latch] flipped source=connection_state_with_prior_complete');
        return true;
      });
    }
  }, [isConnected]);

  const config = useMemo<ZeroFallbackConfig>(
    () => ({
      ...DEFAULT_ZERO_FALLBACK_CONFIG,
      fallbackEnabled: !hasZeroDelivered || !isConnected,
      keepZeroAlongsideFallback: true,
      onZeroComplete: markZeroDelivered,
    }),
    [hasZeroDelivered, isConnected, markZeroDelivered],
  );

  return (
    <ZeroFallbackContext.Provider value={config}>
      <FallbackExecutorProvider value={fallbackExecutor}>{children}</FallbackExecutorProvider>
    </ZeroFallbackContext.Provider>
  );
}

export default LotusZeroFallbackProvider;
