import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { createSubTicket } from '@/services/subTicketService';
import { logger } from '@/utils/logger';

const CreateSubTicketConfigSchema = z.object({
  parentTicketId: variableRef(z.string().min(1)),
  title: variableRef(z.string().min(1)),
  description: variableRef(z.string()).optional(),
  assignedTo: variableRef(z.string()).optional(),
});

const CreateSubTicketOutputSchema = z.object({
  subTicketId: z.string(),
  mappingId: z.string(),
  parentTicketId: z.string(),
});

interface CreateSubTicketOutput extends Record<string, unknown> {
  subTicketId: string;
  mappingId: string;
  parentTicketId: string;
}

export class CreateSubTicketStep extends BaseActionStep<
  typeof CreateSubTicketConfigSchema,
  CreateSubTicketOutput
> {
  readonly type = 'CREATE_SUB_TICKET';
  readonly configSchema = CreateSubTicketConfigSchema;
  readonly outputSchema = CreateSubTicketOutputSchema;
  readonly name = 'Create a sub-ticket';
  readonly description =
    "Creates a sub-ticket under the trigger ticket (or another parent you specify). The sub-ticket inherits the parent's conversation — no separate channel / board / project needed.";
  readonly category = StepCategory.TICKET;
  readonly icon = 'GitBranchPlus';

  async execute(
    config: z.infer<typeof CreateSubTicketConfigSchema>,
    context: AutomationContext,
  ): Promise<CreateSubTicketOutput> {
    const result = await createSubTicket({
      parentTicketId: config.parentTicketId as string,
      title: config.title as string,
      description: (config.description as string | undefined) ?? null,
      assignedTo: (config.assignedTo as string | undefined) ?? null,
      createdBy: context.automation.createdById,
    });

    logger.info(
      `[automations] CREATE_SUB_TICKET → ${result.subTicketId} under parent ${result.parentTicketId}`,
    );

    return {
      subTicketId: result.subTicketId,
      mappingId: result.mappingId,
      parentTicketId: result.parentTicketId,
    };
  }
}

export const createSubTicketStep = new CreateSubTicketStep();
