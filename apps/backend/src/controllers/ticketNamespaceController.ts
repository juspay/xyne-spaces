import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { sanitizeProjectCode, isValidProjectCode, WorkspaceRole } from '@xyne/shared';
import { TicketNamespaceRepository } from '@/database/repositories/ticketNamespaceRepository';
import { ProjectRepository } from '@/database/repositories/projectRepository';
import { DatabaseClient } from '@/database/client';
import { ticketNamespacesActivated } from '@/utils/ticketNamespaceUtils';
import { logger } from '@/utils/logger';

export class TicketNamespaceController {
  private repo: TicketNamespaceRepository;
  private projectRepo: ProjectRepository;

  constructor() {
    this.repo = new TicketNamespaceRepository();
    this.projectRepo = new ProjectRepository();
  }

  // Reads go through the Zero query `ticketNamespacesByProject`; only the write is REST,
  // matching how projects/boards are created.
  createNamespace = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (req.user?.role === WorkspaceRole.GUEST) {
        res.status(403).json({ error: 'Guests cannot create ticket codes' });
        return;
      }

      // Only the backfill bootstraps the first namespace; custom prefixes can't be
      // created until the feature is activated. This also keeps the rollout delta safe.
      if (!(await ticketNamespacesActivated(DatabaseClient.getInstance()))) {
        res.status(409).json({ error: 'Ticket namespaces are not enabled yet' });
        return;
      }

      const { projectId, code, name } = req.body;
      if (!projectId || typeof projectId !== 'string') {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      if (!code || typeof code !== 'string') {
        res.status(400).json({ error: 'code is required' });
        return;
      }

      const project = await this.projectRepo.findById(projectId);
      if (!project || project.workspaceId !== workspaceId) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const sanitizedCode = sanitizeProjectCode(code);
      if (!isValidProjectCode(sanitizedCode)) {
        res.status(400).json({
          error: 'Invalid code',
          message: `Ticket code must be at least 2 uppercase letters/numbers (e.g., EU, PR, X2). Received: '${code}'`,
          sanitizedCode,
        });
        return;
      }

      const available = await this.repo.isCodeAvailable(sanitizedCode, workspaceId);
      if (!available) {
        res.status(409).json({ error: `Ticket code '${sanitizedCode}' is already in use in this workspace` });
        return;
      }

      const namespace = await this.repo.create({
        code: sanitizedCode,
        name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
        workspaceId,
        projectId,
        createdBy: userId,
      });

      res.status(201).json({
        success: true,
        namespace: { id: namespace.id, code: namespace.code, name: namespace.name, projectId: namespace.projectId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'Ticket code is already in use in this workspace' });
        return;
      }
      logger.error('Error creating ticket namespace:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
