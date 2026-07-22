import { randomUUID } from 'crypto';
import { FormContextType, FormEntityType, FormFieldType, parseFieldOptions, resolveParentOption, serializeFieldOptions, type FieldEnumOption } from '@xyne/shared';
import { BaseRepository } from './base';
import { Form, FormFields, Prisma, PrismaClient, FormFieldType as PrismaFormFieldType } from '@prisma/client';
import { logger } from '@/utils/logger';
import {
  assertNoNameCollisions,
  FormFieldInput,
  normalizeFormFieldInput,
  resolveFormFields,
  ResolvedFormField,
  validateFormFieldInputs,
} from '@/utils/formFieldResolution';
import { resolveFieldDefinitionsByIds } from '@/utils/fieldDefinition';
import { parseGlobalFieldEnum, serializeGlobalFieldEnum } from '@/utils/globalFieldEnum';
import { EntitySequenceService } from '@/services/entitySequenceService';

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
  fieldType: PrismaFormFieldType;
  fieldEnum: Prisma.JsonValue | null;
  fieldOptions: Prisma.JsonValue | null;
}

interface LocalFieldDefinitionInput {
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

      const scopedProjectId = data.projectId
        ? await this.resolveProjectIdForFormFields(tx, {
            workspaceId: data.workspaceId,
            projectId: data.projectId,
          })
        : undefined;

