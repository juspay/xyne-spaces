import { spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';

/**
 * Talks to the bundled Swift helper (native/transit-key) that keeps the transit key in the
 * Secure Enclave. Each call is one short-lived process; inputs go on stdin, never argv.
 */

/** A hung helper must never hold up login: it is killed and the caller falls back. */
const HELPER_TIMEOUT_MS = 3000;

function helperPath(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'native',
      'transit-key',
      'transit-key'
    );
  }
  return path.join(app.getAppPath(), 'native', 'transit-key', 'transit-key');
}

function runHelper(
  command: 'create' | 'agree',
  input?: Record<string, string>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), [command], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`transit-key ${command} timed out`));
    }, HELPER_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let output: unknown;
      try {
        output = JSON.parse(stdout.trim());
      } catch {
        reject(new Error(`transit-key ${command} exited ${code}: ${stderr.trim()}`));
        return;
      }
      if (typeof output !== 'object' || output === null) {
        reject(new Error(`transit-key ${command} returned no result`));
      } else if (code !== 0 || 'error' in output) {
        const message = (output as { error?: unknown }).error;
        reject(new Error(`transit-key ${command} failed: ${String(message)}`));
      } else {
        resolve(output as Record<string, unknown>);
      }
    });
    // `create` exits without reading stdin, so writing to it can fail with EPIPE: harmless, ignore it.
    child.stdin.on('error', () => {});
    child.stdin.end(input ? JSON.stringify(input) : '');
  });
}

function base64Field(output: Record<string, unknown>, name: string): Buffer {
  const value = output[name];
  if (typeof value !== 'string') throw new Error(`transit-key returned no ${name}`);
  return Buffer.from(value, 'base64');
}

/** A new key in the Secure Enclave; returns the Enclave's encrypted handle to it. */
export async function createEnclaveKey(): Promise<Buffer> {
  return base64Field(await runHelper('create'), 'blob');
}

/** ECDH inside the Secure Enclave with a server's uncompressed P-256 point. */
export async function enclaveAgree(
  blob: Buffer,
  serverPoint: Uint8Array
): Promise<{ secret: Buffer; publicKey: Buffer }> {
  const output = await runHelper('agree', {
    blob: blob.toString('base64'),
    serverPoint: Buffer.from(serverPoint).toString('base64'),
  });
  return { secret: base64Field(output, 'secret'), publicKey: base64Field(output, 'publicKey') };
}
