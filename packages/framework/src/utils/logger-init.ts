/**
 * Logger initialization for application
 * Sets log level based on debug parameter before any other imports
 */

import { logger, LogLevel } from '../utils/logger.js';

// Parse debug parameter early
const debug = process.argv.includes('--debug');

// Set log level - completely disable logs when not in debug mode
if (debug) {
  logger.setLevel(LogLevel.DEBUG);
} else {
  // Disable all logging
  logger.setLevel(LogLevel.OFF);
}

export { debug };