      await this.syncFormFields(tx, form.id, scopedProjectId, normalizedFields);
      await this.assertResolvedFieldNameUniqueness(tx, form.id);
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
    }));
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

    return await this.db.$transaction(async (tx) => {
      const existingForm = await tx.form.findUnique({
        where: { id },
        select: { workspaceId: true },
      });
      if (!existingForm) {
        throw new Error('Form not found');
      }

      const form = await tx.form.update({
        where: { id },
        data: {
          formName: data.formName.trim(),
          formDescription: data.formDescription?.trim() || null,
        },
      });

      const scopedProjectId = data.projectId
        ? await this.resolveProjectIdForFormFields(tx, {
            workspaceId: existingForm.workspaceId,
            projectId: data.projectId,
          })
        : undefined;

      await this.syncFormFields(tx, id, scopedProjectId, normalizedFields);
      await this.assertResolvedFieldNameUniqueness(tx, id);

      return form;
    });
  }

  async resolveFormFieldsForFormId(formId: string): Promise<ResolvedFormField[]> {
    const membershipRows = await this.db.formFields.findMany({
      where: { formId },
      orderBy: { sequenceNumber: 'asc' },
    });
    return await this.resolveMembershipRows(this.db, formId, membershipRows);
  }

  private async resolveMembershipRows(
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
   * Reconcile a form's per-form membership rows (form_fields) against the incoming
   * field list. New definitions live in global_fields; legacy rows are kept in place.
   */
  private async syncFormFields(
    tx: Prisma.TransactionClient,
    formId: string,
    projectId: string | undefined,
    fields: FormFieldInput[],
  ): Promise<void> {
    const existingRows = await tx.formFields.findMany({ where: { formId } });
    const existingByGlobalId = new Map<string, FormFields>();
    const existingById = new Map<string, FormFields>();
    for (const row of existingRows) {
      existingById.set(row.id, row);
      if (row.globalFieldId) {
        existingByGlobalId.set(row.globalFieldId, row);
      }
    }

    const keptRowIds = new Set<string>();
    // Existing memberships keep their allocated number. Only newly inserted
    // memberships advance the shared counter; deletes intentionally leave gaps.
    let currentMaxSequence = existingRows.reduce(
      (max, row) => Math.max(max, row.sequenceNumber),
      0,
    );
    const allocateSequence = async (): Promise<number> => {
      const allocated = await EntitySequenceService.getNextFormFieldSequence(
        formId,
        currentMaxSequence,
      );
      currentMaxSequence = Math.max(currentMaxSequence, allocated);
      return allocated;
    };

    for (const field of fields) {
      const isOptional = field.isOptional ?? false;

      if (field.fieldId) {
        const existingGlobalRow = existingByGlobalId.get(field.fieldId);
        if (existingGlobalRow) {
          await this.updateGlobalFieldDefinition(tx, formId, field.fieldId, field);
          await tx.formFields.update({
            where: { id: existingGlobalRow.id },
            data: { isOptional, parentOptionId: field.parentOptionId ?? null },
          });
          keptRowIds.add(existingGlobalRow.id);
          continue;
        }

        const existingLegacyRow = existingById.get(field.fieldId);
        if (existingLegacyRow && !existingLegacyRow.globalFieldId) {
          // Update the legacy row in place to keep its id + saved values stable.
          await tx.formFields.update({
            where: { id: existingLegacyRow.id },
            data: {
              fieldName: field.fieldName.trim(),
              fieldType: field.fieldType,
              fieldEnum: field.fieldEnum ?? Prisma.DbNull,
              fieldOptions: serializeFieldOptions(field.fieldOptions as FieldEnumOption[] | undefined),
              isOptional,
              parentOptionId: field.parentOptionId ?? null,
            },
          });
          keptRowIds.add(existingLegacyRow.id);
          continue;
        }

        // Reuse an existing project global field (e.g. picked from autocomplete) by
        // linking it to this form without mutating the shared definition.
        const reusableGlobal = await tx.globalField.findUnique({
          where: { id: field.fieldId },
        });
        if (reusableGlobal) {
          if (reusableGlobal.projectId !== projectId) {
            throw new Error(`Field ${field.fieldId} does not belong to this form`);
          }
          await this.updateGlobalFieldDefinition(tx, formId, reusableGlobal.id, field);
          const existingMembership = existingByGlobalId.get(reusableGlobal.id);
          const rowId = await this.upsertGlobalMembershipRow(
            tx,
            formId,
            reusableGlobal.id,
            existingMembership?.sequenceNumber ?? (await allocateSequence()),
            isOptional,
            field.parentOptionId ?? null,
            existingMembership,
          );
          keptRowIds.add(rowId);
          continue;
        }
      }

      // New local field → find-or-create the global definition by (projectId, name + type).
      if(projectId) {
        const globalFieldId = await this.findOrCreateGlobalField(tx, projectId, field);
        const existingMembership = existingByGlobalId.get(globalFieldId);
        const rowId = await this.upsertGlobalMembershipRow(
          tx,
          formId,
          globalFieldId,
          existingMembership?.sequenceNumber ?? (await allocateSequence()),
          isOptional,
          field.parentOptionId ?? null,
          existingMembership,
        );
        keptRowIds.add(rowId);
      } else {
        const rowId = await this.findOrCreateLegacyField(
          tx,
          formId,
          field,
          isOptional,
          allocateSequence,
        );
        keptRowIds.add(rowId);
      }
    }

    const removedRows = existingRows.filter(row => !keptRowIds.has(row.id));
    await this.deleteRemovedMembershipRows(tx, formId, projectId, removedRows);
  }

  private async upsertGlobalMembershipRow(
    tx: Prisma.TransactionClient,
    formId: string,
    globalFieldId: string,
    sequenceNumber: number,
    isOptional: boolean,
    parentOptionId: string | null,
    existing?: FormFields,
  ): Promise<string> {
    if (existing) {
      await tx.formFields.update({
        where: { id: existing.id },
        data: {
          globalFieldId,
          sequenceNumber,
          isOptional,
          parentOptionId,
          fieldName: null,
          fieldType: null,
          fieldEnum: Prisma.DbNull,
          fieldOptions: null,
        },
      });
      return existing.id;
    }

    const created = await tx.formFields.create({
      data: {
        id: randomUUID(),
        formId,
        globalFieldId,
        sequenceNumber,
        isOptional,
        parentOptionId,
      },
    });
    return created.id;
  }

  private async findOrCreateGlobalField(
    tx: Prisma.TransactionClient,
    projectId: string,
    def: LocalFieldDefinitionInput,
  ): Promise<string> {
    const fieldName = def.fieldName.trim();
    const existing = await tx.globalField.findFirst({
      where: {
        projectId,
        fieldName,
        fieldType: def.fieldType,
      },
    });

    if (existing) {
      if (def.fieldEnum !== undefined) {
        await tx.globalField.update({
          where: { id: existing.id },
          data: {
            fieldEnum: serializeGlobalFieldEnum(def.fieldEnum),
            fieldOptions: serializeFieldOptions(def.fieldOptions as FieldEnumOption[] | undefined),
          },
        });
      }
      return existing.id;
    }

    const now = new Date();
    const created = await tx.globalField.create({
      data: {
        id: def.fieldId ?? randomUUID(),
        projectId,
        fieldName,
        fieldType: def.fieldType,
        ...(def.fieldEnum !== undefined ? { fieldEnum: serializeGlobalFieldEnum(def.fieldEnum) } : {}),
        ...(def.fieldOptions !== undefined
          ? { fieldOptions: serializeFieldOptions(def.fieldOptions as FieldEnumOption[] | undefined) }
          : {}),
        createdAt: now,
        updatedAt: now,
      },
    });
    return created.id;
  }

  private async findOrCreateLegacyField(
    tx: Prisma.TransactionClient,
    formId: string,
    def: LocalFieldDefinitionInput,
    isOptional: boolean,
    allocateSequence: () => Promise<number>,
  ): Promise<string> {
    const fieldName = def.fieldName.trim();
    const existing = await tx.formFields.findFirst({
      where: {
        formId,
        fieldName,
        fieldType: def.fieldType,
      },
    });

    if (existing) {
      await tx.formFields.update({
        where: { id: existing.id },
        data: {
          globalFieldId: null,
          fieldName,
          fieldType: def.fieldType,
          fieldEnum: def.fieldEnum ?? Prisma.DbNull,
          fieldOptions: serializeFieldOptions(def.fieldOptions as FieldEnumOption[] | undefined),
          isOptional,
          updatedAt: new Date(),
        },
      });
      return existing.id;
    }

    const now = new Date();
    const sequenceNumber = await allocateSequence();
    const created = await tx.formFields.create({
      data: {
        id: def.fieldId ?? randomUUID(),
        formId,
        globalFieldId: null,
        fieldName,
        fieldType: def.fieldType,
        fieldEnum: def.fieldEnum ?? Prisma.DbNull,
        fieldOptions: serializeFieldOptions(def.fieldOptions as FieldEnumOption[] | undefined),
        isOptional,
        sequenceNumber,
        createdAt: now,
        updatedAt: now,
      },
    });
    return created.id;
  }

  private async updateGlobalFieldDefinition(
    tx: Prisma.TransactionClient,
    formId: string,
    globalFieldId: string,
    def: LocalFieldDefinitionInput,
  ): Promise<void> {
    const existing = await tx.globalField.findUnique({
      where: { id: globalFieldId },
      select: { fieldName: true, fieldType: true, fieldEnum: true, fieldOptions: true },
    });
    if (!existing) {
      throw new Error(`Field ${globalFieldId} does not belong to this form`);
    }

    // An option's id is a per-form parentOptionId's only anchor — if some other form has a
    // branch child pointing at an option this save is about to remove, that child would be
    // left referencing an option that no longer exists.
    const oldOptionIds = new Set(parseFieldOptions(existing.fieldOptions ?? existing.fieldEnum).map(o => o.id));
    const newOptionIds = new Set(
      ((def.fieldOptions as FieldEnumOption[] | undefined) ?? []).map(o => o.id),
    );
    const removedOptionIds = [...oldOptionIds].filter(id => !newOptionIds.has(id));
    if (removedOptionIds.length > 0) {
      const dependentRows = await tx.formFields.findMany({
        where: { parentOptionId: { in: removedOptionIds } },
        select: { formId: true },
      });
      if (dependentRows.some(row => row.formId !== formId)) {
        throw new Error(
          `An option on "${def.fieldName.trim()}" can't be removed — a nested field on another board depends on it.`,
        );
      }
    }

    try {
      await tx.globalField.update({
        where: { id: globalFieldId },
        data: {
          fieldName: def.fieldName.trim(),
          fieldType: def.fieldType,
          fieldEnum: serializeGlobalFieldEnum(def.fieldEnum),
          fieldOptions: serializeFieldOptions(def.fieldOptions as FieldEnumOption[] | undefined),
        },
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new Error('A field with this name and type already exists in this project');
      }
      throw error;
    }
  }

  private async assertProjectScope(
    tx: Prisma.TransactionClient,
    projectId: string,
    workspaceId: string,
  ): Promise<void> {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project || project.workspaceId !== workspaceId) {
      throw new Error(`Project ${projectId} does not belong to this workspace`);
    }

  }

  private async resolveProjectIdForFormFields(
    tx: Prisma.TransactionClient,
    input: {
      workspaceId: string;
      projectId?: string;
    },
  ): Promise<string> {
    const { workspaceId, projectId } = input;

    if (!projectId) {
      throw new Error('Project ID is required for reusable form fields');
    }

    await this.assertProjectScope(tx, projectId, workspaceId);
    return projectId;
  }

  private async deleteRemovedMembershipRows(
    tx: Prisma.TransactionClient,
    formId: string,
    projectId: string | undefined,
    removedRows: FormFields[],
  ): Promise<void> {
    if (removedRows.length === 0) {
      return;
    }

    for (const row of removedRows) {
      if (!projectId) {
        if (row.globalFieldId) {
          await tx.formFields.delete({ where: { id: row.id } });
          continue;
        }

        const valueCount = await tx.formEntityValues.count({
          where: {
            formId,
            fieldId: row.id,
          },
        });
        if (valueCount > 0) {
          throw new Error(`Cannot delete field "${row.fieldName ?? row.id}" because it has saved values`);
        }
        await tx.formFields.delete({ where: { id: row.id } });
        continue;
      }

      const definitionId = await this.ensureLegacyGlobalField(tx, projectId, row);
      if (definitionId && definitionId !== row.id) {
        await tx.formEntityValues.updateMany({
          where: { formId, fieldId: row.id },
          data: { fieldId: definitionId, updatedAt: new Date() },
        });
      }

      await tx.formFields.delete({ where: { id: row.id } });
    }
  }

  private async ensureLegacyGlobalField(
    tx: Prisma.TransactionClient,
    projectId: string,
    row: FormFields,
  ): Promise<string | undefined> {
    if (row.globalFieldId) {
      return row.globalFieldId;
    }
    if (!row.fieldName || !row.fieldType) {
      return undefined;
    }

    const existing = await tx.globalField.findFirst({
      where: {
        projectId,
        fieldName: row.fieldName,
        fieldType: row.fieldType,
      },
    });
    if (existing) {
      return existing.id;
    }

    const now = new Date();
    const created = await tx.globalField.create({
      data: {
        id: row.id,
        projectId,
        fieldName: row.fieldName,
        fieldType: row.fieldType,
        ...(row.fieldEnum !== null ? { fieldEnum: serializeGlobalFieldEnum(row.fieldEnum) } : {}),
        ...(row.fieldOptions !== null ? { fieldOptions: row.fieldOptions } : {}),
        createdAt: now,
        updatedAt: now,
      },
    });
    return created.id;
  }

  private async assertResolvedFieldNameUniqueness(
    tx: Prisma.TransactionClient,
    formId: string,
  ): Promise<void> {
    const membershipRows = await tx.formFields.findMany({ where: { formId } });
    const resolvedFields = await this.resolveMembershipRows(tx, formId, membershipRows);
    assertNoNameCollisions(resolvedFields);
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
      data: data.map((item) => ({
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
    fieldPairs: Array<{ fieldName: string; value: string | null | undefined }>
  ): Promise<UpsertTicketFormFieldsResult> {
    const formMapping = await this.db.formContextMapping.findFirst({
      where: { contextId: boardId, contextType: 'BOARD', entityType: 'TICKET' },
    });

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
    const existingValues = await this.db.formEntityValues.findMany({
      where: { entityId: ticketId, entityType: 'TICKET', contextId: boardId },
      select: { version: true },
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

    const definitions = await resolveFieldDefinitionsByIds(
      this.db,
      values.map(v => v.fieldId),
    );

    const result: Record<string, any> = {};

    for (const v of values) {
      const field = definitions.get(v.fieldId);
      if (field) {
        result[field.fieldName] = v.actualFieldValue ?? v.fieldValue;
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
        contextType: 'BOARD',
        entityType: 'TICKET',
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

    const currentVersionRow = await this.db.formEntityValues.findFirst({
      where: {
        entityId: ticketId,
        entityType: 'TICKET',
        formId: form.id,
        contextId: boardId,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const currentVersion = currentVersionRow?.version ?? 1;

    const [resolvedFormFields, formValues] = await Promise.all([
      this.resolveFormFieldsForFormId(form.id),
      this.db.formEntityValues.findMany({
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
      if (value.contextId !== boardId || value.version !== currentVersion) {
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
      const value = (savedValue?.actualFieldValue as Prisma.JsonValue | null | undefined) ?? null;

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
