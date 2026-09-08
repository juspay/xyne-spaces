// /_edge/* endpoints. nginx only forwards these for requests that did not
// come through the Istio gateway (no x-original-host header).
import { hostname } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Config } from '../config.js';
import type { Origin } from '../origin/index.js';
import type { RulesStore } from '../rules/store.js';

export type StatusHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** One named handler per endpoint; the router dispatches to them statically. */
export interface StatusHandlers {
  healthz: StatusHandler;
  ready: StatusHandler;
  status: StatusHandler;
  /** POST: re-read the rules and re-fingerprint every bundle now, then answer like status. */
  reload: StatusHandler;
}

export function makeStatusHandlers(
  store: RulesStore,
  origin: Origin,
  config: Config,
): StatusHandlers {
  const statusBody = (): Record<string, unknown> => {
    let storage: Record<string, unknown>;
    try {
      storage = origin.describe();
    } catch (err) {
      storage = { error: (err as Error).message };
    }
    return {
      ...store.status(),
      storage,
      hostname: hostname(),
      now: new Date().toISOString(),
      config: {
        reload_interval_s: config.reloadIntervalMs / 1000,
        health_interval_s: config.healthIntervalMs / 1000,
      },
    };
  };

  return {
    healthz: async (_req, res): Promise<void> => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('ok\n');
    },

    ready: async (_req, res): Promise<void> => {
      const state = store.ready();
      res.writeHead(state.ready ? 200 : 503, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
      });
      res.end(state.ready ? 'ready\n' : `not ready: ${state.reason}\n`);
    },

    status: async (_req, res): Promise<void> => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(`${JSON.stringify(statusBody())}\n`);
    },

    reload: async (_req, res): Promise<void> => {
      const before = store.current()?.generation ?? 0;
      await store.reload(true);
      const body = { reloaded: true, previous_generation: before, ...statusBody() };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(`${JSON.stringify(body)}\n`);
    },
  };
}
