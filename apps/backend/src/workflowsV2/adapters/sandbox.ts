/**
 * `SandboxAdapter` for `@xyne/workflow-sdk`, backed by the Kata microVM sandboxes
 * (`@xyne/kata-sdk`) that xyne-claw already uses.
 *
 * Without an adapter the SDK fails closed: the CODE step throws "no code-execution
 * sandbox is configured" and the `run_code` agent tool returns "Code execution is not
 * available". The SDK only ships the contract (its docs talk about E2B / Docker / Modal);
 * the host decides the backend. This is the Kata one.
 *
 * Lifecycle, as the SDK drives it:
 *   CODE step  → create → writeFiles(/tmp/…cjs) → bash(`node …`) → destroy
 *   run_code   → create → writeFiles(/mnt/files/…) → exec(python) | bash … → destroy
 * Each `create` claims a fresh VM (a SandboxClaim), so nothing — files, processes, env —
 * survives from one tenant's step to another's.
 *
 * Why the dynamic import: `@xyne/kata-sdk` ships TypeScript source (`exports: ./src/index.ts`)
 * and has no build. A static (or even type-only) import pulls those files into this
 * package's `tsc` program, which moves the common source root and relocates `dist/` —
 * `dist/worker.js` would become `dist/apps/backend/src/worker.js`. Loading it at runtime
 * through `tsx` (which both `start` and `start:worker` already use) avoids that, and the
 * small structural types below pin the surface this file relies on.
 */
import { randomUUID } from 'crypto';
import type {
  SandboxAdapter,
  SandboxArtifact,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileUpload,
  SandboxHandle,
  StorageScope,
} from '@xyne/workflow-sdk';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

// ── The slice of @xyne/kata-sdk this adapter uses ────────────────────────────────────────

interface KataExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface KataSession {
  readonly id: string;
  readonly claimName: string;
  readonly commands: { run(cmd: string, timeoutMs?: number): Promise<KataExecResult> };
  readonly files: {
    write(path: string, content: string | Buffer): Promise<void>;
    read(path: string): Promise<Buffer>;
  };
  waitUntilReady(timeoutMs?: number): Promise<void>;
  destroy(): Promise<void>;
}

interface KataClientLike {
  createSession(options?: {
    timeoutMs?: number;
    readyTimeoutMs?: number;
    idleTimeoutMs?: number;
  }): Promise<KataSession>;
}

interface KataSdkModule {
  KataClient: new (options: {
    routerUrl: string;
    namespace?: string;
    template?: string;
    minCreateSpacingMs?: number;
  }) => KataClientLike;
}

/** Kept in a variable so `tsc` does not resolve it — see the file header. */
const KATA_SDK_SPECIFIER = '@xyne/kata-sdk';

// ── Paths and limits ─────────────────────────────────────────────────────────────────────

/** Where the SDK's `run_code` tool reads uploads from and tells the model to write outputs. */
const INPUT_DIR = '/mnt/files';
const OUTPUT_DIR = '/mnt/output';
/**
 * The in-VM agent (claw-deployments/kata-infra/agent-workspace/src/main.ts) confines `/write`
 * and `/read` to its workspace root, and the kata-sdk strips leading slashes — so writing
 * `/tmp/x.cjs` through it silently lands at `<workspace>/tmp/x.cjs`. Every transfer is staged
 * here (a path relative to the workspace root) and moved into place with a shell command.
 */
const STAGING_DIR = '.xyne-sandbox-io';
/** Upper bound on artifacts collected per call, so a runaway loop cannot flood storage. */
const MAX_ARTIFACTS = 20;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
/** Exit code of coreutils `timeout` when it had to kill the command. */
const TIMEOUT_EXIT_CODE = 124;
/** Slack for the HTTP round-trip on top of the in-VM `timeout`. */
const TRANSPORT_GRACE_MS = 15_000;

const MIME_BY_EXT: Record<string, string> = {
  csv: 'text/csv',
  html: 'text/html',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

const mimeTypeFor = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
};

