import { PrismaClient, FormEntityType, FormFieldType } from '@prisma/client';
import { FieldInfo, FieldType, AvailableFields, getPrismaModelName } from './types';
import {logger} from '@/utils/logger';

const FORM_FIELD_TYPE_MAPPING: Record<FormFieldType, FieldType> = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATE: 'date',
  SINGLE_SELECT: 'select',
  MULTI_SELECT: 'select',
  USER: 'string',
};

export type PrismaFieldType = 'String' | 'Int' | 'Float' | 'Boolean' | 'DateTime' | 'Json' | 'BigInt';

export interface FieldMetadata {
  name: string;
  type: PrismaFieldType;
  isRequired: boolean;
  isId: boolean;
  enumValues?: string[];
  sortable: boolean;
  filterable: boolean;
  aggregatable: boolean;
}


const SCHEMA_CACHE = new Map<string, Map<string, FieldMetadata>>();

async function initSchemaCache(): Promise<void> {
  // Dynamic import to avoid ES module compatibility issues
  const { getDMMF } = await import('@prisma/internals');
  const dmmf = await getDMMF({ datamodelPath: './prisma/schema.prisma' });

  for (const model of dmmf.datamodel.models) {
    const fields = new Map<string, FieldMetadata>();

    for (const field of model.fields) {
      const fieldType = field.type as PrismaFieldType;

      // Get enum values for enum fields
      let enumValues: string[] | undefined;
      if (field.kind === 'enum') {
        const enumType = dmmf.datamodel.enums.find(e => e.name === field.type);
        enumValues = enumType?.values.map(v => v.name);
      }

      fields.set(field.name, {
        name: field.name,
        type: fieldType,
        isRequired: field.isRequired,
        isId: field.isId,
        enumValues,
        sortable: fieldType !== 'Json',
        filterable: fieldType !== 'Json',
        aggregatable: ['Int', 'Float', 'DateTime', 'String'].includes(fieldType),
      });
    }

    SCHEMA_CACHE.set(model.name, fields);
  }
}

export function getModelFields(modelName: string): Map<string, FieldMetadata> | undefined {
  return SCHEMA_CACHE.get(modelName);
}

export function getFieldMetadata(modelName: string, fieldName: string): FieldMetadata | undefined {
  return SCHEMA_CACHE.get(modelName)?.get(fieldName);
}

export function hasField(modelName: string, fieldName: string): boolean {
  return SCHEMA_CACHE.get(modelName)?.has(fieldName) ?? false;
}


function mapPrismaTypeToFieldType(metadata: FieldMetadata): FieldType {
  if (metadata.enumValues && metadata.enumValues.length > 0) {
    return 'select';
  }

  switch (metadata.type) {
    case 'String':
      return 'string';
    case 'Int':
    case 'Float':
    case 'BigInt':
      return 'number';
    case 'Boolean':
      return 'boolean';
    case 'DateTime':
      return 'date';
    case 'Json':
      return 'string';
    default:
      return 'string';
  }
}


function extractFieldsFromModel(modelName: string): FieldInfo[] {
  const fields = getModelFields(modelName);
  if (!fields) {
    return [];
  }

  return Array.from(fields.values()).map(metadata => {
    const fieldType = mapPrismaTypeToFieldType(metadata);

    return {
      name: metadata.name,
      type: fieldType,
      sortable: metadata.sortable,
      filterable: metadata.filterable,
      aggregatable: metadata.aggregatable,
      enumType: metadata.enumValues ? `${modelName}.${metadata.name}` : undefined,
      enumValues: metadata.enumValues,
      description: `${modelName} ${metadata.name}`,
    };
  });
}

export class GenericFieldRegistry {
  private static instance: GenericFieldRegistry | null = null;
  private prisma: PrismaClient;

  private constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  static async initialize(): Promise<void> {
    if (SCHEMA_CACHE.size > 0) {
      return; // Already initialized
    }
    await initSchemaCache();
  }

  static getInstance(prisma: PrismaClient): GenericFieldRegistry {
    if (!GenericFieldRegistry.instance) {
      GenericFieldRegistry.instance = new GenericFieldRegistry(prisma);
    }
    return GenericFieldRegistry.instance;
  }

  getSystemFields(entityType: FormEntityType): FieldInfo[] {
    const modelName = getPrismaModelName(entityType);
    return extractFieldsFromModel(modelName);
  }

  async getCustomFields(entityType: FormEntityType): Promise<FieldInfo[]> {
    try {
      const forms = await this.prisma.form.findMany({
        where: { entityType },
        select: { id: true },
      });

      if (forms.length === 0) {
        return [];
      }

      const formIds = forms.map(f => f.id);

      const formFields = await this.prisma.formFields.findMany({
        where: { formId: { in: formIds } },
        select: { id: true, fieldName: true, fieldType: true },
      });

      return formFields.map(ff => {
        const fieldType = FORM_FIELD_TYPE_MAPPING[ff.fieldType];

        // Determine sortable, filterable, aggregatable based on field type
        const sortable = fieldType === 'string' || fieldType === 'number' || fieldType === 'date' || fieldType === 'boolean';
        const aggregatable = fieldType === 'number' || fieldType === 'date';

        return {
          name: ff.fieldName,
          fieldId: ff.id,
          type: fieldType,
          sortable,
          filterable: true,
          aggregatable,
          description: `Custom field: ${ff.fieldName}`,
        };
      });
    } catch (error) {
      logger.error('Error fetching custom fields:', error);
      return [];
    }
  }


  async getAvailableFields(entityType: FormEntityType): Promise<AvailableFields> {
    const systemFields = this.getSystemFields(entityType);
    const customFields = await this.getCustomFields(entityType);

    return {
      system: systemFields,
      custom: customFields,
    };
  }
}
