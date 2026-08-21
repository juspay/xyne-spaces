import { randomBytes } from "node:crypto";
import { CustomObjectsApi, KubeConfig } from "@kubernetes/client-node";
import { Session } from "./session.js";
import type { CreateSessionOptions, ExecResult, KataClientOptions } from "./types.js";

const GROUP = "extensions.agents.x-k8s.io";
const SANDBOXES_GROUP = "agents.x-k8s.io";
const VERSION = "v1alpha1";
const SANDBOX_CLAIMS_PLURAL = "sandboxclaims";
const SANDBOXES_PLURAL = "sandboxes";
const DEFAULT_NAMESPACE = "xyne-apps";
const DEFAULT_TEMPLATE = "kata-workspace-template";
const DEFAULT_SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_READY_TIMEOUT_MS = 120 * 1000;
const ONE_SHOT_SESSION_TIMEOUT_MS = 60 * 1000;
// Minimum spacing between SandboxClaim creations on one client instance.
// SandboxClaims CoW-clone off the template's source VolumeSnapshot; GCP
// throttles per-source-snapshot CreateVolume ops, so bursts trip a
// self-sustaining retry loop. 10s spacing keeps callers under the budget.
const DEFAULT_MIN_CREATE_SPACING_MS = 10_000;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedString(value: unknown, keys: string[]): string | undefined {
  let current: unknown = value;

  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return typeof current === "string" ? current : undefined;
}

function isSandboxReady(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const status = body["status"];
  if (!isRecord(status)) return false;
  const conditions = status["conditions"];
  if (!Array.isArray(conditions)) return false;
  return conditions.some(
    (c) => isRecord(c) && c["type"] === "Ready" && c["status"] === "True",
  );
}

function randomHex(length: number): string {
  return randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function createKubeClient(): CustomObjectsApi {
  const config = new KubeConfig();

  // loadFromDefault supports both execution modes: it reads KUBECONFIG or
  // ~/.kube/config for local development, and falls back to the mounted
  // service-account credentials when running inside Kubernetes (it calls
  // loadFromCluster itself once it sees the service-account token file).
  // Calling loadFromCluster first and catching does not work: it only records
  // the token/CA file *paths* without reading them and always sets a current
  // context, so off-cluster it cannot throw, the catch never runs, and we end
  // up with a client aimed at https://undefined:undefined that only fails on
  // the first API request.
  config.loadFromDefault();

  return config.makeApiClient(CustomObjectsApi);
}

export class KataClient {
  private readonly routerUrl: string;
  private readonly namespace: string;
  private readonly template: string;
  private readonly k8sClient: CustomObjectsApi;
  private readonly minCreateSpacingMs: number;
  // Wall-clock time (ms since epoch) at which the NEXT createSession call
  // is allowed to actually issue its CreateNamespacedCustomObject. Each
  // caller advances the marker atomically so concurrent bursts serialize
  // into a 10s-spaced queue instead of all racing to hit GCP at once.
  private nextCreateAllowedTime = Date.now();

  constructor(options: KataClientOptions) {
    this.routerUrl = options.routerUrl.replace(/\/$/, "");
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE;
    this.template = options.template ?? DEFAULT_TEMPLATE;
    this.minCreateSpacingMs =
      options.minCreateSpacingMs ?? DEFAULT_MIN_CREATE_SPACING_MS;
    this.k8sClient = createKubeClient();
  }

  private async claimCreateSlot(): Promise<void> {
    if (this.minCreateSpacingMs <= 0) return;
    const now = Date.now();
    const startAt = Math.max(now, this.nextCreateAllowedTime);
    // Reserve the slot BEFORE awaiting; concurrent callers get sequential
    // slots even if they enter this method at the same tick.
    this.nextCreateAllowedTime = startAt + this.minCreateSpacingMs;
    const waitMs = startAt - now;
    if (waitMs > 0) await sleep(waitMs);
  }

  async createSession(options: CreateSessionOptions = {}): Promise<Session> {
    const namespace = options.namespace ?? this.namespace;
    const template = options.template ?? this.template;
    const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const claimName = `kata-claim-${randomHex(8)}`;

    await this.claimCreateSlot();

    await this.k8sClient.createNamespacedCustomObject(
      GROUP,
      VERSION,
      namespace,
      SANDBOX_CLAIMS_PLURAL,
      {
        apiVersion: `${GROUP}/${VERSION}`,
        kind: "SandboxClaim",
        metadata: {
          name: claimName,
          namespace,
        },
        spec: {
          sandboxTemplateRef: {
            name: template,
          },
          lifecycle: {
            shutdownPolicy: "Delete",
            shutdownTime: new Date(Date.now() + timeoutMs).toISOString(),
          },
        },
      },
    );

    const sandboxName = await this.waitForSandboxAssignment(claimName, namespace, readyTimeoutMs);
    await this.waitForSandboxRunning(sandboxName, namespace, readyTimeoutMs);

    return new Session({
      sandboxId: sandboxName,
      claimName,
      namespace,
      routerUrl: this.routerUrl,
      k8sClient: this.k8sClient,
      ...(options.idleTimeoutMs !== undefined && { idleTimeoutMs: options.idleTimeoutMs }),
    });
  }

  async exec(cmd: string, options: CreateSessionOptions = {}): Promise<ExecResult> {
    const session = await this.createSession({
      ...options,
      timeoutMs: ONE_SHOT_SESSION_TIMEOUT_MS,
    });

    try {
      await session.waitUntilReady(options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
      return await session.commands.run(cmd, options.timeoutMs ?? ONE_SHOT_SESSION_TIMEOUT_MS);
    } finally {
      await session.destroy();
    }
  }

  private async waitForSandboxAssignment(claimName: string, namespace: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await this.k8sClient.getNamespacedCustomObject(
        GROUP,
        VERSION,
        namespace,
        SANDBOX_CLAIMS_PLURAL,
        claimName,
      );
      const sandboxName = getNestedString(response.body, ["status", "sandbox", "name"]);

      if (sandboxName) {
        return sandboxName;
      }

      await sleep(1_000);
    }

    throw new Error(`Timed out waiting for SandboxClaim ${claimName} to bind to a sandbox.`);
  }

  private async waitForSandboxRunning(sandboxName: string, namespace: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await this.k8sClient.getNamespacedCustomObject(
        SANDBOXES_GROUP,
        VERSION,
        namespace,
        SANDBOXES_PLURAL,
        sandboxName,
      );
      if (isSandboxReady(response.body)) {
        return;
      }

      await sleep(1_000);
    }

    throw new Error(`Timed out waiting for sandbox ${sandboxName} to reach Running phase.`);
  }
}
