import type { z } from 'zod';
import type { Encrypted, RequestContract, RequestDerived, SourceToDerived } from './define.js';
import type { UnreadableString } from './unreadable-string.js';

/**
 * The methods a route contract may use. No `all`, no `head` (Express answers HEAD from the
 * GET route), no `options` (CORS preflight is answered by the cors middleware, before any route).
 */
export const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];

declare const routeBrand: unique symbol;

/**
 * One REST API, end to end: its address, the shape of what comes in (path params, query,
 * body), the shape of what goes out, and, when the client encrypts fields of the body, the
 * encryption contract the encryption service checks the request against.
 *
 * `path` is the address without the `/api` prefix, exactly as the manifest rules name it
 * (`/apps/chat/postMessage`). Routing is strict and case-sensitive: `/apps/chat/postMessage/`
 * and `/apps/chat/postmessage` are different addresses, and neither is this one.
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
  E extends RequestContract | undefined = RequestContract | undefined,
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
  /** The fields of the body the client encrypts, and the facts derived from them. */
  readonly encryption: E;
  readonly [routeBrand]: true;
}

/** Any route contract, whatever its types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouteContract = RouteContract<RouteMethod, string, any, any, any, any, any>;

type RouteSpec<
  M extends RouteMethod,
  P extends string,
  Params extends z.ZodType | undefined,
  Query extends z.ZodType | undefined,
  Body extends z.ZodType | undefined,
  Res extends z.ZodType,
  E extends RequestContract | undefined,
> = {
  method: M;
  path: P;
  params?: Params;
  query?: Query;
  body?: Body;
  response: Res;
  /**
   * The encryption contract. Its fields must all be fields of `body` (`routeSpecProblems`), so
   * one schema says what the body is and the encryption contract only says which of those
   * fields are encrypted.
   */
  encryption?: E;
};

/** Problems with a route spec; empty when it is fine. Shared by `defineRoute` and the tests. */
export function routeSpecProblems(spec: { method: string; path: string; body?: z.ZodType; encryption?: RequestContract }): string[] {
  const problems: string[] = [];
  if (!(ROUTE_METHODS as readonly string[]).includes(spec.method)) {
    problems.push(`method ${spec.method} is not one of ${ROUTE_METHODS.join(', ')}`);
  }
  if (!spec.path.startsWith('/')) problems.push(`path ${spec.path} must start with /`);
  if (spec.path.length > 1 && spec.path.endsWith('/')) problems.push(`path ${spec.path} must not end with /`);
  if (/^\/api(\/|$)/.test(spec.path)) problems.push(`path ${spec.path} must not start with /api (the mount adds it)`);
  if (/[*?+()]/.test(spec.path)) problems.push(`path ${spec.path} may use only plain segments and :params`);
  if (spec.encryption) {
    const bodyShape = (spec.body as { shape?: Record<string, unknown> } | undefined)?.shape;
    const encryptionFields = Object.keys(spec.encryption.schema.shape);
    const missing = bodyShape ? encryptionFields.filter((f) => !(f in bodyShape)) : encryptionFields;
    if (missing.length > 0) problems.push(`encryption fields missing from body: ${missing.join(', ')}`);
  }
  return problems;
}

/**
 * Define a route contract. Lives in this package, next to the encryption contracts, so the
 * backend and its clients share one definition of the request and the response.
 *
 *   export const appsChatPostMessage = defineRoute({
 *     method: 'POST',
 *     path: '/apps/chat/postMessage',
 *     body: postMessageBodySchema,
 *     response: chatActionResponseSchema,
 *     encryption: appsChatPostMessageClient,
 *   });
 */
export function defineRoute<
  M extends RouteMethod,
  const P extends string,
  Res extends z.ZodType,
  Params extends z.ZodType | undefined = undefined,
  Query extends z.ZodType | undefined = undefined,
  Body extends z.ZodType | undefined = undefined,
  E extends RequestContract | undefined = undefined,
>(spec: RouteSpec<M, P, Params, Query, Body, Res, E>): RouteContract<M, P, Params, Query, Body, Res, E> {
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
    encryption: spec.encryption as E,
  } as RouteContract<M, P, Params, Query, Body, Res, E>;
}

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

type UnreadableKeys<S> = S extends z.ZodObject
  ? { [K in keyof z.output<S>]: [NonNullable<z.output<S>[K]>] extends [UnreadableString] ? K : never }[keyof z.output<S>]
  : never;

/**
 * The body as the handler gets it: the checked (parsed) body, with the fields the client
 * encrypts branded as ciphertext. `unreadableString()` fields already have the
 * `UnreadableString` type from the schema.
 */
type BodyOf<B, E> = E extends RequestContract<infer S, infer D extends SourceToDerived>
  ? {
      [K in keyof Out<B>]: K extends keyof D
        ? K extends UnreadableKeys<S>
          ? Out<B>[K]
          : Encrypted<NonNullable<Out<B>[K]>> | Extract<Out<B>[K], null | undefined>
        : Out<B>[K];
    }
  : Out<B>;

export type RouteParams<C> = C extends RouteContract<RouteMethod, string, infer Params> ? Out<Params> : never;
export type RouteQuery<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, infer Q> ? Out<Q> : never;
export type RouteBody<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, z.ZodType | undefined, infer B, z.ZodType, infer E>
  ? BodyOf<B, E>
  : never;
/** What the client sends as the body, before parsing (defaults, trims and the like not applied). */
export type RouteBodyInput<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, z.ZodType | undefined, infer B>
  ? B extends z.ZodType
    ? z.input<B>
    : undefined
  : never;
export type RouteResponse<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, z.ZodType | undefined, z.ZodType | undefined, infer R>
  ? z.output<R>
  : never;
/** The facts the encryption service derived from the encrypted fields; absent when nothing was derived. */
export type RouteDerived<C> = C extends RouteContract<RouteMethod, string, z.ZodType | undefined, z.ZodType | undefined, z.ZodType | undefined, z.ZodType, infer E>
  ? E extends RequestContract
    ? RequestDerived<E> | undefined
    : undefined
  : never;

/** A group of routes (one entry of the API table). */
export type RouteGroup = { readonly [name: string]: AnyRouteContract };

/** Every route contract of a group or a nested table, flattened. */
export function routeContracts(table: object): AnyRouteContract[] {
  return Object.values(table).flatMap((entry) =>
    entry && typeof entry === 'object' && (entry as { kind?: unknown }).kind === 'ROUTE'
      ? [entry as AnyRouteContract]
      : entry && typeof entry === 'object'
        ? routeContracts(entry)
        : [],
  );
}
