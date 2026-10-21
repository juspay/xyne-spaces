import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { createSubTicket } from '@/services/subTicketService';
import { createTicketStep } from './create-ticket.step';
import { logger } from '@/utils/logger';

const CreateSubTicketConfigSchema = z.object({
  parentTicketId: variableRef(z.string().min(1)),
  title: variableRef(z.string().min(1)),
  description: variableRef(z.string()).optional(),
  assignedTo: variableRef(z.string()).optional(),
  channelId: variableRef(z.string()).optional(),
  projectId: variableRef(z.string()).optional(),
  boardId: variableRef(z.string()).optional(),
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
    "Creates a sub-ticket under the trigger ticket (or another parent you specify). Pick a channel, project and board to create it as a real ticket there; leave them empty to keep it inside the parent's conversation.";
  readonly category = StepCategory.TICKET;
  readonly icon = 'GitBranchPlus';

  async execute(
    config: z.infer<typeof CreateSubTicketConfigSchema>,
    context: AutomationContext,
  ): Promise<CreateSubTicketOutput> {
    const { channelId, projectId, boardId } = config as Record<string, string | undefined>;
    if ((channelId || projectId || boardId) && !(channelId && projectId && boardId)) {
      throw new Error('[CREATE_SUB_TICKET] Channel, project and board must be set together');
    }

    // createTicketStep.execute is called directly, so its own schema never runs.
    const ticket = channelId
      ? await createTicketStep.execute(
          {
            title: config.title,
            description: config.description || config.title,
            channelId,
            projectId: projectId!,
            boardId: boardId!,
            assigneeId: config.assignedTo,
          },
          context,
        )
      : null;

    const result = await createSubTicket({
      parentTicketId: config.parentTicketId as string,
      title: config.title as string,
      description: (config.description as string | undefined) ?? null,
      assignedTo: (config.assignedTo as string | undefined) ?? null,
      createdBy: context.automation.createdById,
      mappedTicketId: ticket?.ticketId ?? null,
      subTicketXyneId: ticket?.xyneId ?? null,
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
