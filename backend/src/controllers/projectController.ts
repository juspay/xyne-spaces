import { Request, Response } from 'express';
import { ProjectRepository } from '../database/repositories/projectRepository';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { projectSchema } from '@/vespa/src/types';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { sanitizeProjectCode, isValidProjectCode } from '@xyne/shared';

export class ProjectController {
  private projectRepository: ProjectRepository;

  constructor() {
    this.projectRepository = new ProjectRepository();
  }

  createProject = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description, code } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!name || typeof name !== 'string' || name.trim() === '') {
        res.status(400).json({ error: 'Project name is required' });
        return;
      }

      // Check for duplicate name before creating
      const isDuplicate = await this.projectRepository.checkDuplicateName(name.trim());
      if (isDuplicate) {
        res.status(409).json({ error: `Project with name '${name.trim()}' already exists` });
        return;
      }

      // Validate project code is provided
      if (!code || typeof code !== 'string') {
        res.status(400).json({ error: 'Project code is required' });
        return;
      }

      // Sanitize code using shared utility
      const sanitizedCode = sanitizeProjectCode(code);

      // Validate format: at least 3 uppercase letters
      if (!isValidProjectCode(sanitizedCode)) {
        res.status(400).json({
          error: 'Invalid project code',
          message: `Project code must be at least 3 uppercase letters (e.g., EUL, INT, PROJ). Received: '${code}'`,
          sanitizedCode
        });
        return;
      }

      // Check code uniqueness
      const duplicateCheck = await this.projectRepository.checkDuplicateCodeWithInfo(sanitizedCode);
      if (duplicateCheck.exists) {
        res.status(409).json({
          error: `Duplicate project code used by project ${duplicateCheck.existingProject?.name}`,
          message: `Project code '${sanitizedCode}' is already in use by project '${duplicateCheck.existingProject?.name}'`
        });
        return;
      }

      const project = await this.projectRepository.create({
        name: name.trim(),
        description: description?.trim(),
        createdBy: userId,
        code: sanitizedCode,
      });

      // Queue Vespa job in background - worker will handle all processing
      vespaQueue.addJob({
        schema: projectSchema,
        jobType: "feed",
        docId: project.id,
        userId: userId
      }).catch(async (error) => {
        logger.error('Error queuing Vespa job for project:', error);
        // Log failed insertion to Postgres for later retry
        try {
          const vespaLogs = db.vespaInsertionLogs;
          if (vespaLogs) {
            await vespaLogs.create({
              data: {
                status: "FAILED",
                type: "INSERT",
                entityId: project.id,
                entityType: projectSchema,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
                errorDetails: JSON.stringify(error),
                userId: userId,
                createdAt: new Date(),
              },
            });
          }
        } catch (dbError) {
          logger.error('Failed to log Vespa insertion error to database:', dbError);
        }
      });

      res.status(201).json({
        success: true,
        message: 'Project created successfully',
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          createdBy: project.createdBy,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      });
    } catch (error) {
      logger.error('Error creating project:', error);

      if (error instanceof Error && error.message.includes('already exists')) {
        res.status(409).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
