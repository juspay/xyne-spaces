import { logger } from '@/utils/logger';
import { InstanceManager } from './instanceManager';
import { disconnectSyncStore } from './redisStore';

const zeroCacheUrl = (): string => process.env['ZERO_CACHE_UPSTREAM'] || 'http://localhost:4848';

/**
 * Process-level handle for the shared-base sync engine. `start`/`stop` are wired
 * into the app lifecycle behind ENABLE_SYNC_ENGINE; `subscribe`/`unsubscribe` are
 * the control plane the client transport drives (a subscriber = a client tailing
 * the instance's Redis stream).
 */
export class SyncEngine {
  #manager: InstanceManager | null = null;

  start(): void {
    if (this.#manager) return;
    this.#manager = new InstanceManager(zeroCacheUrl());
    logger.info('sync_engine_started', { zeroCacheUrl: zeroCacheUrl() });
  }

  async stop(): Promise<void> {
    await this.#manager?.stopAll();
    this.#manager = null;
    // Close the dedicated sync-store connection (app.ts stops the fan-out first, so nothing else
    // is using it by now). Lazily recreated if the engine restarts.
    disconnectSyncStore();
    logger.info('sync_engine_stopped');
  }

  /** Register interest in a shared query-instance; returns its instanceKey, or null if not allowlisted. */
  subscribe(queryName: string, queryArgs: readonly unknown[], subscriberId: string): string | null {
    return this.#manager?.subscribe(queryName, queryArgs, subscriberId) ?? null;
  }

  unsubscribe(instanceKey: string, subscriberId: string): void {
    this.#manager?.unsubscribe(instanceKey, subscriberId);
  }

  activeInstances(): number {
    return this.#manager?.activeInstances() ?? 0;
  }

  activeGroups(): number {
    return this.#manager?.activeGroups() ?? 0;
  }
}

export const syncEngine = new SyncEngine();
