/**
 * Unified Bot Framework - Bot Catalog
 *
 * Single source of truth for all bots in the system.
 * Merges both internal (class-based) and external (config-based) bots.
 */

import type {
  BotDefinition,
  BotCatalogEntry,
  BotRuntime,
  BotScope,
  InternalBotDefinition,
  ExternalBotDefinition,
} from '../types/index.js';
import { isInternalBot, isExternalBot } from '../types/index.js';
import {logger} from '@/utils/logger';


/**
 * Bot Catalog - manages registration and discovery of all bots
 */
class BotCatalogImpl {
  private bots = new Map<string, BotCatalogEntry>();
  private byScope = new Map<BotScope, Set<string>>();
  private initialized = false;

  /**
   * Register an internal bot (class-based)
   */
  registerInternal<TInput = unknown, TOutput = unknown>(
    definition: InternalBotDefinition<TInput, TOutput>,
    botClass: new () => BotRuntime
  ): void {
    if (this.bots.has(definition.id)) {
      logger.warn(`[BotCatalog] Bot '${definition.id}' already registered, replacing...`);
    }

    const entry: BotCatalogEntry = {
      definition,
      botClass,
      registeredAt: new Date(),
    };

    this.bots.set(definition.id, entry);
    this.indexBot(definition);

    logger.info(`[BotCatalog] Registered internal bot: ${definition.id}`);
  }

  /**
   * Register an external bot (config-based)
   */
  registerExternal(definition: ExternalBotDefinition): void {
    if (this.bots.has(definition.id)) {
      logger.warn(`[BotCatalog] Bot '${definition.id}' already registered, replacing...`);
    }

    const entry: BotCatalogEntry = {
      definition,
      registeredAt: new Date(),
    };

    this.bots.set(definition.id, entry);
    this.indexBot(definition);

    logger.info(`[BotCatalog] Registered external bot: ${definition.id}`);
  }

  /**
   * Register any bot definition
   */
  register(definition: BotDefinition, botClass?: new () => BotRuntime): void {
    if (isInternalBot(definition)) {
      if (!botClass) {
        throw new Error(`Internal bot '${definition.id}' requires a bot class`);
      }
      this.registerInternal(definition, botClass);
    } else if (isExternalBot(definition)) {
      this.registerExternal(definition);
    }
  }

  /**
   * Get a bot by ID
   */
  getById(botId: string): BotCatalogEntry | undefined {
    return this.bots.get(botId);
  }

  /**
   * Get a bot definition by ID
   */
  getDefinitionById(botId: string): BotDefinition | undefined {
    return this.bots.get(botId)?.definition;
  }

  /**
   * Get all registered bots
   */
  getAll(): BotCatalogEntry[] {
    return Array.from(this.bots.values());
  }

  /**
   * Get all bot definitions
   */
  getAllDefinitions(): BotDefinition[] {
    return this.getAll().map((entry) => entry.definition);
  }

  /**
   * Get bots by scope
   */
  getByScope(scope: BotScope): BotCatalogEntry[] {
    const botIds = this.byScope.get(scope) || new Set();
    const allScopeIds = this.byScope.get('all') || new Set();

    const combinedIds = new Set([...botIds, ...allScopeIds]);
    return Array.from(combinedIds)
      .map((id) => this.bots.get(id))
      .filter((entry): entry is BotCatalogEntry => entry !== undefined);
  }

  /**
   * Search bots by name or description
   */
  search(query: string): BotCatalogEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter((entry) => {
      const def = entry.definition;
      return (
        def.name.toLowerCase().includes(lowerQuery) ||
        def.description.toLowerCase().includes(lowerQuery) ||
        def.id.toLowerCase().includes(lowerQuery)
      );
    });
  }

  /**
   * Check if a bot is registered
   */
  has(botId: string): boolean {
    return this.bots.has(botId);
  }

  /**
   * Get count of registered bots
   */
  get count(): number {
    return this.bots.size;
  }

  /**
   * Update a bot's database user ID
   */
  setDbUserId(botId: string, dbUserId: string): void {
    const entry = this.bots.get(botId);
    if (entry) {
      entry.dbUserId = dbUserId;
    }
  }

  /**
   * Get a bot's database user ID
   */
  getDbUserId(botId: string): string | undefined {
    return this.bots.get(botId)?.dbUserId;
  }

  /**
   * Mark catalog as initialized
   */
  markInitialized(): void {
    this.initialized = true;
    logger.info(`[BotCatalog] Initialized with ${this.count} bot(s)`);
  }

  /**
   * Check if catalog is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get all internal bots
   */
  getInternalBots(): BotCatalogEntry[] {
    return this.getAll().filter((entry) => isInternalBot(entry.definition));
  }

  /**
   * Get all external bots
   */
  getExternalBots(): BotCatalogEntry[] {
    return this.getAll().filter((entry) => isExternalBot(entry.definition));
  }

  /**
   * Index a bot for fast lookups
   */
  private indexBot(definition: BotDefinition): void {
    // Index by scope
    const scope = definition.scope || 'all';
    if (!this.byScope.has(scope)) {
      this.byScope.set(scope, new Set());
    }
    this.byScope.get(scope)!.add(definition.id);
  }

  /**
   * Clear all registrations (for testing)
   */
  clear(): void {
    this.bots.clear();
    this.byScope.clear();
    this.initialized = false;
  }
}

/**
 * Singleton bot catalog instance
 */
export const botCatalog = new BotCatalogImpl();

/**
 * Export class for testing
 */
export { BotCatalogImpl };
