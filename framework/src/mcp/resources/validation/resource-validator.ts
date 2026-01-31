/**
 * Resource validation for MCP resources
 */

import type { MCPResource, MCPResourceResult } from '../../core/types/framework.js';
import type { ResourceMetadata, CatalogEntry } from '../types/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Validation rule for resources
 */
export interface ValidationRule {
  readonly name: string;
  readonly description: string;
  readonly validate: (resource: MCPResource, content?: MCPResourceResult) => ValidationResult;
}

/**
 * Result of validation
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly message?: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly details?: Record<string, unknown>;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  readonly rules?: readonly ValidationRule[];
  readonly skipContentValidation?: boolean;
  readonly strictMode?: boolean;
  readonly maxSize?: number;
  readonly allowedMimeTypes?: readonly string[];
}

/**
 * Comprehensive validation result
 */
export interface ResourceValidationResult {
  readonly uri: string;
  readonly valid: boolean;
  readonly errors: readonly ValidationResult[];
  readonly warnings: readonly ValidationResult[];
  readonly validatedAt: Date;
  readonly rulePassed: number;
  readonly rulesFailed: number;
}

/**
 * Validates MCP resources for schema compliance and content integrity
 */
export class ResourceValidator {
  private readonly builtInRules: readonly ValidationRule[];

  constructor() {
    this.builtInRules = [
      this.createUriValidationRule(),
      this.createMimeTypeValidationRule(),
      this.createSizeValidationRule(),
      this.createContentIntegrityRule(),
      this.createSecurityRule()
    ];
  }

  /**
   * Validate a resource with its metadata
   */
  public validateResource(
    catalogEntry: CatalogEntry,
    content?: MCPResourceResult,
    options: ValidationOptions = {}
  ): ResourceValidationResult {
    const { resource } = catalogEntry;
    const uri = resource.uri;
    
    logger.debug(`Validating resource: ${uri}`);

    const rules = [...this.builtInRules, ...(options.rules || [])];
    const errors: ValidationResult[] = [];
    const warnings: ValidationResult[] = [];

    // Run all validation rules
    for (const rule of rules) {
      try {
        const result = rule.validate(resource, content);
        
        if (!result.valid) {
          if (result.severity === 'high') {
            errors.push(result);
          } else {
            warnings.push(result);
          }
        }
      } catch (error) {
        logger.warn(`Validation rule '${rule.name}' failed`, { error: (error as Error).message });
        warnings.push({
          valid: false,
          message: `Validation rule '${rule.name}' encountered an error: ${(error as Error).message}`,
          severity: 'medium'
        });
      }
    }

    const validationResult: ResourceValidationResult = {
      uri,
      valid: errors.length === 0 && (!options.strictMode || warnings.length === 0),
      errors,
      warnings,
      validatedAt: new Date(),
      rulePassed: rules.length - errors.length - warnings.length,
      rulesFailed: errors.length + warnings.length
    };

    logger.debug(`Validation complete for ${uri}: ${validationResult.valid ? 'PASS' : 'FAIL'} ` +
      `(${validationResult.rulePassed} passed, ${validationResult.rulesFailed} failed)`);

    return validationResult;
  }

  /**
   * Validate multiple resources in batch
   */
  public validateBatch(
    catalogEntries: readonly CatalogEntry[],
    options: ValidationOptions = {}
  ): Map<string, ResourceValidationResult> {
    const results = new Map<string, ResourceValidationResult>();
    
    // Process all entries since validation is now synchronous
    for (const entry of catalogEntries) {
      try {
        const result = this.validateResource(entry, undefined, options);
        results.set(entry.resource.uri, result);
      } catch (error) {
        logger.error(`Failed to validate resource ${entry.resource.uri}: ${(error as Error).message}`);
        results.set(entry.resource.uri, {
          uri: entry.resource.uri,
          valid: false,
          errors: [{
            valid: false,
            message: `Validation failed: ${(error as Error).message}`,
            severity: 'high'
          }],
          warnings: [],
          validatedAt: new Date(),
          rulePassed: 0,
          rulesFailed: 1
        });
      }
    }
    
    return results;
  }

  /**
   * Validate resource metadata
   */
  public validateMetadata(metadata: ResourceMetadata): ValidationResult[] {
    const issues: ValidationResult[] = [];

    // Check required fields
    if (!metadata.uri) {
      issues.push({
        valid: false,
        message: 'URI is required',
        severity: 'high'
      });
    }

    if (!metadata.serverName) {
      issues.push({
        valid: false,
        message: 'Server name is required',
        severity: 'high'
      });
    }

    // Check URI format
    if (metadata.uri && !this.isValidUri(metadata.uri)) {
      issues.push({
        valid: false,
        message: 'Invalid URI format',
        severity: 'medium'
      });
    }

    // Check MIME type format
    if (metadata.mimeType && !this.isValidMimeType(metadata.mimeType)) {
      issues.push({
        valid: false,
        message: 'Invalid MIME type format',
        severity: 'low'
      });
    }

    return issues;
  }

