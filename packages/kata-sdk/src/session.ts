import type { CustomObjectsApi } from "@kubernetes/client-node";
import { CommandsModule } from "./commands.js";
import { FilesystemModule } from "./filesystem.js";
import type { SandboxRequestHeaders, SessionConstructorOptions } from "./types.js";

const SANDBOX_CLAIMS_GROUP = "extensions.agents.x-k8s.io";
const SANDBOX_CLAIMS_VERSION = "v1alpha1";
const SANDBOX_CLAIMS_PLURAL = "sandboxclaims";
const SANDBOX_PORT = 8888;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class Session {
  readonly id: string;
  readonly claimName: string;
  readonly namespace: string;
  readonly commands: CommandsModule;
  readonly files: FilesystemModule;

  private readonly routerUrl: string;
  private readonly k8sClient: CustomObjectsApi;
  private destroyed = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeoutMs: number;
  private readonly exitHandler: () => void;

  constructor(options: SessionConstructorOptions) {
    this.id = options.sandboxId;
    this.claimName = options.claimName;
    this.namespace = options.namespace;
    this.routerUrl = options.routerUrl.replace(/\/$/, "");
    this.k8sClient = options.k8sClient;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.commands = new CommandsModule(this);
    this.files = new FilesystemModule(this);

    this.exitHandler = () => { void this.destroy(); };
    process.once("SIGTERM", this.exitHandler);
    process.once("SIGINT", this.exitHandler);
    // Do NOT register uncaughtException/unhandledRejection handlers.
    // Node doesn't actually terminate on those by default, but registering
    // a one-shot here means *any unrelated rejection in the host process*
    // (e.g. a failing git fetch in worktree setup) triggers destroy() on
    // every live Session — which DELETEs the underlying SandboxClaim via
    // K8s API. That caused the ~5-min claim-churn cycle that matched the
    // worktree git-fetch retry deadline. Fail-loud is fine; cleanup
    // happens via SIGTERM (pod shutdown) and the SandboxClaim's own
    // shutdownTime / idle timer.

    this.resetIdleTimer();
  }

  async waitUntilReady(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const response = await this.request("/", { method: "GET" });
        if (response.ok) {
          return;
        }
      } catch {
      }

      await sleep(1_000);
    }

    throw new Error(`Timed out waiting for sandbox ${this.id} to become ready.`);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.clearIdleTimer();
    process.off("SIGTERM", this.exitHandler);
    process.off("SIGINT", this.exitHandler);
    process.off("uncaughtException", this.exitHandler);
    process.off("unhandledRejection", this.exitHandler);

    await this.k8sClient.deleteNamespacedCustomObject(
      SANDBOX_CLAIMS_GROUP,
      SANDBOX_CLAIMS_VERSION,
      this.namespace,
      SANDBOX_CLAIMS_PLURAL,
      this.claimName,
    );
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.destroy();
  }

  sandboxHeaders(): SandboxRequestHeaders {
    return {
      "X-Sandbox-ID": this.id,
      "X-Sandbox-Namespace": this.namespace,
      "X-Sandbox-Port": String(SANDBOX_PORT),
    };
  }

  async request(pathname: string, init: RequestInit): Promise<Response> {
    this.resetIdleTimer();

    const headers = new Headers(init.headers);
    const sandboxHeaders = this.sandboxHeaders();
    headers.set("X-Sandbox-ID", sandboxHeaders["X-Sandbox-ID"]);
    headers.set("X-Sandbox-Namespace", sandboxHeaders["X-Sandbox-Namespace"]);
    headers.set("X-Sandbox-Port", sandboxHeaders["X-Sandbox-Port"]);

    const response = await fetch(`${this.routerUrl}${pathname}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const message = await this.readErrorMessage(response);
      throw new Error(message);
    }

    return response;
  }

  async requestJson<T>(pathname: string, init: RequestInit): Promise<T> {
    const response = await this.request(pathname, init);
    return (await response.json()) as T;
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => { void this.destroy(); }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async readErrorMessage(response: Response): Promise<string> {
    const text = await response.text();

    try {
      const payload = JSON.parse(text) as unknown;
      if (isRecord(payload)) {
        const message = payload["message"];
        if (typeof message === "string" && message.length > 0) {
          return message;
        }
      }
    } catch {
    }

    if (text.length > 0) {
      return text;
    }

    return `Sandbox router request failed with status ${response.status}.`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
