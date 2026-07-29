import 'reflect-metadata';
import type { BotConfig, BotInstance } from './types/bot.js';

/**
 * Symbol for storing bot metadata
 */
const BOT_METADATA_SYMBOL = Symbol('bot:metadata');

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
