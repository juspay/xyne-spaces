import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  FormContextType,
  FormEntityType,
  type FormFieldType,
} from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { logger } from '@/utils/logger';

export interface TicketFormFieldDefinition {
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: string[];
  isOptional?: boolean;
}

async function hasAllBoardTicketFormFields(
  boardId: string,
  fields: TicketFormFieldDefinition[],
): Promise<boolean> {
  const mapping = await db.formContextMapping.findFirst({
    where: {
      contextId: boardId,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    },
    select: { formId: true },
  });
  if (!mapping) return false;

  const form = await db.form.findUnique({
    where: { id: mapping.formId },
    select: { id: true },
  });
  if (!form) return false;

  const existingFields = await repositories.forms.findFormFields(mapping.formId);
  const existingNames = new Set(existingFields.map((field) => field.fieldName));
  return fields.every((field) => existingNames.has(field.fieldName));
}

export async function ensureBoardTicketFormFields(params: {
  boardId: string;
  workspaceId: string;
  createdBy: string;
  fields: TicketFormFieldDefinition[];
}): Promise<void> {
  if (params.fields.length === 0) return;
  if (await hasAllBoardTicketFormFields(params.boardId, params.fields)) return;

  const lock = await acquireLock(`lock:ticket-form-fields:${params.boardId}`, {
    ttlSeconds: 60,
    waitTimeoutMs: 5_000,
  });
  if (!lock) {
    throw new Error(`Timed out provisioning ticket fields for board ${params.boardId}`);
  }

  try {
    let mapping = await db.formContextMapping.findFirst({
      where: {
        contextId: params.boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });

    if (mapping) {
      const mappedForm = await db.form.findUnique({ where: { id: mapping.formId } });
      if (!mappedForm) {
        logger.warn('[TicketFormFieldService] Removing dangling ticket form mapping', {
          boardId: params.boardId,
          formId: mapping.formId,
        });
        await db.formContextMapping.delete({ where: { id: mapping.id } });
        mapping = null;
      }
    }

    if (!mapping) {
      const form = await repositories.forms.createWithFields({
        formName: 'Ticket Details',
        entityType: FormEntityType.TICKET,
        contextType: FormContextType.BOARD,
        workspaceId: params.workspaceId,
        createdBy: params.createdBy,
        fields: params.fields,
      });

      try {
        mapping = await db.formContextMapping.create({
          data: {
            id: randomUUID(),
            contextId: params.boardId,
            contextType: FormContextType.BOARD,
            entityType: FormEntityType.TICKET,
            formId: form.id,
            workspaceId: params.workspaceId,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        await repositories.forms.delete(form.id).catch(() => undefined);
        mapping = await db.formContextMapping.findFirst({
          where: {
            contextId: params.boardId,
            contextType: FormContextType.BOARD,
            entityType: FormEntityType.TICKET,
          },
        });
      }
    }

    if (!mapping) {
      throw new Error(`Ticket form mapping not found for board ${params.boardId}`);
    }

    const form = await db.form.findUnique({ where: { id: mapping.formId } });
    if (!form) {
      throw new Error(`Mapped ticket form ${mapping.formId} not found`);
    }

    const existingFields = await repositories.forms.findFormFields(mapping.formId);
    const existingNames = new Set(existingFields.map((field) => field.fieldName));
    const missingFields = params.fields.filter(
      (field) => !existingNames.has(field.fieldName),
    );
    if (missingFields.length === 0) return;

    await repositories.forms.updateWithFields(mapping.formId, {
      formName: form.formName,
      formDescription: form.formDescription ?? undefined,
      fields: [
        ...existingFields.map((field) => ({
          fieldId: field.id,
          fieldName: field.fieldName,
          fieldType: field.fieldType as unknown as FormFieldType,
          fieldEnum: field.fieldEnum ?? undefined,
          isOptional: field.isOptional,
        })),
        ...missingFields,
      ],
    });
  } finally {
    await releaseLock(lock);
  }
}
