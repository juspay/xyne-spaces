import type { NextFunction, Request, Response } from 'express';
import { ADMIN_SCOPE, type Scope } from '@xyne/spaces-contract';
import { ApiError } from '../errors';

/**
 * Scope gate. `spaces.admin` is a superuser scope over the whole surface; every
 * other scope grants exactly what it names.
 *
 * Note this is authorization over the API surface only — row-level access is
 * still enforced underneath by the Zero ACL layers (read ACL folded into the
 * query AST, write ACL deny-by-default in the transaction wrapper).
 */
export function requireScope(scope: Scope) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const granted = req.sdkAuth?.scopes ?? [];
    if (granted.includes(scope) || granted.includes(ADMIN_SCOPE)) {
      next();
      return;
    }
    next(
      new ApiError('insufficient_scope', `This endpoint requires the "${scope}" scope.`, {
        details: [{ issue: `missing scope: ${scope}` }],
      }),
    );
  };
}
