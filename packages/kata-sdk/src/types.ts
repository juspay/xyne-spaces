import type { CustomObjectsApi } from "@kubernetes/client-node";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface FileEntry {
  name: string;
  size: number;
  type: "file" | "directory";
  modTime: number;
}

export interface JobStatus {
  done: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** The claim a git scope is requested for, fixed before the claim is created. */
export interface GitScopeClaim {
  claimName: string;
  namespace: string;
  template: string;
  /** The claim's spec.lifecycle.shutdownTime, in whole seconds. */
  endTime: Date;
}

export interface CreateSessionOptions {
  template?: string;
  namespace?: string;
  timeoutMs?: number;
  readyTimeoutMs?: number;
  idleTimeoutMs?: number;
  /**
   * Returns the signed git scope for this claim. Called once, after the claim
   * name and end time are fixed and before the claim is created; the result is
   * put on the claim as the `xyne.ai/git-scope` annotation. If it throws, no
   * claim is created and the error propagates. Omit for a claim without a list.
   */
  gitScope?: (claim: GitScopeClaim) => Promise<string>;
}

export interface KataClientOptions {
  routerUrl: string;
  namespace?: string;
  template?: string;
  /**
   * Minimum spacing between successive `createSession` calls on this client
   * instance, in milliseconds. Each SandboxClaim triggers a CoW clone off the
   * template's source VolumeSnapshot; GCP enforces a per-source-snapshot
   * `CreateVolume` rate limit and every retry counts. Spacing calls out ~10s
   * apart keeps well under that budget under bursty callers. Set 0 to
   * disable. Default: 10_000 (10s).
   */
  minCreateSpacingMs?: number;
  k8sClient?: CustomObjectsApi;
}

export interface SessionConstructorOptions {
  sandboxId: string;
  claimName: string;
  namespace: string;
  routerUrl: string;
  k8sClient: CustomObjectsApi;
  idleTimeoutMs?: number;
}

export interface SandboxRequestHeaders {
  "X-Sandbox-ID": string;
  "X-Sandbox-Namespace": string;
  "X-Sandbox-Port": string;
}
