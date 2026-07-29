/**
 * Unified Bot Framework - @Bot Decorator
 *
 * Decorator for automatic registration of internal bots with the bot catalog.
 * Same name as the legacy decorator but registers with the unified catalog.
 */

import 'reflect-metadata';
import type { z } from 'zod';
import type { BotRuntime, InternalBotDefinition, BotScope, BotInteractionMode } from '../types/index.js';
import { botCatalog } from '../catalog/index.js';
import {logger} from '@/utils/logger';


/**
 * Symbol for storing bot metadata
 */
const BOT_METADATA_SYMBOL = Symbol('unified:bot:metadata');

/**
 * Bot decorator configuration
 */
export interface BotDecoratorConfig<TInput = unknown, TOutput = unknown> {
  /** Unique bot identifier */
  readonly id: string;
  /** Display name shown to users */
  readonly name: string;
  /** Bot email address (must be unique) */
  readonly email: string;
  /** Description */
  readonly description: string;
  /** Zod input schema */
  readonly inputSchema: z.ZodSchema<TInput>;
  /** Zod output schema */
  readonly outputSchema: z.ZodSchema<TOutput>;
  /** Avatar URL */
  readonly picture?: string;
  /** Bot version */
  readonly version?: string;
  /** Scope where bot can be triggered */
  readonly scope?: BotScope;
  /** Whether to use queue-based execution (default: true) */
  readonly useQueue?: boolean;
  /** Interaction mode - 'dm' for chat-capable bots, 'execute' for background-only bots (default: 'execute') */
  readonly interactionMode?: BotInteractionMode;
}

/**
 * Convert decorator config to internal bot definition
 */
function toInternalBotDefinition<TInput, TOutput>(
  config: BotDecoratorConfig<TInput, TOutput>
): InternalBotDefinition<TInput, TOutput> {
  return {
    id: config.id,
    name: config.name,
    email: config.email,
    description: config.description,
    picture: config.picture,
    version: config.version,
    scope: config.scope,
    runtimeType: 'internal',
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    useQueue: config.useQueue ?? true,
    interactionMode: config.interactionMode ?? 'execute',
  };
}

/**
 * @Bot decorator for automatic registration with unified bot catalog
 *
 * Usage:
 * ```typescript
 * @Bot({
 *   id: 'my-bot',
 *   name: 'My Bot',
 *   email: 'my-bot@bot.xyne.ai',
 *   description: 'Does something useful',
 *   inputSchema: z.object({ ... }),
 *   outputSchema: z.object({ ... }),
 * })
 * class MyBot extends UnifiedBaseBot { ... }
 * ```
 */
export function Bot<TInput = unknown, TOutput = unknown>(
  config: BotDecoratorConfig<TInput, TOutput>
) {
  return function <T extends new () => BotRuntime>(constructor: T): T {
    // Validate configuration
    validateBotConfig(config);

    // Convert to internal definition
    const definition = toInternalBotDefinition(config);

    // Store metadata in the constructor
    Reflect.defineMetadata(BOT_METADATA_SYMBOL, definition, constructor);

    // Register with the unified bot catalog
    try {
      botCatalog.registerInternal(definition, constructor);

      logger.info(`[Bot] Registered with unified catalog: ${config.id}`, {
        name: config.name,
      });
    } catch (error) {
      logger.error(`[Bot] Registration failed: ${config.id}`, error);
      throw error;
    }

    return constructor;
  };
}

/**
 * Validate bot configuration
 */
function validateBotConfig(config: BotDecoratorConfig): void {
  if (!config.id || config.id.trim().length === 0) {
    throw new Error('Bot id is required and cannot be empty');
  }

  if (!config.name || config.name.trim().length === 0) {
    throw new Error(`Bot name is required for bot '${config.id}'`);
  }

  if (!config.email || config.email.trim().length === 0) {
    throw new Error(`Bot email is required for bot '${config.id}'`);
  }

  if (!config.description || config.description.trim().length === 0) {
    throw new Error(`Bot description is required for bot '${config.id}'`);
  }

  // Validate id format
  const idRegex = /^[a-zA-Z0-9_-]{2,50}$/;
  if (!idRegex.test(config.id)) {
    throw new Error(
      `Bot id '${config.id}' must be 2-50 characters and contain only letters, numbers, dashes, and underscores`
    );
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(config.email)) {
    throw new Error(`Bot email '${config.email}' is not a valid email format`);
  }

  // Validate schemas are provided
  if (!config.inputSchema) {
    throw new Error(`Input schema is required for bot '${config.id}'`);
  }

  if (!config.outputSchema) {
    throw new Error(`Output schema is required for bot '${config.id}'`);
  }

  // Validate version format if provided
  if (config.version) {
    const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
    if (!versionRegex.test(config.version)) {
      throw new Error(
        `Bot version '${config.version}' must follow semantic versioning format (e.g., 1.0.0)`
      );
    }
  }
}
