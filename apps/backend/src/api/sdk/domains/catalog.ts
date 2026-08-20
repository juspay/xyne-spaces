/**
 * Access to the Zero query and mutator catalogs.
 *
 * An API key acts as its user, and Zero's per-table ACL — folded into every query
 * AST and every wrapped transaction — decides what that user may read and write.
 * That ACL is the authorization boundary for these endpoints.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { ApiError } from '../errors';
import { callQuery } from '../query';
import { callMutator } from '../engine/mutations';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();
const requestSchema = z.object({
  name: z.string().min(1),
  args: z.unknown().optional(),
});

router.post('/query', rateLimit('read'), asyncHandler('query'));
router.post('/mutate', rateLimit('write'), asyncHandler('mutator'));

function asyncHandler(kind: 'query' | 'mutator') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = req.sdkAuth;
      if (!auth) throw new ApiError('unauthenticated', 'Missing authenticated principal.');

      const { name, args } = requestSchema.parse(req.body);

      if (kind === 'query') {
        res.status(200).json({ data: await callQuery(name, args, auth.ctx) });
        return;
      }

      await callMutator({ name, args, authData: auth.authData, ctx: auth.ctx });
      res.status(200).json({ success: true });
    } catch (err) {
      next(err instanceof ZodError ? ApiError.validation(err) : err);
    }
  };
}

export { router as catalogRouter };
