import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { issueSpacesToken } from '@/serviceAccounts/login';

const TokenSchema = z.object({ email: z.string().trim().email().max(254) }).strict();

export class S2sAuthController {
  token = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = TokenSchema.parse(req.body);
      res.status(200).json(await issueSpacesToken(req.serviceAccount!, 'email', input));
    } catch (err) {
      next(err);
    }
  };
}
