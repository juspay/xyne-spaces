/**
 * `SandboxAdapter` for `@xyne/workflow-sdk`, over an HTTP sandbox service at `SANDBOX_URL`
 * (locally, the xyne-sandbox service: one throwaway Docker container per sandbox).
 *
 * The CODE step and the agent's `run_code` tool call it: create → write files → run → destroy.
 */
import type {
  SandboxAdapter,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileUpload,
  SandboxHandle,
} from '@xyne/workflow-sdk';

type RunResult = Omit<SandboxExecResult, 'artifacts'>;

export class HttpSandboxAdapter implements SandboxAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async create(opts?: { signal?: AbortSignal }): Promise<SandboxHandle> {
    const { id } = await this.request<{ id: string }>('POST', '/sandboxes', {}, opts?.signal);
    return { id };
  }

  async exec(handle: SandboxHandle, code: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
    const result = await this.request<RunResult>(
      'POST',
      `/sandboxes/${handle.id}/exec`,
      { code, timeoutMs: opts?.timeoutMs },
      opts?.signal,
    );
    return { ...result, artifacts: [] };
  }

  async bash(handle: SandboxHandle, command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
    const result = await this.request<RunResult>(
      'POST',
      `/sandboxes/${handle.id}/bash`,
      { command, timeoutMs: opts?.timeoutMs },
      opts?.signal,
    );
    return { ...result, artifacts: [] };
  }

  async writeFiles(handle: SandboxHandle, files: SandboxFileUpload[]): Promise<void> {
    await this.request('PUT', `/sandboxes/${handle.id}/files`, {
      files: files.map((file) => ({ path: file.path, base64: Buffer.from(file.bytes).toString('base64') })),
    });
  }

  async readFile(handle: SandboxHandle, path: string): Promise<Uint8Array> {
    const { base64 } = await this.request<{ base64: string }>(
      'GET',
      `/sandboxes/${handle.id}/files?path=${encodeURIComponent(path)}`,
    );
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    await this.request('DELETE', `/sandboxes/${handle.id}`);
  }

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Sandbox ${method} ${path} failed (${response.status}): ${detail}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}
