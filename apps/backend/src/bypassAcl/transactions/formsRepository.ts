import { transaction } from '../base';
import { FormsRepository, CreateFormWithFieldsInput } from '@/database/repositories/formsRepository';
import { FormFieldInput, assertNoNameCollisions } from '@/utils/formFieldResolution';
import { FormFieldType, serializeFieldOptions, FieldEnumOption, parseFieldOptions } from '@xyne/shared';
import { Prisma, FormFields } from '@prisma/client';
import { EntitySequenceService } from '@/services/entitySequenceService';
import { randomUUID } from 'crypto';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import type { LocalFieldDefinitionInput } from '@/database/repositories/formsRepository';
import { serializeGlobalFieldEnum } from '@/utils/globalFieldEnum';


export type FormFieldSequenceState = { formId: string; currentMaxSequence: number };

// Existing memberships keep their allocated number. Only newly inserted
// memberships advance the shared counter; deletes intentionally leave gaps.
async function allocateSequence(state: FormFieldSequenceState): Promise<number> {
  const allocated = await EntitySequenceService.getNextFormFieldSequence(
    state.formId,
    state.currentMaxSequence,
  );
  state.currentMaxSequence = Math.max(state.currentMaxSequence, allocated);
  return allocated;
}

export function createWithFieldsTx(self: FormsRepository, data: CreateFormWithFieldsInput, normalizedFields: FormFieldInput[]) {
  return transaction(['Form', 'FormEntityValues', 'FormFields', 'GlobalField', 'Project'], 'createWithFields: form plus field-definition writes must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
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
      ? await resolveProjectIdForFormFields(tx, {
          workspaceId: data.workspaceId,
          projectId: data.projectId,
        })
      : undefined;

    await syncFormFields(tx, form.id, scopedProjectId, normalizedFields);
    await assertResolvedFieldNameUniqueness(self, tx, form.id);
    return form;
  });
}
export function updateWithFieldsTx(self: FormsRepository, id: string, data: {
  formName: string; formDescription?: string; projectId?: string; fields: Array<{
    fieldId?: string;
    fieldName?: string;
    fieldType?: FormFieldType;
    fieldEnum?: Prisma.InputJsonValue;
    fieldOptions?: Array<{ id: string; value: string; }>;
    isOptional?: boolean;
    parentOptionId?: string | null;
  }>;
}, normalizedFields: FormFieldInput[]) {
  return transaction(['Form', 'FormEntityValues', 'FormFields', 'GlobalField', 'Project'], 'updateWithFields: form plus field-definition writes must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
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
      ? await resolveProjectIdForFormFields(tx, {
          workspaceId: existingForm.workspaceId,
          projectId: data.projectId,
        })
      : undefined;

    await syncFormFields(tx, id, scopedProjectId, normalizedFields);
    await assertResolvedFieldNameUniqueness(self, tx, id);

    return form;
  });
}

  /**
   * Reconcile a form's per-form membership rows (form_fields) against the incoming
   * field list. New definitions live in global_fields; legacy rows are kept in place.
   */
export async function syncFormFields(tx: Prisma.TransactionClient, formId: string, projectId: string | undefined, fields: FormFieldInput[]): Promise<void> {
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
    const sequenceState: FormFieldSequenceState = {
      formId,
      currentMaxSequence: existingRows.reduce(
        (max, row) => Math.max(max, row.sequenceNumber),
        0,
      ),
    };

    for (const field of fields) {
      const isOptional = field.isOptional ?? false;

      if (field.fieldId) {
        const existingGlobalRow = existingByGlobalId.get(field.fieldId);
        if (existingGlobalRow) {
          await updateGlobalFieldDefinition(tx, formId, field.fieldId, field);
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
          await updateGlobalFieldDefinition(tx, formId, reusableGlobal.id, field);
          const existingMembership = existingByGlobalId.get(reusableGlobal.id);
          const rowId = await upsertGlobalMembershipRow(tx, formId, reusableGlobal.id, existingMembership?.sequenceNumber ?? (await allocateSequence(sequenceState)), isOptional, field.parentOptionId ?? null, existingMembership);
          keptRowIds.add(rowId);
          continue;
        }
      }

      // New local field → find-or-create the global definition by (projectId, name + type).
      if(projectId) {
        const globalFieldId = await findOrCreateGlobalField(tx, projectId, field);
        const existingMembership = existingByGlobalId.get(globalFieldId);
        const rowId = await upsertGlobalMembershipRow(tx, formId, globalFieldId, existingMembership?.sequenceNumber ?? (await allocateSequence(sequenceState)), isOptional, field.parentOptionId ?? null, existingMembership);
        keptRowIds.add(rowId);
      } else {
        const rowId = await findOrCreateLegacyField(tx, formId, field, isOptional, sequenceState);
        keptRowIds.add(rowId);
      }
    }

    const removedRows = existingRows.filter(row => !keptRowIds.has(row.id));
    await deleteRemovedMembershipRows(tx, formId, projectId, removedRows);
  }

