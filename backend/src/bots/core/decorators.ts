import 'reflect-metadata';
import type { BotConfig, BotInstance } from './types/bot.js';
import { botRegistry } from './bot-registry.js';
import { 
  createBotRegistrationError,
  BotRegistrationErrorClass
} from './errors.js';
import {logger} from '@/utils/logger';

/**
 * Symbol for storing bot metadata
 */
const BOT_METADATA_SYMBOL = Symbol('bot:metadata');

/**
 * Bot decorator for automatic registration
 */
export function Bot<TInput = unknown, TOutput = unknown>(
  config: BotConfig<TInput, TOutput>
) {
  return function<T extends new () => BotInstance<TInput, TOutput>>(
    constructor: T
  ): T {
    // Validate configuration
    validateBotConfig(config);

    // Store metadata in the constructor
    Reflect.defineMetadata(BOT_METADATA_SYMBOL, config, constructor);

    // Register the bot automatically
    try {
      botRegistry.registerBot(
        {
          name: config.name,
          description: config.description,
          ...(config.version && { version: config.version }),
          ...(config.tags && { tags: config.tags }),
          ...(config.category && { category: config.category }),
          ...(config.capabilities && { capabilities: config.capabilities }),
          ...(config.scope && { scope: config.scope })
        },
        {
          input: config.inputSchema,
          output: config.outputSchema
        },
        constructor
      );

      logger.debug(`[Bot] Auto-registered via decorator: ${config.name}`, {
        category: config.category,
        capabilities: config.capabilities
      });

    } catch (error) {
      logger.error(`[Bot] Auto-registration failed: ${config.name}`, error);
      throw error;
    }

    return constructor;
  };
}

/**
 * Get bot metadata from a decorated class
 */
export function getBotMetadata<TInput = unknown, TOutput = unknown>(
  constructor: new () => BotInstance<TInput, TOutput>
): BotConfig<TInput, TOutput> | undefined {
  return Reflect.getMetadata(BOT_METADATA_SYMBOL, constructor) as BotConfig<TInput, TOutput> | undefined;
}

/**
 * Check if a class is decorated with @Bot
 */
export function isBotDecorated(constructor: new () => BotInstance<unknown, unknown>): boolean {
  return Reflect.hasMetadata(BOT_METADATA_SYMBOL, constructor);
}

/**
 * Bot category decorator (optional convenience decorator)
 */
export function BotCategory(category: string) {
  return function<T extends new () => BotInstance<unknown, unknown>>(constructor: T): T {
    const existingMetadata = getBotMetadata(constructor);
    if (existingMetadata) {
      // Update existing metadata
      const updatedMetadata = { ...existingMetadata, category };
      Reflect.defineMetadata(BOT_METADATA_SYMBOL, updatedMetadata, constructor);
    }
    return constructor;
  };
}

/**
 * Bot tags decorator (optional convenience decorator)
 */
export function BotTags(...tags: string[]) {
  return function<T extends new () => BotInstance<unknown, unknown>>(constructor: T): T {
    const existingMetadata = getBotMetadata(constructor);
    if (existingMetadata) {
      // Update existing metadata
      const updatedMetadata = { ...existingMetadata, tags };
      Reflect.defineMetadata(BOT_METADATA_SYMBOL, updatedMetadata, constructor);
    }
    return constructor;
  };
}

/**
 * Bot capabilities decorator (optional convenience decorator)
 */
export function BotCapabilities(...capabilities: string[]) {
  return function<T extends new () => BotInstance<unknown, unknown>>(constructor: T): T {
    const existingMetadata = getBotMetadata(constructor);
    if (existingMetadata) {
      // Update existing metadata
      const updatedMetadata = { ...existingMetadata, capabilities };
      Reflect.defineMetadata(BOT_METADATA_SYMBOL, updatedMetadata, constructor);
    }
    return constructor;
  };
}

/**
 * Scan and register all bots in a module or object
 */
export function registerBotsFromModule(moduleExports: Record<string, unknown>): void {
  let registeredCount = 0;
  
  for (const [exportName, exportValue] of Object.entries(moduleExports)) {
    // Check if it's a class constructor
    if (typeof exportValue === 'function' && 
        exportValue.prototype && 
        isBotDecorated(exportValue as new () => BotInstance)) {
      
      try {
        // The bot should already be registered by the decorator,
        // but we can log the discovery
        logger.debug(`[Bot] Discovered decorated bot in module: ${exportName}`, {
          botName: getBotMetadata(exportValue as new () => BotInstance)?.name
        });
        registeredCount++;
      } catch (error) {
        logger.warn(`[Bot] Failed to process bot from module: ${exportName}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  logger.debug(`[Bot] Module scan completed`, {
    totalExports: Object.keys(moduleExports).length,
    botsFound: registeredCount
  });
}

/**
 * Validate bot configuration
 */
function validateBotConfig(config: BotConfig): void {
  if (!config.name || config.name.trim().length === 0) {
    throw new BotRegistrationErrorClass(createBotRegistrationError(
      config.name || 'unknown',
      'Bot name is required and cannot be empty'
    ));
  }

  if (!config.description || config.description.trim().length === 0) {
    throw new BotRegistrationErrorClass(createBotRegistrationError(
      config.name,
      'Bot description is required and cannot be empty'
    ));
  }

  // Validate name format
  const nameRegex = /^[a-zA-Z0-9_-]{2,50}$/;
  if (!nameRegex.test(config.name)) {
    throw new BotRegistrationErrorClass(createBotRegistrationError(
      config.name,
      'Bot name must be 2-50 characters and contain only letters, numbers, dashes, and underscores'
    ));
  }

  // Validate schemas are provided
  if (!config.inputSchema) {
    throw new BotRegistrationErrorClass(createBotRegistrationError(
      config.name,
      'Input schema is required'
    ));
  }

  if (!config.outputSchema) {
    throw new BotRegistrationErrorClass(createBotRegistrationError(
      config.name,
      'Output schema is required'
    ));
  }





  // Validate version format if provided
  if (config.version) {
    const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
    if (!versionRegex.test(config.version)) {
      throw new BotRegistrationErrorClass(createBotRegistrationError(
        config.name,
        'Bot version must follow semantic versioning format (e.g., 1.0.0)'
      ));
    }
  }
}