  /**
   * Create URI validation rule
   */
  private createUriValidationRule(): ValidationRule {
    return {
      name: 'uri_validation',
      description: 'Validates URI format and scheme',
      validate: (resource: MCPResource): ValidationResult => {
        if (!resource.uri) {
          return {
            valid: false,
            message: 'Resource URI is required',
            severity: 'high'
          };
        }

        if (!this.isValidUri(resource.uri)) {
          return {
            valid: false,
            message: 'Invalid URI format',
            severity: 'medium'
          };
        }

        return { valid: true, severity: 'low' };
      }
    };
  }

  /**
   * Create MIME type validation rule
   */
  private createMimeTypeValidationRule(): ValidationRule {
    return {
      name: 'mime_type_validation',
      description: 'Validates MIME type format',
      validate: (resource: MCPResource): ValidationResult => {
        if (resource.mimeType && !this.isValidMimeType(resource.mimeType)) {
          return {
            valid: false,
            message: `Invalid MIME type: ${resource.mimeType}`,
            severity: 'low'
          };
        }

        return { valid: true, severity: 'low' };
      }
    };
  }

  /**
   * Create size validation rule
   */
  private createSizeValidationRule(): ValidationRule {
    return {
      name: 'size_validation',
      description: 'Validates resource size limits',
      validate: (_resource: MCPResource, content?: MCPResourceResult): ValidationResult => {
        if (!content) {
          return { valid: true, severity: 'low' };
        }

        let size = 0;
        
        if (typeof content.contents === 'string') {
          size = new TextEncoder().encode(content.contents).length;
        } else if (Array.isArray(content.contents)) {
          for (const contentItem of content.contents) {
            if ('text' in contentItem && typeof contentItem.text === 'string') {
              size += new TextEncoder().encode(contentItem.text).length;
            }
          }
        }

        // Default size limit: 50MB
        const maxSize = 50 * 1024 * 1024;
        
        if (size > maxSize) {
          return {
            valid: false,
            message: `Resource size (${Math.round(size / 1024 / 1024)}MB) exceeds limit (${Math.round(maxSize / 1024 / 1024)}MB)`,
            severity: 'medium',
            details: { size, maxSize }
          };
        }

        return { valid: true, severity: 'low' };
      }
    };
  }

  /**
   * Create content integrity rule
   */
  private createContentIntegrityRule(): ValidationRule {
    return {
      name: 'content_integrity',
      description: 'Validates content structure and integrity',
      validate: (resource: MCPResource, content?: MCPResourceResult): ValidationResult => {
        if (!content) {
          return { valid: true, severity: 'low' };
        }

        // Check content structure
        if (!content.contents) {
          return {
            valid: false,
            message: 'Content is missing',
            severity: 'high'
          };
        }

        // Validate content based on MIME type
        if (resource.mimeType) {
          if (resource.mimeType.startsWith('application/json')) {
            let jsonContent = '';
            
            if (typeof content.contents === 'string') {
              jsonContent = content.contents;
            } else if (Array.isArray(content.contents)) {
              for (const contentItem of content.contents) {
                if ('text' in contentItem && typeof contentItem.text === 'string') {
                  jsonContent += contentItem.text;
                }
              }
            }
            
            if (jsonContent) {
              try {
                JSON.parse(jsonContent);
              } catch {
                return {
                  valid: false,
                  message: 'Invalid JSON content',
                  severity: 'medium'
                };
              }
            }
          }
        }

        return { valid: true, severity: 'low' };
      }
    };
  }

  /**
   * Create security validation rule
   */
  private createSecurityRule(): ValidationRule {
    return {
      name: 'security_validation',
      description: 'Validates resource for security concerns',
      validate: (resource: MCPResource, content?: MCPResourceResult): ValidationResult => {
        // Check for potentially dangerous URI schemes
        const dangerousSchemes = ['javascript:', 'data:', 'vbscript:'];
        const uriLower = resource.uri.toLowerCase();
        
        for (const scheme of dangerousSchemes) {
          if (uriLower.startsWith(scheme)) {
            return {
              valid: false,
              message: `Potentially dangerous URI scheme: ${scheme}`,
              severity: 'high'
            };
          }
        }

        // Check content for suspicious patterns if available
        if (content) {
          let textContent = '';
          
          if (typeof content.contents === 'string') {
            textContent = content.contents;
          } else if (Array.isArray(content.contents)) {
            for (const contentItem of content.contents) {
              if ('text' in contentItem && typeof contentItem.text === 'string') {
                textContent += contentItem.text;
              }
            }
          }
          
          if (textContent) {
            const suspiciousPatterns = [
              /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
              /javascript:/gi,
              /eval\s*\(/gi
            ];
            
            for (const pattern of suspiciousPatterns) {
              if (pattern.test(textContent)) {
                return {
                  valid: false,
                  message: 'Content contains potentially dangerous script elements',
                  severity: 'high'
                };
              }
            }
          }
        }

        return { valid: true, severity: 'low' };
      }
    };
  }

  /**
   * Validate URI format
   */
  private isValidUri(uri: string): boolean {
    try {
      new URL(uri);
      return true;
    } catch {
      // Also allow relative URIs and custom schemes
      return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri) || /^\//.test(uri) || /^[a-zA-Z0-9._-]+/.test(uri);
    }
  }

  /**
   * Validate MIME type format
   */
  private isValidMimeType(mimeType: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9!#$&\-^_]*\/[a-zA-Z0-9!#$&\-^_.]+$/.test(mimeType);
  }

}