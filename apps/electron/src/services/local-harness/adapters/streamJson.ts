import { spawn } from 'child_process';
import log from 'electron-log/main';

export interface SpawnJsonLinesOptions {
  binaryPath: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
  onEvent: (event: Record<string, unknown>) => void;
}

export interface SpawnJsonLinesResult {
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

const STDERR_TAIL_LIMIT = 4000;

export function spawnJsonLines(opts: SpawnJsonLinesOptions): Promise<SpawnJsonLinesResult> {
  return new Promise((resolve) => {
    const child = spawn(opts.binaryPath, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    let stdoutBuffer = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const killTree = () => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, opts.timeoutMs);

    const onAbort = () => {
      aborted = true;
      killTree();
    };
    opts.signal.addEventListener('abort', onAbort, { once: true });

    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      resolve({ exitCode, stderr: stderr.slice(-STDERR_TAIL_LIMIT), timedOut, aborted });
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      let newline = stdoutBuffer.indexOf('\n');
      while (newline !== -1) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        newline = stdoutBuffer.indexOf('\n');
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            opts.onEvent(parsed as Record<string, unknown>);
          }
        } catch {
          log.debug(`[LocalHarness] non-JSON stdout line: ${line.slice(0, 200)}`);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > STDERR_TAIL_LIMIT * 2) stderr = stderr.slice(-STDERR_TAIL_LIMIT);
    });

    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      settle(null);
    });
    child.on('close', (code) => settle(code));

    child.stdin.on('error', () => {});
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}
