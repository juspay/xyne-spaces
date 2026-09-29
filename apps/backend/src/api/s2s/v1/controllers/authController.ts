import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { s2sIssueSpacesToken } from '@/bypassAcl/serviceAccountS2sServices';

const TokenSchema = z.object({ email: z.string().trim().email().max(254) }).strict();

export class S2sAuthController {
  token = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = TokenSchema.parse(req.body);
      res.status(200).json(await s2sIssueSpacesToken(req.serviceAccount!, req.serviceAccountKeyId!, input.email));
    } catch (err) {
      next(err);
    }
  };
}
