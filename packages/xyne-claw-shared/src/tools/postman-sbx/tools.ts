/**
 * postman_sbx — Postman collection EXECUTION inside the agent's sandbox.
 *
 * WHY THIS LIVES HERE (not in claw-auth):
 * Running a Postman collection means running Newman, which (a) executes the
 * collection's pre-request/test scripts as arbitrary Node code and (b) issues
 * the collection's HTTP requests. That is code-execution + network egress and
 * MUST NOT run in claw-auth (the control plane, next to DB creds / encryption
 * keys). It belongs in the isolated, egress-controlled Kata sandbox the agent
 * already drives — same place all other untrusted execution happens.
 *
 * CREDENTIAL BOUNDARY (important):
 * The Postman API key is NEVER handed to the sandbox. The credential-bearing
 * Postman *API* operations (fetch collection / environment JSON, runMonitor)
 * stay in the `postman` claw-auth MCP. This tool takes the already-fetched
 * collection (+ optional environment) JSON as input and runs it offline in the
 * VM. The sandbox therefore needs only network egress to the collection's
 * target hosts (an infra-level IP allowlist) — not the key.
 *
 * APPROVAL: none. The two risks HITL guards against — credential exfiltration
 * and uncontrolled egress — are already contained by the sandbox (no gateway
 * creds inside it; egress restricted to the operator's allowlist). Approval
 * here would be friction without added safety. Contrast `postman.runMonitor`,
 * which stays approval-gated because it executes in claw-auth with the real key.
 *
 * Requires an active sandbox session for the conversation (created by
 * sandbox-create / sandbox-repo-setup). This tool does not create or destroy
 * sandboxes — it reuses the conversation's session, resolved by store key
 * (conversationId + agentSlug), so it can only ever touch this conversation's
 * own sandbox.
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { getSandboxSession, buildSandboxStoreKey } from "../sandbox/index.js";
import { redactSecrets } from "../sandbox/redact.js";

// Cap the collection/environment payloads we write into the VM. A Postman
// collection is normally well under this; the cap stops a pathological payload
// from ballooning the sandbox /tmp.
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
// Cap Newman output echoed back to the model.
const OUTPUT_CAP = 12_000;
// Hard wall-clock cap for a collection run. Kept just under the MCP request
// timeout so the tool returns rather than being killed mid-flight.
const DEFAULT_TIMEOUT_MS = 290_000;

const STALE_SESSION_RE = /could not connect to backend sandbox|sandbox not found|no route to host|connection refused|ECONNREFUSED|sandbox pod/i;

function byteLen(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

// Single-quote a path for safe interpolation into the shell command. Temp
// paths are tool-controlled (/tmp/pm-<hex>.json) so this is belt-and-braces.
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

function randSuffix(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const postmanSbxRunCollection: ToolDefinition = {
  slug: "postman-sbx-run-collection",
  name: "Postman Run Collection (sandbox)",
  description:
    "Run a Postman collection with Newman INSIDE the agent's sandbox (isolated, egress-controlled). " +
    "Use this to execute/test a collection. Pass the full collection JSON (fetch it first with the " +
    "`postman` connector's read tool) as `collectionJson`; optionally an environment JSON. The Postman " +
    "API key is NOT needed here and must not be passed — this runs the collection offline against its " +
    "target hosts. Requires an active sandbox for this conversation (call sandbox-create or " +
    "sandbox-repo-setup first). Returns Newman's CLI summary (pass/fail counts and failures).",
  source: "custom:postman_sbx",
  // No approval: the run is confined to the isolated sandbox. See file header.
  isWriteTool: false,
  inputSchema: {
    type: "object",
    properties: {
      collectionJson: {
        type: "string",
        description:
          "The full Postman collection as a JSON string (Collection v2.1 schema). Fetch it with the " +
          "`postman` connector's get-collection tool, then pass the JSON here. Do NOT pass the API key.",
      },
      environmentJson: {
        type: "string",
        description: "Optional Postman environment as a JSON string, to run the collection against.",
      },
      iterationCount: {
        type: "number",
        description: "Optional number of iterations to run (default 1).",
      },
      timeoutMs: {
        type: "number",
        description: "Optional hard timeout in milliseconds (default 290000, max 290000).",
      },
    },
    required: ["collectionJson"],
  },

  async execute(params, context?: ToolExecutionContext) {
    if (!context) return "Error: No execution context available.";

    const collectionJson = params["collectionJson"];
    if (typeof collectionJson !== "string" || !collectionJson.trim()) {
      return "Error: collectionJson is required (the full Postman collection as a JSON string).";
    }
    if (byteLen(collectionJson) > MAX_PAYLOAD_BYTES) {
      return `Error: collectionJson exceeds the ${MAX_PAYLOAD_BYTES}-byte limit.`;
    }
    try {
      JSON.parse(collectionJson);
    } catch {
      return "Error: collectionJson is not valid JSON.";
    }

    const environmentJson = params["environmentJson"];
    let envProvided = false;
    if (environmentJson !== undefined && environmentJson !== null && environmentJson !== "") {
      if (typeof environmentJson !== "string") {
        return "Error: environmentJson must be a JSON string.";
      }
      if (byteLen(environmentJson) > MAX_PAYLOAD_BYTES) {
        return `Error: environmentJson exceeds the ${MAX_PAYLOAD_BYTES}-byte limit.`;
      }
      try {
        JSON.parse(environmentJson);
      } catch {
        return "Error: environmentJson is not valid JSON.";
      }
      envProvided = true;
    }

    const iterRaw = params["iterationCount"];
    const iterationCount =
      typeof iterRaw === "number" && Number.isFinite(iterRaw) ? Math.max(1, Math.floor(iterRaw)) : undefined;

    const timeoutRaw = params["timeoutMs"];
    const timeoutMs =
      typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw)
        ? Math.min(DEFAULT_TIMEOUT_MS, Math.max(1_000, Math.floor(timeoutRaw)))
        : DEFAULT_TIMEOUT_MS;

    // Resolve the conversation's sandbox. Keying by conversationId + agentSlug
    // means we can only ever reach THIS conversation's session — no cross-tenant
    // access, no explicit sessionId to smuggle in.
    const storeKey = buildSandboxStoreKey(
      context.meta?.["userId"],
      context.meta?.["conversationId"],
      context.meta?.["agentSlug"],
    );
    if (!storeKey) {
      return "Error: No conversationId in context; cannot resolve a sandbox session.";
    }
    const session = getSandboxSession(storeKey);
    if (!session) {
      return (
        "Error: No active sandbox for this conversation. Create one first with sandbox-create " +
        "(or sandbox-repo-setup), then call postman-sbx-run-collection again."
      );
    }

    const suffix = randSuffix();
    const colPath = `/tmp/pm-collection-${suffix}.json`;
    const envPath = `/tmp/pm-environment-${suffix}.json`;

    try {
      await session.files.write(colPath, collectionJson);
      if (envProvided) {
        await session.files.write(envPath, environmentJson as string);
      }

      const parts = ["npx", "--yes", "newman", "run", shellQuote(colPath), "--reporters", "cli", "--color", "off"];
      if (envProvided) {
        parts.push("--environment", shellQuote(envPath));
      }
      if (iterationCount) {
        parts.push("-n", String(iterationCount));
      }
      // 2>&1 so the CLI reporter (stdout) and any Newman errors (stderr) both
      // land in one stream. exitCode is preserved from Newman (non-zero on test
      // failures) — we do NOT suppress it, so `passed` reflects the real result.
      const cmd = `cd /tmp && ${parts.join(" ")} 2>&1`;

      const result = await session.commands.run(cmd, timeoutMs);

      const raw = `${result.stdout ?? ""}${result.stderr ? `\n${result.stderr}` : ""}`;
      const capped = raw.length > OUTPUT_CAP ? `${raw.slice(0, OUTPUT_CAP)}\n…(output truncated)` : raw;

      return JSON.stringify(
        {
          ran: true,
          exitCode: result.exitCode,
          passed: result.exitCode === 0,
          output: redactSecrets(capped) || "(no output)",
        },
        null,
        2,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (STALE_SESSION_RE.test(msg)) {
        return "Error: The sandbox for this conversation appears to have died. Call sandbox-repo-setup (or sandbox-create) to re-provision, then retry.";
      }
      if (/aborted due to timeout|operation was aborted/i.test(msg)) {
        return `Error: The collection run timed out after ${timeoutMs}ms. The sandbox is likely still alive — retry, or lower the iteration count.`;
      }
      return `Error: ${redactSecrets(msg)}`;
    } finally {
      // Best-effort cleanup — the environment JSON may hold secrets, don't leave
      // it lying in the sandbox /tmp. Ignore failures (VM is per-conversation).
      try {
        await session.commands.run(`rm -f ${shellQuote(colPath)} ${shellQuote(envPath)}`, 10_000);
      } catch {
        /* ignore */
      }
    }
  },
};
