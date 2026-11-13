/**
 * SandboxAdapter — host plug-in for sandboxed code execution.
 *
 * The SDK defines this contract; the host implements it (E2B, self-hosted
 * Docker, Modal, …). The framework imports no execution backend — exactly like
 * {@link StorageAdapter}, this is a blessed seam, not a baked-in dependency.
 *
 * Consumers: the built-in `run_code` agent tool today (via {@link SandboxSession}
 * on the tool execution context), and — because it's a generic primitive, not an
 * LLM-only affordance — a deterministic sandboxed `CODE` step later. Lives next
 * to {@link StorageAdapter} in `RuntimeOptions`.
 */

import type { StorageScope } from '../storage/types.js';

/** Opaque handle to a live sandbox instance. Shape is backend-defined. */
export interface SandboxHandle {
  readonly id: string;
}

export interface SandboxExecOptions {
  /** Per-call wall-clock timeout in ms. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** A file produced inside the sandbox, collected from the output dir. */
export interface SandboxArtifact {
  /** Path inside the sandbox, e.g. "/mnt/output/report.pdf". */
  path: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  /** Set for `bash` (process exit code); `exec` reports failures via `error`. */
  exitCode?: number;
  /** Structured error when the executed code raised. */
  error?: { name: string; value: string; traceback?: string };
  /** Files newly written to the output dir during this call. */
  artifacts: SandboxArtifact[];
  durationMs: number;
}

export interface SandboxFileUpload {
  /** Destination path inside the sandbox, e.g. "/mnt/files/contract.pdf". */
  path: string;
  bytes: Uint8Array;
}

/**
 * Host plug-in for code execution. Handle-based so one backend instance can
 * manage many concurrent sandboxes.
 */
export interface SandboxAdapter {
  /** Boot a fresh, isolated sandbox. `scope` lets the host route per-tenant. */
  create(opts?: { scope?: StorageScope; signal?: AbortSignal }): Promise<SandboxHandle>;
  /** Run code (Python by default for the reference image). */
  exec(handle: SandboxHandle, code: string, opts?: SandboxExecOptions): Promise<SandboxExecResult>;
  /** Run a shell command. */
  bash(handle: SandboxHandle, command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult>;
  /** Upload files into the sandbox filesystem. */
  writeFiles(handle: SandboxHandle, files: SandboxFileUpload[]): Promise<void>;
  /** Read a file's bytes back out of the sandbox. */
  readFile(handle: SandboxHandle, path: string): Promise<Uint8Array>;
  /** Tear the sandbox down. Callers must invoke this (e.g. in `finally`). */
  destroy(handle: SandboxHandle): Promise<void>;
}

/**
 * A handle-bound convenience view of a {@link SandboxAdapter}, passed to tools
 * via the tool execution context. The owning step creates one per execution
 * (create → mount inputs → … → destroy in `finally`), so tools just call
 * `exec`/`bash` without juggling the handle or lifecycle.
 */
export interface SandboxSession {
  exec(code: string, opts?: SandboxExecOptions): Promise<SandboxExecResult>;
  bash(command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult>;
  writeFiles(files: SandboxFileUpload[]): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
}

/** Bind an adapter + handle into a {@link SandboxSession}. */
export function bindSandboxSession(
  adapter: SandboxAdapter,
  handle: SandboxHandle,
): SandboxSession {
  return {
    exec: (code, opts) => adapter.exec(handle, code, opts),
    bash: (command, opts) => adapter.bash(handle, command, opts),
    writeFiles: (files) => adapter.writeFiles(handle, files),
    readFile: (path) => adapter.readFile(handle, path),
  };
}
