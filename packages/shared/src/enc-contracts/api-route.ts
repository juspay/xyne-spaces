import type { z } from 'zod';
import type { DerivedSpec, RequestContract, RequestDerived, SourceToDerived } from './define.js';
import { isUnreadableSchema, type UnreadableString } from './unreadable-string.js';

/**
 * The methods a route contract may use. No `all`, no `head` (Express answers HEAD from the
 * GET route), no `options` (CORS preflight is answered by the cors middleware, before any route).
 */
export const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];

declare const routeBrand: unique symbol;

/**
 * One REST API, end to end: its address, the shape of what comes in (path params, query,
 * body), the shape of what goes out, and, when the body has encrypted fields, the facts
 * derived from each of them.
 *
 * The body is ONE schema: a field marked `unreadableString()` is encrypted (the handler gets it
 * as `UnreadableString`), every other field is plain. `sourceToDerived` names, per encrypted field, the
 * facts the handler reads instead of its text.
 *
 * `path` is the address without the `/api` prefix, exactly as the manifest rules name it
 * (`/apps/chat/postMessage`). Routing is strict and case-sensitive: `/apps/chat/postMessage/`
 * and `/apps/chat/postmessage` are different addresses, and neither is this one. A contract
 * inside a `defineRouter` gets its router's prefix in front of its own path.
 *
 * Only `defineRoute` makes one (the brand); the backend mounts only these.
 */
export interface RouteContract<
  M extends RouteMethod = RouteMethod,
  P extends string = string,
  Params extends z.ZodType | undefined = z.ZodType | undefined,
  Query extends z.ZodType | undefined = z.ZodType | undefined,
  Body extends z.ZodType | undefined = z.ZodType | undefined,
  Res extends z.ZodType = z.ZodType,
  F extends SourceToDerived | undefined = SourceToDerived | undefined,
> {
  readonly kind: 'ROUTE';
  readonly method: M;
  readonly path: P;
  /** `"<METHOD> <path>"`, as the manifest rules and `matchesRoute` name a route. */
  readonly key: `${M} ${P}`;
  readonly params: Params;
  readonly query: Query;
  readonly body: Body;
  /** The success response. Checked in non-prod only, and a mismatch is only logged. */
  readonly response: Res;
  /** Per encrypted (`unreadableString()`) body field, the facts derived from it; undefined when none is encrypted. */
  readonly sourceToDerived: F;
  readonly [routeBrand]: true;
}

/** Any route contract, whatever its types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouteContract = RouteContract<RouteMethod, string, any, any, any, any, any>;

type IsAny<T> = 0 extends 1 & T ? true : false;

/** The body fields a schema marks `unreadableString()` (its output type is `UnreadableString`). */
export type UnreadableKeys<B> = B extends z.ZodType
  ? {
      [K in keyof z.output<B>]-?: IsAny<z.output<B>[K]> extends true
        ? never
        : [NonNullable<z.output<B>[K]>] extends [never]
          ? never
          : [NonNullable<z.output<B>[K]>] extends [UnreadableString]
            ? K
            : never;
    }[keyof z.output<B>]
  : never;

/** One facts entry per encrypted field of `B`: `{}` when nothing is derived from that field. */
export type FactsFor<B> = { readonly [K in UnreadableKeys<B>]: DerivedSpec };

type RouteSpec<
  M extends RouteMethod,
  P extends string,
  Params extends z.ZodType | undefined,
  Query extends z.ZodType | undefined,
  Body extends z.ZodType | undefined,
  Res extends z.ZodType,
  F,
> = {
  method: M;
  /** The path under the router's prefix: `/info`, or `''` for the router's own address. */
  path: P;
  params?: Params;
  query?: Query;
  body?: Body;
  response: Res;
} & FactsSpec<Body, F>;

/**
 * `sourceToDerived` is required when the body has `unreadableString()` fields: one entry per encrypted field
 * (`{}` when nothing is derived from it), and no other key (a key that is not an encrypted field
 * of the body is a type error). Leaving it out would also leave the route without its encryption
 * steps, so it is a type error too. A body without encrypted fields may leave it out.
 */
type FactsSpec<Body extends z.ZodType | undefined, F> = [UnreadableKeys<Body>] extends [never]
  ? { sourceToDerived?: F & { readonly [K in Exclude<keyof F, UnreadableKeys<Body>>]: never } }
  : { sourceToDerived: F & { readonly [K in Exclude<keyof F, UnreadableKeys<Body>>]: never } };

