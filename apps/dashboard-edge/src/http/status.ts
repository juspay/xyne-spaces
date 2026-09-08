// /_edge/* endpoints. nginx only forwards these for requests that did not
// come through the Istio gateway (no x-original-host header).
import { hostname } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Config } from '../config.js';
import { registry } from '../metrics.js';
import type { Origin } from '../origin/index.js';
import type { RulesStore } from '../rules/store.js';

export type StatusHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function makeStatusHandlers(
  store: RulesStore,
  origin: Origin,
  config: Config,
): Map<string, StatusHandler> {
  const handlers = new Map<string, StatusHandler>();

  handlers.set('/_edge/healthz', async (_req, res): Promise<void> => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('ok\n');
  });

  handlers.set('/_edge/ready', async (_req, res): Promise<void> => {
    const state = store.ready();
    res.writeHead(state.ready ? 200 : 503, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
    });
    res.end(state.ready ? 'ready\n' : `not ready: ${state.reason}\n`);
  });

  handlers.set('/_edge/status', async (_req, res): Promise<void> => {
    let storage: Record<string, unknown>;
    try {
      storage = origin.describe();
    } catch (err) {
      storage = { error: (err as Error).message };
    }
    const body = {
      ...store.status(),
      storage,
      hostname: hostname(),
      now: new Date().toISOString(),
      config: {
        reload_interval_s: config.reloadIntervalMs / 1000,
        health_interval_s: config.healthIntervalMs / 1000,
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(`${JSON.stringify(body)}\n`);
  });

  handlers.set('/_edge/metrics', async (_req, res): Promise<void> => {
    const text = await registry.metrics();
    res.writeHead(200, { 'Content-Type': registry.contentType, 'Cache-Control': 'no-store' });
    res.end(text);
  });

  return handlers;
}
