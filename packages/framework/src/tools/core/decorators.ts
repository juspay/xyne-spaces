import 'reflect-metadata';
import type { ToolConfig, ToolInstance } from './types/tool.js';
import { TOOL_METADATA_SYMBOL } from '../../utils/constants.js';
import { validateToolName } from '../../utils/validation.js';
import { toolRegistry } from './tool-registry.js';
import { logger } from '../../utils/logger.js';
import { 
  createToolRegistrationError,
  ToolRegistrationErrorClass
} from './errors.js';

/**
 * Tool decorator for automatic registration
 */
export function Tool<TInput = unknown, TOutput = unknown, TLLMOutput = unknown>(
  config: ToolConfig<TInput, TOutput, TLLMOutput>
) {
  return function<T extends new () => ToolInstance<TInput, TOutput, TLLMOutput>>(
    constructor: T
  ): T {
    // Validate configuration
    if (!validateToolName(config.name)) {
      throw new ToolRegistrationErrorClass(createToolRegistrationError(
        config.name,
        'Invalid tool name format. Must be alphanumeric with optional dashes/underscores, 2-50 characters'
      ));
    }

    if (!config.description || config.description.trim().length === 0) {
      throw new ToolRegistrationErrorClass(createToolRegistrationError(
        config.name,
        'Tool description is required'
      ));
    }

    // Store metadata in the constructor
    Reflect.defineMetadata(TOOL_METADATA_SYMBOL, config, constructor);

    // Register the tool automatically
    try {
      toolRegistry.registerTool(
        {
          name: config.name,
          description: config.description,
          ...(config.version && { version: config.version }),
          ...(config.tags && { tags: config.tags }),
          ...(config.category && { category: config.category })
        },
        {
          input: config.inputSchema,
          output: config.outputSchema
        },
        constructor
      );

      logger.debug('Tool auto-registered via decorator', {
        toolName: config.name,
        category: config.category
      });

    } catch (error) {
      logger.error('Tool auto-registration failed', error as Error, {
        toolName: config.name
      });
      throw error;
    }

    return constructor;
  };
}

/**
 * Get tool metadata from a decorated class
 */
export function getToolMetadata<TInput = unknown, TOutput = unknown, TLLMOutput = unknown>(
  constructor: new () => ToolInstance<TInput, TOutput, TLLMOutput>
): ToolConfig<TInput, TOutput, TLLMOutput> | undefined {
  return Reflect.getMetadata(TOOL_METADATA_SYMBOL, constructor) as ToolConfig<TInput, TOutput, TLLMOutput> | undefined;
}

/**
 * Check if a class is decorated with @Tool
 */
export function isToolDecorated(constructor: new () => ToolInstance<unknown, unknown, unknown>): boolean {
  return Reflect.hasMetadata(TOOL_METADATA_SYMBOL, constructor);
}

/**
 * Tool category decorator (optional convenience decorator)
 */
export function ToolCategory(category: string) {
  return function<T extends new () => ToolInstance<unknown, unknown, unknown>>(constructor: T): T {
    const existingMetadata = getToolMetadata(constructor);
    if (existingMetadata) {
      // Update existing metadata
      const updatedMetadata = { ...existingMetadata, category };
      Reflect.defineMetadata(TOOL_METADATA_SYMBOL, updatedMetadata, constructor);
    }
    return constructor;
  };
}

/**
 * Tool tags decorator (optional convenience decorator)
 */
export function ToolTags(...tags: string[]) {
  return function<T extends new () => ToolInstance<unknown, unknown, unknown>>(constructor: T): T {
    const existingMetadata = getToolMetadata(constructor);
    if (existingMetadata) {
      // Update existing metadata
      const updatedMetadata = { ...existingMetadata, tags };
      Reflect.defineMetadata(TOOL_METADATA_SYMBOL, updatedMetadata, constructor);
    }
    return constructor;
  };
}

/**
 * Scan and register all tools in a module or object
 */
export function registerToolsFromModule(moduleExports: Record<string, unknown>): void {
  let registeredCount = 0;
  
  for (const [exportName, exportValue] of Object.entries(moduleExports)) {
    // Check if it's a class constructor
    if (typeof exportValue === 'function' && 
        exportValue.prototype && 
        isToolDecorated(exportValue as new () => ToolInstance)) {
      
      try {
        // The tool should already be registered by the decorator,
        // but we can log the discovery
        logger.debug('Discovered decorated tool in module', {
          exportName,
          toolName: getToolMetadata(exportValue as new () => ToolInstance)?.name
        });
        registeredCount++;
      } catch (error) {
        logger.warn('Failed to process tool from module', {
          exportName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  logger.info('Tool module scan completed', {
    totalExports: Object.keys(moduleExports).length,
    toolsFound: registeredCount
  });
}