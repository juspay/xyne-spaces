/**
 * Slack List Route
 * Lists slack-related data without Slack request verification
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { ingestSlackList, SlackListResponse } from './slackListService';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import { ProjectRepository } from '../../database/repositories/projectRepository';
import { BoardRepository } from '../../database/repositories/boardRepository';
import { DatabaseClient } from '../../database/client';
import { FormContextType, FormEntityType } from '@xyne/shared';
import { authMiddleware } from '../../middleware/auth';

const router = Router();

interface SlackListRequest extends Request {
  body: SlackListResponse;
}

const sendError = (res: Response, statusCode: number, errorMessage: string) => {
  return res.status(statusCode).json({
    success: false,
    error: errorMessage,
  });
};

router.post('/slack-list', authMiddleware.authenticate, async (req: SlackListRequest, res: Response) => {
  try {
    logger.info('[Slack List] Request received', {
      body: req.body,
      headers: req.headers,
    });

    if (!req.body.channelId || !req.body.ingestionData) {
      return sendError(res, 400, 'Missing required fields: channelId and ingestionData are required');
    }

    if (!Array.isArray(req.body.ingestionData) || req.body.ingestionData.length === 0) {
      return sendError(res, 400, 'ingestionData must be a non-empty array');
    }

    // Validate channel exists
    const channelRepo = new ChannelRepository();
    const channel = await channelRepo.findById(req.body.channelId);
    if (!channel) {
      return sendError(res, 404, `Channel with id ${req.body.channelId} does not exist`);
    }

    // Validate channel has a project
    if (!channel.projectId) {
      return sendError(res, 400, `Channel with id ${req.body.channelId} is not associated with a project`);
    }

    // Validate project exists
    const projectRepo = new ProjectRepository();
    const project = await projectRepo.findById(channel.projectId);
    if (!project) {
      return sendError(res, 404, `Project with id ${channel.projectId} does not exist`);
    }

    // Validate project has at least one board
    const boardRepo = new BoardRepository();
    const boards = await boardRepo.findBoardsByProject(channel.projectId);
    if (boards.length === 0) {
      return sendError(res, 400, `Project with id ${channel.projectId} does not have any boards associated with it`);
    }

    // Get the oldest board
    const oldestBoard = await boardRepo.findOldestBoardByProject(channel.projectId);
    if (!oldestBoard) {
      return sendError(res, 400, `Could not find the oldest board for project ${channel.projectId}`);
    }

    // Validate that a form is mapped to the oldest board
    const db = DatabaseClient.getInstance();
    const formMapping = await db.formContextMapping.findFirst({
      where: {
        contextId: oldestBoard.id,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });

    if (!formMapping) {
      return sendError(res, 400, `No form is mapped to the oldest board (id: ${oldestBoard.id}) for project ${channel.projectId}`);
    }

    ingestSlackList(channel.id, project.id, oldestBoard.id, formMapping.formId, req.body.ingestionData);

    return res.status(200).json({
      success: true,
      message: 'Ingestion has been started',
    });
    
  } catch (error) {
    logger.error('[Slack List] Error handling request', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return sendError(res, 500, 'Internal server error');
  }
});

export default router;
