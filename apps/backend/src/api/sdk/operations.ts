/**
 * Operation-id resolution for API v3, kept free of router and controller imports so code
 * outside the SDK router (the request-body decrypt in `middleware/decryptionMiddleware.ts`)
 * can ask which Zero mutator a call runs without pulling the SDK surface in.
 */

import type { Request } from 'express';
import { resolveV1Operation, v1OperationIds } from './v1/mapper';
import type { V1Target } from './v1/types';

/** Operation ids whose v3 target differs from v1's. None yet. */
const V3_OVERRIDES: Readonly<Record<string, V1Target>> = {};

/** Resolve a v3 operation id, or undefined when v3 does not define it. */
export function resolveV3Operation(op: string): V1Target | undefined {
  return Object.prototype.hasOwnProperty.call(V3_OVERRIDES, op) ? V3_OVERRIDES[op] : resolveV1Operation(op);
}

/** Every operation id v3 resolves. */
export function v3OperationIds(): string[] {
  return [...new Set([...v1OperationIds(), ...Object.keys(V3_OVERRIDES)])];
}

const V3_MUTATE_PATH = '/api/sdk/v3/mutate';

/**
 * The Zero mutator a `POST /api/sdk/v3/mutate` request runs, from its `op`. Undefined for any
 * other request, an unknown op, or an op that is not a mutator.
 */
export function sdkMutatorNameFor(req: Request): string | undefined {
  if (req.method?.toUpperCase() !== 'POST') return undefined;
  if (req.originalUrl.split('?')[0] !== V3_MUTATE_PATH) return undefined;
  const op = (req.body as { op?: unknown } | null)?.op;
  if (typeof op !== 'string') return undefined;
  const target = resolveV3Operation(op);
  return target?.kind === 'mutator' ? target.name : undefined;
}
