// Workflow registry for managing predefined workflow definitions

import { WorkflowEngine, BaseWorkflowContext, AnyEnum } from '../workflow-types'
import { WorkflowType } from '../types/workflow-enums'
import { ZodSchema } from 'zod';
import { createWorkflowEngine } from '../workflow-engine';
import zodToJsonSchema from 'zod-to-json-schema';
import {logger} from '@/utils/logger';
import { repositories } from '../../database/repositories';


// Note: We use BaseWorkflowContext for workflow definitions but the engine parameter
// still expects BaseWorkflowContext, so we use type casting where needed

// Type alias for workflows without preExecute
export type EmptyPreExecuteResult = Record<string, never>

export interface WorkflowDefinition<
  TContext extends BaseWorkflowContext,
  TOutput,
  TEnum extends AnyEnum,
  TPreExecuteResult = EmptyPreExecuteResult
> {
  type: WorkflowType
  name: string
  description: string
  // Optional preExecute function that runs before execute()
  preExecute?: (context: Readonly<TContext>) => Promise<TPreExecuteResult>
  // Execute function receives preExecute result as second parameter
  execute: (engine: WorkflowEngine<TContext, TEnum>, preExecuteResult: TPreExecuteResult) => Promise<TOutput>
  estimatedDuration?: number
  tags?: string[]
  // UI and API metadata
  category?: string
  icon?: string
  requiresRepo?: boolean
  fields?: string[]
  priority?: 'low' | 'medium' | 'high'
  experimental?: boolean;
  inputSchema: ZodSchema<any>;
  contextMapper: (payload: any) => TContext;
}

// API response interfaces
export interface WorkflowTypeAPIResponse {
  id: string
  label: string
  description: string
  category: string
  icon: string
  requiresRepo: boolean
  estimatedDuration?: number
  tags: string[]
  fields: string[]
  priority: 'low' | 'medium' | 'high'
  experimental: boolean
}

// Field definition for frontend forms
export interface WorkflowFieldSchema {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  defaultValue?: any;
  nestedFields?: WorkflowFieldSchema[];
}

export interface WorkflowTypesAPIResponse {
  workflowTypes: Array<{
    id: string;
    label: string;
    description: string;
    category: string;
    schema: WorkflowFieldSchema[];   // Array of field definitions for frontend
    icon?: string;
    priority?: 'low' | 'medium' | 'high';
    requiresRepo?: boolean;
    estimatedDuration?: number;
    experimental?: boolean;
  }>;
}

function unwrapZodSchema(schema: any): any {
  if (schema.$ref && schema.definitions) {
    const refName = schema.$ref.replace("#/definitions/", "");
    return schema.definitions[refName];
  }
  return schema;
}


// Helper function to recursively convert schema properties to field array
function convertProperties(properties: any, required: string[]): WorkflowFieldSchema[] {
  return Object.entries(properties).map(([fieldName, fieldDef]: [string, any]) => {
    const def = fieldDef as any;

    let type = "string";
    let enumValues: string[] | undefined;
    let nestedFields: WorkflowFieldSchema[] | undefined;

    if (def.type) {
      type = def.type;
    }
    if (def.enum) {
      type = "enum";
      enumValues = def.enum;
    }

    // Handle nested objects recursively
    if (def.type === "object" && def.properties) {
      nestedFields = convertProperties(def.properties, def.required || []);
    }

    return {
      name: fieldName,
      type,
      required: required.includes(fieldName),
      description: def.description,
      enumValues,
      defaultValue: def.default,
      nestedFields
    };
  });
}

