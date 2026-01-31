import { createMCPConfigError } from '../core/errors/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Pattern to match environment variable placeholders
 */
const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Options for environment variable resolution
 */
export interface EnvironmentResolverOptions {
  readonly throwOnMissing?: boolean;
  readonly defaultValues?: Record<string, string>;
  readonly allowEmpty?: boolean;
}

/**
 * Result of environment variable resolution
 */
export interface EnvironmentResolutionResult {
  readonly success: boolean;
  readonly resolvedConfig?: unknown;
  readonly missingVariables?: readonly string[];
  readonly errors?: readonly string[];
}

/**
 * Environment variable resolver for MCP configuration
 */
export class EnvironmentResolver {
  private readonly options: EnvironmentResolverOptions;

  constructor(options: EnvironmentResolverOptions = {}) {
    this.options = {
      throwOnMissing: true,
      allowEmpty: false,
      ...options
    };
  }

  /**
   * Resolve environment variables in configuration object
   */
  public resolveEnvironmentVariables(config: unknown): EnvironmentResolutionResult {
    try {
      const configString = JSON.stringify(config);
      const { resolvedString, missingVariables } = this.resolveStringVariables(configString);
      
      if (missingVariables.length > 0 && this.options.throwOnMissing) {
        const errors = missingVariables.map(varName => 
          `Environment variable '${varName}' is not set`
        );
        
        return {
          success: false,
          missingVariables,
          errors
        };
      }
      
      const resolvedConfig: unknown = JSON.parse(resolvedString);
      
      logger.debug('Environment variables resolved successfully', {
        missingVariables: missingVariables.length > 0 ? missingVariables : undefined
      });
      
      const result: EnvironmentResolutionResult = {
        success: true,
        resolvedConfig,
        ...(missingVariables.length > 0 && { missingVariables })
      };
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to resolve environment variables', error as Error);
      
      return {
        success: false,
        errors: [`Environment resolution failed: ${errorMessage}`]
      };
    }
  }

  /**
   * Resolve environment variables in a string
   */
  private resolveStringVariables(str: string): {
    resolvedString: string;
    missingVariables: string[];
  } {
    const missingVariables: string[] = [];
    
    // First pass: find and replace complete quoted values
    let resolvedString = this.replaceQuotedEnvironmentVariables(str, missingVariables);
    
    // Second pass: replace any remaining environment variables (partial string replacements)
    resolvedString = resolvedString.replace(ENV_VAR_PATTERN, (match, varName: string, offset: number, fullString: string) => {
      // Don't trim the entire varName as it might contain default values with whitespace
      // Check for default value syntax: ${VAR_NAME:-default}
      const [actualVarName, defaultValue] = this.parseVariableWithDefault(varName);
      
      // Try to get value from environment
      let value = process.env[actualVarName];
      
      // Use inline default value (highest priority after env)
      if (value === undefined && defaultValue !== undefined) {
        value = defaultValue;
      }
      
      // Try default values from options (lowest priority)
      if (value === undefined && this.options.defaultValues) {
        value = this.options.defaultValues[actualVarName];
      }
      
      // Handle missing variable
      if (value === undefined) {
        missingVariables.push(actualVarName);
        return match; // Return original placeholder
      }
      
      // Handle empty values
      if (value === '' && !this.options.allowEmpty) {
        missingVariables.push(actualVarName);
        return match; // Return original placeholder
      }
      
      // Check if this replacement is the entire value (surrounded by quotes)
      const isCompleteValue = this.isCompleteJsonValue(match, offset, fullString);
      
      if (isCompleteValue) {
        // Replace with the converted value (unquoted for proper type conversion)
        return this.convertValue(value);
      } 
      
      // This is part of a larger string, keep as string
      return value;
    });
    
    return {
      resolvedString,
      missingVariables
    };
  }

  /**
   * Parse variable name with optional default value
   * Supports syntax: VAR_NAME, VAR_NAME:default_value, or VAR_NAME:-default_value
   */
  private parseVariableWithDefault(varExpression: string): [string, string | undefined] {
    // Try :- separator first (bash-style)
    let defaultSeparator = ':-';
    let separatorIndex = varExpression.indexOf(defaultSeparator);
    
    // If not found, try : separator (simple style)
    if (separatorIndex === -1) {
      defaultSeparator = ':';
      separatorIndex = varExpression.indexOf(defaultSeparator);
    }
    
    if (separatorIndex === -1) {
      return [varExpression.trim(), undefined];
    }
    
    const varName = varExpression.substring(0, separatorIndex).trim();
    const defaultValue = varExpression.substring(separatorIndex + defaultSeparator.length);
    
    return [varName, defaultValue];
  }

