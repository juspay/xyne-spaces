import { base64Field, runHelper } from './helper-process';

/**
 * Talks to the bundled Swift helper (native/transit-key/secure-enclave.swift) that keeps the
 * transit key in the Secure Enclave.
 */

const HELPER = 'transit-key';

/** A new key in the Secure Enclave; returns the Enclave's encrypted handle to it. */
export async function createEnclaveKey(): Promise<Buffer> {
  return base64Field(await runHelper(HELPER, ['create'], ''), 'blob');
}

/** ECDH inside the Secure Enclave with a server's uncompressed P-256 point. */
export async function enclaveAgree(
  blob: Buffer,
  serverPoint: Uint8Array
): Promise<{ secret: Buffer; publicKey: Buffer }> {
  const input = JSON.stringify({
    blob: blob.toString('base64'),
    serverPoint: Buffer.from(serverPoint).toString('base64'),
  });
  const output = await runHelper(HELPER, ['agree'], input);
  return { secret: base64Field(output, 'secret'), publicKey: base64Field(output, 'publicKey') };
}
