import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { assertFormFieldType, FormContextType, FormEntityType, FormFieldType, resolveParentOption } from '@xyne/shared';
import { BaseRepository } from './base';
import { Form, FormFields, Prisma, PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import {
  
  FormFieldInput,
  normalizeFormFieldInput,
  resolveFormFields,
  ResolvedFormField,
  validateFormFieldInputs,
} from '@/utils/formFieldResolution';
import { resolveFieldDefinitionsByIds } from '@/utils/fieldDefinition';
import { parseGlobalFieldEnum } from '@/utils/globalFieldEnum';
import { createWithFieldsTx } from '@/bypassAcl/transactions/formsRepository';
import {
  createFormEntityValues,
  findFormEntityValueKeys,
  findFormEntityValues,
  upsertFormEntityValue,
} from '@/database/repositories/formEntityValueRepository';
import { updateWithFieldsTx } from '@/bypassAcl/transactions/formsRepository';

export interface UpsertTicketFormFieldsResult {
  updatedFields: string[];
  skippedFields: string[];
}

export interface TicketCustomFormFieldValue {
  fieldId: string;
  fieldName: string;
  fieldType: FormFieldType;
  value: Prisma.JsonValue | string | null;
}

export interface TicketCustomFormData {
  formId: string;
  formName: string;
  fields: TicketCustomFormFieldValue[];
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
  projectId?: string;
  fields: Array<{
    fieldId?: string;
    fieldName?: string;
    fieldType?: FormFieldType;
    fieldEnum?: Prisma.InputJsonValue;
    fieldOptions?: Array<{ id: string; value: string }>;
    isOptional?: boolean;
    // Id of an option in another field's fieldOptions — this field only applies in that branch.
    parentOptionId?: string | null;
  }>;
}

export interface FormWithResolvedFields extends Form {
  fields: ResolvedFormField[];
}

export interface GlobalFieldListResult {
  id: string;
  projectId: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum: Prisma.JsonValue | null;
  fieldOptions: Prisma.JsonValue | null;
}

export interface LocalFieldDefinitionInput {
  fieldId?: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: Prisma.InputJsonValue;
  fieldOptions?: Prisma.InputJsonValue;
  parentOptionId?: string | null;
}

type BranchableFieldInput = {
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: Prisma.InputJsonValue;
  fieldOptions?: Prisma.InputJsonValue;
  parentOptionId?: string | null;
};

/** Validates a field's parentOptionId against its resolved parent. No-op if unset. */
const validateBranch = (child: BranchableFieldInput, allFields: BranchableFieldInput[]): void => {
  if (!child.parentOptionId) return;

  const resolved = resolveParentOption(allFields, child.parentOptionId);
  if (!resolved) {
    throw new Error(
      `Field "${child.fieldName}" references an option that doesn't exist on any field in this form`
    );
  }
  if (resolved.parentField.fieldType !== FormFieldType.SINGLE_SELECT) {
    throw new Error(
      `Field "${child.fieldName}" can only belong to a branch of a Single Select field`
    );
  }
  if (resolved.parentField.parentOptionId) {
    throw new Error(
      `Field "${child.fieldName}" cannot belong to a branch of "${resolved.parentField.fieldName}" — that field is itself in a branch, only one level is allowed`
    );
  }
};

/** Validates every field's branch tag; a parent is always another entry in the same payload. */
const validateAllBranches = (fields: BranchableFieldInput[]): void => {
  // fieldEnum is the string[] projection after normalization. Feed fieldOptions as the scanned
  // property so branch parents can still be resolved.
  const withOptions = fields.map(f => ({ ...f, fieldEnum: f.fieldOptions ?? f.fieldEnum }));
  for (const field of withOptions) {
    validateBranch(field, withOptions);
  }
};

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

    // Normalize + validate (duplicate input field IDs / duplicate local names).
    const normalizedFields = data.fields.map(normalizeFormFieldInput);
    validateFormFieldInputs(normalizedFields);
    this.validateLocalFieldDefinitions(normalizedFields);
    validateAllBranches(normalizedFields);

    return await createWithFieldsTx(this, data, normalizedFields);
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

  async findFormByContextAndEntity(
    context: FormContextType,
    entity: FormEntityType
  ): Promise<Form | null> {
    return await this.db.form.findFirst({
      where: {
        contextType: context,
        entityType: entity,
      },
    });
  }

  async findFormFields(formId: string): Promise<ResolvedFormField[]> {
    const membershipRows = await this.db.formFields.findMany({
      where: { formId },
      orderBy: { sequenceNumber: 'asc' },
    });

    return await this.resolveMembershipRows(this.db, formId, membershipRows);
  }

  async findFormWithFields(formId: string): Promise<FormWithResolvedFields | null> {
    const form = await this.db.form.findUnique({
      where: { id: formId },
      include: {
        fields: {
          orderBy: { sequenceNumber: 'asc' },
        },
      },
    });

    if (!form) {
      return null;
    }

    const resolvedFields = await this.resolveMembershipRows(this.db, form.id, form.fields);

    return {
      ...form,
      fields: resolvedFields,
    };
  }

  async getGlobalFields(input: {
    projectId: string;
    workspaceId: string;
  }): Promise<GlobalFieldListResult[]> {
    const rows = await this.db.globalField.findMany({
      where: {
        projectId: input.projectId,
        project: {
          workspaceId: input.workspaceId,
        },
      },
      orderBy: [{ fieldName: 'asc' }, { fieldType: 'asc' }],
      select: {
        id: true,
        projectId: true,
        fieldName: true,
        fieldType: true,
        fieldEnum: true,
        fieldOptions: true,
      },
    });

    return rows.map(row => ({
      ...row,
      fieldEnum: parseGlobalFieldEnum(row.fieldEnum),
    })) as GlobalFieldListResult[];
  }

  /**
   * Update form with fields while preserving existing field IDs when possible.
   */
  async updateWithFields(
    id: string,
    data: {
      formName: string;
      formDescription?: string;
      projectId?: string;
      fields: Array<{
        fieldId?: string;
        fieldName?: string;
        fieldType?: FormFieldType;
        fieldEnum?: Prisma.InputJsonValue;
        fieldOptions?: Array<{ id: string; value: string }>;
        isOptional?: boolean;
        parentOptionId?: string | null;
      }>;
    }
  ): Promise<Form> {
    await this.validateString(data.formName, 'formName', 100);

    // Normalize + validate (duplicate input field IDs / duplicate local names).
    const normalizedFields = data.fields.map(normalizeFormFieldInput);
    validateFormFieldInputs(normalizedFields);
    this.validateLocalFieldDefinitions(normalizedFields);
    validateAllBranches(normalizedFields);

    return await updateWithFieldsTx(this, id, data, normalizedFields);
  }

  async resolveFormFieldsForFormId(formId: string): Promise<ResolvedFormField[]> {
    const membershipRows = await this.db.formFields.findMany({
      where: { formId },
      orderBy: { sequenceNumber: 'asc' },
    });
    return await this.resolveMembershipRows(this.db, formId, membershipRows);
  }

  async resolveMembershipRows(
    client: Pick<PrismaClient, 'globalField'>,
    formId: string,
    membershipRows: FormFields[],
  ): Promise<ResolvedFormField[]> {
    const globalFieldIds = membershipRows
      .map(row => row.globalFieldId)
      .filter((value): value is string => Boolean(value));
    const globalDefinitions = globalFieldIds.length
      ? await client.globalField.findMany({ where: { id: { in: globalFieldIds } } })
      : [];
    return resolveFormFields(formId, membershipRows, globalDefinitions);
  }

  private validateLocalFieldDefinitions(fields: FormFieldInput[]): void {
    const validFieldTypes = Object.values(FormFieldType);
    const invalidFieldTypes = fields.filter(field => !validFieldTypes.includes(field.fieldType));

    if (invalidFieldTypes.length > 0) {
      throw new Error(
        `Invalid field type(s): ${invalidFieldTypes.map(f => f.fieldType).join(', ')}. Valid types: ${validFieldTypes.join(', ')}`,
      );
    }
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
      value: Prisma.InputJsonValue;
    }>,
    tx?: Prisma.TransactionClient
  ): Promise<{ count: number }> {
    const client = tx || this.db;
    if (data.length === 0) return { count: 0 };
    const workspaceId = await resolveWorkspaceIdFromModel(client, 'form', { id: data[0].formId });
    const definitions = await resolveFieldDefinitionsByIds(client, data.map((item) => item.fieldId));
    return createFormEntityValues(
      client,
      data.map((item) => ({
        formId: item.formId,
        entityId: item.entityId,
        entityType: item.entityType,
        fieldId: item.fieldId,
        workspaceId,
        // Release-scoped writes (entityType=RELEASE_ENV_FORM/RELEASE_MIGRATION_FORM)
        // pass contextId=releaseTicketId so the same change-type row can hold
        // values across multiple releases without colliding on the
        // (entityId, entityType, fieldId, contextId) unique key.
        contextId: item.contextId,
        fieldType: assertFormFieldType(definitions.get(item.fieldId)?.fieldType, item.fieldId),
        value: item.value,
      })),
      { skipDuplicates: true },
    );
  }

  async upsertTicketFormFields(
    ticketId: string,
    boardId: string,
    fieldPairs: Array<{ fieldName: string; value: string | null | undefined }>
  ): Promise<UpsertTicketFormFieldsResult> {
    const formMapping = await this.db.formContextMapping.findFirst({
      where: { contextId: boardId, contextType: FormContextType.BOARD, entityType: FormEntityType.TICKET },
    });
    const ticketWorkspaceId = await resolveWorkspaceIdFromModel(this.db, 'ticket', { id: ticketId });

    if (!formMapping) {
      logger.warn('[FormsRepository] upsertTicketFormFields — no form mapped to board', {
        ticketId,
        boardId,
      });
      return { updatedFields: [], skippedFields: fieldPairs.map((f) => f.fieldName) };
    }

    const formFields = await this.resolveFormFieldsForFormId(formMapping.formId);
    const fieldsByName = new Map(formFields.map(f => [f.fieldName, f]));

    const updatedFields: string[] = [];
    const skippedFields: string[] = [];
    const now = new Date();

    // Resolve current visit version so revisits don't overwrite prior-visit form values.
    // Compute the max in code (NULL = version 1): the version column is nullable with no DB
    // default, and ORDER BY version DESC would sort NULLs first in Postgres — a legacy NULL
    // row would masquerade as the latest version.
    const existingValues = await findFormEntityValueKeys(this.db, {
      where: { entityId: ticketId, entityType: 'TICKET', contextId: boardId },
    });
    const currentVersion = existingValues.reduce((max, v) => Math.max(max, v.version ?? 1), 1);

    for (const { fieldName, value } of fieldPairs) {
      const valueStr = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
      if (!valueStr) {
        skippedFields.push(fieldName);
        continue;
      }

      const field = fieldsByName.get(fieldName);
      if (!field) {
        logger.warn('[FormsRepository] upsertTicketFormFields — field not found on form', {
          ticketId,
          fieldName,
          formId: formMapping.formId,
        });
        skippedFields.push(fieldName);
        continue;
      }

      const isMulti = field.fieldType === FormFieldType.MULTI_SELECT || field.fieldType === FormFieldType.USER;
      await upsertFormEntityValue(this.db, {
        formId: formMapping.formId,
        workspaceId: ticketWorkspaceId,
        entityId: ticketId,
        entityType: 'TICKET',
        fieldId: field.id,
        contextId: boardId,
        version: currentVersion,
        fieldType: field.fieldType,
        value: isMulti ? [valueStr] : valueStr,
        createdAt: now,
        updatedAt: now,
      });
      updatedFields.push(fieldName);
    }

    return { updatedFields, skippedFields };
  }

  async getFormEntityValuesByEntityId(
    entityId: string,
    entityType: string
  ): Promise<Record<string, any>> {
    const values = await findFormEntityValues(this.db, {
      where: {
        entityId,
        entityType,
      },
    });

    const definitions = await resolveFieldDefinitionsByIds(
      this.db,
      values.map(v => v.fieldId),
    );

    const result: Record<string, any> = {};

    for (const v of values) {
      const field = definitions.get(v.fieldId);
      if (field) {
        result[field.fieldName] = v.value;
      }
    }

    return result;
  }

  async getTicketCustomFormData(
    ticketId: string,
    boardId: string
  ): Promise<TicketCustomFormData | null> {
    const formMapping = await this.db.formContextMapping.findFirst({
      where: {
        contextId: boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
      select: { formId: true },
    });

    if (!formMapping) {
      return null;
    }

    const form = await this.db.form.findUnique({
      where: { id: formMapping.formId },
      select: { id: true, formName: true },
    });

    if (!form) {
      return null;
    }

    const [currentVersionRow] = await findFormEntityValueKeys(this.db, {
      where: {
        entityId: ticketId,
        entityType: 'TICKET',
        formId: form.id,
        contextId: boardId,
      },
      orderBy: { version: 'desc' },
      take: 1,
    });
    const currentVersion = currentVersionRow?.version ?? 1;

    const [resolvedFormFields, formValues] = await Promise.all([
      this.resolveFormFieldsForFormId(form.id),
      findFormEntityValues(this.db, {
        where: {
          entityId: ticketId,
          entityType: 'TICKET',
          formId: form.id,
        },
        orderBy: [
          { version: 'desc' },
          { updatedAt: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      }),
    ]);

    const validValueByFieldId = new Map<string, (typeof formValues)[number]>();

    for (const value of formValues) {
      if (value.contextId !== boardId || (value.version ?? 1) !== currentVersion) {
        logger.warn('[FormsRepository] Skipping unexpected ticket form value', {
          ticketId,
          boardId,
          formId: form.id,
          fieldId: value.fieldId,
          contextId: value.contextId,
          version: value.version,
          expectedVersion: currentVersion,
          formEntityValueId: value.id,
        });
        continue;
      }

      if (validValueByFieldId.has(value.fieldId)) {
        logger.warn('[FormsRepository] Skipping duplicate ticket form value for field', {
          ticketId,
          boardId,
          formId: form.id,
          fieldId: value.fieldId,
          formEntityValueId: value.id,
        });
        continue;
      }

      validValueByFieldId.set(value.fieldId, value);
    }

    const fields: TicketCustomFormFieldValue[] = resolvedFormFields.map((field) => {
      const savedValue = validValueByFieldId.get(field.id);
      const value = savedValue?.value ?? null;

      return {
        fieldId: field.id,
        fieldName: field.fieldName,
        fieldType: field.fieldType as FormFieldType,
        value,
      };
    });

    return {
      formId: form.id,
      formName: form.formName,
      fields,
    };
  }
}


