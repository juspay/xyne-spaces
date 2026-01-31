import type { 
  BotMetadata, 
  BotSchemas, 
  BotRegistryEntry, 
  BotInstance 
} from './types/bot.js';
import { 
  createBotRegistrationError, 
  BotRegistrationErrorClass 
} from './errors.js';
import {logger} from '@/utils/logger';

/**
 * Bot registry for managing bot registration and discovery
 */
export class BotRegistry {
  private readonly bots = new Map<string, BotRegistryEntry>();
  private readonly categories = new Map<string, Set<string>>();
  private readonly capabilities = new Map<string, Set<string>>();

  /**
   * Register a bot in the registry
   */
  public registerBot<TInput = unknown, TOutput = unknown>(
    metadata: BotMetadata,
    schemas: BotSchemas<TInput, TOutput>,
    botClass: new () => BotInstance<TInput, TOutput>
  ): void {
    // Validate bot name uniqueness
    if (this.bots.has(metadata.name)) {
      throw new BotRegistrationErrorClass(createBotRegistrationError(
        metadata.name,
        `Bot with name '${metadata.name}' is already registered`
      ));
    }

    // Validate metadata
    this.validateMetadata(metadata);

    // Create registry entry
    const entry: BotRegistryEntry<TInput, TOutput> = {
      metadata,
      schemas,
      botClass,
      registeredAt: new Date()
    };

    // Register the bot
    this.bots.set(metadata.name, entry);

    // Update category index
    if (metadata.category) {
      if (!this.categories.has(metadata.category)) {
        this.categories.set(metadata.category, new Set());
      }
      this.categories.get(metadata.category)!.add(metadata.name);
    }

    // Update capability index
    if (metadata.capabilities) {
      for (const capability of metadata.capabilities) {
        if (!this.capabilities.has(capability)) {
          this.capabilities.set(capability, new Set());
        }
        this.capabilities.get(capability)!.add(metadata.name);
      }
    }

    logger.debug(`[BotRegistry] Bot registered: ${metadata.name}`, {
      category: metadata.category,
      capabilities: metadata.capabilities,
      version: metadata.version
    });
  }

  /**
   * Get a bot by name
   */
  public getBot(name: string): BotRegistryEntry | undefined {
    return this.bots.get(name);
  }

  /**
   * Get all registered bots
   */
  public getAllBots(): BotRegistryEntry[] {
    return Array.from(this.bots.values());
  }

  /**
   * Get bots by category
   */
  public getBotsByCategory(category: string): BotRegistryEntry[] {
    const botNames = this.categories.get(category);
    if (!botNames) {
      return [];
    }

    return Array.from(botNames)
      .map(name => this.bots.get(name))
      .filter((bot): bot is BotRegistryEntry => bot !== undefined);
  }

  /**
   * Get bots by capability
   */
  public getBotsByCapability(capability: string): BotRegistryEntry[] {
    const botNames = this.capabilities.get(capability);
    if (!botNames) {
      return [];
    }

    return Array.from(botNames)
      .map(name => this.bots.get(name))
      .filter((bot): bot is BotRegistryEntry => bot !== undefined);
  }

  /**
   * Get bots by tags
   */
  public getBotsByTags(tags: string[]): BotRegistryEntry[] {
    return this.getAllBots().filter(bot => {
      if (!bot.metadata.tags) {
        return false;
      }
      return tags.some(tag => bot.metadata.tags!.includes(tag));
    });
  }

  /**
   * Get bots by scope
   */
  public getBotsByScope(scope: 'conversation' | 'thread'): BotRegistryEntry[] {
    return this.getAllBots().filter(bot => {
      if (!bot.metadata.scope) {
        return true; // Default to 'all' if no scope specified
      }
      return bot.metadata.scope === scope || bot.metadata.scope === 'all';
    });
  }

