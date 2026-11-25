import express, { type Application, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { z } from 'zod';
import {
  makeUnreadable,
  type AnyRouteContract,
  type RequestContract,
  type RouteBody,
  type RouteDerived,
  type RouteGroup,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
} from '@xyne/shared';
import { config } from '@/config/env';
import { authMiddleware } from '@/middleware/auth';
import { encryptedRoute } from '@/middleware/encryptedRoute';
import { encryptResponseBodyMiddleware } from '@/middleware/decryptionMiddleware';
import { errorHandler } from '@/middleware/errorHandler';
import { authenticateApp } from '@/apps/middelware/authenticator';
import { slackAuthenticateApp } from '@/apps/platform-adapters/slack/middleware';
import { requireTransitProxyIngress } from '@/apps/middelware/requireTransitProxy';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';
import { API_PREFIX, ROUTER_OPTIONS, registerContract } from './contractGate';

/**
 * A handler's (or an access check's) answer when it is not the success response: the status
 * and the JSON body, sent as they are. Thrown instead of writing to `res`, which they never get.
 */
export class ContractError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; code?: string } & Record<string, unknown>,
  ) {
    super(body.error);
    this.name = 'ContractError';
  }
}

/**
 * How the caller logs in. Default `session`; anything else is written on the route, so a
 * `public` route stands out in review.
 * - `session`: a dashboard user (authMiddleware.authenticate).
 * - `app`: a Xyne App's bot token (authenticateApp).
 * - `slack-app`: the same bot token, for the Slack-compatible API (/apps/slack/...):
 *   slackAuthenticateApp, which also answers every error the Slack way (HTTP 200,
 *   `{ ok: false, error }`), as Slack SDKs expect.
 * - `public`: nobody; the route checks the caller itself (webhook secret, signed state...).
 */
export type RouteAuth = 'session' | 'app' | 'slack-app' | 'public';

const AUTH_STEPS: Record<RouteAuth, RequestHandler[]> = {
  session: [authMiddleware.authenticate as RequestHandler],
  app: [authenticateApp as RequestHandler],
  'slack-app': [slackAuthenticateApp as RequestHandler],
  public: [],
};

/** The Xyne App behind an `app` route's bot token (authenticateApp). */
export type AppCaller = {
  appId: string;
  installedAppId: string;
  /** The permission scopes granted to the install, e.g. `chat:write`. */
  permissions: string[];
  /** The app's permissions changed and await a reinstall. */
  permissionsStale: boolean;
};

/** What an access check gets: the checked request, never the raw one. */
export type CheckInput<C> = {
  params: RouteParams<C>;
  query: RouteQuery<C>;
  body: RouteBody<C>;
  user: AuthenticatedUser | undefined;
  app: AppCaller | undefined;
};

/**
 * One access check: runs after the request is checked against its contract, before the
 * encryption pipeline and the handler. Throws ContractError to refuse; what it returns, the
 * handler gets under `access.<name>` (e.g. the channel it resolved).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AccessCheck<T = unknown> = (input: CheckInput<any>) => Promise<T>;
export type AccessChecks = Record<string, AccessCheck>;
type AccessResults<A extends AccessChecks> = { [K in keyof A]: Awaited<ReturnType<A[K]>> };

/** What the handler gets. No `req`, no `res`: everything it may read is here, checked. */
export type HandlerInput<C, A extends AccessChecks> = CheckInput<C> & {
  /** Facts the encryption service derived from the encrypted fields; absent when none. */
  derived: RouteDerived<C>;
  /** What the route's access checks returned, by name. */
  access: AccessResults<A>;
  /** Uploaded files (the route's `upload` step), else undefined. */
  files: Express.Multer.File[] | undefined;
  ip: string | undefined;
  userAgent: string | undefined;
};

type EncryptionImpl<C> = C extends { encryption: RequestContract }
  ? {
      /** Workspace whose DEK the encrypted fields are stored under. */
      resolveWorkspaceId: (req: Request) => Promise<string>;
    }
  : never;

export type RouteImpl<C extends AnyRouteContract, A extends AccessChecks = Record<never, never>> = {
  /** Default `session`. */
  auth?: RouteAuth;
  /** Upload parsing (multer): the only step allowed to fill the body before it is checked. */
  upload?: RequestHandler;
  /** Access checks, by name; they run in this order, after the request is checked. */
  access?: A;
  /** Status of the success response. Default 200. */
  successStatus?: number;
  /**
   * The answer to a request that breaks the contract (params, query or body), when the API's
   * wire format is not the default 400 `{ error: 'Validation error', code: 'VALIDATION_ERROR',
   * details }`; e.g. Slack's 200 `{ ok: false, error: 'invalid_arguments' }`. The request is
   * refused either way.
   */
  invalidRequest?: () => ContractError;
  handle: (input: HandlerInput<C, A>) => Promise<RouteResponse<C>>;
} & (C extends { encryption: RequestContract } ? { encryption: EncryptionImpl<C> } : { encryption?: never });

