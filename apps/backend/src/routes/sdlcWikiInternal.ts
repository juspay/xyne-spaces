import { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { listSdlcWikiPagesSchema, writeSdlcWikiPageSchema } from '@xyne/shared';
import { AppError } from '@/middleware/errorHandler';
import { sdlcWikiPageStore } from '@/sdlc/wiki/SdlcWikiPageStore';

const router = Router();

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

function parse<T extends { actorUserId: string }>(schema: ZodType<T>, req: Request): T {
  let input: T;
  try {
    input = schema.parse(req.body);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const issue = error.issues[0];
    const location = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new AppError(`${location}${issue?.message ?? 'Invalid wiki request'}`, 400);
  }
  if (String(req.headers['x-xyne-acting-user-id'] ?? '').trim() !== input.actorUserId) {
    throw new AppError('SDLC wiki binding mismatch', 403);
  }
  return input;
}

router.post(
  '/pages/list',
  route(async (req, res) => {
    const pages = await sdlcWikiPageStore.listPages(parse(listSdlcWikiPagesSchema, req));
    res.status(200).json({ success: true, pages });
  })
);

router.post(
  '/pages/write',
  route(async (req, res) => {
    const page = await sdlcWikiPageStore.write(parse(writeSdlcWikiPageSchema, req));
    res.status(200).json({ success: true, page });
  })
);

export default router;
