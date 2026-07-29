/**
 * Unified Bot Framework
 *
 * A unified, extensible bot framework that supports both internal (class-based)
 * and external (config-based) bots with a consistent event stream contract.
 *
 * Key exports:
 * - Types: BotDefinition, BotEvent, BotExecutionContext, BotRuntime
 * - Catalog: botCatalog (singleton) for bot registration and discovery
 * - Base: UnifiedBaseBot for creating internal bots
 * - Decorator: @Bot for automatic registration
 */

// Types
export * from './types/index.js';

// Bot Catalog
export * from './catalog/index.js';

// Base Classes
export * from './base/index.js';

// Decorators
export * from './decorators/index.js';

// Orchestrator
export * from './orchestrator/index.js';

// Execution Runtimes
export * from './execution/index.js';

// Pluggable Adapters
export * from './adapters/index.js';

// Services
export * from './services/index.js';
