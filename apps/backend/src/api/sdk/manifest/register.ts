import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../errors';
import { rateLimit } from '../middleware/rateLimit';
import type { RouteDefinition } from './types';

/**
 * Turn manifest entries into Express routes with a uniform middleware chain.
 *
 * Authorization already happened in `apiKeyAuth`; what a principal may touch is
 * decided by the Zero ACL inside each handler, so the chain here is only rate
 * limit, then validation, then the handler — wrapped so a rejected promise
 * reaches the SDK error handler rather than crashing the process.
 */
export function registerRoutes(routes: readonly RouteDefinition[]): Router {
  const router = Router();
  const seen = new Set<string>();

  for (const route of routes) {
    const signature = `${route.method} ${route.path}`;
    if (seen.has(signature)) {
      throw new Error(`Duplicate SDK route: ${signature}`);
    }
    seen.add(signature);

    const isWrite = route.method !== 'get';

    router[route.method](
      route.path,
      rateLimit(isWrite ? 'write' : 'read'),
      ...(route.middleware ?? []),
      asyncHandler(route),
    );
  }

  return router;
}

function asyncHandler(route: RouteDefinition) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = req.sdkAuth;
      if (!auth) throw new ApiError('unauthenticated', 'Missing authenticated principal.');

      const parsed = validate(route, req);

      const result = await route.handler({
        req,
        auth,
        params: parsed.params,
        query: parsed.query,
        body: parsed.body,
      });

      if (result.headers) {
        for (const [name, value] of Object.entries(result.headers)) {
          res.setHeader(name, value);
        }
      }
      if (result.status === 204 || result.body === undefined) {
        res.status(result.status).end();
        return;
      }
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  };
}

function validate(
  route: RouteDefinition,
  req: Request,
): { params: Record<string, string>; query: Record<string, unknown>; body: unknown } {
  try {
    return {
      params: route.request?.params
        ? (route.request.params.parse(req.params) as Record<string, string>)
        : (req.params as Record<string, string>),
      query: route.request?.query
        ? (route.request.query.parse(req.query) as Record<string, unknown>)
        : (req.query as Record<string, unknown>),
      body: route.request?.body ? route.request.body.parse(req.body) : req.body,
    };
  } catch (err) {
    if (err instanceof ZodError) throw ApiError.validation(err);
    throw err;
  }
}
