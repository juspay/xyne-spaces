import express, { type Application, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import type { z } from 'zod';
import {
  deriveFactsFromPlaintext,
  derivedNames,
  isCiphertextValue,
  makeUnreadable,
  requestContractOf,
  reveal,
  UnreadableString,
  type AnyRouteContract,
  type RequestContract,
  type RouteContract,
  type SourceToDerived,
  type RouteBody,
  type RouteDerived,
  type RouteParams,
  type RouteTable,
  type RouteQuery,
  type RouteResponse } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { encryptedRoute } from '@/middleware/encryptedRoute';
import { isDekPassthrough } from '@/services/encryption/dekPassthrough';
import { encryptResponseBodyMiddleware } from '@/middleware/decryptionMiddleware';
import { errorHandler } from '@/middleware/errorHandler';
import { authenticateApp } from '@/apps/middelware/authenticator';
import { slackAuthenticateApp } from '@/apps/platform-adapters/slack/middleware';
import { requireTransitProxyIngress } from '@/apps/middelware/requireTransitProxy';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';
import { ROUTER_OPTIONS, registerContract } from './contractGate';

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
  public: [] };

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
  /** The request's method and full path (no query string), for checks that decide by route (the route ACL). */
  route: { method: string; path: string };
  /** The request headers (read only): device and app-version headers a few routes record. */
  headers: Readonly<IncomingHttpHeaders>;
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

type EncryptionImpl = {
  /** Workspace whose DEK the encrypted fields are stored under. */
  resolveWorkspaceId: (req: Request) => Promise<string>;
};

/** Whether the contract's body has encrypted fields (its `facts` is a map, not undefined). */
type HasEncryptedFields<C> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  C extends RouteContract<any, any, any, any, any, any, infer F> ? (F extends SourceToDerived ? true : false) : false;

export type RouteImpl<C extends AnyRouteContract, A extends AccessChecks = Record<never, never>> = {
  /** Default `session`. */
  auth?: RouteAuth;
  /** Upload parsing (multer): the only step allowed to fill the body before it is checked. */
  upload?: RequestHandler;
  /** Access checks, by name; they run in this order, after the request is checked. */
  access?: A;
  /** Status of the success response. Default 200. */
  successStatus?: number;
  /** Headers set on every answer of this route, success or a ContractError (e.g. `Cache-Control`). */
  responseHeaders?: Record<string, string>;
  /**
   * The answer to a request that breaks the contract (params, query or body), when the API's
   * wire format is not the default 400 `{ error: 'Validation error', code: 'VALIDATION_ERROR',
   * details }`; e.g. Slack's 200 `{ ok: false, error: 'invalid_arguments' }`. The request is
   * refused either way.
   */
  invalidRequest?: () => ContractError;
  /** The route's controller: the checked input in, the answer out (or a thrown ContractError). */
  controller: (input: HandlerInput<C, A>) => Promise<RouteResponse<C>>;
} & (HasEncryptedFields<C> extends true ? { encryption: EncryptionImpl } : { encryption?: never });

declare const mountedBrand: unique symbol;
/** A route built for contract `C`, ready to mount. Only `router` makes one. */
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
const typedRouter = express.Router(ROUTER_OPTIONS);

/** Body parsing as app.ts does it for its routes (same limits), on typed routes only. */
const parseBody: RequestHandler[] = [express.json({ limit: '10mb' }), express.urlencoded({ extended: true, limit: '10mb' })];

/**
 * The checked request parts. `body` is the checked body the access checks read; the handler reads
 * `req.body` (for a contract with encrypted fields, the encryption service's checked answer).
 */
type Checked = { params: unknown; query: unknown; body: unknown; access: Record<string, unknown> };
const checked = new WeakMap<Request, Checked>();

