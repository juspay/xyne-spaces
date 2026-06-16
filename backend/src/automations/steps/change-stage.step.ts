import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';
import { BoardType } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { ticketStageTransitionService } from '@/services/stageTransition/ticketStageTransitionService';

const ChangeStageConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
  stageName: variableRef(z.string().min(1)),
});

const ChangeStageOutputSchema = z.object({
  ticketId: z.string(),
  stageName: z.string(),
});

interface ChangeStageOutput extends Record<string, unknown> {
  ticketId: string;
  stageName: string;
}

export class ChangeStageStep extends BaseActionStep<typeof ChangeStageConfigSchema, ChangeStageOutput> {
  readonly type = 'CHANGE_STAGE';
  readonly configSchema = ChangeStageConfigSchema;
  readonly outputSchema = ChangeStageOutputSchema;
  readonly name = 'Move ticket to stage';
  readonly description = 'Moves the chosen ticket to a new stage on its board.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'StepForward';

  async execute(
    config: z.infer<typeof ChangeStageConfigSchema>,
    context: AutomationContext,
  ): Promise<ChangeStageOutput> {
    const ticketId = config.ticketId as string;
    const stageName = config.stageName as string;
    const updatedBy = context.automation.createdById;

    const prisma = DatabaseClient.getInstance();
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { board: { select: { boardType: true } } },
    });

    if (ticket?.board?.boardType === BoardType.NON_LINEAR) {
      const result = await ticketStageTransitionService.transitionTicket(
        ticketId,
        updatedBy,
        stageName,
        { isAutomation: true },
      );
      if (!result.success) {
        throw new Error(result.message ?? 'Stage transition failed');
      }
    } else {
      await repositories.tickets.updateTicketStage(ticketId, stageName, updatedBy);
    }

    return { ticketId, stageName };
  }
}

export const changeStageStep = new ChangeStageStep();
