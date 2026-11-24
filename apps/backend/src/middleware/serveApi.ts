import type { Request, RequestHandler, Response, Router } from 'express';
// For the global Express.Multer types (the uploaded files a handler gets).
import type {} from 'multer';
import type { z } from 'zod';
import type { RequestBody, RequestContract, RequestDerived, ResponseBody, SourceToDerived } from '@xyne/shared';
import type { AuthenticatedUser, ContractRequest } from '@/types/express';
import { logger } from '@/utils/logger';
import { sanitizeForLog } from './decryptionMiddleware';
import { encryptedRoute } from './encryptedRoute';

/** A contract that declares its response: what an HTTP route needs. */
type RouteContract = RequestContract<z.ZodObject, SourceToDerived, z.ZodType>;

/**
 * Everything an API handler gets. There is no `req` and no `res`: the body is the
 * contract's request type, and the only way to answer is to return the contract's response
 * type or throw a ContractError.
 */
export type ContractInput<C extends RouteContract> = {
  params: Request['params'];
  body: RequestBody<C>;
  derived: RequestDerived<C> | undefined;
  user: AuthenticatedUser;
  /** Uploaded files by form field, when an upload parser ran in `before`; `{}` otherwise. */
  files: { [field: string]: Express.Multer.File[] };
};

/** A non-2xx answer from a contract handler: its status and JSON body. */
export class ContractError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === 'string' ? body.error : `Request failed with ${status}`);
    this.name = 'ContractError';
  }
}

/**
 * How the backend serves one API of the table: where (method and path, relative to the
 * router), what runs first, and the handler, whose input and answer are the contract's.
 */
export type ApiRoute<C extends RouteContract> = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: `/${string}`;
  /** Middleware that must run before the body is read (an upload parser fills `req.body`). */
  before?: RequestHandler[];
  /** Workspace whose DEK the encrypted fields are stored under: the one the row belongs to. */
  resolveWorkspaceId: (req: Request) => Promise<string>;
  /** Status of the answer the handler returns; 200 when not given. */
  successStatus?: number;
  handle: (input: ContractInput<C>) => Promise<ResponseBody<C>>;
};

/** A group of the package's `API` table: API name -> its contract. */
type ApiGroup = { readonly [name: string]: RouteContract };

/** One route per API of the group: no more, no fewer. */
export type ApiRoutes<G extends ApiGroup> = { [K in keyof G]: ApiRoute<G[K]> };

/**
 * Serves a group of the package's `API` table on `router`: the one way a contracted route is
 * registered. `routes` must hold exactly one route per API of the group, so a route whose
 * request and response are not defined in enc-contracts does not compile, and an API of the
 * group that is not served does not compile either. Only the group's own entries are
 * registered, whatever else `routes` might carry at runtime.
 *
 * Per request: `before`, the encryptedRoute steps (see encryptedRoute.ts), then `handle`.
 * What `handle` returns is sent with `successStatus`; a ContractError it throws is sent as its
 * status and body; anything else it throws is logged and answered with 500. Every route needs
 * an authenticated user.
 */
export function serveApi<G extends ApiGroup>(router: Router, group: G, routes: ApiRoutes<G>): void {
  for (const name of Object.keys(group) as (keyof G & string)[]) {
    const route = routes[name];
    if (!route) throw new Error(`API "${name}" has a contract but no route`);
    register(router, group[name], route);
  }
}

function register<C extends RouteContract>(router: Router, contract: C, route: ApiRoute<C>): void {
  const run = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      // encryptedRoute has made the request the contract's by now.
      const contracted = req as unknown as ContractRequest<C>;
      const body = await route.handle({
        params: req.params,
        body: contracted.body,
        derived: contracted.derived,
        user: req.user,
        files: (req as Request & { files?: { [field: string]: Express.Multer.File[] } }).files ?? {},
      });
      res.status(route.successStatus ?? 200).json(body);
    } catch (error) {
      if (error instanceof ContractError) {
        res.status(error.status).json(error.body);
        return;
      }
      logger.error('[serveApi] handler failed', {
        route: `${sanitizeForLog(req.method)} ${sanitizeForLog(req.baseUrl)}${route.path}`,
        error,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  const add = router[route.method].bind(router) as unknown as (path: string, ...handlers: RequestHandler[]) => void;
  add(
    route.path,
    ...(route.before ?? []),
    ...encryptedRoute(contract, { resolveWorkspaceId: route.resolveWorkspaceId }),
    run,
  );
}
