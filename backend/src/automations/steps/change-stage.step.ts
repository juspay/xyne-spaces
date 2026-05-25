import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';

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
    await repositories.tickets.updateTicketStage(ticketId, stageName, context.automation.createdById);
    return { ticketId, stageName };
  }
}

export const changeStageStep = new ChangeStageStep();