/** The shape of an object body schema (also when refined), else undefined. */
function bodyShape(body: unknown): Record<string, unknown> | undefined {
  const shape = (body as { shape?: unknown } | undefined)?.shape;
  return shape && typeof shape === 'object' ? (shape as Record<string, unknown>) : undefined;
}

/** The body's top-level `unreadableString()` fields. */
function unreadableFieldsOf(body: unknown): string[] {
  const shape = bodyShape(body);
  return shape ? Object.entries(shape).filter(([, field]) => isUnreadableSchema(field)).map(([name]) => name) : [];
}

/** Problems with a route spec; empty when it is fine. Shared by `defineRoute` and the tests. */
export function routeSpecProblems(spec: { method: string; path: string; body?: unknown; sourceToDerived?: unknown }): string[] {
  const problems: string[] = [];
  if (!(ROUTE_METHODS as readonly string[]).includes(spec.method)) {
    problems.push(`method ${spec.method} is not one of ${ROUTE_METHODS.join(', ')}`);
  }
  if (spec.path !== '' && !spec.path.startsWith('/')) problems.push(`path ${spec.path} must start with /`);
  if (spec.path.length > 1 && spec.path.endsWith('/')) problems.push(`path ${spec.path} must not end with /`);
  if (/^\/api(\/|$)/.test(spec.path)) problems.push(`path ${spec.path} must not start with /api (the mount adds it)`);
  if (/[*?+()]/.test(spec.path)) problems.push(`path ${spec.path} may use only plain segments and :params`);
  const encrypted = unreadableFieldsOf(spec.body);
  const factKeys = Object.keys((spec.sourceToDerived as object | undefined) ?? {});
  const withoutFacts = encrypted.filter((field) => !factKeys.includes(field));
  if (withoutFacts.length > 0) problems.push(`encrypted fields without a sourceToDerived entry: ${withoutFacts.join(', ')}`);
  const notEncrypted = factKeys.filter((field) => !encrypted.includes(field));
  if (notEncrypted.length > 0) problems.push(`sourceToDerived for fields that are not unreadableString() in the body: ${notEncrypted.join(', ')}`);
  return problems;
}

/**
 * Define a route contract. Lives in this package, so the backend and its clients share one
 * definition of the request and the response.
 *
 *   export const postMessage = defineRoute({
 *     method: 'POST',
 *     path: '/postMessage',
 *     body: z.object({ channelId: z.string(), text: unreadableString().optional() }),
 *     sourceToDerived: { text: { userIds: derive.userIds } },
 *     response: chatActionResponseSchema,
 *   });
 */
export function defineRoute<
  M extends RouteMethod,
  const P extends string,
  Res extends z.ZodType,
  Params extends z.ZodType | undefined = undefined,
  Query extends z.ZodType | undefined = undefined,
  Body extends z.ZodType | undefined = undefined,
  const F extends FactsFor<Body> | undefined = undefined,
>(spec: RouteSpec<M, P, Params, Query, Body, Res, F>): RouteContract<M, P, Params, Query, Body, Res, F> {
  // No throw here: a bad spec must not stop the backend from starting. The package's tests run
  // routeSpecProblems over every contract in the API table.
  return {
    kind: 'ROUTE',
    method: spec.method,
    path: spec.path,
    key: `${spec.method} ${spec.path}`,
    params: spec.params as Params,
    query: spec.query as Query,
    body: spec.body as Body,
    response: spec.response,
    sourceToDerived: spec.sourceToDerived as F,
  } as RouteContract<M, P, Params, Query, Body, Res, F>;
}

// ─── Routers: a prefix over a table of routes and routers ───────────────────────

/** What a router holds: routes and routers, by name. Its key order is the mount order. */
export type RouteTable = { readonly [name: string]: AnyRouteContract | RouteTable };

/** `T` with `Pre` in front of every path (and key) in it, at any depth. */
export type Prefixed<Pre extends string, T> = {
  readonly [K in keyof T]: T[K] extends RouteContract<infer M, infer P, infer Pa, infer Q, infer B, infer R, infer F>
    ? RouteContract<M, `${Pre}${P}`, Pa, Q, B, R, F>
    : Prefixed<Pre, T[K]>;
};

