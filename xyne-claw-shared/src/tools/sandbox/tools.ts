import { KataClient } from "@xyne/kata-sdk";
import type { Session } from "@xyne/kata-sdk";
import type { ToolDefinition } from "../types.js";
import { redactSecrets, redactAndStringify } from "./redact.js";

const SESSION_STORE = new Map<string, Session>();

// When was a session first stored? Used to give freshly-created sessions
// a grace period during which we DON'T treat probe failures as "dead".
// A new pod can take 5-8 min to finish its prebake (clone + npm ci × 3
// + nix build) before port 8888 opens. During that window, every probe
// sees "could not connect to backend sandbox" — a transient state, not
// session death. Without a grace period, every sandbox-repo-setup call
// during prebake evicts the cache and creates a NEW claim, causing
// runaway claim-creation storms.
const SESSION_CREATED_AT = new Map<string, number>();

// Template name the session was created with. Used by sandbox-repo-setup
// on reuse to confirm the cached session is the right template type.
// Without this we fall back to a fragile substring-on-session-id check
// (cached.id.includes("agent-workspace") || ...) which fails for new
// templates like hyperswitch-workspace-template — kata-claim-* IDs don't
// encode the template name, so the check evicts perfectly good sessions
// and spawns duplicate claims.
const SESSION_TEMPLATE = new Map<string, string>();
// Sessions younger than this are considered "still warming up" — probe
// failures during this window get retried/ignored instead of triggering
// eviction. Matches the SandboxTemplate's prebake budget (~8 min).
const SESSION_FRESH_WINDOW_MS = 8 * 60 * 1000;

const STALE_PATTERNS = [
  /could not connect to the backend sandbox/i,
  /HTTP request failed/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /socket hang up/i,
  /sandbox(?:claim)?.*not found/i,
];

function isStaleSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return STALE_PATTERNS.some((re) => re.test(msg));
}

function rememberSession(storeKey: string | undefined, session: Session, template?: string): void {
  if (storeKey) SESSION_STORE.set(storeKey, session);
  SESSION_STORE.set(session.id, session);
  const now = Date.now();
  if (storeKey) SESSION_CREATED_AT.set(storeKey, now);
  SESSION_CREATED_AT.set(session.id, now);
  if (template) {
    if (storeKey) SESSION_TEMPLATE.set(storeKey, template);
    SESSION_TEMPLATE.set(session.id, template);
  }
}

function isFreshSession(session: Session, storeKey?: string): boolean {
  const t = (storeKey ? SESSION_CREATED_AT.get(storeKey) : undefined) ??
            SESSION_CREATED_AT.get(session.id);
  if (!t) return false;
  return Date.now() - t < SESSION_FRESH_WINDOW_MS;
}

function evictSession(session: Session, storeKey?: string): void {
  if (storeKey) {
    SESSION_STORE.delete(storeKey);
    SESSION_CREATED_AT.delete(storeKey);
    SESSION_TEMPLATE.delete(storeKey);
  }
  SESSION_STORE.delete(session.id);
  SESSION_CREATED_AT.delete(session.id);
  SESSION_TEMPLATE.delete(session.id);
  for (const [k, v] of SESSION_STORE.entries()) {
    if (v === session) {
      SESSION_STORE.delete(k);
      SESSION_CREATED_AT.delete(k);
      SESSION_TEMPLATE.delete(k);
    }
  }
}

// Probe a session for liveness. Two safeguards against false-positive
// "dead" verdicts that cause claim-creation storms:
//   1. If the session is fresh (< SESSION_FRESH_WINDOW_MS old), skip the
//      probe entirely and assume alive — the pod is still warming up.
//   2. Otherwise retry up to 3× with exponential backoff before
//      declaring dead. A single transient sandbox-router blip or
//      network glitch shouldn't trigger eviction.
async function probeSession(session: Session, storeKey?: string): Promise<boolean> {
  if (isFreshSession(session, storeKey)) return true;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await session.commands.run("true", 5_000);
      return true;
    } catch (err) {
      lastErr = err;
      if (!isStaleSessionError(err)) return true;          // non-stale error: don't evict
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
  // 3 stale errors in a row; treat as dead.
  return false;
}

export function getSandboxSession(storeKey: string): Session | undefined {
  return SESSION_STORE.get(storeKey);
}

export { probeSession };

export interface HealthCheck {
  cmd: string;
  // "all-healthy" — every line of `cmd`'s stdout starts with "Up" or
  //   contains "healthy" (docker ps style; legacy kata path).
  // "all-up"      — `cmd` outputs the literal string "all-up" on stdout
  //   when ports are bound; otherwise prints `MISSING:<port>` lines
  //   (Nix process-compose path; agent-workspace).
  successCondition: "all-healthy" | "all-up";
  intervalMs: number;
  timeoutMs: number;
}

export type SetupStep =
  | { type: "install"; packages: string[]; cmd?: string }
  // services/devserver: if `markerPath` is set and the file exists in the
  // sandbox, the launch is skipped (the prebake already started this).
  // healthCheck still runs so the caller knows the dependency is ready.
  | { type: "services"; cmd: string; healthCheck?: HealthCheck; markerPath?: string }
  | { type: "devserver"; name: string; cmd: string; cwd: string; markerPath?: string }
  | { type: "run"; label: string; cmd: string; cwd?: string; timeoutMs?: number };

