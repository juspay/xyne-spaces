/**
 * Code execution for the Spaces backend's workflow v2 (CODE step, run_code), shared by xyne-claw
 * (which runs it: it alone holds the sandbox cluster's access) and xyne-claw-auth (which validates
 * and forwards the backend's request to claw).
 *
 *   backend → claw-auth /claw/api/v1/internal/workflow-sandbox/run → claw /internal/workflow-sandbox/run
 *           → runWorkflowSandbox() → kata-sdk runOnce(): fresh sandbox, run, collect, destroy
 *
 * One sandbox per request, destroyed before the response: nothing outlives a call, and a caller
 * can never name an existing sandbox.
 */
import { randomBytes } from "node:crypto";
import { KataClient, runOnce, type RunOnceFile } from "@xyne/kata-sdk";

/** Inputs are written here; the code runs with these in place. */
const OUTPUT_DIR = "/mnt/output";
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_FILES = 50;
/** Decoded bytes across all input files; keeps the JSON body under the 50mb limits on both hops. */
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_SOURCE_BYTES = 1024 * 1024;

export type WorkflowSandboxLanguage = "python" | "bash";

/** What the backend sends. File contents are base64. */
export interface WorkflowSandboxRunRequest {
  language: WorkflowSandboxLanguage;
  /** Python source, or a bash script. */
  source: string;
  files?: { path: string; content: string }[];
  timeoutMs?: number;
}

export interface WorkflowSandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** Python raised, or the run timed out. */
  error?: { name: string; value: string; traceback: string };
  /** Files new or changed under /mnt/output. Content is base64. */
  artifacts: { path: string; mimeType: string; content: string }[];
  /** Output files left out because of the size limits. */
  skippedArtifacts: { path: string; size: number }[];
}

export class WorkflowSandboxRequestError extends Error {}

/** Check and normalise a request body; throws WorkflowSandboxRequestError with a caller-facing message. */
export function parseWorkflowSandboxRunRequest(body: unknown): WorkflowSandboxRunRequest {
  if (typeof body !== "object" || body === null) throw new WorkflowSandboxRequestError("body must be an object");
  const b = body as Record<string, unknown>;

  const language = b["language"];
  if (language !== "python" && language !== "bash") {
    throw new WorkflowSandboxRequestError('language must be "python" or "bash"');
  }
  const source = b["source"];
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new WorkflowSandboxRequestError("source must be a non-empty string");
  }
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new WorkflowSandboxRequestError("source is too large");

  const rawFiles = b["files"] ?? [];
  if (!Array.isArray(rawFiles)) throw new WorkflowSandboxRequestError("files must be an array");
  if (rawFiles.length > MAX_FILES) throw new WorkflowSandboxRequestError(`at most ${String(MAX_FILES)} files`);
  let inputBytes = 0;
  const files = rawFiles.map((f, i) => {
    const path = (f as Record<string, unknown> | null)?.["path"];
    const content = (f as Record<string, unknown> | null)?.["content"];
    if (typeof path !== "string" || !path.startsWith("/") || path.split("/").includes("..")) {
      throw new WorkflowSandboxRequestError(`files[${String(i)}].path must be an absolute path without ".."`);
    }
    if (typeof content !== "string") throw new WorkflowSandboxRequestError(`files[${String(i)}].content must be base64`);
    inputBytes += Math.floor((content.length * 3) / 4);
    return { path, content };
  });
  if (inputBytes > MAX_INPUT_BYTES) throw new WorkflowSandboxRequestError("files are too large in total");

  const t = b["timeoutMs"];
  if (t !== undefined && (typeof t !== "number" || !Number.isFinite(t) || t <= 0)) {
    throw new WorkflowSandboxRequestError("timeoutMs must be a positive number");
  }

  return {
    language,
    source,
    files,
    ...(typeof t === "number" ? { timeoutMs: Math.min(Math.max(t, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS) } : {}),
  };
}

export interface WorkflowSandboxConfig {
  routerUrl: string;
  namespace: string;
  template: string;
  readyTimeoutMs: number;
}

/** From env (claw's KATA_ROUTER_URL / KATA_NAMESPACE, plus WORKFLOWS_SANDBOX_TEMPLATE); undefined when incomplete. */
export function workflowSandboxConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkflowSandboxConfig | undefined {
  const template = env["WORKFLOWS_SANDBOX_TEMPLATE"]?.trim();
  const routerUrl = env["KATA_ROUTER_URL"]?.trim();
  const namespace = env["KATA_NAMESPACE"]?.trim();
  if (!template || !routerUrl || !namespace) return undefined;
  const ready = Number(env["WORKFLOWS_SANDBOX_READY_TIMEOUT_MS"]);
  return { routerUrl, namespace, template, readyTimeoutMs: ready > 0 ? ready : 120_000 };
}

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const mimeFromPath = (path: string): string => {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 && EXT_TO_MIME[path.slice(dot).toLowerCase()]) || "application/octet-stream";
};

/**
 * Run one request in a fresh sandbox. Pass a client built with `minCreateSpacingMs: 0`; reuse it
 * across calls (it holds the Kubernetes connection).
 */
export async function runWorkflowSandbox(
  client: KataClient,
  cfg: WorkflowSandboxConfig,
  req: WorkflowSandboxRunRequest,
): Promise<WorkflowSandboxRunResult> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The source travels as a file: no shell-quoting of author- or model-written code.
  const script = `/tmp/xyne-run-${randomBytes(6).toString("hex")}.${req.language === "python" ? "py" : "sh"}`;
  const files: RunOnceFile[] = [
    ...(req.files ?? []).map((f) => ({ path: f.path, content: Buffer.from(f.content, "base64") })),
    { path: script, content: req.source },
  ];

  const r = await runOnce(client, {
    command: req.language === "python" ? `python3 ${script}` : `bash -l ${script}`,
    files,
    timeoutMs,
    outputDir: OUTPUT_DIR,
    template: cfg.template,
    namespace: cfg.namespace,
    readyTimeoutMs: cfg.readyTimeoutMs,
  });

  const result: WorkflowSandboxRunResult = {
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.exitCode,
    durationMs: r.durationMs,
    artifacts: r.outputFiles.map((f) => ({
      path: f.path,
      mimeType: mimeFromPath(f.path),
      content: f.content.toString("base64"),
    })),
    skippedArtifacts: r.skippedOutputFiles,
  };
  if (r.timedOut) {
    result.error = { name: "Timeout", value: `command exceeded ${String(timeoutMs)}ms`, traceback: "" };
  } else if (req.language === "python" && r.exitCode !== 0) {
    // The workflow SDK reports python failures through `error`, not the exit code.
    const lines = r.stderr.trimEnd().split("\n");
    const last = lines[lines.length - 1] ?? "error";
    const m = /^([A-Za-z_.]*(?:Error|Exception|Warning))\b:?\s*(.*)$/.exec(last);
    result.error = { name: m?.[1] ?? "PythonError", value: m?.[2] ?? last, traceback: r.stderr };
  }
  return result;
}

/** A KataClient for workflow sandboxes: no create spacing (the template clones no snapshot). */
export function createWorkflowSandboxClient(cfg: WorkflowSandboxConfig): KataClient {
  return new KataClient({
    routerUrl: cfg.routerUrl,
    namespace: cfg.namespace,
    template: cfg.template,
    minCreateSpacingMs: 0,
  });
}
