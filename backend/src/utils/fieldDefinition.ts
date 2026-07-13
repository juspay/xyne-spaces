import type { Prisma, PrismaClient } from '@prisma/client';
import { FormFieldType } from '@xyne/shared';
import { parseGlobalFieldEnum } from './globalFieldEnum';

/**
 * A resolved field definition, regardless of whether it lives in the new
 * workspace-scoped `global_fields` table or on a legacy `form_fields` row.
 */
export interface FieldDefinition {
  id: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum: Prisma.JsonValue | null;
  source: 'global' | 'legacy';
}

/** Minimal client shape satisfied by both PrismaClient and a transaction client. */
type FieldDefinitionClient = Pick<PrismaClient, 'globalField' | 'formFields'>;

/**
 * Resolve field definitions for a set of field ids.
 *
 * A field id may reference either a `global_fields` row (new fields) or a legacy
 * `form_fields` row (deployed fields). We look up global fields first, then fall
 * back to legacy form_fields for any ids that weren't found.
 */
export const resolveFieldDefinitionsByIds = async (
  client: FieldDefinitionClient,
  ids: string[],
): Promise<Map<string, FieldDefinition>> => {
  const result = new Map<string, FieldDefinition>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) {
    return result;
  }

  const globals = await client.globalField.findMany({ where: { id: { in: unique } } });
  for (const g of globals) {
    result.set(g.id, {
      id: g.id,
      fieldName: g.fieldName,
      fieldType: g.fieldType as FormFieldType,
      fieldEnum: parseGlobalFieldEnum(g.fieldEnum),
      source: 'global',
    });
  }

  const remaining = unique.filter(id => !result.has(id));
  if (remaining.length > 0) {
    const legacy = await client.formFields.findMany({ where: { id: { in: remaining } } });
    for (const f of legacy) {
      if (f.fieldName && f.fieldType) {
        result.set(f.id, {
          id: f.id,
          fieldName: f.fieldName,
          fieldType: f.fieldType as FormFieldType,
          fieldEnum: f.fieldEnum,
          source: 'legacy',
        });
      }
    }
  }

  return result;
};

export const resolveFieldDefinitionById = async (
  client: FieldDefinitionClient,
  id: string,
): Promise<FieldDefinition | null> => {
  const map = await resolveFieldDefinitionsByIds(client, [id]);
  return map.get(id) ?? null;
};

export interface ResolvedFormFieldDefinition {
  id: string; // globalField id for new rows, form_fields id for legacy rows
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum: Prisma.JsonValue | null;
  isOptional: boolean;
  sequenceNumber: number;
}

type FormFieldsQueryClient = Pick<PrismaClient, 'formFields'>;

/**
 * Resolve all fields for a form (membership + coalesced definition), ordered by
 * sequenceNumber. New rows resolve to their global_fields definition; legacy rows
 * resolve to their own definition columns.
 */
export const resolveFormFieldDefinitionsForForm = async (
  client: FormFieldsQueryClient,
  formId: string,
): Promise<ResolvedFormFieldDefinition[]> => {
  const rows = await client.formFields.findMany({
    where: { formId },
    orderBy: { sequenceNumber: 'asc' },
    include: { globalField: true },
  });

  return rows
    .map(row => {
      const id = row.globalFieldId ?? row.id;
      const fieldName = row.globalField?.fieldName ?? row.fieldName;
      const fieldType = (row.globalField?.fieldType ?? row.fieldType) as FormFieldType | null;
      const fieldEnum = row.globalField ? parseGlobalFieldEnum(row.globalField.fieldEnum) : row.fieldEnum;
      if (!fieldName || !fieldType) {
        return null;
      }
      return {
        id,
        fieldName,
        fieldType,
        fieldEnum,
        isOptional: row.isOptional,
        sequenceNumber: row.sequenceNumber,
      };
    })
    .filter((field): field is ResolvedFormFieldDefinition => field !== null);
};
