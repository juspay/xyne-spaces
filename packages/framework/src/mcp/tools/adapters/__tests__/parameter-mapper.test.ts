/**
 * Tests for ParameterMapper - handles parameter mapping between MCP and framework formats
 */

import { z } from 'zod';
import { ParameterMapper } from '../parameter-mapper.js';
import type { JSONSchema } from '../../../core/types/framework.js';

describe('ParameterMapper', () => {
  let mapper: ParameterMapper;

  beforeEach(() => {
    mapper = new ParameterMapper();
  });

  describe('mapParameters', () => {
    it('should map parameters successfully with valid schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          active: { type: 'boolean' }
        },
        required: ['name']
      };

      const parameters = {
        name: 'John',
        age: 30,
        active: true
      };

      const result = mapper.mapParameters(parameters, schema);

      expect(result.success).toBe(true);
      expect(result.mappedParameters).toEqual(parameters);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass through parameters when no schema provided', () => {
      const parameters = { test: 'value' };
      const result = mapper.mapParameters(parameters);

      expect(result.success).toBe(true);
      expect(result.mappedParameters).toEqual(parameters);
      expect(result.warnings).toContain('No schema provided, parameters passed through without validation');
    });

    it('should report missing required parameters', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' }
        },
        required: ['name', 'email']
      };

      const parameters = { name: 'John' };
      const result = mapper.mapParameters(parameters, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Required parameter 'email' is missing");
    });

    describe('string mapping', () => {
      it('should convert non-string values to strings', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            value: { type: 'string' }
          }
        };

        const parameters = { value: 123 };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.mappedParameters['value']).toBe('123');
        expect(result.warnings).toContain("Converting non-string value to string for parameter 'value'");
      });

      it('should convert objects to JSON strings', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            data: { type: 'string' }
          }
        };

        const parameters = { data: { nested: 'value' } };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.mappedParameters['data']).toBe('{"nested":"value"}');
      });

      it('should validate enum values', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['active', 'inactive'] }
          }
        };

        const parameters = { status: 'pending' };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.warnings).toContain("Value 'pending' for parameter 'status' is not in allowed enum values");
      });

      it('should validate pattern matching', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            email: { type: 'string', pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$' }
          }
        };

        const parameters = { email: 'invalid-email' };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.warnings).toContain("Value 'invalid-email' for parameter 'email' does not match required pattern");
      });
    });

    describe('number mapping', () => {
      it('should convert string numbers to numbers', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'number' }
          }
        };

        const parameters = { count: '42' };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.mappedParameters['count']).toBe(42);
        expect(result.warnings).toContain("Converting string to number for parameter 'count'");
      });

      it('should convert float to integer when required', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            items: { type: 'integer' }
          }
        };

        const parameters = { items: 42.7 };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.mappedParameters['items']).toBe(43);
        expect(result.warnings).toContain("Converting float to integer for parameter 'items'");
      });

      it('should fail for invalid number conversion', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            value: { type: 'number' }
          }
        };

        const parameters = { value: 'not-a-number' };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(false);
        expect(result.errors).toContain("Failed to map parameter 'value': Cannot convert value to number for parameter 'value'");
      });
    });

    describe('boolean mapping', () => {
      it('should convert string booleans', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            active: { type: 'boolean' }
          }
        };

        const testCases = [
          { input: 'true', expected: true },
          { input: 'false', expected: false },
          { input: '1', expected: true },
          { input: '0', expected: false },
          { input: 'yes', expected: true },
          { input: 'no', expected: false }
        ];

        testCases.forEach(({ input, expected }) => {
          const result = mapper.mapParameters({ active: input }, schema);
          expect(result.success).toBe(true);
          expect(result.mappedParameters['active']).toBe(expected);
        });
      });

      it('should convert numbers to booleans', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' }
          }
        };

        const parameters = { enabled: 1 };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.mappedParameters['enabled']).toBe(true);
        expect(result.warnings).toContain("Converting number 1 to boolean for parameter 'enabled'");
      });
    });

    describe('array mapping', () => {
      it('should convert single values to arrays', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            tags: { type: 'array' }
          }
        };

        const parameters = { tags: 'single-value' };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.mappedParameters['tags']).toEqual(['single-value']);
        expect(result.warnings).toContain("Converting single value to array for parameter 'tags'");
      });

      it('should preserve existing arrays', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            items: { type: 'array' }
          }
        };

        const parameters = { items: [1, 2, 3] };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.mappedParameters['items']).toEqual([1, 2, 3]);
      });
    });

    describe('object mapping', () => {
      it('should preserve object values', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            config: { type: 'object' }
          }
        };

        const parameters = { config: { nested: 'value' } };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(true);
        expect(result.mappedParameters['config']).toEqual({ nested: 'value' });
      });

      it('should fail for non-object values', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            data: { type: 'object' }
          }
        };

        const parameters = { data: 'not-an-object' };
        const result = mapper.mapParameters(parameters, schema);

        expect(result.success).toBe(false);
        expect(result.errors).toContain("Failed to map parameter 'data': Expected object for parameter 'data' but got string");
      });
    });
  });

  describe('adaptSchema', () => {
    it('should convert object schema to Zod', () => {
      const inputSchema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          active: { type: 'boolean' }
        },
        required: ['name']
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(result.outputSchema).toBeInstanceOf(z.ZodUnknown);
    });

    it('should handle array schemas', () => {
      const inputSchema: JSONSchema = {
        type: 'array',
        items: { type: 'string' }
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodArray);
    });

    it('should handle primitive string schemas', () => {
      const inputSchema: JSONSchema = {
        type: 'string',
        enum: ['option1', 'option2']
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodEnum);
    });

    it('should handle primitive number schemas', () => {
      const inputSchema: JSONSchema = {
        type: 'number'
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodNumber);
    });

    it('should handle primitive integer schemas', () => {
      const inputSchema: JSONSchema = {
        type: 'integer'
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodNumber);
    });

    it('should handle primitive boolean schemas', () => {
      const inputSchema: JSONSchema = {
        type: 'boolean'
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodBoolean);
    });

    it('should handle string patterns', () => {
      const inputSchema: JSONSchema = {
        type: 'string',
        pattern: '^test-.*'
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodString);
    });

    it('should handle optional properties', () => {
      const inputSchema: JSONSchema = {
        type: 'object',
        properties: {
          required: { type: 'string' },
          optional: { type: 'string' }
        },
        required: ['required']
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodObject);
    });

    it('should handle nested objects', () => {
      const inputSchema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' }
            },
            required: ['name']
          }
        }
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodObject);
    });

    it('should handle arrays without item definitions', () => {
      const inputSchema: JSONSchema = {
        type: 'array'
      };

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodArray);
      expect(result.warnings).toContain('Array schema in input has no items definition, using unknown[]');
    });

    it('should handle unknown primitive types', () => {
      const inputSchema = {
        type: 'unknown-type'
      } as JSONSchema;

      const result = mapper.adaptSchema(inputSchema);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodUnknown);
      expect(result.warnings).toContain("Unknown primitive type 'unknown-type' in input schema, using unknown");
    });

    it('should use default schemas when no schemas provided', () => {
      const result = mapper.adaptSchema();

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodRecord);
      expect(result.outputSchema).toBeInstanceOf(z.ZodUnknown);
    });

    it('should handle schema conversion errors gracefully', () => {
      const schemaWithUnsupportedType: JSONSchema = {
        type: 'object',
        properties: {
          // This unsupported type should generate warnings
          unsupportedField: { type: 'null' }, // null type might not be fully supported
          unknownTypeField: { type: 'custom-type' } // Unknown type should cause warnings
        }
      };

      const result = mapper.adaptSchema(schemaWithUnsupportedType);

      expect(result.success).toBe(true);
      expect(result.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle null/undefined parameter conversion gracefully', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: { type: 'string' }
        }
      };

      const parameters = { value: null };
      const result = mapper.mapParameters(parameters, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Failed to map parameter 'value': Cannot convert null/undefined to string for parameter 'value'");
    });

    it('should handle schema without properties', () => {
      const schema: JSONSchema = {
        type: 'object'
      };

      const parameters = { test: 'value' };
      const result = mapper.mapParameters(parameters, schema);

      expect(result.success).toBe(true);
      expect(result.mappedParameters).toEqual(parameters);
    });

    it('should handle parameters not in schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      };

      const parameters = { 
        name: 'John',
        extra: 'value'
      };
      const result = mapper.mapParameters(parameters, schema);

      expect(result.success).toBe(true);
      expect(result.mappedParameters).toEqual(parameters);
      expect(result.warnings).toContain("No schema definition found for parameter 'extra', passing through as-is");
    });
  });
});
