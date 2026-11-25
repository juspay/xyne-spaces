import express, { type Application } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import { config } from '@/config/env';
import { stream } from '@/utils/logger';
import { redactSensitiveUrl } from '@/utils/redact';
import { metricsMiddleware } from '@/middleware/metricsMiddleware';
import { requestLogger } from '@/middleware/requestLogger';
import { tenantScopeMiddleware } from '@/database/tenant/context';
import { contractGate } from './contractGate';
import { mountTypedRoutes } from './api';

/**
 * The only place the backend's Express app is made. In this order:
 *
 * 1. The contract gate, first: it labels each request with its route contract.
 * 2. What every request gets, typed or not: security headers, cookies, CORS, compression,
 *    metrics, request logging, the tenant scope. (Moved here unchanged from app.ts.)
 * 3. The typed routes (api.route / api.routes), before any route app.ts adds. A typed request
 *    is answered here; nothing app.ts adds afterwards runs for it. Each typed route brings
 *    the rest of what it needs itself (body parsing, response encryption, the Xyne Apps proxy
 *    check, error answers): see framework/api.ts.
 *
 * app.ts then adds the routes that have no contract yet; they get every request the typed
 * routes did not answer. The gate does not enforce yet (migration plan, phase 4).
 */
export function createApp(): Application {
  const app = express();

  // 1. Contract gate.
  app.use(contractGate({ enforce: false }));

  // 2. Every request.
  app.use(helmet());
  // Cookie parser (must be before routes that use cookies)
  app.use(cookieParser());
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
    }),
  );
  // Compression - skip SSE endpoints to allow streaming
  app.use(
    compression({
      filter: (req, res) => {
        // Don't compress SSE responses - they need to stream immediately
        if (req.headers.accept === 'text/event-stream') {
          return false;
        }
        // Use default compression filter for other requests
        return compression.filter(req, res);
      },
    }),
  );
  app.use(metricsMiddleware);
  if (config.env !== 'test') {
    morgan.token('url', (req) =>
      redactSensitiveUrl((req as { originalUrl?: string; url?: string }).originalUrl ?? (req as { url?: string }).url),
    );
    app.use(morgan('combined', { stream }));
  }
  app.use(requestLogger);
  // Open a request-backed tenant scope for every route, once, here. Auth-agnostic:
  // resolves req.user lazily at DB-call time so the workspaceId stamper can read it.
  app.use(tenantScopeMiddleware);

  // 3. Typed routes.
  mountTypedRoutes(app);

  return app;
}
