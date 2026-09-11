import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Config } from '../config.js';
import { log } from '../log.js';
import type { Origin } from '../origin/index.js';
import type { RulesStore } from '../rules/store.js';
import { makeObjectsHandler } from './objects.js';
import { makeResolveHandler } from './resolve.js';
import { makeStatusHandlers } from './status.js';

export function createEdgeServer(store: RulesStore, origin: Origin, config: Config): Server {
  const resolveHandler = makeResolveHandler(store);
  const objectsHandler = makeObjectsHandler(origin, store);
  const statusHandlers = makeStatusHandlers(store, origin, config);

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    if (pathname === '/resolve') {
      await resolveHandler(req, res);
      return;
    }
    if (pathname.startsWith('/objects/') && (req.method === 'GET' || req.method === 'HEAD')) {
      await objectsHandler(req, res, pathname);
      return;
    }
    // Static dispatch on purpose: no lookup keyed by the request path, so
    // the callee is never derived from request data.
    if (req.method === 'POST' && pathname === '/_edge/reload') {
      await statusHandlers.reload(req, res);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      switch (pathname) {
        case '/_edge/healthz':
          await statusHandlers.healthz(req, res);
          return;
        case '/_edge/ready':
          await statusHandlers.ready(req, res);
          return;
        case '/_edge/status':
          await statusHandlers.status(req, res);
          return;
        default:
          break;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('not found\n');
  };

  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      log.error('unhandled request error', { url: req.url, err });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('edge: internal error\n');
      } else {
        res.destroy();
      }
    });
  });
  server.keepAliveTimeout = 65_000;
  return server;
}
