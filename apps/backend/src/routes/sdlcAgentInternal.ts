import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { resolveSdlcAgentRepositorySchema } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { SdlcHubService } from '@/sdlc';
import { linkHubSkill, readHubKnowledge } from '@/sdlc/hubKnowledge';
import { promoteRegisteredAgent } from '@/sdlc/sdlcHubAgents';

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

/** Claw-auth adds these to every run that starts in the hub. */
router.post(
  '/hub-knowledge',
  route(async (req, res) => {
    const input = hubKnowledgeSchema.parse(req.body);
    const knowledge = await readHubKnowledge(input.channelId, input.actorUserId);
    res.status(200).json({ success: true, ...knowledge });
  }),
);

const hubSkillSchema = hubKnowledgeSchema.extend({ skillId: z.string().min(1).max(64) });

/** Claw-auth calls this when a skill is created during a run, so a hub run's skill is linked to its hub. */
router.post(
  '/hub-skill',
  route(async (req, res) => {
    const input = hubSkillSchema.parse(req.body);
    const hub = await prisma.channel.findFirst({
      where: { id: input.channelId, type: 'SDLC' },
      select: { workspaceId: true },
    });
    if (hub) {
      await linkHubSkill(
        { userId: input.actorUserId, workspaceId: hub.workspaceId },
        input.channelId,
        input.skillId,
      );
    }
    res.status(204).send();
  }),
);

const agentRegisteredSchema = z.object({
  agentId: z.string().min(1),
  botUserId: z.string().min(1),
});

// claw-auth calls this when an agent's Spaces app is installed, so hub-created agents join their hub.
router.post(
  '/registered',
  route(async (req, res) => {
    const { agentId, botUserId } = agentRegisteredSchema.parse(req.body);
    const hubs = await promoteRegisteredAgent(prisma, agentId, botUserId);
    res.status(200).json({ success: true, hubs });
  }),
);

export default router;
