import { Request, Response } from 'express';
import { WorkflowStepRepository } from '../database/repositories/workflowSteps';
import { repositories } from '../database/repositories';
import { eventService } from '@/services/eventService';
import { logger } from '@/utils/logger';

export class ExternalStepResponseController {
  private workflowStepRepository: WorkflowStepRepository;

  constructor() {
    this.workflowStepRepository = repositories.workflowSteps;
  }

  createOrUpdateExternalStepResponse = async (req: Request, res: Response): Promise<void> => {
    try {
      const workflowStepId = req.body.workflowStepId || req.query.workflowStepId as string;
      const rawResponse = req.body.rawResponse || JSON.stringify(req.body);

      if (!workflowStepId) {
        res.status(400).json({
          error: 'Missing required field: workflowStepId (in body or query params)'
        });
        return;
      }

      const workflowStep = await this.workflowStepRepository.findById(workflowStepId);
      if (!workflowStep) {
        res.status(404).json({
          error: 'Workflow step not found'
        });
        return;
      }
      const workflowExecutionId = workflowStep.workflowExecutionId;

      await eventService.storeEvent(
        workflowExecutionId,
        workflowStepId,
        rawResponse
      );

      res.status(200).json({
        success: true,
        message: 'Event stored successfully'
      });
    } catch (error) {
      logger.error('Error storing external step event:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  };
}
