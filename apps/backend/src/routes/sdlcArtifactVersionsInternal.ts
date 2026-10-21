import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { AppError, zodErrorToAppError } from '@/middleware/errorHandler';
import { SdlcArtifactVersionStore } from '@/sdlc/SdlcArtifactVersionStore';

const router = Router();
const store = new SdlcArtifactVersionStore();

const bindingSchema = z.object({
  workspaceId: z.string().trim().min(1),
  actorUserId: z.string().trim().min(1),
}).passthrough();

const canvasIdSchema = z.string().trim().min(1).max(256);

const listSchema = z.object({
  channelId: z.string().trim().min(1),
  artifactTypeId: z.string().trim().min(1).optional(),
  trackId: z.string().trim().min(1).optional(),
  trackFolderId: z.string().trim().min(1).optional(),
  includeArchived: z.boolean().optional(),
});

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

function parse<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (error instanceof ZodError) throw zodErrorToAppError(error, 'Invalid artifact history request');
    throw error;
  }
}

function binding(req: Request) {
  const parsed = parse(() => bindingSchema.parse(req.body));
  const actingUserId = String(req.headers['x-xyne-acting-user-id'] ?? '').trim();
  if (!actingUserId || actingUserId !== parsed.actorUserId) {
    throw new AppError('SDLC artifact history binding mismatch', 403);
  }
  return { workspaceId: parsed.workspaceId, userId: parsed.actorUserId };
}

function canvasId(req: Request): string {
  return parse(() => canvasIdSchema.parse((req.body as Record<string, unknown>).canvasId));
}

router.post(
  '/current/list',
  route(async (req, res) => {
    const trusted = binding(req);
    const filters = parse(() => listSchema.parse(req.body));
    const artifacts = await store.listArtifacts({ ...trusted, ...filters });
    res.status(200).json({ success: true, artifacts });
  })
);

router.post(
  '/current/read',
  route(async (req, res) => {
    const trusted = binding(req);
    const versionId = String((req.body as Record<string, unknown>).versionId ?? '').trim();
    const result = versionId
      ? await store.readVersion({ ...trusted, canvasId: canvasId(req), versionId })
      : await store.readArtifact({ ...trusted, canvasId: canvasId(req) });
    res.status(200).json({ success: true, ...result });
  })
);

router.post(
  '/list',
  route(async (req, res) => {
    const trusted = binding(req);
    const body = req.body as Record<string, unknown>;
    const rawLimit = body.limit === undefined ? 10 : Number(body.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 25) {
      throw new AppError('limit must be an integer between 1 and 25', 400);
    }
    const cursor = body.cursor === undefined ? undefined : String(body.cursor).trim();
    if (body.cursor !== undefined && !cursor) throw new AppError('cursor must not be empty', 400);
    const result = await store.listVersions({
      ...trusted,
      canvasId: canvasId(req),
      limit: rawLimit,
      ...(cursor ? { cursor } : {}),
    });
    res.status(200).json({ success: true, ...result });
  })
);

export default router;
