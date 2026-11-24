/**
 * {@link SandboxAdapter} for `@xyne/workflow-sdk` — gives workflow v2 (the CODE step, and the
 * `run_code` agent/chat tool) an isolated place to run code.
 *
 * The backend has no access to the Kata sandbox cluster: every run goes to xyne-claw-auth
 * (`/claw/api/v1/internal/workflow-sandbox/run`, INTERNAL_S2S_KEY), which forwards it to xyne-claw,
 * which runs it in a fresh sandbox and destroys it before answering.
 *
 * So one `exec`/`bash` = one sandbox. The SDK's handle-based calls map onto that:
 *  - `create` makes a local handle; no sandbox exists yet.
 *  - `writeFiles` keeps the files on the handle; they are sent with every run on it.
 *  - `exec`/`bash` run once with those files; output files come back in the result.
 *  - `readFile` serves a file from the last run's outputs, or one written with `writeFiles`.
 *  - `destroy` drops the handle.
 * Nothing on the sandbox's filesystem survives from one run to the next; files passed through
 * `writeFiles` are re-sent each time.
 *
 * Enabled with ENABLE_WORKFLOWS_SANDBOX=true; needs XYNE_CLAW_AUTH_URL and INTERNAL_S2S_KEY.
 */
import { randomUUID } from 'crypto';
import { Agent, fetch as undiciFetch } from 'undici';
import type {
  SandboxAdapter,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileUpload,
  SandboxHandle,
} from '@xyne/workflow-sdk';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

const RUN_PATH = '/claw/api/v1/internal/workflow-sandbox/run';
/** Matches claw's default when the step gives none. */
const DEFAULT_RUN_TIMEOUT_MS = 30_000;
/** Past the run's own timeout: sandbox start-up (no warm pool), transfers, and claw-auth's own slack. */
const OVERHEAD_MS = 6 * 60 * 1000;

/**
 * The response only starts when the run ends, so undici's default 300s header/body timeouts would
 * cut long runs short; each call's AbortSignal bounds it instead. Direct (no env proxy): claw-auth
 * is in-cluster.
 */
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 10_000 });

interface RunResponse {
  success: boolean;
  /** A string when the request failed; the code's structured error when it ran and raised. */
  error?: string | { name: string; value: string; traceback?: string };
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  artifacts: { path: string; mimeType: string; content: string }[];
  skippedArtifacts?: { path: string; size: number }[];
}

interface HandleState {
  files: Map<string, Uint8Array>;
  outputs: Map<string, Uint8Array>;
}

class ClawSandboxAdapter implements SandboxAdapter {
  private readonly url: string;
  private readonly handles = new Map<string, HandleState>();

  constructor(
    clawAuthUrl: string,
    private readonly s2sKey: string,
  ) {
    this.url = `${clawAuthUrl.replace(/\/+$/, '')}${RUN_PATH}`;
  }

  create(): Promise<SandboxHandle> {
    const id = randomUUID();
    this.handles.set(id, { files: new Map(), outputs: new Map() });
    return Promise.resolve({ id });
  }

  exec(handle: SandboxHandle, code: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
    return this.run(handle, 'python', code, opts);
  }

  bash(handle: SandboxHandle, command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
    return this.run(handle, 'bash', command, opts);
  }

  writeFiles(handle: SandboxHandle, files: SandboxFileUpload[]): Promise<void> {
    const state = this.state(handle);
    for (const f of files) state.files.set(f.path, f.bytes);
    return Promise.resolve();
  }

  readFile(handle: SandboxHandle, path: string): Promise<Uint8Array> {
    const state = this.state(handle);
    const bytes = state.outputs.get(path) ?? state.files.get(path);
    if (!bytes) {
      return Promise.reject(
        new Error(`workflow sandbox: ${path} is not available (each run uses a fresh sandbox; only output files and written files can be read)`),
      );
    }
    return Promise.resolve(bytes);
  }

  destroy(handle: SandboxHandle): Promise<void> {
    this.handles.delete(handle.id);
    return Promise.resolve();
  }

  private state(handle: SandboxHandle): HandleState {
    const state = this.handles.get(handle.id);
    if (!state) throw new Error(`workflow sandbox: unknown or destroyed handle ${handle.id}`);
    return state;
  }

  private async run(
    handle: SandboxHandle,
    language: 'python' | 'bash',
    source: string,
    opts?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const state = this.state(handle);
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs + OVERHEAD_MS);

    const res = await undiciFetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-s2s-key': this.s2sKey },
      body: JSON.stringify({
        language,
        source,
        timeoutMs,
        files: [...state.files].map(([path, bytes]) => ({ path, content: Buffer.from(bytes).toString('base64') })),
      }),
      signal: opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      dispatcher,
    });
    const text = await res.text();
    let body: RunResponse;
    try {
      body = JSON.parse(text) as RunResponse;
    } catch {
      throw new Error(`workflow sandbox: HTTP ${String(res.status)} ${text.slice(0, 200)}`);
    }
    if (!res.ok || body.success !== true) {
      const reason = typeof body.error === 'string' ? body.error : `HTTP ${String(res.status)}`;
      throw new Error(`workflow sandbox: ${reason}`);
    }

    if (body.skippedArtifacts?.length) {
      logger.warn(
        `[workflows] sandbox: ${String(body.skippedArtifacts.length)} output file(s) too large to return: ${body.skippedArtifacts.map((a) => a.path).join(', ')}`,
      );
    }
    const artifacts = body.artifacts.map((a) => ({
      path: a.path,
      mimeType: a.mimeType,
      bytes: new Uint8Array(Buffer.from(a.content, 'base64')),
    }));
    state.outputs = new Map(artifacts.map((a) => [a.path, a.bytes]));

    return {
      stdout: body.stdout,
      stderr: body.stderr,
      exitCode: body.exitCode,
      durationMs: body.durationMs,
      ...(typeof body.error === 'object' ? { error: body.error } : {}),
      artifacts,
    };
  }
}

/**
 * Build the workflow sandbox from config, or `undefined` when none is configured (the CODE step
 * then fails closed and `run_code` is not offered).
 */
export const createWorkflowSandboxAdapter = (): SandboxAdapter | undefined => {
  if (!config.workflows.sandboxEnabled) {
    logger.info('[workflows] code-execution sandbox off (ENABLE_WORKFLOWS_SANDBOX) — CODE steps unavailable');
    return undefined;
  }
  const url = config.xyneClaw.authUrl;
  const key = config.internalS2sKey;
  if (!url || !key) {
    logger.warn(
      '[workflows] ENABLE_WORKFLOWS_SANDBOX is on but XYNE_CLAW_AUTH_URL or INTERNAL_S2S_KEY is not set — CODE steps unavailable',
    );
    return undefined;
  }
  logger.info('[workflows] code-execution sandbox: Kata, through xyne-claw-auth → xyne-claw (one sandbox per run)');
  return new ClawSandboxAdapter(url, key);
};