declare const mountedBrand: unique symbol;
/** A route built for contract `C`, ready to mount. Only `api.routes` makes one. */
export type MountedRoute<C extends AnyRouteContract> = {
  readonly contract: C;
  readonly handlers: RequestHandler[];
  readonly [mountedBrand]: true;
};

/**
 * The typed router: every typed route, and nothing else. Strict, case-sensitive. Not exported:
 * only createApp mounts it (mountTypedRoutes), right after the contract gate and the steps
 * every request gets, before any route app.ts adds.
 */
const apiRouter = express.Router(ROUTER_OPTIONS);

/** Body parsing as app.ts does it for its routes (same limits), on typed routes only. */
const parseBody: RequestHandler[] = [express.json({ limit: '10mb' }), express.urlencoded({ extended: true, limit: '10mb' })];

type Checked = { params: unknown; query: unknown; access: Record<string, unknown> };
const checked = new WeakMap<Request, Checked>();

function appCaller(req: Request): AppCaller | undefined {
  const auth = (req as Request & { auth?: Partial<AppCaller> }).auth;
  if (!auth?.appId) return undefined;
  return {
    appId: auth.appId,
    installedAppId: auth.installedAppId ?? '',
    permissions: Array.isArray(auth.permissions) ? auth.permissions : [],
    permissionsStale: auth.permissionsStale === true,
  };
}

function validationError(res: Response, issues: z.core.$ZodIssue[]): void {
  // The shape the Xyne Apps controllers have always answered with.
  res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: issues });
}

