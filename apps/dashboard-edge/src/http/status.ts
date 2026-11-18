// /_edge/* endpoints. nginx only forwards these for requests that did not
// come through the Istio gateway (no x-original-host header).
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { RulesStore } from '../rules/store.js';

export type StatusHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** One named handler per endpoint; the router dispatches to them statically. */
export interface StatusHandlers {
  healthz: StatusHandler;
  ready: StatusHandler;
}

export function makeStatusHandlers(store: RulesStore): StatusHandlers {
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
  };
}
