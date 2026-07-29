// Import z type for schemas but don't use directly since it's in type definitions
import type { 
  ToolRegistryEntry, 
  ToolMetadata, 
  ToolSchemas,
  ToolInstance 
} from './types/tool.js';
import { validateToolName } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';
import { TOOL_REGISTRY_SYMBOL } from '../../utils/constants.js';
import { 
  createToolRegistrationError,
  createToolNotFoundError,
  ToolRegistrationErrorClass,
  ToolNotFoundErrorClass
} from './errors.js';

/**
 * Singleton registry for managing tool registration and discovery
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private readonly tools = new Map<string, ToolRegistryEntry>();

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance of ToolRegistry
   */
  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a tool in the registry
   */
  public registerTool<TInput = unknown, TOutput = unknown>(
    metadata: ToolMetadata,
    schemas: ToolSchemas<TInput, TOutput>,
    toolClass: new () => ToolInstance<TInput, TOutput>
  ): void {
    // Validate tool name
    if (!validateToolName(metadata.name)) {
      throw new ToolRegistrationErrorClass(createToolRegistrationError(
        metadata.name,
        'Invalid tool name format. Must be alphanumeric with optional dashes/underscores, 2-50 characters'
      ));
    }

    // Check for duplicate registration
    if (this.tools.has(metadata.name)) {
      throw new ToolRegistrationErrorClass(createToolRegistrationError(
        metadata.name,
        `Tool '${metadata.name}' is already registered`
      ));
    }

    // Validate schemas
    try {
      // Test schema compilation
      schemas.input.parse({});
    } catch {
      // Schema validation will happen at runtime, this just checks if schema is valid
    }

    try {
      schemas.output.parse({});
    } catch {
      // Schema validation will happen at runtime
    }

    const entry: ToolRegistryEntry<TInput, TOutput> = {
      metadata,
      schemas,
      toolClass,
      registeredAt: new Date()
    };

    this.tools.set(metadata.name, entry);

    logger.debug('Tool registered successfully', {
      toolName: metadata.name,
      category: metadata.category,
      version: metadata.version
    });
  }

  /**
   * Get a tool entry by name
   */
  public getTool(name: string): ToolRegistryEntry {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundErrorClass(createToolNotFoundError(name));
    }
    return tool;
  }

  /**
   * Check if a tool is registered
   */
  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names
   */
  public getToolNames(): readonly string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all registered tools metadata
   */
  public getAllTools(): readonly ToolRegistryEntry[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  public getToolsByCategory(category: string): readonly ToolRegistryEntry[] {
    return Array.from(this.tools.values()).filter(
      tool => tool.metadata.category === category
    );
  }

  /**
   * Get tools by tag
   */
  public getToolsByTag(tag: string): readonly ToolRegistryEntry[] {
    return Array.from(this.tools.values()).filter(
      tool => tool.metadata.tags?.includes(tag)
    );
  }

  /**
   * Create an instance of a tool by name
   */
  public createToolInstance<TInput = unknown, TOutput = unknown>(
    name: string
  ): ToolInstance<TInput, TOutput> {
    const entry = this.getTool(name);
    return new entry.toolClass() as ToolInstance<TInput, TOutput>;
  }

  /**
   * Unregister a tool (useful for testing)
   */
  public unregisterTool(name: string): boolean {
    const existed = this.tools.has(name);
    if (existed) {
      this.tools.delete(name);
      logger.info('Tool unregistered', { toolName: name });
    }
    return existed;
  }

  /**
   * Clear all registered tools (useful for testing)
   */
  public clear(): void {
    const toolCount = this.tools.size;
    this.tools.clear();
    logger.info('All tools cleared from registry', { toolCount });
  }

  /**
   * Get registry statistics
   */
  public getStats(): {
    readonly totalTools: number;
    readonly categories: readonly string[];
    readonly tags: readonly string[];
  } {
    const categories = new Set<string>();
    const tags = new Set<string>();

    for (const tool of this.tools.values()) {
      if (tool.metadata.category) {
        categories.add(tool.metadata.category);
      }
      if (tool.metadata.tags) {
        for (const tag of tool.metadata.tags) {
          tags.add(tag);
        }
      }
    }

    return {
      totalTools: this.tools.size,
      categories: Array.from(categories),
      tags: Array.from(tags)
    };
  }
}

/**
 * Global registry instance
 */
export const toolRegistry = ToolRegistry.getInstance();

/**
 * Decorator helper to access registry symbol
 */
export const TOOL_REGISTRY = TOOL_REGISTRY_SYMBOL;