/** Only the contract the gate matched may serve the request: a typed route is never reached past the gate. */
function throughGate(contract: AnyRouteContract): RequestHandler {
  return function throughGateMiddleware(req, res, next) {
    if (req.apiContract !== contract) {
      logger.error('[api] typed route reached without the contract gate matching it', {
        route: contract.key,
        matched: req.apiContract?.key ?? null,
      });
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  };
}

/** Checks params, query and body against the contract; everything after gets the checked copies. */
function validate(contract: AnyRouteContract, invalidRequest?: () => ContractError): RequestHandler {
  return function validateMiddleware(req, res, next) {
    const refuse = (issues: z.core.$ZodIssue[]): void => {
      if (!invalidRequest) return validationError(res, issues);
      const answer = invalidRequest();
      res.status(answer.status).json(answer.body);
    };
    const params = contract.params ? (contract.params as z.ZodType).safeParse(req.params) : undefined;
    if (params && !params.success) return refuse(params.error.issues);
    const query = contract.query ? (contract.query as z.ZodType).safeParse(req.query) : undefined;
    if (query && !query.success) return refuse(query.error.issues);
    if (contract.body) {
      const body = (contract.body as z.ZodType).safeParse(req.body ?? {});
      if (!body.success) return refuse(body.error.issues);
      req.body = body.data;
    }
    checked.set(req, { params: params?.data, query: query?.data, access: {} });
    next();
  };
}

function checkInput(req: Request): CheckInput<AnyRouteContract> {
  const state = checked.get(req);
  return {
    params: state?.params as never,
    query: state?.query as never,
    body: req.body as never,
    user: req.user,
    app: appCaller(req),
  };
}

function runAccess(checks: AccessChecks): RequestHandler {
  return async function accessMiddleware(req, res, next) {
    const state = checked.get(req);
    try {
      for (const [name, check] of Object.entries(checks)) {
        const result = await check(checkInput(req));
        if (state) state.access[name] = result;
      }
    } catch (error) {
      if (error instanceof ContractError) {
        res.status(error.status).json(error.body);
        return;
      }
      next(error);
      return;
    }
    next();
  };
}

function checkResponse(contract: AnyRouteContract, result: unknown): void {
  if (config.env === 'production') return;
  const parsed = (contract.response as z.ZodType).safeParse(result);
  if (!parsed.success) {
    // Logged only: a drift between the handler and its contract shows up in dev/sandbox logs
    // without failing the caller.
    logger.warn('[api] response does not match its contract', { route: contract.key, issues: parsed.error.issues });
  }
}

function respond<C extends AnyRouteContract, A extends AccessChecks>(contract: C, impl: RouteImpl<C, A>): RequestHandler {
  return async function respondMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      // Wrapped here as well as in encryptedRoute, so the handler gets UnreadableString
      // fields whether or not the encryption pipeline ran.
      const body = contract.encryption ? makeUnreadable(contract.encryption as RequestContract, req.body ?? {}) : req.body;
      const files = req.files;
      const result = await impl.handle({
        ...(checkInput(req) as CheckInput<C>),
        body: body as RouteBody<C>,
        derived: req.derived as RouteDerived<C>,
        access: (checked.get(req)?.access ?? {}) as AccessResults<A>,
        files: Array.isArray(files) ? files : files ? Object.values(files).flat() : undefined,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      checkResponse(contract, result);
      res.status(impl.successStatus ?? 200).json(result);
    } catch (error) {
      if (error instanceof ContractError) {
        res.status(error.status).json(error.body);
        return;
      }
      next(error);
    }
  };
}

/**
 * The encryption pipeline always runs for a contract with encrypted fields. Routes cannot turn
 * it off. The one deployment-wide exception is encryptedRoute's own `transitProxyIngress` rule,
 * which the framework sets for every `app` route: on a stack without the Xyne Apps ingress
 * transit proxy (TRANSIT_PROXY_INGRESS_ENABLED=false, e.g. prod today) bots call the backend
 * directly and send plaintext, stored encrypted at rest as before.
 */

/**
 * Xyne Apps addresses (`/apps/...`): with the ingress transit proxy deployed every call must
 * come through it (requireTransitProxyIngress). Decided by the address, as infra routes all of
 * /api/apps to the proxy, so no /apps route can leave it out.
 */
function isAppsAddress(path: string): boolean {
  return path === '/apps' || path.startsWith('/apps/');
}

/**
 * The handlers of one typed route, in this order and no other:
 * gate check → Xyne Apps proxy check (/apps addresses) → body parsing → response encryption
 * (encryptResponseBodyMiddleware) → login → upload parsing → validation → access checks →
 * encryption pipeline (when the contract has encrypted fields) → handler → response,
 * and the error answer for anything a step passes on.
 */
function build<C extends AnyRouteContract, A extends AccessChecks>(contract: C, impl: RouteImpl<C, A>): MountedRoute<C> {
  const auth = impl.auth ?? 'session';
  const encryption = (impl as { encryption?: { resolveWorkspaceId: (req: Request) => Promise<string> } }).encryption;
  const handlers: RequestHandler[] = [
    throughGate(contract),
    ...(isAppsAddress(contract.path) ? [requireTransitProxyIngress] : []),
    ...parseBody,
    // Before encryptedRoute's transformResponse, as it was before every route in app.ts.
    encryptResponseBodyMiddleware as RequestHandler,
    ...AUTH_STEPS[auth],
    ...(impl.upload ? [impl.upload] : []),
    validate(contract, impl.invalidRequest),
    ...(impl.access ? [runAccess(impl.access)] : []),
    ...(contract.encryption && encryption
      ? encryptedRoute(contract.encryption as RequestContract, {
          resolveWorkspaceId: encryption.resolveWorkspaceId,
          transitProxyIngress: auth === 'app' || auth === 'slack-app',
        })
      : []),
    respond(contract, impl),
    // Last: an error any step passes on (anything not a ContractError) gets the app's error
    // answer here, in the route itself, so a typed request never reaches anything app.ts adds.
    errorHandler as unknown as RequestHandler,
  ];
  return { contract, handlers } as unknown as MountedRoute<C>;
}

function mount(route: MountedRoute<AnyRouteContract>): void {
  if (!registerContract(route.contract)) return;
  const method = route.contract.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  apiRouter[method](route.contract.path, ...route.handlers);
}

/** Builds the route for one entry of a group: `serve('postMessage', { ... })`. */
export type Serve<G extends RouteGroup> = <K extends keyof G & string, A extends AccessChecks = Record<never, never>>(
  name: K,
  impl: RouteImpl<G[K], A>,
) => MountedRoute<G[K]>;

/**
 * Mount a group of the API table. `build` must return a route for every entry of the group,
 * each built for that entry (`serve('<name>', ...)` under the key `<name>`): a missing route,
 * an extra one, or one built for another entry is a type error.
 *
 *   api.routes(API.apps.chat, (serve) => ({
 *     postMessage: serve('postMessage', { auth: 'app', ..., handle: async ({ body }) => ... }),
 *     updateMessage: serve('updateMessage', { ... }),
 *   }));
 */
export function routes<G extends RouteGroup>(group: G, buildGroup: (serve: Serve<G>) => { [K in keyof G]: MountedRoute<G[K]> }): void {
  const serve: Serve<G> = (name, impl) => build(group[name], impl);
  const built = buildGroup(serve);
  for (const name of Object.keys(group)) mount(built[name]);
}

/** Mount one typed route. Groups of the API table go through `api.routes`, which checks none is left out. */
export function route<C extends AnyRouteContract, A extends AccessChecks = Record<never, never>>(contract: C, impl: RouteImpl<C, A>): void {
  mount(build(contract, impl));
}

/** createApp only: mounts the typed router at /api. */
export function mountTypedRoutes(app: Application): void {
  app.use(API_PREFIX, apiRouter);
}

/** What feature code uses: add typed routes. Mounting the router is createApp's alone. */
export const api = { route, routes };
