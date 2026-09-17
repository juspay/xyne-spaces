import type { Logger } from '../logger/index.js';
import { noopLogger } from '../logger/index.js';

/**
 * Module-level logger for the shared crypto package.
 * Defaults to noopLogger; call setCryptoLogger() at app boot to enable real logging.
 * (e.g. call it in EncryptionProvider with the instrumentation logger)
 */
let _logger: Logger = noopLogger;

export function setCryptoLogger(l: Logger): void {
  _logger = l;
}

export function getCryptoLogger(): Logger {
  return _logger;
}
