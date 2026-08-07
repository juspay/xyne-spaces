/** OAuth-protected access to the Zero query and mutator catalogs used by the SDK. */

import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  ADMIN_SCOPE,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  type Scope,
} from '@xyne/spaces-contract';
import { z, ZodError } from 'zod';
import { catalogOperationScopes } from '../catalog-operation-scopes.generated';
import { ApiError } from '../errors';
import { callQuery } from '../engine/queries';
import { callMutator } from '../engine/mutations';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();
const requestSchema = z.object({
  name: z.string().min(1),
  args: z.unknown().optional(),
});

router.post('/query', rateLimit('read'), asyncHandler('query'));
router.post('/mutate', rateLimit('write'), asyncHandler('mutator'));

function asyncHandler(expectedKind: 'query' | 'mutator') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = req.sdkAuth;
      if (!auth) throw new ApiError('unauthenticated', 'Missing authenticated principal.');

      const parsed = requestSchema.parse(req.body);
      const operation = lookupOperation(parsed.name);
      if (operation.kind !== expectedKind) {
        throw new ApiError(
          'invalid_request',
          `Catalog operation "${parsed.name}" is not a ${expectedKind}.`,
        );
      }
      requireAnyScope(auth.scopes, operation.scopes as readonly Scope[]);

      if (expectedKind === 'query') {
        const data = await callQuery(parsed.name, parsed.args, auth.ctx);
        res.status(200).json({ data });
        return;
      }

      const idempotencyKey = req.header(IDEMPOTENCY_KEY_HEADER)?.trim();
      if (idempotencyKey && idempotencyKey.length > 255) {
        throw new ApiError(
          'invalid_request',
          `${IDEMPOTENCY_KEY_HEADER} must be 255 characters or fewer.`,
        );
      }

      const result = await callMutator({
        name: parsed.name,
        args: parsed.args,
        authData: auth.authData,
        ctx: auth.ctx,
        endpoint: `/catalog/mutate/${parsed.name}`,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      if (result.storedResponse) {
        res.status(result.storedResponse.status).json(result.storedResponse.body);
        return;
      }
      res.status(200).json({ success: true });
    } catch (err) {
      next(err instanceof ZodError ? ApiError.validation(err) : err);
    }
  };
}

function lookupOperation(name: string): {
  readonly kind: 'query' | 'mutator';
  readonly scopes: readonly string[];
} {
  const operation = (catalogOperationScopes as Record<
    string,
    { readonly kind: 'query' | 'mutator'; readonly scopes: readonly string[] }
  >)[name];
  if (!operation) {
    throw new ApiError('invalid_request', `Unknown or unexposed catalog operation "${name}".`);
  }
  return operation;
}

function requireAnyScope(granted: readonly Scope[], required: readonly Scope[]): void {
  if (granted.includes(ADMIN_SCOPE) || required.some((scope) => granted.includes(scope))) return;
  throw new ApiError(
    'insufficient_scope',
    `This catalog operation requires one of: ${required.join(', ')}.`,
    { details: required.map((scope) => ({ issue: `missing scope: ${scope}` })) },
  );
}

export { router as catalogRouter };
