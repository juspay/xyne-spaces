/**
 * mTLS (Mutual TLS) Configuration
 *
 * Allows applications to provide client certificates for mTLS authentication.
 * This is similar to how the Xyne Electron app handles device enrollment.
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
 * Creates an HTTPS agent for Node.js with mTLS configuration.
 * This is a factory function that returns an Agent when in Node.js,
 * or undefined in browser environments (where mTLS is handled by the browser).
 *
 * @internal
 */
export async function createMTLSAgent(
  config: MTLSConfig
): Promise<unknown | undefined> {
  if (!isNodeEnvironment()) {
    // In browser environments, mTLS is handled by the browser/OS
    // through the keychain (like Electron does)
    return undefined;
  }

  // Dynamic import to avoid bundling Node.js modules in browser builds
  const https = await import('https');

  return new https.Agent({
    cert: config.cert,
    key: config.key,
    passphrase: config.passphrase,
    ca: config.ca,
    rejectUnauthorized: config.rejectUnauthorized ?? true,
  });
}

/**
 * Node.js fetch options with agent support.
 * Standard fetch doesn't support agents, but node-fetch and undici do.
 */
export interface NodeFetchOptions extends RequestInit {
  agent?: unknown;
  dispatcher?: unknown;
}
