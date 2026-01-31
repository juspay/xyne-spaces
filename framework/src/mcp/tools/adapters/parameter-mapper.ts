/**
 * Parameter mapping between MCP tools and framework tools
 */

import { z } from 'zod';
import type { JSONSchema } from '../../core/types/framework.js';
import type { ParameterMappingResult, SchemaAdaptationResult } from '../types/index.js';

/**
 * Maps parameters and schemas between MCP and framework formats
 */
export class ParameterMapper {
  
  /**
   * Convert MCP tool parameters to framework parameters
   */
  public mapParameters(
    mcpParameters: Record<string, unknown>,
    mcpSchema?: JSONSchema
  ): ParameterMappingResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    const mappedParameters: Record<string, unknown> = {};

    try {
      // If no schema provided, pass parameters through as-is
      if (!mcpSchema) {
        return {
          success: true,
          mappedParameters: mcpParameters,
          warnings: ['No schema provided, parameters passed through without validation'],
          errors: []
        };
      }

      // Validate and map each parameter
      for (const [key, value] of Object.entries(mcpParameters)) {
        try {
          const mappedValue = this.mapParameterValue(key, value, mcpSchema, warnings);
          mappedParameters[key] = mappedValue;
        } catch (error) {
          errors.push(`Failed to map parameter '${key}': ${(error as Error).message}`);
        }
      }

      // Check for required parameters
      const requiredParams = this.getRequiredParameters(mcpSchema);
      for (const requiredParam of requiredParams) {
        if (!(requiredParam in mappedParameters)) {
          errors.push(`Required parameter '${requiredParam}' is missing`);
        }
      }

      return {
        success: errors.length === 0,
        mappedParameters,
        warnings,
        errors
      };
    } catch (error) {
      return {
        success: false,
        mappedParameters: {},
        warnings,
        errors: [`Parameter mapping failed: ${(error as Error).message}`]
      };
    }
  }

  /**
   * Adapt MCP JSON Schema to Zod schema for framework use
   */
  public adaptSchema<TInput = unknown, TOutput = unknown>(
    inputSchema?: JSONSchema,
    outputSchema?: JSONSchema
  ): SchemaAdaptationResult<TInput, TOutput> {
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // Convert input schema
      const zodInputSchema = inputSchema 
        ? this.jsonSchemaToZod(inputSchema, 'input', warnings, errors)
        : z.record(z.unknown()); // Accept any object if no schema

      // Convert output schema  
      const zodOutputSchema = outputSchema
        ? this.jsonSchemaToZod(outputSchema, 'output', warnings, errors)
        : z.unknown(); // Accept any output if no schema

      return {
        success: errors.length === 0,
        inputSchema: zodInputSchema as z.ZodSchema<TInput>,
        outputSchema: zodOutputSchema as z.ZodSchema<TOutput>,
        warnings,
        errors
      };
    } catch (error) {
      return {
        success: false,
        inputSchema: z.record(z.unknown()) as z.ZodSchema<TInput>,
        outputSchema: z.unknown() as z.ZodSchema<TOutput>,
        warnings,
        errors: [`Schema adaptation failed: ${(error as Error).message}`]
      };
    }
  }

  /**
   * Map a single parameter value
   */
  private mapParameterValue(
    key: string,
    value: unknown,
    schema: JSONSchema,
    warnings: string[]
  ): unknown {
    const propertySchema = schema.properties?.[key];
    
    if (!propertySchema) {
      warnings.push(`No schema definition found for parameter '${key}', passing through as-is`);
      return value;
    }

    // Handle different types
    if (typeof propertySchema === 'object' && propertySchema !== null && 'type' in propertySchema) {
      const expectedType = propertySchema.type;
      
      switch (expectedType) {
        case 'string':
          return this.mapStringValue(value, key, propertySchema, warnings);
        case 'number':
        case 'integer':
          return this.mapNumberValue(value, key, expectedType, warnings);
        case 'boolean':
          return this.mapBooleanValue(value, key, warnings);
        case 'array':
          return this.mapArrayValue(value, key, propertySchema, warnings);
        case 'object':
          return this.mapObjectValue(value, key, propertySchema, warnings);
        default:
          warnings.push(`Unknown type '${expectedType}' for parameter '${key}'`);
          return value;
      }
    }

    return value;
  }

  /**
   * Map string values with validation
   */
  private mapStringValue(
    value: unknown,
    key: string,
    schema: Record<string, unknown>,
    warnings: string[]
  ): string {
    if (typeof value === 'string') {
      // Check enum values
      if (Array.isArray(schema['enum']) && !schema['enum'].includes(value)) {
        warnings.push(`Value '${value}' for parameter '${key}' is not in allowed enum values`);
      }
      
      // Check pattern
      if (typeof schema['pattern'] === 'string') {
        const regex = new RegExp(schema['pattern']);
        if (!regex.test(value)) {
          warnings.push(`Value '${value}' for parameter '${key}' does not match required pattern`);
        }
      }
      
      return value;
    }
    
    // Try to convert to string
    if (value !== null && value !== undefined) {
      warnings.push(`Converting non-string value to string for parameter '${key}'`);
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
      }
      return String(value as string | number | boolean);
    }
    
    throw new Error(`Cannot convert null/undefined to string for parameter '${key}'`);
  }

  /**
   * Map number values with validation
   */
  private mapNumberValue(
    value: unknown,
    key: string,
    expectedType: 'number' | 'integer',
    warnings: string[]
  ): number {
    if (typeof value === 'number') {
      if (expectedType === 'integer' && !Number.isInteger(value)) {
        warnings.push(`Converting float to integer for parameter '${key}'`);
        return Math.round(value);
      }
      return value;
    }
    
    // Try to convert to number
    if (typeof value === 'string') {
      const parsed = expectedType === 'integer' ? parseInt(value, 10) : parseFloat(value);
      if (!isNaN(parsed)) {
        warnings.push(`Converting string to ${expectedType} for parameter '${key}'`);
        return parsed;
      }
    }
    
    throw new Error(`Cannot convert value to ${expectedType} for parameter '${key}'`);
  }

  /**
   * Map boolean values with validation
   */
  private mapBooleanValue(value: unknown, key: string, warnings: string[]): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    
    // Try to convert common boolean representations
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        warnings.push(`Converting string '${value}' to boolean true for parameter '${key}'`);
        return true;
      }
      if (lower === 'false' || lower === '0' || lower === 'no') {
        warnings.push(`Converting string '${value}' to boolean false for parameter '${key}'`);
        return false;
      }
    }
    
    if (typeof value === 'number') {
      warnings.push(`Converting number ${value} to boolean for parameter '${key}'`);
      return Boolean(value);
    }
    
    throw new Error(`Cannot convert value to boolean for parameter '${key}'`);
  }

  /**
   * Map array values with validation
   */
  private mapArrayValue(
    value: unknown,
    key: string,
    _schema: Record<string, unknown>,
    warnings: string[]
  ): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    
    // Try to convert single value to array
    if (value !== null && value !== undefined) {
      warnings.push(`Converting single value to array for parameter '${key}'`);
      return [value];
    }
    
    throw new Error(`Cannot convert null/undefined to array for parameter '${key}'`);
  }

  /**
   * Map object values with validation
   */
  private mapObjectValue(
    value: unknown,
    key: string,
    _schema: Record<string, unknown>,
    _warnings: string[]
  ): Record<string, unknown> {
    if (value !== null && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    
    throw new Error(`Expected object for parameter '${key}' but got ${typeof value}`);
  }

  /**
   * Convert JSON Schema to Zod schema
   */
  private jsonSchemaToZod(
    schema: JSONSchema,
    context: 'input' | 'output',
    warnings: string[],
    errors: string[]
  ): z.ZodSchema {
    try {
      // Handle different schema types
      if (schema.type === 'object') {
        return this.createObjectSchema(schema, context, warnings, errors);
      }
      
      if (schema.type === 'array') {
        return this.createArraySchema(schema, context, warnings, errors);
      }
      
      return this.createPrimitiveSchema(schema, context, warnings);
    } catch (error) {
      errors.push(`Failed to convert ${context} schema: ${(error as Error).message}`);
      return z.record(z.unknown());
    }
  }

  /**
   * Create Zod object schema from JSON Schema
   */
  private createObjectSchema(
    schema: JSONSchema,
    context: string,
    warnings: string[],
    errors: string[]
  ): z.ZodObject<Record<string, z.ZodSchema>> {
    const shape: Record<string, z.ZodSchema> = {};
    
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        try {
          if (typeof propSchema === 'object' && propSchema !== null) {
            shape[key] = this.jsonSchemaToZod(propSchema, context as 'input' | 'output', warnings, errors);
            
            // Make optional if not required
            const required = Array.isArray(schema.required) ? schema.required : [];
            if (!required.includes(key)) {
              shape[key] = shape[key].optional();
            }
          }
        } catch (error) {
          warnings.push(`Failed to process property '${key}' in ${context} schema: ${(error as Error).message}`);
          shape[key] = z.unknown().optional();
        }
      }
    }
    
    return z.object(shape);
  }

  /**
   * Create Zod array schema from JSON Schema
   */
  private createArraySchema(
    schema: JSONSchema,
    context: string,
    warnings: string[],
    errors: string[]
  ): z.ZodArray<z.ZodSchema> {
    if (schema.items && typeof schema.items === 'object') {
      const itemSchema = this.jsonSchemaToZod(schema.items, context as 'input' | 'output', warnings, errors);
      return z.array(itemSchema);
    }
    
    warnings.push(`Array schema in ${context} has no items definition, using unknown[]`);
    return z.array(z.unknown());
  }

  /**
   * Create Zod primitive schema from JSON Schema
   */
  private createPrimitiveSchema(
    schema: JSONSchema,
    context: string,
    warnings: string[]
  ): z.ZodSchema {
    switch (schema.type) {
      case 'string': {
        let stringSchema = z.string();
        if (Array.isArray(schema.enum)) {
          return z.enum(schema.enum as [string, ...string[]]);
        }
        if (typeof schema.pattern === 'string') {
          stringSchema = stringSchema.regex(new RegExp(schema.pattern));
        }
        return stringSchema;
      }
        
      case 'number':
        return z.number();
        
      case 'integer':
        return z.number().int();
        
      case 'boolean':
        return z.boolean();
        
      default:
        warnings.push(`Unknown primitive type '${schema.type}' in ${context} schema, using unknown`);
        return z.unknown();
    }
  }

  /**
   * Get required parameters from JSON Schema
   */
  private getRequiredParameters(schema: JSONSchema): readonly string[] {
    if (Array.isArray(schema.required)) {
      return schema.required as readonly string[];
    }
    return [];
  }
}