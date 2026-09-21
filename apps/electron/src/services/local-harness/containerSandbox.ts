import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { promises as fsp } from 'fs';
import { join } from 'path';
import log from 'electron-log/main';

const IDLE_STOP_MS = 30 * 60 * 1000;
const SWEEP_MS = 60 * 1000;
const READY_CACHE_MS = 60 * 1000;
const OUTPUT_CAP = 64 * 1024;
const JOB_TAIL_BYTES = 8 * 1024;
const JOB_ID_RE = /^[a-f0-9]{12}$/;
export const JOBS_DIR = '.xyne-jobs';

export interface ContainerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  wallMs: number;
  timedOut: boolean;
}

interface ContainerRecord {
  name: string;
  runDir: string;
  lastUsedAt: number;
}

function sandboxImage(): string {
  return process.env['XYNE_LOCAL_SANDBOX_IMAGE'] ?? 'docker.io/library/node:22-bookworm';
}

function podman(
  args: string[],
  opts: { timeoutMs?: number; input?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = execFile('podman', args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, () => undefined);
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, opts.timeoutMs)
      : null;
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = tailCap(stdout + String(chunk));
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = tailCap(stderr + String(chunk));
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${err.message}`.trim(), timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
}

function tailCap(text: string): string {
  if (text.length <= OUTPUT_CAP) return text;
  return `[truncated]\n${text.slice(text.length - OUTPUT_CAP)}`;
}

export class ContainerSandbox {
  private readonly containers = new Map<string, ContainerRecord>();
  private readyAt = 0;
  private readyResult: { ok: true } | { ok: false; reason: string } | null = null;
  private imageReady = false;
  private sweeper: NodeJS.Timeout | null = null;

  private probeAt = 0;
  private probeResult: { available: boolean; reason?: string } | null = null;

  async probe(): Promise<{ available: boolean; reason?: string }> {
    if (this.probeResult && Date.now() - this.probeAt < READY_CACHE_MS) return this.probeResult;
    const result = await this.doProbe();
    this.probeResult = result;
    this.probeAt = Date.now();
    return result;
  }

  private async doProbe(): Promise<{ available: boolean; reason?: string }> {
    const version = await podman(['--version'], { timeoutMs: 8_000 });
    if (version.code !== 0) {
      return { available: false, reason: 'Podman is not installed. Install it from https://podman.io/ (macOS: `brew install podman`) to enable the container sandbox.' };
    }
    const list = await podman(['machine', 'list', '--format', 'json'], { timeoutMs: 12_000 });
    if (list.code !== 0) return { available: false, reason: 'Podman is installed but not responding.' };
    let machines: Array<{ Running?: boolean }> = [];
    try {
      machines = JSON.parse(list.stdout || '[]') as Array<{ Running?: boolean }>;
    } catch {
      machines = [];
    }
    if (machines.length === 0) return { available: false, reason: 'Podman has no machine yet — run `podman machine init`.' };
    if (machines.some((m) => m.Running)) return { available: true };
    return { available: false, reason: 'Podman machine is stopped — run `podman machine start`.' };
  }

  async ensureReady(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.readyResult && Date.now() - this.readyAt < READY_CACHE_MS) return this.readyResult;
    const result = await this.checkReady();
    this.readyResult = result;
    this.readyAt = Date.now();
    return result;
  }

  private async checkReady(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const version = await podman(['--version'], { timeoutMs: 10_000 });
    if (version.code !== 0) {
      return {
        ok: false,
        reason:
          'The container sandbox needs Podman, which is not installed on this computer. ' +
          'Install it from https://podman.io/ (macOS: `brew install podman`), then run `podman machine init` once.',
      };
    }
    const list = await podman(['machine', 'list', '--format', 'json'], { timeoutMs: 20_000 });
    if (list.code !== 0) return { ok: false, reason: `Could not talk to Podman: ${list.stderr.trim() || list.code}` };
    let machines: Array<{ Running?: boolean; Name?: string }> = [];
    try {
      machines = JSON.parse(list.stdout || '[]') as Array<{ Running?: boolean; Name?: string }>;
    } catch {
      machines = [];
    }
    if (machines.length === 0) {
      return { ok: false, reason: 'Podman is installed but has no machine yet. Run `podman machine init` once, then `podman machine start`.' };
    }
    if (machines.some((m) => m.Running)) return { ok: true };
    log.info('[LocalHarness] starting the Podman machine for the container sandbox');
    const start = await podman(['machine', 'start'], { timeoutMs: 90_000 });
    if (start.code !== 0 || start.timedOut) {
      return { ok: false, reason: `Podman machine could not start: ${start.stderr.trim() || 'timed out'}` };
    }
    return { ok: true };
  }

  async ensureImage(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.imageReady) return { ok: true };
    const image = sandboxImage();
    const exists = await podman(['image', 'exists', image], { timeoutMs: 20_000 });
    if (exists.code !== 0) {
      log.info(`[LocalHarness] pulling container sandbox image ${image}`);
      const pull = await podman(['pull', image], { timeoutMs: 10 * 60 * 1000 });
      if (pull.code !== 0) return { ok: false, reason: `Could not pull ${image}: ${pull.stderr.trim() || pull.code}` };
      log.info(`[LocalHarness] pulled ${image}`);
    }
    this.imageReady = true;
    return { ok: true };
  }

  containerName(runDirName: string): string {
    return `xyne-sbx-${runDirName}`.slice(0, 63);
  }

  async ensureContainer(runDirName: string, runDir: string): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
    const name = this.containerName(runDirName);
    const known = this.containers.get(runDirName);
    const inspect = await podman(['container', 'inspect', '--format', '{{.State.Running}}', name], { timeoutMs: 20_000 });
    if (inspect.code === 0 && inspect.stdout.trim() === 'true' && known) {
      known.lastUsedAt = Date.now();
      return { ok: true, name };
    }
    const mount = process.platform === 'linux' ? `${runDir}:/workspace:Z` : `${runDir}:/workspace`;
    const run = await podman(
      ['run', '-d', '--name', name, '--replace', '-v', mount, '-w', '/workspace', sandboxImage(), 'sleep', 'infinity'],
      { timeoutMs: 60_000 },
    );
    if (run.code !== 0) return { ok: false, reason: `Could not start the sandbox container: ${run.stderr.trim() || run.code}` };
    this.containers.set(runDirName, { name, runDir, lastUsedAt: Date.now() });
    this.startSweeper();
    log.info(`[LocalHarness] container sandbox ready name=${name}`);
    return { ok: true, name };
  }

  touch(runDirName: string): void {
    const rec = this.containers.get(runDirName);
    if (rec) rec.lastUsedAt = Date.now();
  }

  async exec(runDirName: string, command: string, timeoutMs = 120_000): Promise<ContainerExecResult> {
    const name = this.containerName(runDirName);
    this.touch(runDirName);
    const started = Date.now();
    const res = await podman(['exec', '-w', '/workspace', name, 'sh', '-lc', command], { timeoutMs });
    const wallMs = Date.now() - started;
    if (res.timedOut) {
      return { exitCode: 124, stdout: res.stdout, stderr: `${res.stderr}\ntimed out after ${Math.round(timeoutMs / 1000)} s`.trim(), wallMs, timedOut: true };
    }
    return { exitCode: res.code, stdout: res.stdout, stderr: res.stderr, wallMs, timedOut: false };
  }

  async runDetached(runDirName: string, command: string): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
    const name = this.containerName(runDirName);
    this.touch(runDirName);
    const jobId = randomBytes(6).toString('hex');
    const script =
      `mkdir -p /workspace/${JOBS_DIR}; ( ${command} ) > /workspace/${JOBS_DIR}/${jobId}.log 2>&1; ` +
      `echo $? > /workspace/${JOBS_DIR}/${jobId}.exit`;
    const res = await podman(['exec', '-d', '-w', '/workspace', name, 'sh', '-lc', script], { timeoutMs: 20_000 });
    if (res.code !== 0) return { ok: false, reason: res.stderr.trim() || `podman exec failed (${res.code})` };
    return { ok: true, jobId };
  }

  async pollJob(runDir: string, jobId: string): Promise<{ running: boolean; exitCode?: number; output: string } | null> {
    if (!JOB_ID_RE.test(jobId)) return null;
    const base = join(runDir, JOBS_DIR, jobId);
    let output = '';
    try {
      const handle = await fsp.open(`${base}.log`, 'r');
      try {
        const stat = await handle.stat();
        const start = Math.max(0, stat.size - JOB_TAIL_BYTES);
        const buf = Buffer.alloc(stat.size - start);
        await handle.read(buf, 0, buf.length, start);
        output = (start > 0 ? '[earlier output omitted]\n' : '') + buf.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
    try {
      const exit = (await fsp.readFile(`${base}.exit`, 'utf8')).trim();
      const code = Number.parseInt(exit, 10);
      return { running: false, exitCode: Number.isFinite(code) ? code : 1, output };
    } catch {
      return { running: true, output };
    }
  }

  private startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, SWEEP_MS);
    this.sweeper.unref?.();
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [key, rec] of this.containers.entries()) {
      if (now - rec.lastUsedAt < IDLE_STOP_MS) continue;
      this.containers.delete(key);
      await this.remove(rec.name);
    }
  }

  private async remove(name: string): Promise<void> {
    await podman(['stop', '-t', '2', name], { timeoutMs: 30_000 });
    await podman(['rm', '-f', name], { timeoutMs: 30_000 });
    log.info(`[LocalHarness] container sandbox removed name=${name}`);
  }

  async shutdown(): Promise<void> {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
    const names = [...this.containers.values()].map((r) => r.name);
    this.containers.clear();
    await Promise.all(names.map((n) => this.remove(n)));
  }
}

export const containerSandbox = new ContainerSandbox();
