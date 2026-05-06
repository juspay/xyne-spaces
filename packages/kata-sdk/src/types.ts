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

export interface CreateSessionOptions {
  template?: string;
  namespace?: string;
  timeoutMs?: number;
  readyTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface KataClientOptions {
  routerUrl: string;
  namespace?: string;
  template?: string;
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