function isRouteContract(entry: unknown): entry is AnyRouteContract {
  return !!entry && typeof entry === 'object' && (entry as { kind?: unknown }).kind === 'ROUTE';
}

/**
 * A router: `prefix` in front of every route in `table`, at any depth, as Express's
 * `router.use(prefix, child)` does. Routers nest, so a leaf states only its own segment:
 *
 *   const channel = defineRouter('/channel', { info, list });     // GET /channel/info
 *   const apps = defineRouter('/apps', { channel });              // GET /apps/channel/info
 *
 * The routes it returns carry their full path and key; the table's key order is kept (it is
 * the mount order: a literal path before a `:param` one that could capture it).
 */
export function defineRouter<const Pre extends string, const T extends RouteTable>(prefix: Pre, table: T): Prefixed<Pre, T> {
  const prefixed: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(table)) {
    prefixed[name] = isRouteContract(entry)
      ? { ...entry, path: `${prefix}${entry.path}`, key: `${entry.method} ${prefix}${entry.path}` }
      : defineRouter(prefix, entry as RouteTable);
  }
  return prefixed as Prefixed<Pre, T>;
}

// ─── route(): a prefix over contracts written inline, and nested routes ───────────

/** A contract written inline in a `route()` table: what `defineRoute` takes. */
type InlineSpec = {
  readonly method: RouteMethod;
  readonly path: string;
  readonly response: z.ZodType;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly sourceToDerived?: unknown;
};

/** What a `route()` table holds, by name: contracts (inline, or built by a helper) and nested routes. */
export type RouteEntries = { readonly [name: string]: InlineSpec | AnyRouteContract | RouteTable };

type SpecSchema<S, K extends string> = S extends { readonly [P in K]: infer V } ? (V extends z.ZodType ? V : undefined) : undefined;

/** The contract an inline spec makes, with its exact types (as `defineRoute` makes it). */
type ContractOf<S> = S extends { readonly method: infer M extends RouteMethod; readonly path: infer P extends string; readonly response: infer R extends z.ZodType }
  ? RouteContract<M, P, SpecSchema<S, 'params'>, SpecSchema<S, 'query'>, SpecSchema<S, 'body'>, R, S extends { readonly sourceToDerived: infer F extends SourceToDerived } ? F : undefined>
  : never;

/** A table's entries as contracts: inline specs built, built contracts and nested routes as they are. */
export type RouteEntriesBuilt<T> = {
  readonly [K in keyof T]: T[K] extends AnyRouteContract ? T[K] : T[K] extends InlineSpec ? ContractOf<T[K]> : T[K];
};

/** An inline spec whose body has `unreadableString()` fields must give their `sourceToDerived` (as `defineRoute` requires). */
type FactsCheck<S> = [UnreadableKeys<SpecSchema<S, 'body'>>] extends [never] ? unknown : { readonly sourceToDerived: FactsFor<SpecSchema<S, 'body'>> };
type EntriesCheck<T> = { readonly [K in keyof T]: T[K] extends AnyRouteContract ? unknown : T[K] extends InlineSpec ? FactsCheck<T[K]> : unknown };

function isInlineSpec(entry: unknown): entry is InlineSpec {
  return !!entry && typeof entry === 'object' && !isRouteContract(entry) && typeof (entry as { method?: unknown }).method === 'string' && 'response' in entry;
}

/**
 * A route: `prefix` in front of every API in `table`, at any depth. Each entry is a contract,
 * written inline in front of its name, or a nested route:
 *
 *   export const emojis = route('/emojis', {
 *     list: { method: 'GET', path: '', response: listAnswer },            // GET /emojis
 *     get:  { method: 'GET', path: '/:emojiId', params: emojiId, response: emojiAnswer },
 *   });
 *   export const apps = route('/apps', { chat, calls });                  // nested: /apps/chat/…
 *
 * A contract a helper builds (`analytics('active-users', …)`) is an entry too. The table's key
 * order is the mount order: a literal path before a `:param` one that could capture it.
 */
export function route<const Pre extends string, const T extends RouteEntries>(
  prefix: Pre,
  table: T & EntriesCheck<T>,
): Prefixed<Pre, RouteEntriesBuilt<T>> {
  const built: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(table)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    built[name] = isInlineSpec(entry) ? defineRoute(entry as any) : entry;
  }
  return defineRouter(prefix, built as RouteTable) as unknown as Prefixed<Pre, RouteEntriesBuilt<T>>;
}

