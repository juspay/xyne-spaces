/**
 * `SandboxAdapter` for `@xyne/workflow-sdk`, over the Kata/QEMU microVM sandbox
 * fleet (`@xyne/kata-sdk` → the in-cluster `sandbox-router`, backed by
 * `SandboxClaim`/`Sandbox` CRDs in the `xyne-apps` namespace).
 *
 * This is the sibling of {@link WorkflowStorageAdapter}: the SDK defines the
 * seam, the host implements it, and the framework imports no execution backend.
 * The runtime threads it into every step's execution context, where the
 * built-in `run_code` agent tool (and, later, a deterministic `CODE` step)
 * reach for it via a handle-bound `SandboxSession`.
 *
 * ── Impedance notes (kata ↔ the SDK contract) ────────────────────────────────
 *  - The contract is stateless and handle-based (one adapter → many concurrent
 *    sandboxes, each addressed by an opaque `{ id }`). `KataClient.createSession`
 *    hands back a stateful `Session`, so this adapter keeps the live objects in a
 *    registry keyed by the handle id — the same pattern xyne-claw's session store
 *    uses.
 *  - kata only runs shell (`/execute`). `bash` maps 1:1; `exec` (Python by
 *    default in the SDK's reference image) has no native equivalent, so it writes
 *    the code to a temp file and runs the interpreter, reporting a raise through
 *    the structured `error` field rather than an exit code.
 *  - kata has no artifact/output-dir concept, so `artifacts` is always `[]`.
 *    `run_code` still works; it just won't auto-collect produced files. Closing
 *    that means listing a conventional output dir via the filesystem module after
 *    each call and reading the bytes back.
 *
 * ── Operational reality ──────────────────────────────────────────────────────
 * Cold start is slow (repo templates prebake minutes) and `createSession`
 * self-throttles to one `SandboxClaim` per ~10s (a GCP per-source-snapshot
 * CreateVolume rate limit). The SDK's `SandboxSession` lifecycle is
 * create → … → destroy per step, so a hot `CODE`/`run_code` path pays full
 * cold-start each run and can serialize under burst. Add session reuse here if
 * that becomes a problem.
 */
import { randomUUID } from 'crypto';
import type {
  SandboxAdapter,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileUpload,
  SandboxHandle,
  StorageScope,
} from '@xyne/workflow-sdk';
import { KataClient, type Session } from '@xyne/kata-sdk';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

/** Default per-call wall-clock timeout when a caller doesn't set one. */
const DEFAULT_TIMEOUT_MS = 60_000;

export class KataSandboxAdapter implements SandboxAdapter {
  private readonly client: KataClient;

  /**
   * Live `Session` objects, keyed by the opaque handle id we hand back to the
   * SDK. The contract is handle-based; kata's `Session` is stateful, so the
   * adapter owns the mapping between the two.
   */
  private readonly sessions = new Map<string, Session>();

  constructor() {
    this.client = new KataClient({
      routerUrl: config.kata.routerUrl,
      namespace: config.kata.namespace,
      template: config.kata.template,
    });
  }

  /**
   * Boot a fresh, isolated sandbox and wait until it is serving.
   *
   * `scope` is accepted for parity with {@link StorageScope} routing; today the
   * whole fleet shares one namespace/template, so it is only logged. Route per
   * tenant here (namespace/template off `scope`) when that becomes a
   * requirement.
   */
  async create(opts?: { scope?: StorageScope; signal?: AbortSignal }): Promise<SandboxHandle> {
    opts?.signal?.throwIfAborted();
    const session = await this.client.createSession();
    await session.waitUntilReady();
    this.sessions.set(session.id, session);
    logger.info(`[WORKFLOWS-SANDBOX] created sandbox ${session.id}`);
    return { id: session.id };
  }

  /**
   * Run code. kata has no code executor, so write it to a temp file and run the
   * interpreter — this sidesteps all shell-quoting hazards of inlining code.
   * A non-zero exit is reported through `error` (the contract's channel for a
   * raised exception), not `exitCode`.
   */
  async exec(
    handle: SandboxHandle,
    code: string,
    opts?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const session = this.require(handle);
    const started = Date.now();
    const scriptPath = `/tmp/wf-exec-${randomUUID()}.py`;
    await session.files.write(scriptPath, Buffer.from(code, 'utf8'));
    try {
      const r = await session.commands.run(
        `python3 ${scriptPath}`,
        opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      const result: SandboxExecResult = {
        stdout: r.stdout,
        stderr: r.stderr,
        artifacts: [],
        durationMs: Date.now() - started,
      };
      if (r.exitCode !== 0) {
        result.error = { name: 'ExecError', value: r.stderr.trim(), traceback: r.stderr };
      }
      return result;
    } finally {
      // Best-effort cleanup; the sandbox is ephemeral and destroyed per step,
      // so a failed rm must never surface as the step's error.
      await session.commands.run(`rm -f ${scriptPath}`).catch(() => undefined);
    }
  }

  /** Run a shell command. Maps 1:1 onto the kata commands module. */
  async bash(
    handle: SandboxHandle,
    command: string,
    opts?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const session = this.require(handle);
    const started = Date.now();
    const r = await session.commands.run(command, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      artifacts: [],
      durationMs: Date.now() - started,
    };
  }

  /** Upload files into the sandbox filesystem. */
  async writeFiles(handle: SandboxHandle, files: SandboxFileUpload[]): Promise<void> {
    const session = this.require(handle);
    for (const file of files) {
      await session.files.write(file.path, Buffer.from(file.bytes));
    }
  }

  /** Read a file's bytes back out of the sandbox. */
  async readFile(handle: SandboxHandle, path: string): Promise<Uint8Array> {
    const buffer = await this.require(handle).files.read(path);
    return new Uint8Array(buffer);
  }

  /**
   * Tear the sandbox down. Idempotent: an unknown handle is a no-op, so a
   * caller's `finally` never throws over a double-destroy or a lost session.
   */
  async destroy(handle: SandboxHandle): Promise<void> {
    const session = this.sessions.get(handle.id);
    if (!session) return;
    this.sessions.delete(handle.id);
    await session.destroy();
    logger.info(`[WORKFLOWS-SANDBOX] destroyed sandbox ${handle.id}`);
  }

  private require(handle: SandboxHandle): Session {
    const session = this.sessions.get(handle.id);
    if (!session) {
      throw new Error(`workflows sandbox: unknown handle ${JSON.stringify(handle.id)}`);
    }
    return session;
  }
}
