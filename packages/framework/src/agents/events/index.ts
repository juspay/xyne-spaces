/**
 * Minimal Agent Event System
 * 
 * Lightweight event emission for agent orchestrator logging and debugging.
 */

// Basic event emitter from the global instance
export { emit } from './emitter.js';

// Simple event creation functions used by orchestrator
export function createErrorEvent(
  agentId: string,
  error: Error,
  severity: 'error' | 'critical' = 'error',
  context?: Record<string, unknown>,
  recoverable: boolean = true
): {
  id: string;
  timestamp: Date;
  agentId: string;
  type: string;
  source: string;
  severity: string;
  error: Error;
  recoverable: boolean;
  context?: Record<string, unknown>;
} {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    timestamp: new Date(),
    agentId,
    type: 'system:error',
    source: 'system',
    severity,
    error,
    recoverable,
    ...(context && { context }),
  };
}

export function createDebugEvent(
  agentId: string,
  message: string,
  context?: Record<string, unknown>
): {
  id: string;
  timestamp: Date;
  agentId: string;
  type: string;
  source: string;
  severity: string;
  message: string;
  context?: Record<string, unknown>;
} {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    timestamp: new Date(),
    agentId,
    type: 'system:debug',
    source: 'system',
    severity: 'debug',
    message,
    ...(context && { context }),
  };
}

export function createTokenUsageEvent(
  agentId: string,
  currentTokens: number,
  contextWindow: number,
  usagePercentage: number
): {
  id: string;
  timestamp: Date;
  agentId: string;
  type: string;
  source: string;
  severity: string;
  currentTokens: number;
  contextWindow: number;
  usagePercentage: number;
} {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    timestamp: new Date(),
    agentId,
    type: 'system:token_usage',
    source: 'system',
    severity: 'info',
    currentTokens,
    contextWindow,
    usagePercentage,
  };
}