import { Request, Response } from 'express';
import { WorkflowStepRepository } from '../database/repositories/workflowSteps';
import { repositories } from '../database/repositories';
import { eventService } from '@/services/eventService';
import { logger } from '@/utils/logger';
import { processQuestionRawResponse } from '@/workflows/utils/external-step-utils';
import { config as appConfig } from '@/config/env';

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

      // TODO: This needs to be fixed — doing for testing for xyne spaces feature implementation.
      // Immediately create the output step so that:
      // computedStatus becomes 'completed' right away and answers are available for rendering.
      if (appConfig.enableImmediateOutputStep) {
        try {
          const inputStepData = typeof workflowStep.data === 'string' ? workflowStep.data : JSON.stringify(workflowStep.data);
          let questionTexts: string[] = [];
          let questionCount = 0;
          try {
            const stepData = inputStepData ? JSON.parse(inputStepData) : null;
            const questionData = stepData?.args?.[0];
            const questions = questionData?.questions || [];
            questionTexts = questions.map((q: { header?: string; question: string }) => q.header || q.question);
            questionCount = questions.length;
          } catch { /* keep defaults */ }

          const answers = processQuestionRawResponse(rawResponse, questionCount);

          await repositories.workflowSteps.create({
            workflowExecution: { connect: { id: workflowExecutionId } },
            stepExecutorType: 'external',
            stepName: workflowStep.stepName || 'unknown',
            type: 'output',
            data: JSON.stringify({ answers, questionTexts }),
            status: 'completed',
          });
          logger.info(`[ExternalStepResponse] Created output step for ${workflowStepId} — answers will be visible immediately`);
        } catch (outputErr) {
          // Non-fatal: the executor will create the output step later when it resumes
          logger.warn(`[ExternalStepResponse] Failed to create output step (executor will handle it):`, outputErr);
        }
      }

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