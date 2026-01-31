/**
 * Unified Bot Framework - Core Type Definitions
 *
 * This file defines the canonical types for the unified bot framework,
 * supporting both internal (class-based) and external (API-based) bots.
 */

import type { z } from 'zod';
import type { Message } from '@prisma/client';
import type { BotEvent } from './events.js';

// ============================================================================
// Bot Runtime Types
// ============================================================================

/**
 * Bot runtime type - determines how the bot executes
 */
export type BotRuntimeType = 'internal' | 'external';

/**
 * Bot scope - where the bot can be triggered
 */
export type BotScope = 'conversation' | 'thread' | 'dm' | 'all';

/**
 * Authentication types for external bots
 */
export type AuthType = 'none' | 'api_key';

/**
 * Response types for external bots
 */
export type ResponseType = 'streaming' | 'non_streaming';

/**
 * Bot interaction mode - determines how users interact with the bot
 * - 'dm': Chat-capable bots that appear in CommandMenu and can be messaged directly
 * - 'execute': Background-only bots triggered via execute endpoint, hidden from CommandMenu
 */
export type BotInteractionMode = 'dm' | 'execute';

// ============================================================================
// Bot Definition Types
// ============================================================================

/**
 * Base bot definition - common fields for all bots
 */
export interface BotDefinitionBase {
  /** Unique bot identifier (canonical ID used everywhere) */
  readonly id: string;
  /** Display name shown to users */
  readonly name: string;
  /** Bot email address (for DB user record, must be unique) */
  readonly email: string;
  /** Avatar URL */
  readonly picture?: string;
  /** Description shown in command palette */
  readonly description: string;
  /** Bot version */
  readonly version?: string;
  /** Scope where bot can be triggered */
  readonly scope?: BotScope;
  /** Runtime type */
  readonly runtimeType: BotRuntimeType;
  /** Interaction mode - 'dm' for chat-capable bots, 'execute' for background-only bots */
  readonly interactionMode?: BotInteractionMode;
}

/**
 * Internal bot definition - class-based execution
 */
export interface InternalBotDefinition<TInput = unknown, TOutput = unknown>
  extends BotDefinitionBase {
  readonly runtimeType: 'internal';
  /** Zod input schema for validation */
  readonly inputSchema: z.ZodSchema<TInput>;
  /** Zod output schema for validation */
  readonly outputSchema: z.ZodSchema<TOutput>;
  /** Whether to use queue-based execution (default: true) */
  readonly useQueue?: boolean;
}

/**
 * External API configuration for external bots
 */
export interface ExternalApiConfig {
  /** The endpoint URL for the bot's external API */
  readonly endpoint: string;
  /** HTTP method for the API call */
  readonly method: 'GET' | 'POST';
  /** Authentication type for the external API */
  readonly authType: AuthType;
  /** Environment variable name containing the auth value */
  readonly authEnvVar?: string;
  /** Custom header name for API key auth */
  readonly authHeader?: string;
  /** Response type from the external API */
  readonly responseType: ResponseType;
  /** Template for request body - supports placeholders */
  readonly requestBodyTemplate?: Record<string, unknown>;
  /** Custom headers to send with requests */
  readonly headers?: Record<string, string>;
  /** Configuration for conversation context */
  readonly contextConfig: {
    /** Whether to include conversation history in requests */
    readonly includeHistory: boolean;
    /** Maximum number of history messages to include */
    readonly maxHistoryMessages?: number;
  };
  /** SSE parser to use (e.g., 'genius', 'default') */
  readonly sseParser?: string;
  /** Tool output transformer to use */
  readonly toolOutputTransformer?: string;
}

/**
 * External bot definition - API-based execution
 */
export interface ExternalBotDefinition extends BotDefinitionBase {
  readonly runtimeType: 'external';
  /** External API configuration */
  readonly externalApi: ExternalApiConfig;
}

/**
 * Union type for all bot definitions
 */
export type BotDefinition = InternalBotDefinition | ExternalBotDefinition;

// ============================================================================
// Bot Execution Context
// ============================================================================

/**
 * Unified bot execution context - passed to all bot executions
 */