// Helper function to convert JSON Schema to frontend field array
function convertJsonSchemaToFields(jsonSchema: any): WorkflowFieldSchema[] {  
  if (!jsonSchema) return [];  
  
  // Unwrap $ref schema  
  const root = unwrapZodSchema(jsonSchema);  
  
  if (!root.properties) return [];  
  
  const fields: WorkflowFieldSchema[] = [];  
  const required = root.required || [];  
  
  for (const [fieldName, fieldDef] of Object.entries(root.properties)) {  
    const def = fieldDef as any;  
    if (def.description && def.description.startsWith('_HIDDEN_')) {
      continue;
    }
  
    let type = "string";  
    let enumValues: string[] | undefined;  
    let nestedFields: WorkflowFieldSchema[] | undefined;  
  
    if (def.type) {  
      type = def.type;  
    }  
    if (def.enum) {  
      type = "enum";  
      enumValues = def.enum;  
    }  
      
    // Handle nested objects recursively
    if (def.type === "object" && def.properties) {
      nestedFields = convertProperties(def.properties, def.required || []);
    }  
  
    fields.push({  
      name: fieldName,  
      type,  
      required: required.includes(fieldName),  
      description: def.description,  
      enumValues,  
      defaultValue: def.default,  
      nestedFields  
    });  
  }  
  
  return fields;  
}

// Workflow registry class
export class WorkflowRegistry {
  private static instance: WorkflowRegistry;
  private definitions: Map<
    WorkflowType,
    WorkflowDefinition<BaseWorkflowContext, unknown, AnyEnum, unknown>
  > = new Map();

  private constructor() {}

  static getInstance(): WorkflowRegistry {
    if (!WorkflowRegistry.instance) {
      WorkflowRegistry.instance = new WorkflowRegistry();
    }
    return WorkflowRegistry.instance;
  }