/** POSIX single-quote a value for `bash -c`. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Sandbox call aborted');
  }
};

/** Reject as soon as `signal` fires, without waiting for the in-flight HTTP call. */
const withAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void =>
      reject(signal.reason instanceof Error ? signal.reason : new Error('Sandbox call aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
};

export interface KataSandboxOptions {
  routerUrl: string;
  namespace: string;
  template: string;
  /** Hard lifetime of a claim; the controller deletes it after this even if we never do. */
  sessionTtlMs: number;
  readyTimeoutMs: number;
  /** Used when the SDK does not pass `timeoutMs` (e.g. `run_code`). */
  defaultExecTimeoutMs: number;
}

export class KataSandboxAdapter implements SandboxAdapter {
  private clientPromise: Promise<KataClientLike> | null = null;
  /** Live sessions in this process, by handle id. A handle never crosses processes. */
  private readonly sessions = new Map<string, KataSession>();

  constructor(private readonly opts: KataSandboxOptions) {}

  /**
   * One client per process: `KataClient` serialises claim creation (`minCreateSpacingMs`)
   * to stay under the GCP snapshot-clone rate limit, and that only works if every caller
   * shares the same instance.
   */
  private client(): Promise<KataClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = (import(KATA_SDK_SPECIFIER) as Promise<KataSdkModule>)
        .then(
          ({ KataClient }) =>
            new KataClient({
              routerUrl: this.opts.routerUrl,
              namespace: this.opts.namespace,
              template: this.opts.template,
            }),
        )
        .catch((err: unknown) => {
          this.clientPromise = null;
          throw err;
        });
    }
    return this.clientPromise;
  }

  private session(handle: SandboxHandle): KataSession {
    const session = this.sessions.get(handle.id);
    if (!session) throw new Error(`Unknown or destroyed sandbox handle: ${handle.id}`);
    return session;
  }

  async create(opts?: { scope?: StorageScope; signal?: AbortSignal }): Promise<SandboxHandle> {
    throwIfAborted(opts?.signal);
    const startedAt = Date.now();
    const client = await this.client();
    const session = await withAbort(
      client.createSession({
        timeoutMs: this.opts.sessionTtlMs,
        readyTimeoutMs: this.opts.readyTimeoutMs,
        idleTimeoutMs: this.opts.sessionTtlMs,
      }),
      opts?.signal,
    );
    try {
      // The Sandbox reports Ready before the in-VM agent always answers; probe it.
      await withAbort(session.waitUntilReady(this.opts.readyTimeoutMs), opts?.signal);
    } catch (err) {
      await session.destroy().catch(() => undefined);
      throw err;
    }
    // The image runs as uid 1000 without sudo, so these exist only if the template's image
    // pre-creates them writable. Missing dirs only affect `run_code` file I/O, not CODE steps.
    const dirs = await session.commands
      .run(`mkdir -p ${STAGING_DIR} ${INPUT_DIR} ${OUTPUT_DIR} 2>&1`, 15_000)
      .catch((err: unknown) => ({ exitCode: 1, stdout: String(err), stderr: '' }));
    if (dirs.exitCode !== 0) {
      logger.warn(
        `[workflows][sandbox] ${session.id}: cannot create ${INPUT_DIR}/${OUTPUT_DIR} (${dirs.stdout.trim()}); ` +
          'run_code file uploads/outputs need a template image with these dirs writable by uid 1000',
      );
    }
    const id = randomUUID();
    this.sessions.set(id, session);
    logger.info(
      `[workflows][sandbox] created ${session.id} (claim ${session.claimName}) for handle ${id} in ${String(Date.now() - startedAt)}ms`,
    );
    return { id };
  }

  /** The SDK's `exec` is "run this program" — Python, per the `run_code` tool contract. */
  async exec(
    handle: SandboxHandle,
    code: string,
    opts?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const session = this.session(handle);
    // Staging path is relative to the workspace root, which is also /execute's cwd.
    const scriptPath = `${STAGING_DIR}/exec-${randomUUID()}.py`;
    await session.files.write(scriptPath, code);
    const result = await this.run(
      session,
      `python3 ${shellQuote(scriptPath)}; rc=$?; rm -f ${shellQuote(scriptPath)}; exit $rc`,
      opts,
    );
    if (result.exitCode !== undefined && result.exitCode !== 0 && !result.error) {
      const lastLine = result.stderr.trim().split('\n').pop() ?? '';
      const match = /^(\w+(?:Error|Exception|Exit|Interrupt))(?::\s*(.*))?$/.exec(lastLine);
      result.error = {
        name: match?.[1] ?? 'ExecutionError',
        value: match?.[2] ?? (lastLine || `exited with code ${String(result.exitCode)}`),
        traceback: result.stderr,
      };
    }
    return result;
  }

  async bash(
    handle: SandboxHandle,
    command: string,
    opts?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    return this.run(this.session(handle), command, opts);
  }

  async writeFiles(handle: SandboxHandle, files: SandboxFileUpload[]): Promise<void> {
    const session = this.session(handle);
    for (const file of files) {
      const staged = `${STAGING_DIR}/in-${randomUUID()}`;
      await session.files.write(staged, Buffer.from(file.bytes));
      const res = await session.commands.run(
        `mkdir -p "$(dirname ${shellQuote(file.path)})" && mv -f ${shellQuote(staged)} ${shellQuote(file.path)}`,
        30_000,
      );
      if (res.exitCode !== 0) {
        await session.commands.run(`rm -f ${shellQuote(staged)}`, 15_000).catch(() => undefined);
        throw new Error(`Sandbox could not write ${file.path}: ${res.stderr.trim() || res.stdout.trim()}`);
      }
    }
  }

  async readFile(handle: SandboxHandle, path: string): Promise<Uint8Array> {
    return this.readFrom(this.session(handle), path);
  }

  /** Copy `path` into staging, read it through the agent, and clean up. */
  private async readFrom(session: KataSession, path: string): Promise<Uint8Array> {
    const staged = `${STAGING_DIR}/out-${randomUUID()}`;
    const cp = await session.commands.run(
      `cp -f ${shellQuote(path)} ${shellQuote(staged)}`,
      30_000,
    );
    if (cp.exitCode !== 0) {
      throw new Error(`Sandbox could not read ${path}: ${cp.stderr.trim() || cp.stdout.trim()}`);
    }
    try {
      return new Uint8Array(await session.files.read(staged));
    } finally {
      await session.commands.run(`rm -f ${shellQuote(staged)}`, 15_000).catch(() => undefined);
    }
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const session = this.sessions.get(handle.id);
    if (!session) return;
    this.sessions.delete(handle.id);
    await session.destroy();
    logger.info(`[workflows][sandbox] destroyed ${session.id} (handle ${handle.id})`);
  }

  /**
   * Run `command` under coreutils `timeout`, so the deadline is enforced inside the VM and
   * not only on our side of the HTTP call (the agent's `/execute` has no timeout of its own).
   */
  private async run(
    session: KataSession,
    command: string,
    opts?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const timeoutMs = opts?.timeoutMs ?? this.opts.defaultExecTimeoutMs;
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const wrapped = `timeout -k 5 ${String(seconds)} bash -c ${shellQuote(command)}`;
    const startedAt = Date.now();
    const res = await withAbort(
      session.commands.run(wrapped, timeoutMs + TRANSPORT_GRACE_MS),
      opts?.signal,
    );
    const durationMs = Date.now() - startedAt;
    const result: SandboxExecResult = {
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
      artifacts: await this.collectArtifacts(session),
      durationMs,
    };
    if (res.exitCode === TIMEOUT_EXIT_CODE) {
      result.error = {
        name: 'TimeoutError',
        value: `Command timed out after ${String(timeoutMs)}ms`,
      };
    }
    return result;
  }

  /**
   * Files the program left in {@link OUTPUT_DIR}. Best-effort: a missing directory (the CODE
   * step never creates one) or an unreadable file yields fewer artifacts, never a failure.
   */
  private async collectArtifacts(session: KataSession): Promise<SandboxArtifact[]> {
    let listing: KataExecResult;
    try {
      listing = await session.commands.run(
        `[ -d ${OUTPUT_DIR} ] && find ${OUTPUT_DIR} -maxdepth 1 -type f -size -${String(
          MAX_ARTIFACT_BYTES,
        )}c -print 2>/dev/null | head -n ${String(MAX_ARTIFACTS)} || true`,
        15_000,
      );
    } catch {
      return [];
    }
    const paths = listing.stdout.split('\n').map((p) => p.trim()).filter(Boolean);
    const artifacts: SandboxArtifact[] = [];
    for (const path of paths) {
      try {
        const bytes = await this.readFrom(session, path);
        artifacts.push({ path, bytes, mimeType: mimeTypeFor(path) });
      } catch (err) {
        logger.warn(
          `[workflows][sandbox] could not read artifact ${path}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return artifacts;
  }
}

/**
 * The adapter for this deployment, or `undefined` when code execution is off — in which
 * case the SDK keeps failing closed exactly as before.
 */
export const createWorkflowSandboxAdapter = (): SandboxAdapter | undefined => {
  const sandbox = config.workflows.sandbox;
  if (sandbox.backend !== 'kata') {
    logger.info('[workflows] code sandbox disabled — CODE steps and run_code will fail closed');
    return undefined;
  }
  logger.info(
    `[workflows] code sandbox: kata (router ${sandbox.kata.routerUrl}, namespace ${sandbox.kata.namespace}, template ${sandbox.kata.template})`,
  );
  return new KataSandboxAdapter({
    routerUrl: sandbox.kata.routerUrl,
    namespace: sandbox.kata.namespace,
    template: sandbox.kata.template,
    sessionTtlMs: sandbox.sessionTtlMs,
    readyTimeoutMs: sandbox.readyTimeoutMs,
    defaultExecTimeoutMs: sandbox.execTimeoutMs,
  });
};