export interface BotExecutionContext {
  /** Unique execution ID */
  readonly executionId: string;
  /** Bot ID (from catalog) */
  readonly botId: string;
  /** Bot user database ID (resolved from catalog) */
  readonly botUserId?: string;
  /** Channel ID */
  readonly channelId: string;
  /** Conversation ID */
  readonly conversationId: string;
  /** Triggering user ID */
  readonly userId: string;
  /** User's email */
  readonly userEmail?: string;
  /** User's name */
  readonly userName?: string;
  /** Session ID for context continuity */
  readonly sessionId?: string;
  /** Trigger message */
  readonly triggerMessage?: Message | null;
  /** Abort signal for cancellation */
  readonly abortSignal?: AbortSignal;
  /** Start time */
  readonly startTime: Date;
  /** Additional parameters */
  readonly parameters?: Record<string, unknown>;
}

// ============================================================================
// Bot Runtime Interface
// ============================================================================

/**
 * Bot runtime interface - implemented by all bot execution handlers
 */
export interface BotRuntime {
  /**
   * Run the bot and yield events
   * @param input - The input to the bot
   * @param context - The execution context
   * @returns AsyncGenerator yielding BotEvents
   */
  run(input: unknown, context: BotExecutionContext): AsyncGenerator<BotEvent>;
}

// ============================================================================
// Bot Catalog Entry
// ============================================================================

/**
 * Bot catalog entry - stored in the catalog
 */
export interface BotCatalogEntry {
  /** Bot definition */
  readonly definition: BotDefinition;
  /** For internal bots: the bot class */
  readonly botClass?: new () => BotRuntime;
  /** When the bot was registered */
  readonly registeredAt: Date;
  /** Database user ID (set after sync) */
  dbUserId?: string;
}

// ============================================================================
// Bot Execution Results
// ============================================================================

/**
 * Bot execution metadata for tracing and debugging
 */
export interface BotExecutionMetadata {
  readonly botId: string;
  readonly executionId: string;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly duration?: number;
  readonly conversationId?: string;
  readonly userId?: string;
}

/**
 * Bot error interface
 */
export interface BotError {
  readonly type: 'validation' | 'execution' | 'registration' | 'timeout' | 'abort' | 'network';
  readonly message: string;
  readonly botId: string;
  readonly details?: Record<string, unknown>;
  readonly originalError?: Error;
}

// ============================================================================
// Tool Output Types (from Genius integration)
// ============================================================================

/**
 * Tool output - charts, tables, and visualization data
 */
export interface ToolOutput {
  readonly id: string;
  readonly description?: string;
  readonly chartData?: unknown;
  readonly rawChartData?: Array<Record<string, string | number>>;
  readonly groupbyConfig?: unknown;
  readonly selectedMetrics?: unknown;
  readonly singleStat?: {
    readonly metric: string;
    readonly value: string | number;
  };
  readonly tableData?: Array<Record<string, string | number>>;
  readonly barChartData?: {
    readonly rawData: Array<Record<string, string | number>>;
    readonly groupKey: string;
    readonly selectedMetrics: unknown;
    readonly isHorizontalBar?: boolean;
  };
  readonly volumeChartData?: {
    readonly rawData: Array<Record<string, string | number>>;
    readonly groupKey: string;
    readonly selectedMetrics: unknown;
    readonly defaultChartType?: 'bar' | 'pie';
    readonly showToggle?: boolean;
    readonly title?: string;
  };
  readonly agenticChartData?: unknown;
  readonly directChartData?: unknown;
}

// ============================================================================
// FlowJson Types (from internal bot framework)
// ============================================================================

/**
 * FlowJson - structured UI component output
 */
export interface FlowJson {
  readonly type: string;
  readonly content?: unknown;
  readonly children?: readonly FlowJson[];
  readonly props?: Record<string, unknown>;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a bot definition is internal
 */
export function isInternalBot(def: BotDefinition): def is InternalBotDefinition {
  return def.runtimeType === 'internal';
}

/**
 * Check if a bot definition is external
 */
export function isExternalBot(def: BotDefinition): def is ExternalBotDefinition {
  return def.runtimeType === 'external';
}
