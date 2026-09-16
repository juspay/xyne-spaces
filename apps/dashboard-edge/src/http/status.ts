// /_edge/* endpoints. nginx only forwards these for requests that did not
// come through the Istio gateway (no x-original-host header).
import { hostname } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Config } from '../config.js';
import { fingerprintOf, type Origin } from '../origin/index.js';
import { isDynamicBundle, parseRules } from '../rules/schema.js';
import type { RulesStore } from '../rules/store.js';

export type StatusHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** One named handler per endpoint; the router dispatches to them statically. */
export interface StatusHandlers {
  healthz: StatusHandler;
  ready: StatusHandler;
  status: StatusHandler;
  /** POST: re-read the rules and re-fingerprint every bundle now, then answer like status. */
  reload: StatusHandler;
  validate: StatusHandler;
}

const MAX_VALIDATE_BODY = 256 * 1024;

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const tooBig = (): Error => new Error(`body larger than ${maxBytes} bytes`);
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(tooBig());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) {
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        overflowed = true;
        chunks.length = 0;
        reject(tooBig());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!overflowed) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', reject);
  });
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

    validate: async (req, res): Promise<void> => {
      const send = (status: number, body: Record<string, unknown>): void => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(`${JSON.stringify(body)}\n`);
      };

      let text: string;
      try {
        text = await readBody(req, MAX_VALIDATE_BODY);
      } catch (err) {
        send(413, { ok: false, error: (err as Error).message });
        return;
      }

      const parsed = parseRules(text);
      if (!parsed.ok) {
        send(200, { ok: false, error: parsed.error });
        return;
      }

      const rules = await Promise.all(
        parsed.rules.map(async (rule) => {
          const out: Record<string, unknown> = {
            id: rule.id,
            lane: rule.lane,
            bundle: rule.bundle,
          };
          if (rule.version !== undefined) {
            out['version'] = rule.version;
          }
          if (isDynamicBundle(rule.bundle)) {
            out['exists'] = null;
            return out;
          }
          try {
            const info = await origin.head(`${rule.bundle}/index.html`);
            out['exists'] = info !== null;
            if (info) {
              out['fingerprint'] = fingerprintOf(info);
            }
          } catch (err) {
            out['exists'] = null;
            out['error'] = (err as Error).message;
          }
          return out;
        }),
      );
      send(200, { ok: true, rules });
    },
  };
}
