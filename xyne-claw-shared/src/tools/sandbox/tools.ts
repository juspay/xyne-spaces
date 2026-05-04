import { KataClient } from "@xyne/kata-sdk";
import type { Session } from "@xyne/kata-sdk";
import type { ToolDefinition } from "../types.js";

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

function rememberSession(storeKey: string | undefined, session: Session): void {
  if (storeKey) SESSION_STORE.set(storeKey, session);
  SESSION_STORE.set(session.id, session);
  const now = Date.now();
  if (storeKey) SESSION_CREATED_AT.set(storeKey, now);
  SESSION_CREATED_AT.set(session.id, now);
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
  }
  SESSION_STORE.delete(session.id);
  SESSION_CREATED_AT.delete(session.id);
  for (const [k, v] of SESSION_STORE.entries()) {
    if (v === session) {
      SESSION_STORE.delete(k);
      SESSION_CREATED_AT.delete(k);
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
      rememberSession(storeKey, session);
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
        return JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
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
          return JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
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
      return JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
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
      return JSON.stringify(status);
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

/**
 * Read a file from the sandbox.
 */
export const sandboxReadFile: ToolDefinition = {
  slug: "sandbox-read-file",
  name: "Sandbox Read File",
  description: "Read the contents of a file from an existing sandbox session. For binary files (images, PDFs, etc.) the file is automatically delivered as an attachment to the user — always use this tool to send files like screenshots instead of base64-encoding them via sandbox-run.",
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
        return JSON.stringify({ path, content: buf.toString("utf8"), encoding: "utf8" });
      }
      const fileName = path.split("/").pop() ?? "file";
      const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
      const MIME: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
        pdf: "application/pdf", zip: "application/zip",
      };
      const mimeType = MIME[ext] ?? "application/octet-stream";
      return `[ATTACHMENT:${fileName}:${mimeType}]\n${buf.toString("base64")}`;
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export function makeRepoSetupTool(config: RepoSetupConfig): ToolDefinition {
  return {
    slug: config.slug,
    name: config.name,
    description: config.description,
    source: "custom:sandbox",
    configSchema: SANDBOX_CONFIG_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
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
      },
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

      const log: string[] = [];

      const cached = SESSION_STORE.get(storeKey);
      if (cached) {
        // Only reuse sessions on a real repo-template. A bare-warmpool VM
        // (`kata-workspace-warmpool-*`) has no git creds, no Nix services,
        // no prebaked node_modules — running git checkout / npm install /
        // just services in it just fails. Match either the new agent-
        // workspace-gvisor template or the legacy kata docker-dev one for
        // a clean transition window.
        const isRepoTemplate =
          cached.id.includes("agent-workspace") ||
          cached.id.includes("docker-dev");
        if (isRepoTemplate && await probeSession(cached, storeKey)) {
          log.push(`Reusing existing sandbox session ${cached.id}`);
          try {
            // The pod prebakes a shallow clone of the default branch.
            // Other branches need to be fetched on demand. `git fetch
            // origin <branch>` adds that branch's tip to .git (Git
            // auto-handles shallow-update); `checkout -B` resets the
            // working tree to match (works whether the branch exists
            // locally or not).
            const checkoutJob = await cached.commands.runDetached(
              `cd ${config.workDir} && git fetch origin ${branchName} && git checkout -B ${branchName} FETCH_HEAD`,
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
      rememberSession(storeKey, session);
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

      // Probe for a baked clone in the kata-workspace image. The new image
      // (kata-workspace/Dockerfile + scripts/build-kata-workspace.sh) ships
      // with /workspace/xyne-spaces already cloned and node_modules installed.
      // If it's there, fast-path: fetch + checkout instead of clone+install.
      let bakedCloneFound = false;
      try {
        const probe = await session.commands.run(
          `test -d ${config.workDir}/.git && echo present || echo missing`,
          5_000,
        );
        bakedCloneFound = (probe.stdout ?? "").trim() === "present";
      } catch {
        bakedCloneFound = false;
      }

      if (bakedCloneFound) {
        // Pod's prebake clones the default branch shallowly. To switch to
        // any branch (default or other), we fetch its tip + reset working
        // tree to it. This works whether branchName is already in the
        // local repo or not, and survives the shallow clone (Git
        // auto-extends with the new fetch).
        log.push(`Baked clone detected at ${config.workDir} — fetching ${branchName} and checking out.`);
        const branchJobId = await session.commands.runDetached(
          `cd ${config.workDir} && git fetch origin ${branchName} && git checkout -B ${branchName} FETCH_HEAD`,
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
        const prebakeDeadline = Date.now() + 10 * 60_000;
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