// Auxiliary repos baked into a sandbox template alongside the primary
// repo. Each entry's branch is independently overridable at claim time
// via the tool's `auxBranches` input. Currently used by the hyperswitch
// template (primary: hyperswitch; aux: prism, control-center, web).
export interface AuxRepo {
  name: string;          // stable key the agent references (e.g. "prism")
  url: string;           // origin URL (for reference; clones live in the image)
  defaultBranch: string;
  workDir: string;       // path inside the pod
}

export interface RepoSetupConfig {
  slug: string;
  name: string;
  description: string;
  repoUrl: string;
  defaultBranch: string;
  cloneDepth?: number;
  workDir: string;
  template: string;
  sessionTimeoutMs?: number;
  idleTimeoutMs?: number;
  readyTimeoutMs?: number;
  steps: SetupStep[];
  ports?: Record<string, number>;
  // When the template bakes multiple repos, list the auxiliary ones here.
  // The tool input schema then gains `auxBranches: Record<name, branch>`
  // letting the agent override branches on these repos at claim time.
  auxRepos?: AuxRepo[];
}

export const SANDBOX_CONFIG_SCHEMA = {
  KATA_ROUTER_URL: {
    label: "Kata Router URL",
    default: "",
    required: true as const,
    placeholder: "http://sandbox-router-svc.xyne-apps.svc.cluster.local:8080",
  },
  KATA_NAMESPACE: {
    label: "Kata Namespace",
    default: "xyne-apps",
    required: true as const,
    placeholder: "xyne-apps",
  },
  KATA_TEMPLATE: {
    label: "Kata Sandbox Template",
    default: "kata-workspace-template",
    required: false as const,
    placeholder: "kata-workspace-template",
  },
};

function makeClient(config: Record<string, string>): KataClient {
  const routerUrl = config["KATA_ROUTER_URL"];
  if (!routerUrl) throw new Error("KATA_ROUTER_URL is required");
  return new KataClient({
    routerUrl,
    namespace: config["KATA_NAMESPACE"] || "xyne-apps",
    template: config["KATA_TEMPLATE"] || "kata-workspace-template",
  });
}

/**
 * Create a persistent sandbox session. Returns a sessionId for follow-up tool calls.
 */