export async function resolveProjectIdForFormFields(tx: Prisma.TransactionClient, input: {
      workspaceId: string;
      projectId?: string;
    }): Promise<string> {
    const { workspaceId, projectId } = input;

    if (!projectId) {
      throw new Error('Project ID is required for reusable form fields');
    }

    await assertProjectScope(tx, projectId, workspaceId);
    return projectId;
  }

export async function assertResolvedFieldNameUniqueness(self: FormsRepository, tx: Prisma.TransactionClient, formId: string): Promise<void> {
    const membershipRows = await tx.formFields.findMany({ where: { formId } });
    const resolvedFields = await self.resolveMembershipRows(tx, formId, membershipRows);
    assertNoNameCollisions(resolvedFields);
  }

export async function upsertGlobalMembershipRow(tx: Prisma.TransactionClient, formId: string, globalFieldId: string, sequenceNumber: number, isOptional: boolean, parentOptionId: string | null, existing?: FormFields): Promise<string> {
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

    const workspaceId = await resolveWorkspaceIdFromModel(tx, 'form', { id: formId });
    const created = await tx.formFields.create({
      data: {
        id: randomUUID(),
        formId,
        globalFieldId,
        sequenceNumber,
        isOptional,
        parentOptionId,
        workspaceId,
      },
    });
    return created.id;
  }

export async function findOrCreateGlobalField(tx: Prisma.TransactionClient, projectId: string, def: LocalFieldDefinitionInput): Promise<string> {
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
    const workspaceId = await resolveWorkspaceIdFromModel(tx, 'project', { id: projectId });
    const created = await tx.globalField.create({
      data: {
        id: def.fieldId ?? randomUUID(),
        projectId,
        workspaceId,
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

export async function findOrCreateLegacyField(tx: Prisma.TransactionClient, formId: string, def: LocalFieldDefinitionInput, isOptional: boolean, sequenceState: FormFieldSequenceState): Promise<string> {
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
    const sequenceNumber = await allocateSequence(sequenceState);
    const legacyWorkspaceId = await resolveWorkspaceIdFromModel(tx, 'form', { id: formId });
    const created = await tx.formFields.create({
      data: {
        id: def.fieldId ?? randomUUID(),
        formId,
        workspaceId: legacyWorkspaceId,
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

export async function updateGlobalFieldDefinition(tx: Prisma.TransactionClient, formId: string, globalFieldId: string, def: LocalFieldDefinitionInput): Promise<void> {
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

export async function assertProjectScope(tx: Prisma.TransactionClient, projectId: string, workspaceId: string): Promise<void> {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project || project.workspaceId !== workspaceId) {
      throw new Error(`Project ${projectId} does not belong to this workspace`);
    }

  }

export async function deleteRemovedMembershipRows(tx: Prisma.TransactionClient, formId: string, projectId: string | undefined, removedRows: FormFields[]): Promise<void> {
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

      const definitionId = await ensureLegacyGlobalField(tx, projectId, row);
      if (definitionId && definitionId !== row.id) {
        await tx.formEntityValues.updateMany({
          where: { formId, fieldId: row.id },
          data: { fieldId: definitionId, updatedAt: new Date() },
        });
      }

      await tx.formFields.delete({ where: { id: row.id } });
    }
  }

export async function ensureLegacyGlobalField(tx: Prisma.TransactionClient, projectId: string, row: FormFields): Promise<string | undefined> {
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
    const globalWorkspaceId = await resolveWorkspaceIdFromModel(tx, 'project', { id: projectId });
    const created = await tx.globalField.create({
      data: {
        id: row.id,
        projectId,
        workspaceId: globalWorkspaceId,
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
