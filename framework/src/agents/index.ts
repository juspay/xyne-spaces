/**
 * Agent Module - Main Entry Point
 * 
 * Clean agent system with unified configuration and lean orchestration.
 */

// Main agent classes and configuration
export * from './core/index.js';

// Lean orchestrator
export * from './orchestrator/index.js';

// Tool resolution
export * from './tools/index.js';

// Minimal events (for orchestrator logging)
export * from './events/index.js';