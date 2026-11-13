/**
 * Default authorization implementations.
 */

import type { WorkflowAuthorizer, ResourceRef, ResourceType, Action } from './types.js';
import { ALL_ACTIONS, refLabel } from './types.js';
import type { IdScope } from './id-scope.js';

/**
 * Grants everything, sees everything. The default when no `authorizer` is
 * configured, so the SDK runs zero-config (tests, local dev, single-tenant).
 *
 * Production deployments MUST supply their own {@link WorkflowAuthorizer}.
 */
export class AllowAllAuthorizer<TCtx> implements WorkflowAuthorizer<TCtx, IdScope> {
  async permissions(_ctx: TCtx, _ref: ResourceRef): Promise<readonly Action[]> {
    return ALL_ACTIONS;
  }

  // Parameters spelled out even though both are ignored: this class is the
  // reference a host copies to start their own authorizer, so it should show
  // the arguments a real decision is made from.
  async visibleFilter(_ctx: TCtx, _type: ResourceType): Promise<IdScope> {
    return { kind: 'all' };
  }
}

/**
 * Thrown by the runtime when `permissions` does not include the attempted
 * action. The router maps this to a 403 response.
 */
export class AccessDeniedError extends Error {
  constructor(
    public readonly action: Action,
    public readonly ref: ResourceRef,
  ) {
    super(`Access denied: ${action} on ${refLabel(ref)}`);
    this.name = 'AccessDeniedError';
  }
}

/** Thrown when a resource the caller asked for does not exist. */
export class ResourceNotFoundError extends Error {
  constructor(
    public readonly type: string,
    public readonly id: string,
  ) {
    super(`${type} ${id} not found`);
    this.name = 'ResourceNotFoundError';
  }
}
