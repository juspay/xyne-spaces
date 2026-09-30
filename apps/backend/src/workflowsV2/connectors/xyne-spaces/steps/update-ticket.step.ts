import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { noOptions, optionsQuery, stageOptions, userOptions } from '../options';
import type { XyneCtx } from '@/workflowsV2/types';
import { z } from 'zod';
import { TicketStatusV2, TicketPriority, BoardType, ActivityType } from '@xyne/shared';
import { BaseActionStep, variableRef, withOptions } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { ticketStageTransitionService } from '@/services/stageTransition/ticketStageTransitionService';
import { ActivitySource } from '@/types/ticket';
import { logger } from '@/utils/logger';
import { actorOf, workspaceOf } from '../context';

const UpdateTicketConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
  title: variableRef(z.string()).optional(),
  description: variableRef(z.string()).optional(),
  priority: variableRef(z.union([z.nativeEnum(TicketPriority), z.string()])).optional(),
  status: z.nativeEnum(TicketStatusV2).optional(),
  stageName: withOptions(variableRef(z.string())).optional(),
  assignedTo: withOptions(variableRef(z.string())).optional(),
});

const UpdateTicketOutputSchema = z.object({
  ticketId: z.string(),
});

interface UpdateTicketOutput extends Record<string, unknown> {
  ticketId: string;
}

export class UpdateTicketStep extends BaseActionStep<
  typeof UpdateTicketConfigSchema,
  UpdateTicketOutput
> {
  readonly type = 'UPDATE_TICKET';
  readonly configSchema = UpdateTicketConfigSchema;
  readonly outputSchema = UpdateTicketOutputSchema;
  readonly name = 'Update a ticket';
  readonly description =
    'Updates fields on an existing ticket — title, description, priority, status, stage, or assignee.';
  readonly category = 'ticket';
  readonly icon = 'Pencil';




  /**
   * The pickers. Stages are per board, and this step's config names a ticket
   * rather than a board — so there is nothing to narrow by, and `stageOptions`
   * says so rather than showing an empty list.
   */
  override getOptions(
    ctx: FieldOptionsContext<z.infer<typeof UpdateTicketConfigSchema>, Record<string, unknown>, XyneCtx>,
  ): Promise<FieldOptionsPage> {
    const query = optionsQuery(ctx);
    switch (ctx.field) {
      case 'assignedTo':
        return userOptions(query);
      case 'stageName':
        return stageOptions(query, undefined);
      default:
        return Promise.resolve(noOptions);
    }
  }

  async execute(
    config: z.infer<typeof UpdateTicketConfigSchema>,
    ctx: StepExecutionContext,
  ): Promise<UpdateTicketOutput> {
    const ticketId = config.ticketId as string;
    const updatedBy = await actorOf(ctx, this.type);

    if (config.assignedTo !== undefined) {
      await repositories.tickets.updateTicketAssignee(
        ticketId,
        config.assignedTo as string,
        updatedBy,
      );
    }

    if (config.stageName !== undefined) {
      const prisma = DatabaseClient.getInstance();
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { stageName: true, board: { select: { boardType: true } } },
      });

      if (ticket?.board?.boardType === BoardType.NON_LINEAR) {
        const newStageName = config.stageName as string;
        const result = await ticketStageTransitionService.transitionTicket(
          ticketId,
          updatedBy,
          newStageName,
          { isAutomation: true, activitySource: ActivitySource.AUTOMATION },
        );
        if (!result.success) {
          throw new Error(result.message ?? 'Stage transition failed');
        }
        prisma.ticketActivity
          .create({
            data: {
              ticketId,
              updatedBy,
              workspaceId: workspaceOf(ctx, this.type),
              activityType: ActivityType.STAGE_NAME,
              value: {
                field: 'stageName',
                oldValue: ticket.stageName ?? null,
                newValue: newStageName,
                source: ActivitySource.AUTOMATION,
                isAutomation: true,
              },
            },
          })
          .catch((err) =>
            logger.warn(
              `[automations] UPDATE_TICKET stage audit write failed ticketId=${ticketId}:`,
              err,
            ),
          );
      } else {
        await repositories.tickets.updateTicketStage(
          ticketId,
          config.stageName as string,
          updatedBy,
          ActivitySource.AUTOMATION,
        );
      }
    }

    const fields: Parameters<typeof repositories.tickets.updateTicketFields>[1] = {};
    if (config.title !== undefined) fields.title = config.title as string;
    if (config.description !== undefined) fields.description = config.description as string;
    if (config.priority !== undefined) {
      const normalized = (config.priority as string).toUpperCase();
      if (Object.values(TicketPriority).includes(normalized as TicketPriority)) {
        fields.priority = normalized as TicketPriority;
      } else {
        logger.warn(
          `[automations] UPDATE_TICKET skipping priority — "${config.priority}" is not a valid TicketPriority for ticket ${ticketId}`,
        );
      }
      // Always stamp aiPriority — prevents AI retrigger from re-classifying this ticket.
      // If enum was valid, mirrors priority. If invalid, raw value still blocks retrigger.
      fields.aiPriority = fields.priority ?? normalized;
    }
    if (config.status !== undefined) fields.statusV2 = config.status;

    if (Object.keys(fields).length > 0) {
      await repositories.tickets.updateTicketFields(ticketId, fields, updatedBy);
    }

    return { ticketId };
  }
}
