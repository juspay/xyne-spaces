import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { resolveSdlcAgentRepositorySchema } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { SdlcHubService } from '@/sdlc';
import { readHubKnowledge } from '@/sdlc/hubKnowledge';

const router = Router();
const prisma = DatabaseClient.getInstance();
const sdlcHub = new SdlcHubService();

function route(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

router.post(
  '/repository-context',
  route(async (req, res) => {
    const input = resolveSdlcAgentRepositorySchema.parse(req.body);
    const repo = await prisma.repo.findUnique({
      where: { id: input.repoId },
      select: { workspaceId: true },
    });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);

    const actor = await prisma.user.findFirst({
      where: { id: input.actorUserId, workspaceId: repo.workspaceId },
      select: { id: true },
    });
    if (!actor) {
      throw new AppError('Initiating user is unavailable in this workspace', 403);
    }

    const context = await sdlcHub.getRepositoryRunContext(
      { userId: actor.id, workspaceId: repo.workspaceId },
      input.repoId,
      input.conversationId,
      input.channelId
    );
    res.status(200).json({ success: true, context });
  }),
);

const hubKnowledgeSchema = z.object({
  channelId: z.string().min(1),
  actorUserId: z.string().min(1),
});

/** Claw-auth prepends these to SDLC agent chats and channel pings. */
router.post(
  '/hub-knowledge',
  route(async (req, res) => {
    const input = hubKnowledgeSchema.parse(req.body);
    const documents = await readHubKnowledge(input.channelId, input.actorUserId);
    res.status(200).json({ success: true, documents });
  }),
);

export default router;