export const sandboxCreate: ToolDefinition = {
  slug: "sandbox-create",
  name: "Sandbox Create Session",
  description:
    "Create a persistent isolated Kata/QEMU microVM sandbox session for multi-step workflows. " +
    "Provides clean, isolated environment for development tasks. Returns sessionId. " +
    "Use sandbox-run / sandbox-run-detached to execute commands, sandbox-write-file to upload files, " +
    "and sandbox-destroy when done.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      timeoutMs: {
        type: "number",
        description: "Session lifetime in milliseconds before auto-destruction (default: 3600000 = 1 hour)",
      },
      idleTimeoutMs: {
        type: "number",
        description: "Idle timeout in milliseconds — session auto-destroys after this much inactivity (default: 600000 = 10 min)",
      },
      template: {
        type: "string",
        description: "Sandbox template name to use (default: kata-workspace-template from agent config).",
      },
    },
    required: [],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const conversationId = context.meta?.["conversationId"];
    if (!conversationId) return "Error: No conversationId in context.";
    const agentSlug = context.meta?.["agentSlug"] ?? "";
    const storeKey = agentSlug ? `${conversationId}_${agentSlug}` : conversationId;
    const timeoutMs = (params["timeoutMs"] as number | undefined) ?? 60 * 60 * 1000;
    const idleTimeoutMs = (params["idleTimeoutMs"] as number | undefined) ?? 10 * 60 * 1000;
    const template = params["template"] as string | undefined;

    const existing = SESSION_STORE.get(storeKey);
    if (existing) {
      const alive = await probeSession(existing, storeKey);
      if (alive) {
        return JSON.stringify({ sessionId: existing.id, status: "ready", reused: true });
      }
      evictSession(existing, storeKey);
    }

    try {
      const client = makeClient(context.config);
      const session = await client.createSession({ timeoutMs, idleTimeoutMs, ...(template ? { template } : {}) });
      rememberSession(storeKey, session, template);
      return JSON.stringify({ sessionId: session.id, status: "ready" });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Run a command in a sandbox. Auto-detects session or runs one-shot.
 */
export const sandboxRun: ToolDefinition = {
  slug: "sandbox-run",
  name: "Sandbox Run Command",
  description: 
    "**PREFERRED**: Run shell commands in an isolated Kata/QEMU microVM sandbox. " +
    "Use this instead of bash for better isolation, safety, and clean environment. " +
    "Ideal for git clone, npm install, build processes, file operations, and any command execution. " +
    "Auto-detects existing sessions or creates fresh sandboxes as needed.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Optional session ID. If omitted, auto-resolves from conversation context or runs one-shot.",
      },
      cmd: {
        type: "string",
        description: "Shell command to execute",
      },
      timeoutMs: {
        type: "number",
        description: "Command timeout in milliseconds (default: 60000)",
      },
    },
    required: ["cmd"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const cmd = (params["cmd"] ?? params["command"]) as string;
    const timeoutMs = (params["timeoutMs"] as number | undefined) ?? 60_000;
    if (!cmd?.trim()) return "Error: cmd or command is required.";

    // Try explicit sessionId first
    const explicitSessionId = params["sessionId"] as string | undefined;
    if (explicitSessionId) {
      const session = SESSION_STORE.get(explicitSessionId);
      if (!session) return `Error: Session ${explicitSessionId} not found.`;

      try {
        const result = await session.commands.run(cmd, timeoutMs);
        return redactAndStringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
      } catch (err) {
        if (isStaleSessionError(err)) {
          evictSession(session);
          return `Error: Session ${explicitSessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (/aborted due to timeout|operation was aborted/i.test(msg)) {
          return `Error: Tool call timed out (sandbox-router may be slow). The VM is likely still alive — retry the same sandbox-run, or call sandbox-repo-setup which will reuse the existing session. DO NOT attempt to destroy the session.`;
        }
        return `Error: ${msg}`;
      }
    }

    // Try auto-resolve from conversation context
    const conversationId = context.meta?.["conversationId"];
    const agentSlug = context.meta?.["agentSlug"] ?? "";
    if (conversationId) {
      const storeKey = agentSlug ? `${conversationId}_${agentSlug}` : conversationId;
      const session = SESSION_STORE.get(storeKey);
      if (session) {
        try {
          const result = await session.commands.run(cmd, timeoutMs);
          return redactAndStringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
        } catch (err) {
          if (isStaleSessionError(err)) {
            evictSession(session, storeKey);
            return `Error: Sandbox session for this conversation died (pod replaced). Call sandbox-repo-setup to re-provision.`;
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (/aborted due to timeout|operation was aborted/i.test(msg)) {
            return `Error: Tool call timed out (sandbox-router may be slow). The VM is likely still alive — retry the same sandbox-run, or call sandbox-repo-setup which will reuse the existing session. DO NOT attempt to destroy the session.`;
          }
          return `Error: ${msg}`;
        }
      }
    }

    // No session found — fall back to one-shot
    try {
      const client = makeClient(context.config);
      const result = await client.exec(cmd, { timeoutMs });
      return redactAndStringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Fire-and-forget: run a command in the background, returns a jobId to poll.
 */
export const sandboxRunDetached: ToolDefinition = {
  slug: "sandbox-run-detached",
  name: "Sandbox Run Detached",
  description:
    "Start a long-running command in the background inside a sandbox session. " +
    "Returns immediately with a jobId. Use sandbox-poll-job to check completion.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      cmd: {
        type: "string",
        description: "Shell command to run in the background",
      },
    },
    required: ["sessionId", "cmd"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const cmd = (params["cmd"] ?? params["command"]) as string;

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found. Create one with sandbox-create first.`;

    try {
      const jobId = await session.commands.runDetached(cmd);
      return JSON.stringify({ jobId });
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Poll the status of a detached background job.
 */
export const sandboxPollJob: ToolDefinition = {
  slug: "sandbox-poll-job",
  name: "Sandbox Poll Job",
  description: "Check the status of a background job started with sandbox-run-detached. Returns done/stdout/stderr/exitCode.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      jobId: {
        type: "string",
        description: "Job ID returned by sandbox-run-detached",
      },
    },
    required: ["sessionId", "jobId"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const jobId = params["jobId"] as string;

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;

    try {
      const status = await session.commands.pollJob(jobId);
      // status shape varies by job state; redact across whatever string fields
      // it carries (stdout/stderr typically).
      return redactAndStringify(status as unknown as Record<string, unknown>);
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Write a file into the sandbox.
 */
export const sandboxWriteFile: ToolDefinition = {
  slug: "sandbox-write-file",
  name: "Sandbox Write File",
  description: "Write a file into an existing sandbox session. Creates parent directories as needed.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      path: {
        type: "string",
        description: "Absolute path inside the sandbox (e.g. /workspace/script.py)",
      },
      content: {
        type: "string",
        description: "File content as a UTF-8 string for text files, or base64-encoded string for binary files",
      },
      encoding: {
        type: "string",
        enum: ["utf8", "base64"],
        description: "Encoding of content. Use 'base64' for binary files, 'utf8' (default) for text.",
      },
    },
    required: ["sessionId", "path", "content"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const path = params["path"] as string;
    const content = params["content"] as string;
    const encoding = (params["encoding"] as string | undefined) ?? "utf8";

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;

    try {
      const buf = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
      await session.files.write(path, buf);
      return JSON.stringify({ path, written: true });
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const BINARY_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf", zip: "application/zip",
};

/**
 * Read a file from the sandbox.
 *
 * Text files: return the content inline.
 * Binary files: return as `[INSPECT:...]` — visible to the agent for
 * self-verification, but NOT delivered to the user. To send a file to the
 * user, use `sandbox-deliver-files`.
 */
export const sandboxReadFile: ToolDefinition = {
  slug: "sandbox-read-file",
  name: "Sandbox Read File",
  description:
    "Read a file from a sandbox session. " +
    "Text files are returned inline. Binary files (images, PDFs, etc.) are loaded into your context for self-inspection ONLY — the user does NOT see them. " +
    "If you want to actually send files to the user, call `sandbox-deliver-files` (it accepts multiple paths in one call).",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      path: {
        type: "string",
        description: "Absolute path inside the sandbox to read",
      },
    },
    required: ["sessionId", "path"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const path = params["path"] as string;

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;

    try {
      const buf = await session.files.read(path);
      const isText = !buf.slice(0, 512).some((b) => b === 0);
      if (isText) {
        // Redact known secret patterns in text-file reads. Catches the obvious
        // exfil paths (sandbox-read-file ~/.ssh/id_rsa, ~/.git-credentials,
        // ~/.npmrc, ~/.netrc, etc.) for the same reasons the sandbox-run
        // redactor exists — defence-in-depth against accidental / unsophisticated
        // leaks; ephemeral creds are the real fix against determined attackers.
        const content = redactSecrets(buf.toString("utf8"));
        return JSON.stringify({ path, content, encoding: "utf8" });
      }
      const fileName = path.split("/").pop() ?? "file";
      const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
      const mimeType = BINARY_MIME[ext] ?? "application/octet-stream";
      // INSPECT marker (not ATTACHMENT) — xyne-claw routes the bytes into the
      // agent's tool-result content for visual self-check but does NOT push
      // to user-facing attachments. This stops the "agent took 12 screenshots
      // for verification → user got 12" leak.
      return `[INSPECT:${fileName}:${mimeType}]\n${buf.toString("base64")}`;
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Deliver one or more files from the sandbox to the user as attachments.
 *
 * Use this AFTER inspecting candidates via `sandbox-read-file`. Pass the exact
 * subset of paths you want the user to receive. All files are delivered in a
 * single message attachment list.
 */
export const sandboxDeliverFiles: ToolDefinition = {
  slug: "sandbox-deliver-files",
  name: "Sandbox Deliver Files",
  description:
    "Send one or more files from the sandbox to the user as message attachments. " +
    "Pass the exact paths you want delivered. Use this after inspecting screenshots/PDFs via `sandbox-read-file` to send the relevant subset — the user does NOT see anything you only `sandbox-read-file`.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Absolute paths inside the sandbox to deliver as attachments. Order is preserved.",
        minItems: 1,
      },
    },
    required: ["sessionId", "paths"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const paths = params["paths"] as string[];
    if (!Array.isArray(paths) || paths.length === 0) {
      return "Error: paths must be a non-empty array of absolute file paths.";
    }

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;

    const blocks: string[] = [];
    const errors: string[] = [];
    for (const p of paths) {
      try {
        const buf = await session.files.read(p);
        const fileName = p.split("/").pop() ?? "file";
        const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
        const mimeType = BINARY_MIME[ext] ?? "application/octet-stream";
        blocks.push(`[ATTACHMENT:${fileName}:${mimeType}]\n${buf.toString("base64")}`);
      } catch (err) {
        if (isStaleSessionError(err)) {
          evictSession(session);
          return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
        }
        errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (blocks.length === 0) {
      return `Error: failed to read any of ${paths.length} file(s):\n${errors.join("\n")}`;
    }

    // Concatenate ATTACHMENT blocks. xyne-claw's custom-tools.ts scans for all
    // matches and emits one attachment per block. Trailing error notes are
    // appended for the agent's awareness without breaking the global match.
    const result = blocks.join("\n");
    if (errors.length > 0) {
      return `${result}\n\nNote: ${errors.length} file(s) failed:\n${errors.join("\n")}`;
    }
    return result;
  },
};

export function makeRepoSetupTool(config: RepoSetupConfig): ToolDefinition {
  // Build input schema. When the config has auxRepos, add an optional
  // auxBranches field so the agent can override branches on the bundled
  // repos independently of the primary branchName.
  const inputProperties: Record<string, unknown> = {
    branchName: {
      type: "string",
      description: `New branch name to cut (e.g. feat/my-feature). Cut from baseBranch, which defaults to ${config.defaultBranch}.`,
    },
    baseBranch: {
      type: "string",
      description: `Base branch to clone and cut from. Defaults to ${config.defaultBranch} when omitted.`,
    },
    sessionDurationMs: {
      type: "number",
      description: "Session lifetime in milliseconds (default: 3600000 = 1 hour)",
    },
  };
  if (config.auxRepos?.length) {
    const auxNames = config.auxRepos.map((r) => `${r.name} (default ${r.defaultBranch})`).join(", ");
    inputProperties["auxBranches"] = {
      type: "object",
      description:
        `Optional. Override branches for the auxiliary repos bundled in this template. ` +
        `Keys: ${auxNames}. Values: branch name to check out. Example: { "prism": "feat/foo" }. ` +
        `Omitted keys stay on their default branch.`,
      additionalProperties: { type: "string" },
    };
  }
  return {
    slug: config.slug,
    name: config.name,
    description: config.description,
    source: "custom:sandbox",
    configSchema: SANDBOX_CONFIG_SCHEMA,
    inputSchema: {
      type: "object",
      properties: inputProperties,
      required: ["branchName"],
    },

    async execute(params, context) {
      if (!context) return "Error: No execution context available.";
      const conversationId = context.meta?.["conversationId"];
      if (!conversationId) return "Error: No conversationId in context.";
      const agentSlug = context.meta?.["agentSlug"] ?? "";
      const storeKey = agentSlug ? `${conversationId}_${agentSlug}` : conversationId;

      const branchName = params["branchName"] as string;
      const baseBranch = (params["baseBranch"] as string | undefined) ?? config.defaultBranch;
      const sessionDurationMs = (params["sessionDurationMs"] as number | undefined) ?? (config.sessionTimeoutMs || 60 * 60 * 1000);
      const auxBranches = (params["auxBranches"] as Record<string, string> | undefined) ?? {};

      const log: string[] = [];

      // Fetch + checkout each auxiliary repo onto the requested branch
      // (or its default). Idempotent: if the branch is already current,
      // git fetch + checkout -B is a no-op on the worktree. Failures are
      // logged but don't abort setup — the image's baked default branch
      // is still usable.
      const checkoutAuxBranches = async (session: Session) => {
        if (!config.auxRepos?.length) return;
        for (const aux of config.auxRepos) {
          const branch = auxBranches[aux.name] ?? aux.defaultBranch;
          try {
            log.push(`Aux ${aux.name}: fetching ${branch}...`);
            const jobId = await session.commands.runDetached(
              `cd ${aux.workDir} && git fetch origin ${branch} && git checkout -B ${branch} FETCH_HEAD`,
            );
            const deadline = Date.now() + 60_000;
            let done = false;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 2_000));
              const status = await session.commands.pollJob(jobId);
              if (status.done) {
                done = true;
                if (status.exitCode !== null && status.exitCode !== 0) {
                  log.push(`Aux ${aux.name}: WARN ${branch} checkout failed (exit ${status.exitCode}); leaving on baked default.`);
                } else {
                  log.push(`Aux ${aux.name}: on ${branch}`);
                }
                break;
              }
            }
            if (!done) log.push(`Aux ${aux.name}: checkout still running after 60s; continuing.`);
          } catch (err) {
            log.push(`Aux ${aux.name}: WARN error — ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      };

      const cached = SESSION_STORE.get(storeKey);
      if (cached) {
        // Only reuse sessions that were created with THIS config's
        // template. Two reasons to skip reuse:
        //   1. Different template — e.g. session was a hyperswitch one
        //      but this call is for xyne-spaces. The repo layout and
        //      services are wrong; evict + create fresh.
        //   2. Bare-warmpool VM (template-less sandbox-create session)
        //      — no git creds, no Nix services, no prebaked node_modules.
        // SESSION_TEMPLATE is populated by sandbox-repo-setup at
        // rememberSession time. If absent (legacy session created
        // before this tracking landed), fall back to the old fragile
        // substring check.
        const cachedTemplate =
          SESSION_TEMPLATE.get(storeKey) ?? SESSION_TEMPLATE.get(cached.id);
        const isRepoTemplate = cachedTemplate
          ? cachedTemplate === config.template
          : cached.id.includes("agent-workspace") || cached.id.includes("docker-dev");
        if (isRepoTemplate && await probeSession(cached, storeKey)) {
          log.push(`Reusing existing sandbox session ${cached.id}`);
          try {
            // The pod prebakes a shallow clone of the default branch.
            // branchName might be:
            //   (a) an existing branch on origin (resume work on it), or
            //   (b) a brand-new branch to cut from baseBranch.
            // Try (a) first: `git fetch origin <branchName>` succeeds iff
            // the branch exists on remote → checkout from FETCH_HEAD.
            // Fall back to (b): fetch baseBranch + cut new branch from
            // its tip. `checkout -B` is idempotent on re-runs.
            const checkoutJob = await cached.commands.runDetached(
              `cd ${config.workDir} && ` +
              `(if git fetch origin ${branchName} 2>/dev/null; then ` +
              `git checkout -B ${branchName} FETCH_HEAD; else ` +
              `git fetch origin ${baseBranch} && git checkout -B ${baseBranch} FETCH_HEAD && git checkout -B ${branchName}; fi)`,
            );
            const deadline = Date.now() + 30_000;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 1_000));
              const status = await cached.commands.pollJob(checkoutJob);
              if (status.done) break;
            }
            log.push(`Checked out ${branchName} on existing session.`);
          } catch (err) {
            log.push(`Branch checkout failed: ${err instanceof Error ? err.message : String(err)} (continuing anyway)`);
          }
          // Re-run aux branch checkouts even on reuse: caller may have
          // passed a different auxBranches map this turn. Idempotent if
          // already on the requested branches.
          await checkoutAuxBranches(cached);
          return JSON.stringify({
            sessionId: cached.id,
            branch: branchName,
            reused: true,
            ports: config.ports || {},
            log,
          });
        }
        if (!isRepoTemplate) {
          log.push(`Cached session ${cached.id} is on the wrong template — discarding and creating a fresh repo-template VM.`);
        } else {
          log.push(`Cached session ${cached.id} is dead — recreating.`);
        }
        evictSession(cached, storeKey);
      }

      log.push("Creating sandbox session...");
      const client = makeClient(context.config);
      const session = await client.createSession({
        timeoutMs: sessionDurationMs,
        idleTimeoutMs: config.idleTimeoutMs || 60 * 60 * 1000,
        template: config.template,
        readyTimeoutMs: config.readyTimeoutMs || 10 * 60 * 1000,
      });
      rememberSession(storeKey, session, config.template);
      log.push(`Session created: ${session.id}`);

      const pollUntilDone = async (jobId: string, label: string, timeoutMs: number) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5_000));
          const status = await session.commands.pollJob(jobId);
          if (status.done) {
            if (status.exitCode !== null && status.exitCode !== 0) {
              throw new Error(`${label} failed (exit ${status.exitCode}): ${status.stderr}`);
            }
            log.push(`${label} done.`);
            return status;
          }
          log.push(`${label} still running...`);
        }
        throw new Error(`${label} timed out after ${timeoutMs / 1000}s`);
      };

      // Probe for a baked clone in the workspace image.
      //
      // Two flavors of "baked":
      //   1. Legacy agent-workspace image — clone is in the docker
      //      image at build time, so /workspace/<repo>/.git is present
      //      from second 0 of pod life. Probe succeeds immediately.
      //   2. Golden image + per-template prebake ConfigMap (hyperswitch
      //      and any future template) — repos are cloned at BOOT by
      //      prebake.sh. The :8888 workspace server opens before the
      //      prebake's clone finishes, so the probe could race and see
      //      "missing", which would fall through to the manual-clone
      //      else-branch below and skip the prebake-done wait entirely.
      //
      // To handle both, poll for the clone for up to 10 min. Legacy
      // templates hit it on the first probe; golden+prebake templates
      // hit it once the prebake's clone step lands (typically <60s).
      // If it really never appears (network failure on git clone), we
      // fall through to the manual-clone safety net as before.
      log.push("Waiting for baked clone to appear...");
      const cloneWaitDeadline = Date.now() + 10 * 60_000;
      let bakedCloneFound = false;
      while (Date.now() < cloneWaitDeadline) {
        try {
          const probe = await session.commands.run(
            `test -d ${config.workDir}/.git && echo present || echo missing`,
            5_000,
          );
          if ((probe.stdout ?? "").trim() === "present") {
            bakedCloneFound = true;
            break;
          }
        } catch {
          // transient — keep polling
        }
        await new Promise((r) => setTimeout(r, 5_000));
      }
      if (bakedCloneFound) {
        log.push("Baked clone present.");
      } else {
        log.push("Baked clone not found after 10 min — falling back to manual clone.");
      }

      if (bakedCloneFound) {
        // The prebake clones the default branch shallowly. branchName
        // might be (a) an existing remote branch (resume work) or (b)
        // a new branch to cut from baseBranch. Try (a); fall back to
        // (b). `checkout -B` is idempotent across re-runs.
        log.push(`Baked clone detected at ${config.workDir} — checking out ${branchName} (resume if exists, else cut from ${baseBranch}).`);
        // Discard any tree modifications left by the image build or the
        // in-flight boot-time prebake. The prebake runs `npm ci × 3` and
        // `nix build` in the background, and those can race ahead of this
        // checkout — `npm ci` regenerates package-lock.json on minor engine
        // drift, nix-build can stage shadow files inside the worktree, etc.
        // Without this reset, `git checkout -B` would refuse with
        // "Your local changes to the following files would be overwritten by
        // checkout" (observed on the doctor-agent daily-sync cron — the cron
        // always lands here because its scheduler uses a unique
        // conversationId per firing, so it never hits the reuse path).
        // Safe here because this fresh-VM branch only ever runs against a
        // brand-new sandbox whose tree mutations all come from automated
        // boot scripts — never user work. Interactive re-calls hit the
        // reuse path (above) which leaves the tree alone.
        const branchJobId = await session.commands.runDetached(
          `cd ${config.workDir} && ` +
          `git reset --hard HEAD 2>/dev/null; git clean -fd 2>/dev/null; ` +
          `(if git fetch origin ${branchName} 2>/dev/null; then ` +
          `git checkout -B ${branchName} FETCH_HEAD; else ` +
          `git fetch origin ${baseBranch} && git checkout -B ${baseBranch} FETCH_HEAD && git checkout -B ${branchName}; fi)`,
        );
        await pollUntilDone(branchJobId, `git fetch+checkout ${branchName}`, 60_000);

        // Prebake (entrypoint runs npm ci × 3 + nix build .#xyne-space-services
        // in the background) drops /tmp/prebake-done when it finishes. Wait
        // for that marker before starting services / dev servers — otherwise
        // a claim that lands mid-prebake can hit half-installed node_modules
        // and `npm run dev` fails with random missing-module errors.
        //
        // CRITICAL: poll with SHORT commands. The workspace server uses
        // execSync (agent-workspace/src/main.ts:117), which blocks the
        // Node.js event loop for the duration of the shell call. A single
        // 10-min `commands.run` would freeze ALL other HTTP requests on
        // 8888 → sandbox-router returns "internal error" / "Could not
        // connect to backend sandbox" → claw's STALE_PATTERNS fire →
        // claim eviction storm. Instead: 2-sec probes in a JS loop, with
        // sleep on the claw side, so the event loop stays unblocked.
        log.push("Waiting for prebake-done marker...");
        // 45-min budget covers the worst-case template cold-start
        // (hyperswitch's prebake gates prebake-done on services-up,
        // migrations-up, ucs-up, router-up — cargo cold build is
        // 25-35 min). xyne-spaces hits this marker within minutes;
        // the long ceiling only matters for slow templates.
        const prebakeDeadline = Date.now() + 45 * 60_000;
        let prebakeDone = false;
        while (Date.now() < prebakeDeadline) {
          try {
            const probe = await session.commands.run(
              `test -f /tmp/prebake-done && echo done || echo pending`,
              5_000,
            );
            if ((probe.stdout ?? "").trim() === "done") {
              prebakeDone = true;
              break;
            }
          } catch (err) {
            log.push(`prebake probe transient error (continuing): ${err instanceof Error ? err.message : String(err)}`);
          }
          await new Promise((r) => setTimeout(r, 5_000));
        }
        if (prebakeDone) {
          log.push("Prebake finished; proceeding to services + dev servers.");
        } else {
          log.push("Warning: prebake didn't finish in 10min — proceeding anyway, expect possible npm errors.");
        }
      } else {
        // Should never happen with the agent-workspace image (entrypoint
        // prebakes the clone), but kept as a safety net for older / bare
        // sandbox templates that haven't been migrated.
        const cloneCmd = `git clone ${config.cloneDepth ? `--depth ${config.cloneDepth}` : ""} --branch ${baseBranch} ${config.repoUrl} ${config.workDir}`;
        log.push(`No baked clone — cloning ${config.repoUrl} (${baseBranch})...`);
        const cloneJobId = await session.commands.runDetached(cloneCmd);
        await pollUntilDone(cloneJobId, "git clone", 5 * 60_000);
        log.push("Cutting branch: " + branchName);
        const branchJobId = await session.commands.runDetached(
          `cd ${config.workDir} && (git checkout ${branchName} 2>/dev/null || git checkout -b ${branchName})`,
        );
        await pollUntilDone(branchJobId, "git checkout", 30_000);
      }

      // Auxiliary repos: fetch + checkout user-overridable branches. The
      // prebake clones these alongside the primary; here we just refresh
      // them to the agent's requested branch. No-op when config has no
      // auxRepos (xyne-spaces and any other single-repo template).
      await checkoutAuxBranches(session);

      const jobIds: Record<string, string> = {};

      for (const step of config.steps) {
        switch (step.type) {
          case "install": {
            // With baked node_modules in the kata-workspace image, npm ci is
            // mostly a verify+sync. --prefer-offline hits the local cache first,
            // --no-audit/--no-fund skip two network round-trips. Falls back to
            // verdaccio (in-cluster) when needed.
            for (const pkg of step.packages) {
              log.push(`npm install: ${pkg}...`);
              const cmd = step.cmd || `cd ${config.workDir}/${pkg} && npm ci --prefer-offline --no-audit --no-fund --no-progress --loglevel=error`;
              const jobId = await session.commands.runDetached(cmd);
              await pollUntilDone(jobId, `npm ci ${pkg}`, 10 * 60_000);
            }
            break;
          }

          case "services": {
            // Skip the launch if the prebake already started services
            // (entrypoint.sh drops `step.markerPath` when ports are up).
            // Trying to launch twice would fail with "address already
            // in use" on postgres/redis/etc.
            let alreadyRunning = false;
            if (step.markerPath) {
              try {
                const probe = await session.commands.run(
                  `test -f ${step.markerPath} && echo present || echo missing`,
                  5_000,
                );
                alreadyRunning = (probe.stdout ?? "").trim() === "present";
              } catch { alreadyRunning = false; }
            }
            if (alreadyRunning) {
              log.push("Services already running (prebake) — skipping launch.");
            } else {
              log.push("Starting services...");
              const jobId = await session.commands.runDetached(step.cmd);
              jobIds.services = jobId;
            }
            
            if (step.healthCheck) {
              const deadline = Date.now() + step.healthCheck.timeoutMs;
              let servicesReady = false;
              
              while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, step.healthCheck!.intervalMs));
                const healthResult = await session.commands.run(step.healthCheck.cmd, 15_000);
                
                if (step.healthCheck.successCondition === "all-healthy") {
                  const lines = healthResult.stdout.trim().split("\n").filter(Boolean);
                  if (lines.length > 0 && lines.every((l) => l.startsWith("Up") || l.includes("healthy"))) {
                    servicesReady = true;
                    log.push(`All ${lines.length} service(s) healthy.`);
                    break;
                  }
                  log.push(`Waiting for services... (${lines.length} containers seen)`);
                } else if (step.healthCheck.successCondition === "all-up") {
                  // Probe-script reports `all-up` on stdout when every
                  // expected port is bound (Nix process-compose path; no
                  // docker). Anything else means we're still waiting —
                  // log MISSING:<port> lines if the probe printed any.
                  const out = healthResult.stdout.trim();
                  if (out === "all-up") {
                    servicesReady = true;
                    log.push("All services listening.");
                    break;
                  }
                  const missing = out.split("\n").filter((l) => l.startsWith("MISSING:"));
                  log.push(`Waiting for services... ${missing.length ? missing.join(" ") : "(no ports bound yet)"}`);
                }
              }
              
              if (!servicesReady) {
                log.push("Warning: services may not be fully ready yet, proceeding anyway.");
              }
            }
            break;
          }

          case "devserver": {
            // Same skip-if-marker-present logic as the services step.
            // Prebake's npm-run-dev would still hold port 3001/5173, so a
            // second `npm run dev` would EADDRINUSE.
            let alreadyRunning = false;
            if (step.markerPath) {
              try {
                const probe = await session.commands.run(
                  `test -f ${step.markerPath} && echo present || echo missing`,
                  5_000,
                );
                alreadyRunning = (probe.stdout ?? "").trim() === "present";
              } catch { alreadyRunning = false; }
            }
            if (alreadyRunning) {
              log.push(`${step.name} already running (prebake) — skipping launch.`);
            } else {
              log.push(`Starting ${step.name}...`);
              const jobId = await session.commands.runDetached(`cd ${step.cwd} && ${step.cmd}`);
              jobIds[step.name] = jobId;
            }
            break;
          }

          case "run": {
            log.push(`Running: ${step.label}...`);
            const cwd = step.cwd || config.workDir;
            const jobId = await session.commands.runDetached(`cd ${cwd} && ${step.cmd}`);
            await pollUntilDone(jobId, step.label, step.timeoutMs || 5 * 60_000);
            break;
          }
        }
      }

      log.push("Setup complete.");

      return JSON.stringify({
        sessionId: session.id,
        branch: branchName,
        ...jobIds,
        ports: config.ports || {},
        log,
      });
    },
  };
}

export const sandboxRepoSetup: ToolDefinition = {
  slug: "sandbox-repo-setup", 
  name: "Sandbox Repository Setup",
  description:
    "**PREFERRED**: Set up any repository development environment in an isolated Kata sandbox. " +
    "Specify the repo name to automatically clone, install dependencies, start services, and launch dev servers. " +
    "Returns sessionId for subsequent sandbox operations.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      repoName: {
        type: "string", 
        description: "Repository name (e.g. 'xyne-spaces', 'hyperswitch'). Must match a key in REPO_CONFIGS.",
      },
      branchName: {
        type: "string",
        description: "New branch name to create (e.g. 'feat/my-feature')",
      },
      sessionDurationMs: {
        type: "number",
        description: "Session lifetime in milliseconds (default: 3600000 = 1 hour)",
      },
    },
    required: ["repoName", "branchName"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    
    const repoName = params["repoName"] as string;
    const branchName = params["branchName"] as string;
    const sessionDurationMs = params["sessionDurationMs"] as number | undefined;

    // Import here to avoid circular dependency
    const { REPO_CONFIGS } = await import("./repo-configs.js");
    const config = REPO_CONFIGS[repoName];
    
    if (!config) {
      const availableRepos = Object.keys(REPO_CONFIGS).join(", ");
      return `Error: Repository '${repoName}' not found. Available repos: ${availableRepos}`;
    }

    // Force the correct template for repo setup (override config to avoid warmpool)
    const enhancedContext = {
      ...context,
      config: {
        ...context.config,
        "KATA_TEMPLATE": config.template  // Force the repo's template, bypass warmpool
      }
    };
    
    // Create a temporary tool using the factory and execute it
    const repoTool = makeRepoSetupTool(config);
    return repoTool.execute({ branchName, sessionDurationMs }, enhancedContext);
  },
};

/**
 * Destroy a sandbox session and free its resources.
 */
export const sandboxDestroy: ToolDefinition = {
  slug: "sandbox-destroy",
  name: "Sandbox Destroy Session",
  description: "Destroy a sandbox session and free all associated resources. Always call this when done.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
    },
    required: ["sessionId"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const conversationId = context.meta?.["conversationId"];
    const agentSlug = context.meta?.["agentSlug"] ?? "";
    const storeKey = conversationId ? (agentSlug ? `${conversationId}_${agentSlug}` : conversationId) : undefined;

    const session = SESSION_STORE.get(sessionId) ?? (storeKey ? SESSION_STORE.get(storeKey) : undefined);
    if (!session) return `Error: Session ${sessionId} not found or already destroyed.`;

    let destroyError: string | undefined;
    try {
      await session.destroy();
    } catch (err) {
      destroyError = err instanceof Error ? err.message : String(err);
    }
    evictSession(session, storeKey);
    if (destroyError) {
      return JSON.stringify({ sessionId, destroyed: false, evicted: true, error: destroyError });
    }
    return JSON.stringify({ sessionId, destroyed: true });
  },
};