function appCaller(req: Request): AppCaller | undefined {
  const auth = (req as Request & { auth?: Partial<AppCaller> }).auth;
  if (!auth?.appId) return undefined;
  return {
    appId: auth.appId,
    installedAppId: auth.installedAppId ?? '',
    permissions: Array.isArray(auth.permissions) ? auth.permissions : [],
    permissionsStale: auth.permissionsStale === true };
}

/** The refusal of a request that breaks its contract: the route's own wire format, else the default. */
function refusal(issues: z.core.$ZodIssue[], invalidRequest?: () => ContractError): ContractError {
  if (invalidRequest) return invalidRequest();
  // The shape the Xyne Apps controllers have always answered with.
  return new ContractError(400, { error: 'Validation error', code: 'VALIDATION_ERROR', details: issues });
}

type RequestParts = { params: unknown; query: unknown; body: unknown };

/**
 * Params, query and body checked against the contract (the checked copies), or the refusal as a
 * ContractError. The one request check: the typed route's `validate` step and `callTyped` use it.
 */
function checkRequest(contract: AnyRouteContract, raw: RequestParts, invalidRequest?: () => ContractError): RequestParts {
  const params = contract.params ? (contract.params as z.ZodType).safeParse(raw.params) : undefined;
  if (params && !params.success) throw refusal(params.error.issues, invalidRequest);
  const query = contract.query ? (contract.query as z.ZodType).safeParse(raw.query) : undefined;
  if (query && !query.success) throw refusal(query.error.issues, invalidRequest);
  let body: unknown = raw.body;
  if (contract.body) {
    const parsed = checkBody(contract, raw.body);
    if (!parsed.success) throw refusal(parsed.issues, invalidRequest);
    body = parsed.body;
  }
  return { params: params?.data, query: query?.data, body };
}

/**
 * The body checked against the contract: the parsed body, except the encrypted fields, which keep
 * their value as sent (plaintext, or ciphertext) for the encryption service and the facts step;
 * they are wrapped in UnreadableString after the encryption steps (makeUnreadable).
 */
function checkBody(
  contract: AnyRouteContract,
  rawBody: unknown,
): { success: true; body: Record<string, unknown> } | { success: false; issues: z.core.$ZodIssue[] } {
  const sent = (rawBody ?? {}) as Record<string, unknown>;
  const parsed = (contract.body as z.ZodType).safeParse(sent);
  if (!parsed.success) return { success: false, issues: parsed.error.issues };
  const data = parsed.data as Record<string, unknown>;
  for (const field of requestContractOf(contract)?.unreadableFields ?? []) {
    if (field in sent) data[field] = sent[field];
  }
  return { success: true, body: data };
}

/** Runs the access checks in order; their results by name, or the first refusal thrown. */
async function runChecks(checks: AccessChecks, input: CheckInput<AnyRouteContract>): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const [name, check] of Object.entries(checks)) {
    results[name] = await check(input);
  }
  return results;
}