// ─── The login each route needs (the API's auth map) ────────────────────────────

/** The login a route needs: a session, a Xyne App's bot token, a Slack-compatible bot token, or none. */
export type RouteAuth = 'session' | 'app' | 'slack-app' | 'public';

/**
 * One login per route of `T`, in the shape of the API tree: a route's own login, or one login for
 * a whole route (any but `public`, so a route added to it later is never public by accident).
 * Every route must be covered: a missing one is a type error.
 */
export type AuthMap<T> = {
  readonly [K in keyof T]: T[K] extends AnyRouteContract ? RouteAuth : Exclude<RouteAuth, 'public'> | AuthMap<T[K]>;
};

/** The login of each route, by contract. */
export type RouteAuths = { readonly of: (contract: AnyRouteContract) => RouteAuth | undefined };

/** The API's auth map: `defineAuth(api, { emojis: 'session', health: { health: 'public', details: 'session' } })`. */
export function defineAuth<const T extends RouteTable>(api: T, map: AuthMap<T>): RouteAuths {
  const byContract = new Map<AnyRouteContract, RouteAuth>();
  const walk = (table: object, entry: unknown, inherited: RouteAuth | undefined): void => {
    for (const [name, value] of Object.entries(table)) {
      const own = typeof entry === 'string' ? undefined : (entry as Record<string, unknown> | undefined)?.[name];
      if (isRouteContract(value)) {
        const authFor = (typeof own === 'string' ? own : undefined) ?? inherited;
        if (authFor) byContract.set(value, authFor as RouteAuth);
      } else if (value && typeof value === 'object') {
        walk(value, own, typeof own === 'string' ? (own as RouteAuth) : inherited);
      }
    }
  };
  walk(api, map, typeof map === 'string' ? (map as RouteAuth) : undefined);
  return { of: (contract) => byContract.get(contract) };
}

// ─── The encryption side of a contract ─────────────────────────────────────────

const requestContracts = new WeakMap<object, RequestContract | null>();

/**
 * The request contract the encryption pipeline works with (`{ schema, sourceToDerived,
 * unreadableFields }`), built from the route's one body schema and its `sourceToDerived`; undefined when
 * the body has no encrypted field. Built once per contract.
 */
export function requestContractOf(contract: AnyRouteContract): RequestContract | undefined {
  const cached = requestContracts.get(contract);
  if (cached !== undefined) return cached ?? undefined;
  const unreadableFields = unreadableFieldsOf(contract.body);
  const built: RequestContract | null =
    unreadableFields.length === 0
      ? null
      : {
          kind: 'REQUEST',
          schema: contract.body as z.ZodObject,
          sourceToDerived: (contract.sourceToDerived ?? {}) as SourceToDerived,
          unreadableFields,
        };
  requestContracts.set(contract, built);
  return built ?? undefined;
}

// ─── Types read back from a contract ───────────────────────────────────────────

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export type RouteParams<C> = C extends RouteContract<RouteMethod, string, infer Params> ? Out<Params> : never;
export type RouteQuery<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, infer Q> ? Out<Q> : never;
/** The checked body: `unreadableString()` fields are `UnreadableString` (the schema's output type). */
export type RouteBody<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, z.ZodType | undefined, infer B> ? Out<B> : never;
/** What the client sends as the body, before parsing (defaults, trims and the like not applied). */
export type RouteBodyInput<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, z.ZodType | undefined, infer B>
  ? B extends z.ZodType
    ? z.input<B>
    : undefined
  : never;
export type RouteResponse<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, z.ZodType | undefined, z.ZodType | undefined, infer R>
  ? z.output<R>
  : never;
/** The facts derived from the encrypted fields; absent when nothing was derived. */
export type RouteDerived<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, z.ZodType | undefined, z.ZodType | undefined, z.ZodType, infer F>
  ? F extends SourceToDerived
    ? RequestDerived<RequestContract<z.ZodObject, F>> | undefined
    : undefined
  : never;

/** A group of routes (one entry of the API table). */
export type RouteGroup = { readonly [name: string]: AnyRouteContract };

/** Every route contract of a group or a nested table, flattened. */
export function routeContracts(table: object): AnyRouteContract[] {
  return Object.values(table).flatMap((entry) =>
    isRouteContract(entry) ? [entry] : entry && typeof entry === 'object' ? routeContracts(entry) : [],
  );
}
