import { Router, Request, Response } from 'express';
import { DatabaseClient } from '@/database/client';

const router = Router();
const prisma = DatabaseClient.getInstance();

router.get('/workspace-type', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = typeof req.query.workspaceId === 'string'
    ? req.query.workspaceId.trim()
    : '';

  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { workspaceType: true },
  });

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  res.status(200).json({
    workspaceId,
    workspaceType: workspace.workspaceType,
  });
});

export default router;
