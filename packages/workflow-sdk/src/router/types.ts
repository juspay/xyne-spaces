/**
 * Router types — framework-agnostic request/response abstractions.
 *
 * The router produces plain handler functions. The host maps them to their
 * HTTP framework (Express, Fastify, Hono, etc.) with minimal glue code.
 */

import type { Attachment } from '../common/attachment.js';

// ─── Auth Context ───

/**
 * A minimal default ctx shape. Hosts are encouraged to define their OWN
 * strongly-typed ctx (e.g. `{ userId: number; workspaceId: string; role: Role }`)
 * and thread it through `createWorkflowRouter<TCtx>` — the router, runtime, and
 * authorizer are all generic over it. This type exists only as a convenient
 * default; nothing in the framework requires the untyped `metadata` bag.
 */
export interface AuthContext {
  userId: string;
  /** Host-defined metadata — workspaceId, tenantId, etc. */
  metadata: Record<string, unknown>;
}

// ─── Router Options ───

export interface RouterOptions<TCtx = AuthContext> {
  /**
   * Extract the typed ctx from request headers/cookies.
   * Throw to reject the request (the router will catch and return 401).
   */
  authenticate: (headers: Record<string, string | string[] | undefined>) => TCtx | Promise<TCtx>;
  rootId?: (ctx: TCtx) => string | undefined;
}

// ─── Route Handler Types ───

/** The shape every route handler returns. */
export interface RouteResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** If present, the host should stream this as SSE instead of sending body as JSON. */
  stream?: AsyncIterable<string>;
  /**
   * If present, the host pipes these bytes as the response body and ignores
   * {@link body}. For serving a file: the handler never holds it, so the
   * response costs the pipe's buffer rather than the file's size.
   */
  bodyStream?: NodeJS.ReadableStream;
}

/** Parsed request data passed to handlers. */
export interface RouteRequest {
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  /**
   * Uploaded files, as references — the bytes are already in storage.
   *
   * The framework never parses multipart and never sees a file's contents. The
   * host's middleware streams each part straight into its StorageAdapter while
   * parsing and puts the resulting {@link Attachment} here, so a request's
   * memory cost does not grow with the size of what it carries.
   *
   * A route that rejects the request is responsible for calling
   * `StorageAdapter.delete` on these, since they were stored before anyone
   * could judge them.
   */
  files?: Array<{ fieldName?: string; attachment: Attachment }>;
  signal?: AbortSignal;
  /**
   * The exact request bytes. Populated by the host for routes marked
   * {@link RouteDefinition.rawBody}, whose handlers authenticate the sender
   * over these bytes and parse the body themselves.
   */
  rawBody?: Uint8Array;
}

/**
 * Who a route's caller is. A host mounts each class behind the matching
 * middleware, and should switch over every value so a class added later cannot
 * be mounted open by accident.
 */
export type RouteAccess =
  /** A signed-in user of the host app. The host resolves the session into ctx. */
  | 'session'
  /**
   * An external system calling in, with no session and no ctx: a provider
   * delivering a webhook, a service resuming a paused run, or a client starting a
   * run through the API trigger route. The webhook and wait-callback routes
   * authenticate the request themselves. The API trigger route does not, so a
   * host that exposes it puts its own guard in front, such as an API key.
   */
  | 'provider';

/** A single route definition. `auth` is the host's typed ctx: null on `provider` routes. */
export interface RouteDefinition<TCtx = AuthContext> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  /** Who the caller is. See {@link RouteAccess}. */
  access: RouteAccess;
  /**
   * When true, the host must NOT parse the body and must pass the exact bytes as
   * `RouteRequest.rawBody`. Used by webhook ingest, where a signature covers the
   * bytes as sent and any re-serialisation breaks it.
   */
  rawBody?: boolean;
  /** Multipart parser mode the host should apply before calling the handler. */
  multipart?: 'files' | 'any';
  handler: (
    req: RouteRequest,
    auth: TCtx | null,
  ) => Promise<RouteResponse>;
}
