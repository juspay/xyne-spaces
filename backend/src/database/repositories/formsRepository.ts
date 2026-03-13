import { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';
import { BaseRepository } from './base';
import { Form, FormFields, Prisma } from '@prisma/client';

export interface CreateFormInput {
  formName: string;
  formDescription?: string;
  entityType: FormEntityType;
  contextType: FormContextType;
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
          createdBy: data.createdBy,
        },
      });

      // Create form fields
      await tx.formFields.createMany({
        data: data.fields.map(field => ({
          formId: form.id,
          fieldName: field.fieldName.trim(),
          fieldType: field.fieldType,
          fieldEnum: field.fieldEnum,
          isOptional: field.isOptional,
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
      entityId: string;
      entityType: string;
      fieldId: string;
      fieldValue?: string;
      actualFieldValue: Prisma.InputJsonValue;
    }>
  ): Promise<{ count: number }> {
    return await this.db.formEntityValues.createMany({
      data: data.map(item => ({
        entityId: item.entityId,
        entityType: item.entityType,
        fieldId: item.fieldId,
        fieldValue: item.fieldValue || '',
        actualFieldValue: item.actualFieldValue as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
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
