import type { NextFunction, Request, RequestHandler, Response } from 'express';
import pathToRegexp from 'path-to-regexp';
import type { AnyRouteContract } from '@xyne/shared';
import { logger } from '@/utils/logger';

/**
 * Strict, case-sensitive routing for every typed route. The API router is built with these and
 * the gate compiles every address with the same ones, using the same path-to-regexp Express 4
 * uses (0.1.x), so the two agree on every address: `/apps/chat/postMessage/` and
 * `/apps/chat/postmessage` are not `/apps/chat/postMessage` for either of them.
 */
export const ROUTER_OPTIONS = { strict: true, caseSensitive: true } as const;

/** Where the API router is mounted; contract paths do not carry it. */
export const API_PREFIX = '/api';

declare global {
  namespace Express {
    interface Request {
      /** The route contract the contract gate matched this request to; unset for untyped routes. */
      apiContract?: AnyRouteContract;
    }
  }
}

type Compiled = { contract: AnyRouteContract; regexp: RegExp };

/** Typed routes by method. HEAD is answered by the GET route, as Express does. */
const byMethod = new Map<string, Compiled[]>();
const contracts = new Map<string, AnyRouteContract>();

/** Called by `api.route(s)` for each route it mounts. A second contract for the same key is refused (logged). */
export function registerContract(contract: AnyRouteContract): boolean {
  if (contracts.has(contract.key)) {
    logger.error('[contractGate] route already registered; the second one is not mounted', { route: contract.key });
    return false;
  }
  contracts.set(contract.key, contract);
  // Express's own route layer options: end of path, strict and case-sensitive per ROUTER_OPTIONS.
  const regexp = pathToRegexp(API_PREFIX + contract.path, [], {
    sensitive: ROUTER_OPTIONS.caseSensitive,
    strict: ROUTER_OPTIONS.strict,
    end: true,
  });
  const list = byMethod.get(contract.method) ?? [];
  list.push({ contract, regexp });
  byMethod.set(contract.method, list);
  return true;
}

/** The contracts registered so far, by key (tests, and the later enforcement step). */
export function registeredContracts(): ReadonlyMap<string, AnyRouteContract> {
  return contracts;
}

/** The contract for a method and path (the path as Express routes it: no query, not decoded). */
export function findContract(method: string, path: string): AnyRouteContract | undefined {
  const lookup = method === 'HEAD' ? 'GET' : method;
  return byMethod.get(lookup)?.find(({ regexp }) => regexp.test(path))?.contract;
}

export type ContractGateOptions = {
  /**
   * true: a request to an /api address no contract covers gets 404 here, before any route.
   * Off until every API has a contract (migration plan, phase 4); until then untyped routes
   * go on to their old mounts.
   */
  enforce: boolean;
};

/**
 * The first middleware of the app (createApp). It finds the contract for the request's method
 * and address and puts it on `req.apiContract`; a typed route serves a request only when the
 * gate matched it to that route's contract (`api.route(s)`), so a typed route cannot be reached
 * past the gate. OPTIONS (CORS preflight) passes straight through to the cors middleware.
 */
export function contractGate(options: ContractGateOptions): RequestHandler {
  return function contractGateMiddleware(req: Request, res: Response, next: NextFunction): void {
    req.apiContract = undefined;
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    req.apiContract = findContract(req.method, req.path);
    // Any case: Express mounts are case-insensitive, so /API/... still reaches the /api mounts.
    const path = req.path.toLowerCase();
    if (!req.apiContract && options.enforce && (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`))) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  };
}