  /**
   * Search bots by name or description
   */
  public searchBots(query: string): BotRegistryEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllBots().filter(bot => 
      bot.metadata.name.toLowerCase().includes(lowerQuery) ||
      bot.metadata.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get all categories
   */
  public getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Get all capabilities
   */
  public getCapabilities(): string[] {
    return Array.from(this.capabilities.keys());
  }

  /**
   * Check if a bot is registered
   */
  public hasBot(name: string): boolean {
    return this.bots.has(name);
  }

  /**
   * Unregister a bot
   */
  public unregisterBot(name: string): boolean {
    const bot = this.bots.get(name);
    if (!bot) {
      return false;
    }

    // Remove from main registry
    this.bots.delete(name);

    // Remove from category index
    if (bot.metadata.category) {
      const categoryBots = this.categories.get(bot.metadata.category);
      if (categoryBots) {
        categoryBots.delete(name);
        if (categoryBots.size === 0) {
          this.categories.delete(bot.metadata.category);
        }
      }
    }

    // Remove from capability index
    if (bot.metadata.capabilities) {
      for (const capability of bot.metadata.capabilities) {
        const capabilityBots = this.capabilities.get(capability);
        if (capabilityBots) {
          capabilityBots.delete(name);
          if (capabilityBots.size === 0) {
            this.capabilities.delete(capability);
          }
        }
      }
    }

    logger.debug(`[BotRegistry] Bot unregistered: ${name}`);
    return true;
  }

  /**
   * Create a bot instance
   */
  public createBotInstance<TInput = unknown, TOutput = unknown>(
    name: string
  ): BotInstance<TInput, TOutput> | undefined {
    const entry = this.bots.get(name);
    if (!entry) {
      return undefined;
    }

    try {
      return new entry.botClass() as BotInstance<TInput, TOutput>;
    } catch (error) {
      logger.error(`[BotRegistry] Failed to create bot instance: ${name}`, error);
      return undefined;
    }
  }

  /**
   * Get registry statistics
   */
  public getStats(): {
    totalBots: number;
    categories: number;
    capabilities: number;
    botsByCategory: Record<string, number>;
    botsByCapability: Record<string, number>;
  } {
    const botsByCategory: Record<string, number> = {};
    for (const [category, bots] of this.categories.entries()) {
      botsByCategory[category] = bots.size;
    }

    const botsByCapability: Record<string, number> = {};
    for (const [capability, bots] of this.capabilities.entries()) {
      botsByCapability[capability] = bots.size;
    }

    return {
      totalBots: this.bots.size,
      categories: this.categories.size,
      capabilities: this.capabilities.size,
      botsByCategory,
      botsByCapability
    };
  }

  /**
   * Clear all registered bots
   */
  public clear(): void {
    this.bots.clear();
    this.categories.clear();
    this.capabilities.clear();
    logger.debug('[BotRegistry] Registry cleared');
  }

  /**
   * Validate bot metadata
   */
  private validateMetadata(metadata: BotMetadata): void {
    if (!metadata.name || metadata.name.trim().length === 0) {
      throw new BotRegistrationErrorClass(createBotRegistrationError(
        metadata.name || 'unknown',
        'Bot name is required and cannot be empty'
      ));
    }

    if (!metadata.description || metadata.description.trim().length === 0) {
      throw new BotRegistrationErrorClass(createBotRegistrationError(
        metadata.name,
        'Bot description is required and cannot be empty'
      ));
    }

    // Validate name format (alphanumeric, dashes, underscores)
    const nameRegex = /^[a-zA-Z0-9_-]{2,50}$/;
    if (!nameRegex.test(metadata.name)) {
      throw new BotRegistrationErrorClass(createBotRegistrationError(
        metadata.name,
        'Bot name must be 2-50 characters and contain only letters, numbers, dashes, and underscores'
      ));
    }

    // Validate version format if provided
    if (metadata.version) {
      const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
      if (!versionRegex.test(metadata.version)) {
        throw new BotRegistrationErrorClass(createBotRegistrationError(
          metadata.name,
          'Bot version must follow semantic versioning format (e.g., 1.0.0)'
        ));
      }
    }
  }
}

/**
 * Global bot registry instance
 */
export const botRegistry = new BotRegistry();