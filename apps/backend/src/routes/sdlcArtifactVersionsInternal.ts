import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { AppError } from '@/middleware/errorHandler';
import { SdlcArtifactVersionStore } from '@/sdlc/SdlcArtifactVersionStore';

const router = Router();
const store = new SdlcArtifactVersionStore();

const selectorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('WIKI_PAGE'),
    path: z.string().trim().min(1).max(512),
    includeArchived: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('SDLC_CANVAS'),
    canvasId: z.string().trim().min(1).max(256),
  }).strict(),
]);

const bindingSchema = z.object({
  repoId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
  actorUserId: z.string().trim().min(1),
}).passthrough();

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

function parse<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const location = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      throw new AppError(`${location}${issue?.message ?? 'Invalid artifact history request'}`, 400);
    }
    throw error;
  }
}

function binding(req: Request) {
  const parsed = parse(() => bindingSchema.parse(req.body));
  const actingUserId = String(req.headers['x-xyne-acting-user-id'] ?? '').trim();
  if (!actingUserId || actingUserId !== parsed.actorUserId) {
    throw new AppError('SDLC artifact history binding mismatch', 403);
  }
  return {
    repoId: parsed.repoId,
    workspaceId: parsed.workspaceId,
    userId: parsed.actorUserId,
  };
}

router.post(
  '/current/list',
  route(async (req, res) => {
    const trusted = binding(req);
    const body = req.body as Record<string, unknown>;
    const rawKinds = Array.isArray(body.kinds) ? body.kinds : [];
    const mappedKinds = rawKinds.map((kind) => {
      const value = String(kind);
      if (value === 'PRD' || value === 'TECH_DOC') return 'ARTIFACT';
      return value;
    });
    const kinds = [
      ...new Set(
        mappedKinds.filter((kind): kind is 'WIKI' | 'BASELINE' | 'ARTIFACT' =>
          ['WIKI', 'BASELINE', 'ARTIFACT'].includes(kind)
        )
      ),
    ];
    if (kinds.length !== new Set(mappedKinds).size) {
      throw new AppError('Unsupported artifact kind', 400);
    }
    const artifacts = await store.listArtifacts({
      ...trusted,
      ...(kinds.length > 0 ? { kinds } : {}),
      includeArchived: body.includeArchived === true,
    });
    res.status(200).json({ success: true, artifacts });
  })
);

router.post(
  '/current/read',
  route(async (req, res) => {
    const trusted = binding(req);
    const body = req.body as Record<string, unknown>;
    const selector = parse(() => selectorSchema.parse(body.selector));
    const result = await store.readArtifact({ ...trusted, selector });
    res.status(200).json({ success: true, ...result });
  })
);

router.post(
  '/list',
  route(async (req, res) => {
    const trusted = binding(req);
    const body = req.body as Record<string, unknown>;
    const selector = parse(() => selectorSchema.parse(body.selector));
    const rawLimit = body.limit === undefined ? 10 : Number(body.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 25) {
      throw new AppError('limit must be an integer between 1 and 25', 400);
    }
    const cursor = body.cursor === undefined ? undefined : String(body.cursor).trim();
    if (body.cursor !== undefined && !cursor) throw new AppError('cursor must not be empty', 400);
    const result = await store.listVersions({
      ...trusted,
      selector,
      limit: rawLimit,
      ...(cursor ? { cursor } : {}),
    });
    res.status(200).json({ success: true, ...result });
  })
);

router.post(
  '/read',
  route(async (req, res) => {
    const trusted = binding(req);
    const body = req.body as Record<string, unknown>;
    const selector = parse(() => selectorSchema.parse(body.selector));
    const versionId = String(body.versionId ?? '').trim();
    if (!versionId) throw new AppError('versionId is required', 400);
    const result = await store.readVersion({ ...trusted, selector, versionId });
    res.status(200).json({ success: true, ...result });
  })
);

export default router;
