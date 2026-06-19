import { randomUUID } from 'crypto';
import { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';
import { BaseRepository } from './base';
import { Form, FormFields, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

export interface UpsertTicketFormFieldsResult {
  updatedFields: string[];
  skippedFields: string[];
}

export interface CreateFormInput {
  formName: string;
  formDescription?: string;
  entityType: FormEntityType;
  contextType: FormContextType;
  workspaceId: string;
  createdBy: string;
}

export interface CreateFormWithFieldsInput extends CreateFormInput {
  fields: Array<{
    fieldName: string;
    fieldType: FormFieldType;
    fieldEnum?: Prisma.InputJsonValue;
    isOptional?: boolean;
  }>;
}

export class FormsRepository extends BaseRepository<Form, CreateFormInput, Prisma.FormUpdateInput> {
  constructor() {
    super('form');
  }

  async create(data: CreateFormInput): Promise<Form> {
    await this.validateString(data.formName, 'formName', 100);

    const form = await this.db.form.create({
      data: {
        formName: data.formName.trim(),
        formDescription: data.formDescription?.trim() || null,
        entityType: data.entityType,
        contextType: data.contextType,
        workspaceId: data.workspaceId,
        createdBy: data.createdBy,
      },
    });

    return form;
  }

  async update(id: string, data: Prisma.FormUpdateInput): Promise<Form> {
    const form = await this.db.form.update({
      where: { id },
      data,
    });

    return form;
  }

  async createWithFields(data: CreateFormWithFieldsInput): Promise<Form> {
    await this.validateString(data.formName, 'formName', 100);

    // Validate that at least one field is provided
    if (!data.fields || data.fields.length === 0) {
      throw new Error('At least one field is required');
    }

    // Validate all fields have names
    const invalidFields = data.fields.filter(field => !field.fieldName || !field.fieldName.trim());
    if (invalidFields.length > 0) {
      throw new Error('All fields must have a name');
    }

    // Validate all fields have valid field types
    const validFieldTypes = Object.values(FormFieldType);
    const invalidFieldTypes = data.fields.filter(field => !validFieldTypes.includes(field.fieldType));
    if (invalidFieldTypes.length > 0) {
      throw new Error(
        `Invalid field type(s): ${invalidFieldTypes.map(f => f.fieldType).join(', ')}. Valid types: ${validFieldTypes.join(', ')}`
      );
    }

    // Use transaction to create form and form fields together
    return await this.db.$transaction(async (tx) => {
      const form = await tx.form.create({
        data: {
          formName: data.formName.trim(),
          formDescription: data.formDescription?.trim() || null,
          entityType: data.entityType,
          contextType: data.contextType,
          workspaceId: data.workspaceId,
          createdBy: data.createdBy,
        },
      });

      // Create form fields
      await tx.formFields.createMany({
        data: data.fields.map((field, index) => ({
          formId: form.id,
          fieldName: field.fieldName.trim(),
          fieldType: field.fieldType,
          fieldEnum: field.fieldEnum,
          isOptional: field.isOptional,
          sequenceNumber: index + 1,
        })),
      });

      return form;
    });
  }

  async findById(id: string): Promise<Form | null> {
    return await this.db.form.findUnique({
      where: { id },
    });
  }

  async findMany(): Promise<Form[]> {
    return await this.db.form.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async delete(id: string): Promise<Form> {
    return await this.db.form.delete({
      where: { id },
    });
  }

  async findFormByContextAndEntity(context: FormContextType, entity: FormEntityType): Promise<Form | null> {
    return await this.db.form.findFirst({
      where: {
        contextType: context,
        entityType: entity,
      },
    });
  }

  /**
   * Get form with fields by form ID
   */
  async findFormWithFields(id: string): Promise<(Form & { fields: FormFields[] }) | null> {
    return await this.db.form.findUnique({
      where: { id },
      include: {
        fields: {
          orderBy: {
            sequenceNumber: 'asc',
          },
        },
      },
    });
  }

  /**
   * Update form with fields while preserving existing field IDs when possible.
   */
  async updateWithFields(
    id: string,
    data: {
      formName: string;
      formDescription?: string;
      fields: Array<{
        fieldId?: string;
        fieldName: string;
        fieldType: FormFieldType;
        fieldEnum?: Prisma.InputJsonValue;
        isOptional?: boolean;
      }>;
    }
  ): Promise<Form> {
    await this.validateString(data.formName, 'formName', 100);

    // Validate that at least one field is provided
    if (!data.fields || data.fields.length === 0) {
      throw new Error('At least one field is required');
    }

    // Validate all fields have names
    const invalidFields = data.fields.filter(field => !field.fieldName || !field.fieldName.trim());
    if (invalidFields.length > 0) {
      throw new Error('All fields must have a name');
    }

    // Validate all fields have valid field types
    const validFieldTypes = Object.values(FormFieldType);
    const invalidFieldTypes = data.fields.filter(field => !validFieldTypes.includes(field.fieldType));
    if (invalidFieldTypes.length > 0) {
      throw new Error(
        `Invalid field type(s): ${invalidFieldTypes.map(f => f.fieldType).join(', ')}. Valid types: ${validFieldTypes.join(', ')}`
      );
    }

    const providedFieldIds = data.fields
      .map(field => field.fieldId)
      .filter((fieldId): fieldId is string => typeof fieldId === 'string' && fieldId.length > 0);

    if (providedFieldIds.length !== new Set(providedFieldIds).size) {
      throw new Error('Duplicate field IDs are not allowed');
    }

    const normalizedFieldNames = data.fields.map(field => field.fieldName.trim().toLowerCase());
    if (normalizedFieldNames.length !== new Set(normalizedFieldNames).size) {
      throw new Error('Duplicate field names are not allowed');
    }

    return await this.db.$transaction(async (tx) => {
      const existingFields = await tx.formFields.findMany({
        where: { formId: id },
        orderBy: { sequenceNumber: 'asc' },
      });

      const existingFieldIds = new Set(existingFields.map(field => field.id));
      const invalidFieldId = providedFieldIds.find(fieldId => !existingFieldIds.has(fieldId));
      if (invalidFieldId) {
        throw new Error(`Field ${invalidFieldId} does not belong to this form`);
      }

      // Update the form
      const form = await tx.form.update({
        where: { id },
        data: {
          formName: data.formName.trim(),
          formDescription: data.formDescription?.trim() || null,
        },
      });

      const incomingFieldIds = new Set(providedFieldIds);
      const fieldIdsToDelete = existingFields
        .filter(field => !incomingFieldIds.has(field.id))
        .map(field => field.id);

      if (fieldIdsToDelete.length > 0) {
        const referencedValues = await tx.formEntityValues.count({
          where: {
            formId: id,
            fieldId: { in: fieldIdsToDelete },
          },
        });

        if (referencedValues > 0) {
          throw new Error('Cannot delete form fields that already contain saved values');
        }

        await tx.formFields.deleteMany({
          where: { id: { in: fieldIdsToDelete } },
        });
      }

      for (const [index, field] of data.fields.entries()) {
        const baseData = {
          formId: id,
          fieldName: field.fieldName.trim(),
          fieldType: field.fieldType,
          fieldEnum: field.fieldEnum,
          isOptional: field.isOptional ?? false,
          sequenceNumber: index + 1,
        };

        if (field.fieldId) {
          await tx.formFields.update({
            where: { id: field.fieldId },
            data: baseData,
          });
          continue;
        }

        await tx.formFields.create({
          data: {
            id: randomUUID(),
            ...baseData,
          },
        });
      }

      return form;
    });
  }

  /**
   * Get form fields by form ID
   */
  async findFormFields(formId: string): Promise<FormFields[]> {
    return await this.db.formFields.findMany({
      where: { formId },
    });
  }


  /**
   * Save multiple form entity values at once
   */
  async createManyFormEntityValues(
    data: Array<{
      formId: string;
      entityId: string;
      entityType: string;
      fieldId: string;
      contextId?: string | null;
      fieldValue?: string;
      actualFieldValue: Prisma.InputJsonValue;
    }>,
    tx?: Prisma.TransactionClient
  ): Promise<{ count: number }> {
    const client = tx || this.db;
    return await client.formEntityValues.createMany({
      data: data.map(item => ({
        formId: item.formId,
        entityId: item.entityId,
        entityType: item.entityType,
        fieldId: item.fieldId,
        // Release-scoped writes (entityType=RELEASE_ENV_FORM/RELEASE_MIGRATION_FORM)
        // pass contextId=releaseTicketId so the same change-type row can hold
        // values across multiple releases without colliding on the
        // (entityId, entityType, fieldId, contextId) unique key.
        ...(item.contextId !== undefined && { contextId: item.contextId }),
        fieldValue: item.fieldValue || '',
        actualFieldValue: item.actualFieldValue as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  async upsertTicketFormFields(
    ticketId: string,
    boardId: string,
    fieldPairs: Array<{ fieldName: string; value: string | null | undefined }>,
  ): Promise<UpsertTicketFormFieldsResult> {
    const formMapping = await this.db.formContextMapping.findFirst({
      where: { contextId: boardId, contextType: 'BOARD', entityType: 'TICKET' },
    });

    if (!formMapping) {
      logger.warn('[FormsRepository] upsertTicketFormFields — no form mapped to board', { ticketId, boardId });
      return { updatedFields: [], skippedFields: fieldPairs.map(f => f.fieldName) };
    }

    const formFields = await this.db.formFields.findMany({ where: { formId: formMapping.formId } });
    const fieldsByName = new Map(formFields.map(f => [f.fieldName, f]));

    const updatedFields: string[] = [];
    const skippedFields: string[] = [];
    const now = new Date();

    // Resolve current visit version so revisits don't overwrite prior-visit form values.
    // Compute the max in code (NULL = version 1): the version column is nullable with no DB
    // default, and ORDER BY version DESC would sort NULLs first in Postgres — a legacy NULL
    // row would masquerade as the latest version.
    const existingValues = await this.db.formEntityValues.findMany({
      where: { entityId: ticketId, entityType: 'TICKET', contextId: boardId },
      select: { version: true },
    });
    const currentVersion = existingValues.reduce((max, v) => Math.max(max, v.version ?? 1), 1);

    for (const { fieldName, value } of fieldPairs) {
      const valueStr = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
      if (!valueStr) { skippedFields.push(fieldName); continue; }

      const field = fieldsByName.get(fieldName);
      if (!field) {
        logger.warn('[FormsRepository] upsertTicketFormFields — field not found on form', { ticketId, fieldName, formId: formMapping.formId });
        skippedFields.push(fieldName);
        continue;
      }

      const isMulti = field.fieldType === 'MULTI_SELECT' || field.fieldType === 'USER';
      const actualFieldValue = isMulti ? [valueStr] : valueStr;

      await this.db.formEntityValues.upsert({
        where: {
          entityId_entityType_fieldId_contextId_version: {
            entityId: ticketId,
            entityType: 'TICKET',
            fieldId: field.id,
            contextId: boardId,
            version: currentVersion,
          },
        },
        create: {
          id: randomUUID(),
          formId: formMapping.formId,
          entityId: ticketId,
          entityType: 'TICKET',
          fieldId: field.id,
          contextId: boardId,
          version: currentVersion,
          fieldValue: valueStr,
          actualFieldValue,
          createdAt: now,
          updatedAt: now,
        },
        update: { fieldValue: valueStr, actualFieldValue, updatedAt: now },
      });
      updatedFields.push(fieldName);
    }

    return { updatedFields, skippedFields };
  }

  async getFormEntityValuesByEntityId(
    entityId: string,
    entityType: string
  ): Promise<Record<string, any>> {
    const values = await this.db.formEntityValues.findMany({
      where: {
        entityId,
        entityType,
      },
    });

    const result: Record<string, any> = {};
    
    for (const v of values) {
      const field = await this.db.formFields.findUnique({
        where: { id: v.fieldId },
      });
      if (field) {
        result[field.fieldName] = v.actualFieldValue ?? v.fieldValue;
      }
    }

    return result;
  }
}