  register<
    TContext extends BaseWorkflowContext = BaseWorkflowContext,
    TOutput = void,
    TEnum extends AnyEnum = AnyEnum,
    TPreExecuteResult = EmptyPreExecuteResult,
  >(definition: WorkflowDefinition<TContext, TOutput, TEnum, TPreExecuteResult>): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Workflow type ${definition.type} is already registered`);
    }

    this.definitions.set(
      definition.type,
      definition as WorkflowDefinition<BaseWorkflowContext, unknown, AnyEnum, unknown>
    );
    logger.info(`Registered workflow: ${definition.type} - ${definition.name}`);
  }

  get<
    TContext extends BaseWorkflowContext = BaseWorkflowContext,
    TOutput = unknown,
    TEnum extends AnyEnum = AnyEnum,
    TPreExecuteResult = EmptyPreExecuteResult,
  >(
    workflowType: WorkflowType
  ): WorkflowDefinition<TContext, TOutput, TEnum, TPreExecuteResult> | null {
    const definition = this.definitions.get(workflowType);
    return definition
      ? (definition as WorkflowDefinition<TContext, TOutput, TEnum, TPreExecuteResult>)
      : null;
  }

  has(workflowType: WorkflowType): boolean {
    return this.definitions.has(workflowType);
  }

  getRegisteredTypes(): WorkflowType[] {
    return Array.from(this.definitions.keys());
  }

  getAll(): Array<WorkflowDefinition<BaseWorkflowContext, unknown, AnyEnum, unknown>> {
    return Array.from(this.definitions.values());
  }

  async execute<
    TContext extends BaseWorkflowContext = BaseWorkflowContext,
    TOutput = unknown,
    TEnum extends AnyEnum = AnyEnum,
    TPreExecuteResult = EmptyPreExecuteResult,
  >(
    workflowType: WorkflowType,
    engine: WorkflowEngine<BaseWorkflowContext, AnyEnum>
  ): Promise<TOutput> {
    const definition = this.get<TContext, TOutput, TEnum, TPreExecuteResult>(workflowType);

    if (!definition) {
      throw new Error(`Workflow type ${workflowType} is not registered`);
    }

    try {
      logger.info(`Executing workflow: ${definition.name}`);

      // Execute preExecute if defined, otherwise use empty object
      const rawContext = engine.getContext();
      
      let parsedContext: any = rawContext;
      if (definition.inputSchema) {
        parsedContext = definition.inputSchema.parse(rawContext);
      }
      let mappedContext: TContext = parsedContext;
      if (definition.contextMapper) {
        mappedContext = definition.contextMapper(parsedContext);
      }
      const typedInitialState = {
        ...engine.getCurrentState(),
        context: mappedContext,
      };
      const typedEngine: WorkflowEngine<TContext, TEnum> = createWorkflowEngine<TContext, TEnum>(
        typedInitialState,
        (engine as any).storage // reuse existing storage
      );

      let preExecuteResult: TPreExecuteResult;
      if (definition.preExecute) {
        logger.info(`Running preExecute for workflow: ${definition.name}`);
        const context = typedEngine.getContext() as Readonly<TContext>;
        preExecuteResult = await definition.preExecute(context);
        logger.info(`preExecute completed for workflow: ${definition.name}`);
      } else {
        preExecuteResult = {} as TPreExecuteResult;
      }

      // Execute main workflow with preExecute result
      const output = await definition.execute(typedEngine, preExecuteResult);
      logger.info(`Completed workflow: ${definition.name}`);
      return output;
    } catch (error) {
      logger.error(`Workflow execution failed: ${definition.name}`, error);
      throw error;
    }
  }

  getWorkflowInfo(workflowType: WorkflowType): {
    name: string;
    description: string;
    estimatedDuration?: number;
    tags?: string[];
  } | null {
    const definition = this.get(workflowType);

    if (!definition) {
      return null;
    }

    return {
      name: definition.name,
      description: definition.description,
      estimatedDuration: definition.estimatedDuration,
      tags: definition.tags,
    };
  }

  clear(): void {
    this.definitions.clear();
  }

  unregister(workflowType: WorkflowType): boolean {
    return this.definitions.delete(workflowType);
  }

  async getWorkflowTypesForAPI(): Promise<WorkflowTypesAPIResponse> {
    const workflowTypes = [];

    for (const def of this.definitions.values()) {
      // Convert zod → JSON Schema → frontend field array
      const jsonSchema = def.inputSchema
        ? zodToJsonSchema(def.inputSchema, {
            name: def.type,
            $refStrategy: 'none',
          })
        : null;
      // Convert JSON Schema to frontend-friendly field array
      const schemaFields = convertJsonSchemaToFields(jsonSchema);
      const modelField = schemaFields.find(f => f.name === 'modelName');
      if (modelField) {
        const allModels = await repositories.models.findMany();
        const modelNames = allModels.map((model: { name: string }) => model.name);
        
        if (modelNames.length > 0) {
          modelField.type = 'enum';
          modelField.enumValues = modelNames;
        }
      }

      workflowTypes.push({
        id: def.type,
        label: def.name,
        description: def.description,
        category: def.category || 'General',
        schema: schemaFields,
        icon: def.icon,
        priority: def.priority,
        requiresRepo: def.requiresRepo,
        estimatedDuration: def.estimatedDuration,
        experimental: def.experimental,
      });
    }

    return { workflowTypes };
  }
}


export const workflowRegistry = WorkflowRegistry.getInstance()


export function registerWorkflow<
  TContext extends BaseWorkflowContext = BaseWorkflowContext,
  TOutput = void,
  TEnum extends AnyEnum = AnyEnum,
  TPreExecuteResult = EmptyPreExecuteResult
>(
  definition: WorkflowDefinition<TContext, TOutput, TEnum, TPreExecuteResult>
): void {
  workflowRegistry.register(definition)
}


export function getWorkflowDefinition<
  TContext extends BaseWorkflowContext = BaseWorkflowContext,
  TOutput = unknown,
  TEnum extends AnyEnum = AnyEnum,
  TPreExecuteResult = EmptyPreExecuteResult
>(
  workflowType: WorkflowType
): WorkflowDefinition<TContext, TOutput, TEnum, TPreExecuteResult> | null {
  return workflowRegistry.get<TContext, TOutput, TEnum, TPreExecuteResult>(workflowType)
}


export async function executeWorkflow<
  TContext extends BaseWorkflowContext = BaseWorkflowContext,
  TOutput = unknown,
  TEnum extends AnyEnum = AnyEnum,
  TPreExecuteResult = EmptyPreExecuteResult
>(
  workflowType: WorkflowType,
  engine: WorkflowEngine<BaseWorkflowContext, AnyEnum>
): Promise<TOutput> {
  return workflowRegistry.execute<TContext, TOutput, TEnum, TPreExecuteResult>(workflowType, engine)
}