/** Only the contract the gate matched may serve the request: a typed route is never reached past the gate. */
function throughGate(contract: AnyRouteContract): RequestHandler {
  return function throughGateMiddleware(req, res, next) {
    if (req.apiContract !== contract) {
      logger.error('[api] typed route reached without the contract gate matching it', {
        route: contract.key,
        matched: req.apiContract?.key ?? null });
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  };
}

/** Checks params, query and body against the contract; everything after gets the checked copies. */
function validate(contract: AnyRouteContract, invalidRequest?: () => ContractError): RequestHandler {
  return function validateMiddleware(req, res, next) {
    let parts: RequestParts;
    try {
      parts = checkRequest(contract, { params: req.params, query: req.query, body: req.body }, invalidRequest);
    } catch (error) {
      if (!(error instanceof ContractError)) return next(error);
      res.status(error.status).json(error.body);
      return;
    }
    // A body with encrypted fields goes to the encryption service as sent: the service's answer,
    // not the client's body, is what the contract finally holds (contractFieldsAndFacts).
    // Every other body is the checked copy from here on.
    if (contract.body && !requestContractOf(contract)) req.body = parts.body;
    checked.set(req, { params: parts.params, query: parts.query, body: parts.body, access: {} });
    next();
  };
}

function checkInput(req: Request): CheckInput<AnyRouteContract> {
  const state = checked.get(req);
  return {
    params: state?.params as never,
    query: state?.query as never,
    body: (state ? state.body : req.body) as never,
    user: req.user,
    app: appCaller(req),
    route: { method: req.method, path: req.originalUrl.split('?')[0] },
    headers: req.headers };
}

function runAccess(checks: AccessChecks): RequestHandler {
  return async function accessMiddleware(req, res, next) {
    const state = checked.get(req);
    try {
      const results = await runChecks(checks, checkInput(req));
      if (state) state.access = results;
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

/**
 * The answer exactly as its contract describes it, in every environment: fields the contract does
 * not list are removed (a controller handing back a whole row sends only the contract's fields),
 * and a missing or wrong-type field is a server error, logged with the issues, not sent.
 */
function shapeAnswer(contract: AnyRouteContract, answer: unknown): unknown {
  const parsed = (contract.response as z.ZodType).safeParse(answer);
  if (!parsed.success) {
    logger.error('[api] answer does not match its contract; not sent', { route: contract.key, issues: parsed.error.issues });
    throw new ContractError(500, { error: 'Internal server error', code: 'RESPONSE_CONTRACT_VIOLATION' });
  }
  return parsed.data;
}

/**
 * The encryption service's answer against the contract, then the encrypted fields' form, then
 * their facts, as for contracted mutators (the Zero validator on the transformed args,
 * assertArgsMatchContract, deriveLocally): runs after the encryption service transformed the
 * body and before the unreadable fields are wrapped.
 *
 * - Contract: the body the service answered is checked as the request was (checkBody) and is
 *   the body from here on. It cannot fail for a valid request unless the service changed it.
 *
 * - Form: a field the contract keeps plain must not hold ciphertext, at any depth; an
 *   `unreadableString()` field must be ciphertext once the encryption service transformed the
 *   body (DEK passthrough). Without the transform (no gateway, encryption off) everything is
 *   plaintext and is encrypted at rest on write.
 * - Facts: when the encryption service extracted none (it did not run, or the body was plain),
 *   they are computed here from the plaintext with the same shared extractors, so a handler
 *   always decides on `derived` and never reads the text.
 */
function contractFieldsAndFacts(contract: AnyRouteContract, encryption: RequestContract): RequestHandler {
  const factNames = derivedNames(encryption);
  return function contractFieldsAndFactsMiddleware(req, res, next) {
    // The encryption service's answer (or, where it did not run, the body as sent) against the
    // contract. The body as sent already passed the same check (validate), so an answer that
    // does not fit is the service's doing: a server error, logged with the issues.
    const checkedBody = checkBody(contract, req.body);
    if (!checkedBody.success) {
      logger.error('[api] the encryption service\'s request body does not match the contract', { route: contract.key, issues: checkedBody.issues });
      res.status(500).json({ error: 'Internal server error', code: 'ENC_TRANSFORM_CONTRACT_VIOLATION' });
      return;
    }
    const body = checkedBody.body;
    req.body = body;
    const transformed = isDekPassthrough();
    for (const [field, value] of Object.entries(body)) {
      const unreadable = encryption.unreadableFields.includes(field);
      const problem =
        !unreadable && containsCiphertext(value)
          ? 'is plaintext in the contract but arrived encrypted'
          : unreadable && transformed && typeof value === 'string' && value.length > 0 && !isCiphertextValue(value)
            ? 'is encrypted in the contract but arrived as plaintext'
            : undefined;
      if (problem) {
        logger.error('[api] request field does not match its type in the contract', { field, problem, path: req.path });
        res.status(400).json({ error: 'Request body does not match its contract', code: 'ENC_CONTRACT_VIOLATION', field, message: problem });
        return;
      }
    }
    if (!req.derived) {
      const derived = deriveFactsFromPlaintext(body, factNames);
      if (derived) req.derived = derived;
    }
    next();
  };
}

/** Whether `value` is, or holds at any depth, a ciphertext string. */
function containsCiphertext(value: unknown): boolean {
  if (typeof value === 'string') return isCiphertextValue(value);
  if (Array.isArray(value)) return value.some(containsCiphertext);
  if (value && typeof value === 'object') return Object.values(value).some(containsCiphertext);
  return false;
}

/**
 * The encryption pipeline (encryptedRoute) with the field check and facts step after its
 * transform; where the pipeline does not run (an `app` route without the ingress proxy), the
 * check and facts step alone, so the handler gets the same `derived` and wrapped fields.
 */
function encryptionSteps(
  contract: AnyRouteContract,
  encryption: { resolveWorkspaceId: (req: Request) => Promise<string> } | undefined,
  auth: RouteAuth,
): RequestHandler[] {
  const requestContract = requestContractOf(contract);
  if (!requestContract || !encryption) return [];
  const fieldsAndFacts = contractFieldsAndFacts(contract, requestContract);
  const steps = encryptedRoute(requestContract, {
    resolveWorkspaceId: encryption.resolveWorkspaceId,
    transitProxyIngress: auth === 'app' || auth === 'slack-app',
    afterTransform: fieldsAndFacts });
  return steps.length > 0 ? steps : [fieldsAndFacts];
}

/**
 * `value` with every UnreadableString in it (at any depth) as the value it holds: ciphertext,
 * or plaintext while nothing is encrypted. The response's write boundary, as tx.mutate is the
 * database's: a handler hands back what it holds (e.g. the bot's own `text`, echoed in a Slack
 * answer) without reading it, and ciphertext is re-encrypted for the caller after this
 * (transformResponse). Without it an UnreadableString would be sent as "<redacted>".
 */
function makeReadable(value: unknown): unknown {
  if (value instanceof UnreadableString) return reveal(value);
  if (Array.isArray(value)) return value.map(makeReadable);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, makeReadable(inner)]));
  }
  return value;
}

