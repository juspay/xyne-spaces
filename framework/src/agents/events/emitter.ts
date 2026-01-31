/**
 * Minimal Event Emitter
 * 
 * Simple event emission for orchestrator logging and debugging.
 * Only provides the basic emit functionality that the agent system actually uses.
 */

import { logger } from '../../utils/logger.js';

/**
 * Basic event structure for orchestrator logging
 */
interface BasicEvent {
  readonly id: string;
  readonly timestamp: Date;
  readonly agentId: string;
  readonly type: string;
  readonly source: string;
  readonly severity?: string;
  readonly message?: string;
  readonly error?: Error;
  readonly context?: Record<string, unknown>;
  readonly recoverable?: boolean;
}

/**
 * Simple event emission function
 * 
 * Just logs events to console in development for debugging.
 * In production, this would integrate with your logging system.
 */
export function emit(event: BasicEvent): void {
  const context = {
    type: event.type,
    agentId: event.agentId,
    source: event.source,
    recoverable: event.recoverable,
    ...(event.context && { ...event.context })
  };

  const message = event.message || `Agent event: ${event.type}`;

  // Use appropriate log level based on event severity
  switch (event.severity) {
    case 'error':
    case 'critical':
      logger.error(message, event.error, context);
      break;
    case 'warn':
      logger.warn(message, context);
      break;
    default:
      logger.debug(message, context);
      break;
  }
}
