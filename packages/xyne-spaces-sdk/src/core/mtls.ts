/**
 * mTLS (Mutual TLS) Configuration
 *
 * Allows applications to provide client certificates for mTLS authentication.
 * This is similar to how the Xyne Electron app handles device enrollment.
 *
 * Uses Undici's Agent for proper mTLS support in Node.js 18+.
 *
 * @example Node.js usage:
 * ```typescript
 * import { readFileSync } from 'fs';
 * import { createClient } from '@xyne/spaces-sdk';
 *
 * const client = createClient({
 *   baseUrl: 'https://api.xyne.app',
 *   mtls: {
 *     cert: readFileSync('/path/to/client.crt', 'utf8'),
 *     key: readFileSync('/path/to/client.key', 'utf8'),
 *     ca: readFileSync('/path/to/ca.crt', 'utf8'), // optional
 *   },
 * });
 * ```
 */

import type { Agent, Dispatcher } from 'undici';

/**
 * mTLS certificate configuration.
 * The SDK accepts PEM-encoded certificates and keys.
 */
export interface MTLSConfig {
  /**
   * Client certificate in PEM format.
   * This is the certificate that will be presented to the server.
   */
  cert: string;

  /**
   * Private key in PEM format.
   * Must correspond to the client certificate.
   */
  key: string;

  /**
   * Optional passphrase for encrypted private keys.
   */
  passphrase?: string;

  /**
   * Optional CA certificate(s) in PEM format.
   * Used to verify the server's certificate.
   * If not provided, the system's default CA store is used.
   */
  ca?: string | string[];

  /**
   * Whether to reject unauthorized certificates.
   * @default true
   */
  rejectUnauthorized?: boolean;
}

/**
 * Type guard to check if we're running in Node.js environment.
 */
export function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null
  );
}

/**
 * Error thrown when mTLS configuration is invalid or unsupported.
 */
export class MTLSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MTLSError';
  }
}

/**
 * Creates an Undici Agent for Node.js with mTLS configuration.
 * This agent can be used as a dispatcher for fetch requests.
 *
 * In browser/Electron environments, returns undefined as mTLS is handled
 * automatically by the browser/OS through the certificate store.
 * Electron uses `select-client-certificate` event to handle certificate selection.
 *
 * @internal
 */
export async function createMTLSAgent(
  config: MTLSConfig
): Promise<Agent | undefined> {
  if (!isNodeEnvironment()) {
    // In browser/Electron environments, mTLS is handled automatically:
    // - Electron: Uses OS keychain + select-client-certificate event
    // - Browser: Uses OS/browser certificate store
    // The mTLS config is ignored, but no error is thrown to allow
    // the same code to work in both Node.js and browser environments.
    return undefined;
  }

  // Dynamic import to avoid bundling Node.js modules in browser builds
  // Undici is bundled with Node.js 18+ so no extra install needed
  const { Agent } = await import('undici');

  return new Agent({
    connect: {
      cert: config.cert,
      key: config.key,
      passphrase: config.passphrase,
      ca: config.ca,
      rejectUnauthorized: config.rejectUnauthorized ?? true,
    },
  });
}

/**
 * Undici fetch options with dispatcher support.
 */
export interface UndiciRequestInit extends RequestInit {
  dispatcher?: Dispatcher;
}
