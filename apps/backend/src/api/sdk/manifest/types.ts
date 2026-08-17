/**
 * The route manifest.
 *
 * Every /sdk endpoint is declared as data rather than as an Express handler
 * registration, because three consumers need the same description:
 *   - the runtime, to build the router and its middleware chain
 *   - the OpenAPI generator, to emit the committed spec
 *   - the coverage checker, to prove every catalog operation is either bound to
 *     an endpoint or explicitly excluded with a reason
 *
 * A route names the catalog query or mutator it is backed by. That binding is
 * the only place a version like `supportTicketsPageV4` appears — the public path
 * never carries one, so adopting a V5 later is a one-line manifest edit rather
 * than an API change.
 */

import type { Request, RequestHandler } from 'express';
import type { Scope } from '@xyne/spaces-contract';
import type { ZodTypeAny } from 'zod';
import type { SdkAuth } from '../middleware/authn';

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

export type IdempotencyPolicy =
  /** Endpoint is not safe to replay; the header is mandatory. */
  | 'required'
  /** Header is honoured when supplied. Natural for upserts and field updates. */
  | 'optional'
  /** Reads. */
  | 'none';

export interface RouteContext {
  readonly req: Request;
  readonly auth: SdkAuth;
  readonly params: Record<string, string>;
  readonly query: Record<string, unknown>;
  readonly body: unknown;
}

export interface RouteResult {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface RouteDefinition {
  readonly method: HttpMethod;
  /** Express path relative to the /sdk mount, e.g. `/channels/:channelId/participants`. */
  readonly path: string;
  /** Stable identifier used in OpenAPI and as the idempotency scope. */
  readonly operationId: string;
  readonly summary: string;
  readonly scope: Scope;
  readonly idempotency: IdempotencyPolicy;

  /** Route-local parsing such as multipart/form-data handling. */
  readonly middleware?: readonly RequestHandler[];

  /** Catalog query names this route reads from (for the coverage checker). */
  readonly queries?: readonly string[];
  /** Catalog mutator names this route writes through (for the coverage checker). */
  readonly mutators?: readonly string[];

  readonly request?: {
    readonly params?: ZodTypeAny;
    readonly query?: ZodTypeAny;
    readonly body?: ZodTypeAny;
  };
  /** Response schema for OpenAPI. Absent for 204 endpoints. */
  readonly response?: ZodTypeAny;

  readonly handler: (ctx: RouteContext) => Promise<RouteResult>;
}
