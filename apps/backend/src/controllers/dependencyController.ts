import type { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import * as dependencies from '@/services/dependencies/dependencyService';
import { ticketDependenciesEnabled } from '@/services/dependencies/featureFlag';
import { createBlocksSchema, dependencySettingsSchema, subTicketGatingSchema, DependencyError } from '@/services/dependencies/types';
import type { SubTicketLinkActor } from '@/services/subTicketLinkService';

function endpoint(fn: (req: Request, actor: SubTicketLinkActor) => Promise<unknown>) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!(await ticketDependenciesEnabled(workspaceId))) {
      res.status(404).json({ error: 'Ticket dependencies are not enabled' }); return;
    }
    try {
      res.json(await fn(req, { userId, workspaceId, role: '' }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid dependency settings', code: 'DEPENDENCY_INPUT' });
      } else if (error instanceof DependencyError) {
        res.status(error.status).json({ error: error.message, code: error.code });
      } else {
        logger.error('[Dependencies] Request failed', { error });
        res.status(500).json({ error: 'Dependency request failed' });
      }
    }
  };
}

export const dependencyController = {
  read: endpoint((req, actor) => {
    const { ticketIds } = z.object({ ticketIds: z.array(z.string().min(1)).min(1).max(200) }).strict().parse(req.body);
    return dependencies.readDependencies(actor, ticketIds);
  }),
  create: endpoint((req, actor) => dependencies.createBlocks(actor, createBlocksSchema.parse(req.body))),
  update: endpoint((req, actor) => dependencies.updateBlocks(actor, req.params.dependencyId!, dependencySettingsSchema.parse(req.body))),
  remove: endpoint((req, actor) => dependencies.deleteBlocks(actor, req.params.dependencyId!)),
  satisfy: endpoint((req, actor) => dependencies.markSatisfied(actor, req.params.dependencyId!)),
  updateChild: endpoint((req, actor) => dependencies.updateSubTicketGating(actor, req.params.mappingId!, { ...subTicketGatingSchema.parse(req.body), satisfiedStageId: null })),
};
