import { spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';

/**
 * Runs the bundled transit key helper for this platform (native/transit-key): `transit-key`
 * on macOS (Swift, Secure Enclave), `transit-key.exe` on Windows (C, TPM or software KSP). Each
 * call is one short-lived process; inputs go on stdin, never argv. The helper prints one JSON
 * line.
 */

/** A hung helper must never hold up login: it is killed and the attempt fails. */
const HELPER_TIMEOUT_MS = 3000;

/** The helpers' exit codes for a failure (see secure-enclave.swift and windows-key.c). */
const EXIT_BROKEN_KEY = 2;
const EXIT_UNSUPPORTED = 3;

/** A helper that ran and failed, timed out (exit code null) or printed no result. */
export class TransitKeyHelperError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null
  ) {
    super(message);
    this.name = 'TransitKeyHelperError';
  }
}

/** The helper opened the key and found it bad: only then is a key replaced. */
export function isBrokenKey(error: unknown): boolean {
  return error instanceof TransitKeyHelperError && error.exitCode === EXIT_BROKEN_KEY;
}

/**
 * The helper says the hardware its key needs is not there. A helper that cannot run at all (not
 * in this build, not executable, the wrong architecture) is a broken build, never this: it fails
 * loudly instead of moving the install to software.
 */
export function isUnsupported(error: unknown): boolean {
  return error instanceof TransitKeyHelperError && error.exitCode === EXIT_UNSUPPORTED;
}

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
      reject(new TransitKeyHelperError(`transit-key ${command} timed out`, null));
    }, HELPER_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`transit-key helper cannot run (${fileName}): ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let output: unknown;
      try {
        output = JSON.parse(stdout.trim());
      } catch {
        reject(
          new TransitKeyHelperError(`transit-key ${command} exited ${code}: ${stderr.trim()}`, code)
        );
        return;
      }
      if (typeof output !== 'object' || output === null) {
        reject(new TransitKeyHelperError(`transit-key ${command} returned no result`, code));
      } else if (code !== 0 || 'error' in output) {
        const message = (output as { error?: unknown }).error;
        // An error with exit 0 should not happen; it counts as an ordinary failure.
        reject(
          new TransitKeyHelperError(
            `transit-key ${command} failed: ${String(message)}`,
            code === 0 ? 1 : code
          )
        );
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

/** A probe's answer, `{"available": "true" | "false"}`; anything else is an error, not a "no". */
export function availableField(output: Record<string, unknown>): boolean {
  if (output.available === 'true') return true;
  if (output.available === 'false') return false;
  throw new Error('transit-key probe returned no answer');
}