function respond<C extends AnyRouteContract, A extends AccessChecks>(contract: C, impl: RouteImpl<C, A>): RequestHandler {
  return async function respondMiddleware(req: Request, res: Response, next: NextFunction) {
    if (impl.responseHeaders) res.set(impl.responseHeaders);
    try {
      // Wrapped here as well as in encryptedRoute, so the handler gets UnreadableString
      // fields whether or not the encryption pipeline ran.
      const requestContract = requestContractOf(contract);
      const body = requestContract ? makeUnreadable(requestContract, req.body ?? {}) : req.body;
      const files = req.files;
      const result = await impl.controller({
        ...(checkInput(req) as CheckInput<C>),
        body: body as RouteBody<C>,
        derived: req.derived as RouteDerived<C>,
        access: (checked.get(req)?.access ?? {}) as AccessResults<A>,
        files: Array.isArray(files) ? files : files ? Object.values(files).flat() : undefined,
        ip: req.ip,
        userAgent: req.get('user-agent') });
      const shaped = shapeAnswer(contract, makeReadable(result));
      res.status(impl.successStatus ?? 200).json(shaped);
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
    ...encryptionSteps(contract, encryption, auth),
    respond(contract, impl),
    // Last: an error any step passes on (anything not a ContractError) gets the app's error
    // answer here, in the route itself, so a typed request never reaches anything app.ts adds.
    errorHandler as unknown as RequestHandler,
  ];
  return { contract, handlers, impl } as unknown as MountedRoute<C>;
}

/** Every mounted route's setup, with its routers' defaults merged in (access checks included), for callTyped. */
const mountedImpls = new Map<AnyRouteContract, RouteImpl<AnyRouteContract, AccessChecks>>();

function mount(route: MountedRoute<AnyRouteContract>): void {
  if (!registerContract(route.contract)) return;
  const method = route.contract.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  typedRouter[method](route.contract.path, ...route.handlers);
  mountedImpls.set(route.contract, (route as unknown as { impl: RouteImpl<AnyRouteContract, AccessChecks> }).impl);
}

/** A typed route's answer for another caller of the same API: status, the shaped body, headers. */
export type TypedAnswer = { status: number; body: unknown; headers?: Record<string, string> };

/**
 * Runs a mounted typed route's own steps for another caller of the same API (the SDK
 * dispatcher), so the two cannot drift: the request check, the route's access checks (its
 * routers' included), its controller, and the answer check. The caller has already logged the
 * user in and passes the raw params, query and body. A ContractError is the route's refusal.
 *
 * Not for routes with encrypted fields (their encryption pipeline is Express middleware) or for
 * app-token routes (`app`, `slack-app`): those throw, so they fail loudly instead of running
 * without their steps.
 */
export async function callTyped(contract: AnyRouteContract, req: Request, raw: RequestParts): Promise<TypedAnswer> {
  const impl = mountedImpls.get(contract);
  if (!impl) throw new Error(`[api] ${contract.key} is not a mounted typed route`);
  if (requestContractOf(contract)) throw new Error(`[api] ${contract.key} has encrypted fields; callTyped has no encryption step`);
  if (impl.auth === 'app' || impl.auth === 'slack-app') throw new Error(`[api] ${contract.key} is an app-token route; callTyped serves user routes`);

  const parts = checkRequest(contract, raw, impl.invalidRequest);
  const input: CheckInput<AnyRouteContract> = {
    params: parts.params as never,
    query: parts.query as never,
    body: parts.body as never,
    user: req.user,
    app: appCaller(req),
    route: { method: req.method, path: req.originalUrl.split('?')[0] },
    headers: req.headers,
  };
  const access = impl.access ? await runChecks(impl.access, input) : {};
  const result = await impl.controller({ ...input, derived: undefined as never, access, files: undefined, ip: req.ip, userAgent: req.get('user-agent') });
  return {
    status: impl.successStatus ?? 200,
    body: shapeAnswer(contract, makeReadable(result)),
    ...(impl.responseHeaders ? { headers: impl.responseHeaders } : {}),
  };
}

// ─── Routers: a tree of routes, as Express's routers nest ───────────────────────

/**
 * What a router sets for every route under it, at any depth. A child router or a route may
 * set its own `auth`, `responseHeaders` and `invalidRequest`; `access` checks only add up:
 * the ancestors' checks run first, then the child's, and a child cannot remove one.
 */
export type RouterDefaults = {
  auth?: RouteAuth;
  access?: AccessChecks;
  responseHeaders?: Record<string, string>;
  invalidRequest?: () => ContractError;
};

declare const pendingBrand: unique symbol;
/** A route written for contract `C` and not built yet: `api.mount` builds it with its routers' defaults. */
export type PendingRoute<C extends AnyRouteContract> = {
  readonly kind: 'PENDING_ROUTE';
  readonly contract: C;
  readonly impl: RouteImpl<C, AccessChecks>;
  readonly [pendingBrand]: true;
};

/** The entries a router must give: one per name of its table, a route for a contract, a router for a sub-table. */
export type RouterEntries<T> = {
  [K in keyof T]: T[K] extends AnyRouteContract ? PendingRoute<T[K]> : T[K] extends RouteTable ? RouterNode<T[K]> : never;
};

declare const routerBrand: unique symbol;
/** One router of the tree: its table (from the API table), its defaults, and its entries. */
export type RouterNode<T> = {
  readonly kind: 'ROUTER';
  readonly table: T;
  readonly defaults: RouterDefaults;
  readonly entries: RouterEntries<T>;
  readonly [routerBrand]: true;
};

type ContractNames<T> = { [K in keyof T]: T[K] extends AnyRouteContract ? K : never }[keyof T] & string;

/** Writes the route for one contract of a router's table: `serve('info', { controller: ... })`. */
export type Serve<T> = <K extends ContractNames<T>, A extends AccessChecks = Record<never, never>>(
  name: K,
  impl: RouteImpl<Extract<T[K], AnyRouteContract>, A>,
) => PendingRoute<Extract<T[K], AnyRouteContract>>;

/**
 * A router over one table of the API table (`api.apps.channel`): what its routes inherit, and
 * one entry per name of the table (a route via `serve`, or a child router). A missing entry,
 * an extra one, or a route served for another contract is a type error.
 *
 *   export const channelRouter = router(api.apps.channel, { access: { permission: appPermission('channels:read') } }, (serve) => ({
 *     info: serve('info', { controller: ({ query }) => channelInfo(query) }),
 *   }));
 *   export const appsRouter = router(api.apps, { auth: 'app' }, () => ({ channel: channelRouter, ... }));
 */
export function router<T extends RouteTable>(table: T, defaults: RouterDefaults, build: (serve: Serve<T>) => RouterEntries<T>): RouterNode<T> {
  const serve = ((name: string, impl: RouteImpl<AnyRouteContract, AccessChecks>) => ({
    kind: 'PENDING_ROUTE',
    contract: (table as Record<string, AnyRouteContract>)[name],
    impl })) as unknown as Serve<T>;
  return { kind: 'ROUTER', table, defaults, entries: build(serve) } as RouterNode<T>;
}

function mergeDefaults(parent: RouterDefaults, child: RouterDefaults, where: string): RouterDefaults {
  const access: AccessChecks = { ...(parent.access ?? {}) };
  for (const [name, check] of Object.entries(child.access ?? {})) {
    if (name in access) {
      // A child must not replace an ancestor's check: the ancestor's stays, the child's is dropped.
      logger.error('[api] access check name already set by an outer router; the outer one is kept', { where, check: name });
      continue;
    }
    access[name] = check;
  }
  return {
    auth: child.auth ?? parent.auth,
    access,
    responseHeaders: { ...(parent.responseHeaders ?? {}), ...(child.responseHeaders ?? {}) },
    invalidRequest: child.invalidRequest ?? parent.invalidRequest };
}

/** Builds and mounts every route under `node`, in table order, with the defaults of every router above it. */
function mountTree(node: RouterNode<RouteTable>, inherited: RouterDefaults): void {
  const defaults = mergeDefaults(inherited, node.defaults, 'router');
  for (const name of Object.keys(node.table)) {
    const entry = (node.entries as Record<string, PendingRoute<AnyRouteContract> | RouterNode<RouteTable>>)[name];
    if (!entry) {
      logger.error('[api] router has no entry for a table name; not mounted', { name });
      continue;
    }
    if (entry.kind === 'ROUTER') {
      mountTree(entry, defaults);
      continue;
    }
    const merged = mergeDefaults(defaults, { auth: entry.impl.auth, access: entry.impl.access as AccessChecks | undefined, responseHeaders: entry.impl.responseHeaders, invalidRequest: entry.impl.invalidRequest }, entry.contract.key);
    mount(build(entry.contract, { ...entry.impl, ...merged } as RouteImpl<AnyRouteContract, AccessChecks>));
  }
}

/** Mounts the whole router tree (the root router over the API table). Called once, at startup. */
export function mountApi(root: RouterNode<RouteTable>): void {
  mountTree(root, {});
}

/** Mount one typed route outside the tree (tests). The API table goes through `router` / `mountApi`. */
export function route<C extends AnyRouteContract, A extends AccessChecks = Record<never, never>>(contract: C, impl: RouteImpl<C, A>): void {
  mount(build(contract, impl));
}

/** createApp only: mounts the typed router at /api. */
export function mountTypedRoutes(app: Application): void {
  app.use('/api', typedRouter);
}

