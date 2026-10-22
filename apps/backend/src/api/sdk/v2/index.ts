/**
 * The v2 SDK router.
 *
 * v2 is v1 plus the Claw product API. Operation ids resolve exactly as in v1
 * unless `V2_OVERRIDES` says otherwise, and every direct route is the same
 * route; what v2 adds is:
 *
 *   POST /claw/runs/stream          an agent run as a live event stream
 *   POST /claw/runs/stream/cancel   stop one
 *   *    /claw/api/*                claw-auth's product API, as the caller
 *
 * Nothing v1 serves changes meaning here. A change of meaning for an existing
 * id goes in `V2_OVERRIDES`, which v1 never reads.
 */

import type { Router } from 'express';
import { createClawProxyRouter } from '../claw/proxy';
import { createClawRunStreamRouter } from '../claw/run-stream';
import { createSdkVersionRouter, resolveV1Operation } from '../v1';
import type { V1Target } from '../v1/types';

/** Operation ids whose v2 target differs from v1's. None yet. */
const V2_OVERRIDES: Readonly<Record<string, V1Target>> = {};

export function resolveV2Operation(op: string): V1Target | undefined {
  return Object.prototype.hasOwnProperty.call(V2_OVERRIDES, op)
    ? V2_OVERRIDES[op]
    : resolveV1Operation(op);
}

/** The authenticated v2 surface, mounted beside v1 — see `../index.ts`. */
export function createSdkV2Router(): Router {
  return createSdkVersionRouter({
    label: 'v2',
    resolve: resolveV2Operation,
    // The typed run stream before the proxy: `/claw/runs/*` and `/claw/api/*`
    // do not overlap today, and this keeps it that way if a mount ever does.
    routers: [createClawRunStreamRouter(), createClawProxyRouter()],
  });
}
