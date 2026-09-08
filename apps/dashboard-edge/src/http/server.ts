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
  const objectsHandler = makeObjectsHandler(origin);
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
    const status = statusHandlers.get(pathname);
    if (status && (req.method === 'GET' || req.method === 'HEAD')) {
      await status(req, res);
      return;
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
