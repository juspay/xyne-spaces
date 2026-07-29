import { z } from 'zod';
import type { ToolValidationContext } from '../tools/core/types/tool.js';

/**
 * Validation utilities for tool framework
 */

export interface ValidationResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly string[];
}

/**
 * Validates data against a Zod schema
 */
export function validateWithSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: ToolValidationContext
): ValidationResult<T> {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return {
      success: true,
      data: result.data
    };
  }
  
  const errors = result.error.errors.map(err => 
    `${context.toolName} ${context.phase} validation: ${err.path.join('.')} - ${err.message}`
  );
  
  return {
    success: false,
    errors
  };
}

/**
 * Validates tool name format
 */
export function validateToolName(name: string): boolean {
  // Tool names must be alphanumeric with optional dashes/underscores
  const toolNameRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  return toolNameRegex.test(name) && name.length >= 2 && name.length <= 50;
}

/**
 * Validates if value is a safe string (no control characters)
 */
export function isSafeString(value: string): boolean {
  // Check for control characters except common ones like \n, \r, \t
  // eslint-disable-next-line no-control-regex
  const unsafeChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
  return !unsafeChars.test(value);
}

/**
 * Sanitizes file path to prevent directory traversal
 */
export function sanitizeFilePath(filePath: string): string {
  // Remove any directory traversal attempts and normalize slashes
  return filePath.replace(/\.\./g, '').replace(/\/+/g, '/');
}

/**
 * Validates if a value is within size limits
 */
export function validateSize(value: unknown, maxSizeBytes: number): boolean {
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
  const sizeBytes = new TextEncoder().encode(stringValue).length;
  return sizeBytes <= maxSizeBytes;
}