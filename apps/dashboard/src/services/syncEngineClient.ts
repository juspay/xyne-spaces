/**
 * Wires the shared-base sync engine client to the dashboard's existing socket.io
 * connection. The sync engine hosts Zero's IVM locally for allowlisted "shared"
 * queries and receives their rows over the fan-out (see @xyne/shared/sync). This adapts
 * `websocketService` to the engine's minimal transport and initializes it once.
 *
 * Opt-in via `VITE_ENABLE_SYNC_ENGINE=true` (must match the backend's ENABLE_SYNC_ENGINE);
 * when off, shared queries fall back to Zero unchanged.
 */
import { initSyncEngine, configureObs, configureShadow, type SyncTransport } from '@xyne/shared/sync';
import { websocketService } from './clients/socketClient';
import { idbSyncStore } from './syncStore';

const ENABLED = import.meta.env['VITE_ENABLE_SYNC_ENGINE'] === 'true';
/** Dev-only: point the client obs tap at the local collector (scratchpad/obs). */
const OBS_URL = import.meta.env['VITE_SYNC_OBS_URL'] as string | undefined;
/** Dev-only: shadow-diff — display Zero, observe sync, log divergences. */
const SHADOW = import.meta.env['VITE_SYNC_SHADOW'] === 'true';

export function startSyncEngineClient(): void {
  if (!ENABLED) return;
  if (OBS_URL) configureObs(OBS_URL);
  if (SHADOW) configureShadow(true);

  const transport: SyncTransport = {
    emit<P, A = void>(event: string, payload: P, ack?: (response: A) => void): void {
      const socket = websocketService.getSocket();
      if (!socket) return;
      if (ack) socket.emit(event, payload, ack);
      else socket.emit(event, payload);
    },
    on<P>(event: string, handler: (payload: P) => void): void {
      // Persistent: `connect()` recreates the socket (removeAllListeners + new io()), and the
      // sync client registers its listeners before the socket even exists. onPersistent
      // stores each as a re-attach thunk bound to every new socket, so sync:ready/snapshot/
      // delta/revoke are caught regardless of connect timing.
      websocketService.onPersistent<P>(event, handler);
    },
    off<P>(event: string, handler: (payload: P) => void): void {
      websocketService.getSocket()?.off(event, handler);
    },
  };

  initSyncEngine(transport, idbSyncStore);
}
