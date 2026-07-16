import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { ActivityType } from '@prisma/client';
import { logger } from '@/utils/logger';

const UpdateFormFieldsConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)).describe('The ticket to update form fields on.'),
  fields: z
    .array(
      z.object({
        fieldName: z.string().min(1).describe('Form field name to write to.'),
        value: variableRef(z.string().nullable().optional()).describe('Value to set. Supports {{...}} placeholders.'),
      }),
    )
    .min(1)
    .describe('One or more field name / value pairs. Use the variable picker to reference webhook response data.'),
});

const UpdateFormFieldsOutputSchema = z.object({
  ticketId: z.string(),
  updatedFields: z.array(z.string()),
  skippedFields: z.array(z.string()),
});

interface UpdateFormFieldsOutput extends Record<string, unknown> {
  ticketId: string;
  updatedFields: string[];
  skippedFields: string[];
}

export class UpdateFormFieldsStep extends BaseActionStep<
  typeof UpdateFormFieldsConfigSchema,
  UpdateFormFieldsOutput
> {
  readonly type = 'UPDATE_FORM_FIELDS';
  readonly configSchema = UpdateFormFieldsConfigSchema;
  readonly outputSchema = UpdateFormFieldsOutputSchema;
  readonly name = 'Update ticket form fields';
  readonly description =
    'Writes values into the custom form fields on a ticket. Use after a webhook step to populate fields like industry, merchant_id, product etc.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'FormInput';

  async execute(
    config: z.infer<typeof UpdateFormFieldsConfigSchema>,
    context: AutomationContext,
  ): Promise<UpdateFormFieldsOutput> {
    const ticketId = config.ticketId as string;
    const fieldPairs = config.fields as { fieldName: string; value: string | null | undefined }[];
    const prisma = DatabaseClient.getInstance();

    const ticket = await repositories.tickets.getTicketWithBoard(ticketId);

    if (!ticket?.boardId) {
      logger.warn('[automations] UPDATE_FORM_FIELDS — ticket has no boardId', { ticketId });
      return { ticketId, updatedFields: [], skippedFields: fieldPairs.map(f => f.fieldName) };
    }

    const { updatedFields, skippedFields } = await repositories.forms.upsertTicketFormFields(
      ticketId,
      ticket.boardId,
      fieldPairs,
    );

    if (updatedFields.length > 0) {
      const fieldValueMap = new Map(fieldPairs.map(f => [f.fieldName, f.value]));
      await prisma.ticketActivity.createMany({
        data: updatedFields.map(fieldName => ({
          ticketId,
          updatedBy: context.automation.createdById,
          activityType: ActivityType.METADATA,
          value: {
            field: 'customField',
            fieldName,
            newValue: fieldValueMap.get(fieldName) ?? null,
            isAutomation: true,
          },
        })),
      });
    }

    logger.info('[automations] UPDATE_FORM_FIELDS completed', {
      ticketId,
      boardId: ticket.boardId,
      updatedFields,
      skippedFields,
    });

    return { ticketId, updatedFields, skippedFields };
  }
}

export const updateFormFieldsStep = new UpdateFormFieldsStep();