  /**
   * Replace quoted environment variables with properly typed values
   */
  private replaceQuotedEnvironmentVariables(str: string, missingVariables: string[]): string {
    // Pattern to match quoted environment variables: "${...}"
    const quotedEnvPattern = /"(\$\{[^}]+\})"/g;
    
    return str.replace(quotedEnvPattern, (match, envVar: string) => {
      // Extract the variable name and default value
      const varContent = envVar.substring(2, envVar.length - 1); // Remove ${ and }
      const [actualVarName, defaultValue] = this.parseVariableWithDefault(varContent);
      
      // Try to get value from environment
      let value = process.env[actualVarName];
      
      // Use inline default value (highest priority after env)
      if (value === undefined && defaultValue !== undefined) {
        value = defaultValue;
      }
      
      // Try default values from options (lowest priority)
      if (value === undefined && this.options.defaultValues) {
        value = this.options.defaultValues[actualVarName];
      }
      
      // Handle missing variable
      if (value === undefined) {
        missingVariables.push(actualVarName);
        return match; // Return original quoted placeholder
      }
      
      // Handle empty values
      if (value === '' && !this.options.allowEmpty) {
        missingVariables.push(actualVarName);
        return match; // Return original quoted placeholder
      }
      
      // Convert and return unquoted value for proper JSON typing
      const convertedValue = this.convertValue(value);
      
      return convertedValue;
    });
  }

  /**
   * Check if the environment variable placeholder is the complete JSON value
   */
  private isCompleteJsonValue(match: string, offset: number, fullString: string): boolean {
    // Check if the placeholder is surrounded by quotes and is the entire value
    const beforeMatch = fullString.substring(0, offset);
    const afterMatch = fullString.substring(offset + match.length);
    
    // Look for the pattern: "...${VAR}..."
    const quoteBefore = beforeMatch.lastIndexOf('"');
    const quoteAfter = afterMatch.indexOf('"');
    
    if (quoteBefore === -1 || quoteAfter === -1) {
      return false;
    }
    
    // Check if there's anything between the quote and the placeholder
    const contentBefore = beforeMatch.substring(quoteBefore + 1);
    const contentAfter = afterMatch.substring(0, quoteAfter);
    
    // If there's only whitespace or nothing between quotes and placeholder, it's a complete value
    return contentBefore.trim() === '' && contentAfter.trim() === '';
  }

  /**
   * Convert string value to appropriate type while preserving JSON structure
   */
  private convertValue(value: string): string {
    // Handle boolean values (case-insensitive)
    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true' || lowerValue === 'false') {
      return lowerValue;
    }
    
    // Handle null
    if (lowerValue === 'null') {
      return 'null';
    }
    
    // For numbers: be more conservative, only convert obvious cases
    // Keep numeric strings as strings unless they're clearly meant to be numbers
    // This helps with cases like port numbers in args arrays that should stay as strings
    if (/^\d+$/.test(value) && parseInt(value) > 1000000) {
      // Only convert very large numbers to avoid issues with ports, etc.
      return value;
    }
    if (/^\d+\.\d+$/.test(value)) {
      return value; // Float
    }
    
    // For everything else, return as a properly quoted JSON string
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  /**
   * Check which environment variables are referenced in config
   */
  public static extractEnvironmentVariables(config: unknown): string[] {
    const configString = JSON.stringify(config);
    const variables: string[] = [];
    let match;
    
    while ((match = ENV_VAR_PATTERN.exec(configString)) !== null) {
      const varExpression = match[1]?.trim();
      if (!varExpression) continue;
      
      const [varName] = varExpression.includes(':-') 
        ? varExpression.split(':-') 
        : [varExpression];
      
      if (varName && !variables.includes(varName)) {
        variables.push(varName);
      }
    }
    
    return variables;
  }

  /**
   * Validate that all required environment variables are set
   */
  public static validateEnvironmentVariables(
    config: unknown,
    requiredVars?: string[]
  ): { isValid: boolean; missingVars: string[] } {
    const referencedVars = this.extractEnvironmentVariables(config);
    const varsToCheck = requiredVars || referencedVars;
    const missingVars: string[] = [];
    
    for (const varName of varsToCheck) {
      if (process.env[varName] === undefined) {
        missingVars.push(varName);
      }
    }
    
    return {
      isValid: missingVars.length === 0,
      missingVars
    };
  }

  /**
   * Create resolver with throwing disabled
   */
  public static createLenient(defaultValues?: Record<string, string>): EnvironmentResolver {
    const options: EnvironmentResolverOptions = {
      throwOnMissing: false,
      allowEmpty: true,
      ...(defaultValues !== undefined && { defaultValues })
    };
    
    return new EnvironmentResolver(options);
  }

  /**
   * Create resolver with strict validation
   */
  public static createStrict(defaultValues?: Record<string, string>): EnvironmentResolver {
    const options: EnvironmentResolverOptions = {
      throwOnMissing: true,
      allowEmpty: false,
      ...(defaultValues !== undefined && { defaultValues })
    };
    
    return new EnvironmentResolver(options);
  }

  /**
   * Resolve environment variables and throw on errors
   */
  public resolveOrThrow(config: unknown): unknown {
    const result = this.resolveEnvironmentVariables(config);
    
    if (!result.success) {
      throw createMCPConfigError(
        'Environment variable resolution failed',
        {
          validationErrors: result.errors || [],
          severity: 'high'
        }
      );
    }
    
    return result.resolvedConfig;
  }
}
