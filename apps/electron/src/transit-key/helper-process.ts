import { spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';

/**
 * Runs the bundled transit key helper for this platform (native/transit-key): `transit-key`
 * on macOS (Swift, Secure Enclave), `transit-key.exe` on Windows (C, TPM). Each call is one
 * short-lived process; inputs go on stdin, never argv. The helper prints one JSON line.
 */

/** A hung helper must never hold up login: it is killed and the caller falls back. */
const HELPER_TIMEOUT_MS = 3000;

function helperPath(fileName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'transit-key', fileName);
  }
  return path.join(app.getAppPath(), 'native', 'transit-key', fileName);
}

export function runHelper(
  fileName: string,
  args: string[],
  stdin: string
): Promise<Record<string, unknown>> {
  const command = args[0];
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(fileName), args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
    // A command that takes no input may exit without reading stdin, so writing to it can fail
    // with EPIPE: harmless, ignore it.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

export function base64Field(output: Record<string, unknown>, name: string): Buffer {
  const value = output[name];
  if (typeof value !== 'string') throw new Error(`transit-key returned no ${name}`);
  return Buffer.from(value, 'base64');
}
