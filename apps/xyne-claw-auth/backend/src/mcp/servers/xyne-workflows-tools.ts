/**
 * Xyne Workflows MCP tool definitions — Ask AI's workflow authoring + run toolset.
 *
 * A DEDICATED server, like xyne-dashboard and for the same reason: these tools are pinned
 * to the agents that should author workflows, so no other agent's palette sees them. They
 * call the Spaces backend's /api/workflows-v2/claw/* mount, which is the `@xyne/workflow-sdk`
 * HTTP surface narrowed to an agent-safe allowlist and running as the signed-in user.
 *
 * Not merged into xyne-spaces-tools.ts on purpose. That file already carries
 * `spaces-workflow-stats`, which reads the LEGACY workflow engine — a different set of
 * tables with a contradicting status vocabulary (SUCCESS/FAILURE there, COMPLETED/FAILED
 * here). Keeping the two in separate servers with separate naming (`workflow_*` vs
 * `spaces-workflow-*`) is what stops the model blending them.
 *
 * `workflowId` and `executionId` are injected per-session by claw-auth's MCP /call
 * boundary from where the user opened Ask AI (see mcp/run-scalars.ts) — the model never
 * supplies them, and cannot override them.
 */

import { spacesFetch } from "./xyne-spaces-client.js";
import { errMsg } from "../../lib/errors.js";

const BASE = "/api/workflows-v2/claw";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface HandlerContext {
  userId: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult>;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** JSON back to the model. Pretty-printed: these are configs a model has to edit, and
 *  two spaces of indentation costs far less than a mis-parsed one-liner costs in retries. */
function okJson(value: unknown): ToolResult {
  return ok(JSON.stringify(value, null, 2));
}

/** spacesFetch folds a non-2xx body into its Error message. Dig the SDK's `{ error }` out
 *  so the agent reads "Body must contain a folderId" rather than a JSON-escaped blob. */
function modelText(e: unknown, tool: string): string {
  const raw = errMsg(e);
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: string; message?: string };
      const text = parsed?.error ?? parsed?.message;
      if (typeof text === "string" && text) return `${tool}: ${text}`;
    } catch {
      // fall through to the raw message
    }
  }
  return `${tool} failed: ${raw}`;
}

async function get(path: string): Promise<unknown> {
  return spacesFetch(`${BASE}${path}`);
}

async function send(method: "POST" | "PUT", path: string, body: unknown): Promise<unknown> {
  return spacesFetch(`${BASE}${path}`, { method, body: JSON.stringify(body ?? {}) });
}

// Injected per-run by claw-auth. Declared so schema validation tolerates the injected
// keys, described so the model does not try to fill them itself.
const RUN_CTX_PROPS = {
  workflowId: { type: "string", description: "Set automatically for this session — never provide." },
  executionId: { type: "string", description: "Set automatically for this session — never provide." },
  focusedStepId: { type: "string", description: "Set automatically for this session — never provide." },
} as const;

function requireWorkflowId(params: Record<string, unknown>, tool: string): string | ToolResult {
  const id = typeof params["workflowId"] === "string" ? params["workflowId"].trim() : "";
  if (id) return id;
  return err(
    `${tool}: no workflow in scope. This session was not opened on a workflow — ` +
      "use workflow_list to find one and tell the user which you mean, or ask them to " +
      "open the workflow first.",
  );
}

function isToolResult(v: string | ToolResult): v is ToolResult {
  return typeof v !== "string";
}

// ─── Discovery ───

const workflowCatalog: ToolDef = {
  name: "workflow_catalog",
  description:
    "The building blocks available for authoring. Call with NO arguments first: returns a " +
    "compact index of every step type and trigger type (name, description, category) plus " +
    "the condition operators — enough to choose. Then call again with `stepTypes` and/or " +
    "`triggerTypes` to get the FULL config + output JSON Schemas for just the ones you " +
    "picked. Batch them in one call. Never author a config from the index alone: the " +
    "schemas carry required fields, enums and formats you cannot guess, and a config that " +
    "misses them fails validation.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      stepTypes: {
        type: "array",
        items: { type: "string", minLength: 1 },
        maxItems: 12,
        description: 'Step types to expand, e.g. ["HTTP_REQUEST", "CODE"].',
      },
      triggerTypes: {
        type: "array",
        items: { type: "string", minLength: 1 },
        maxItems: 8,
        description: 'Trigger types to expand, e.g. ["CRON"].',
      },
    },
  },
  async handler(params) {
    const stepTypes = Array.isArray(params["stepTypes"]) ? (params["stepTypes"] as string[]) : [];
    const triggerTypes = Array.isArray(params["triggerTypes"])
      ? (params["triggerTypes"] as string[])
      : [];

    try {
      if (stepTypes.length === 0 && triggerTypes.length === 0) {
        const [steps, triggers, operators] = await Promise.all([
          get("/schema/steps"),
          get("/schema/triggers"),
          get("/schema/operators"),
        ]);
        return okJson({
          ...(steps as object),
          ...(triggers as object),
          ...(operators as object),
          hint: "Call workflow_catalog again with stepTypes/triggerTypes for full schemas.",
        });
      }

      const [steps, triggers] = await Promise.all([
        Promise.all(stepTypes.map((t) => get(`/schema/steps/${encodeURIComponent(t)}`))),
        Promise.all(triggerTypes.map((t) => get(`/schema/triggers/${encodeURIComponent(t)}`))),
      ]);
      return okJson({
        ...(steps.length > 0 ? { steps } : {}),
        ...(triggers.length > 0 ? { triggers } : {}),
      });
    } catch (e) {
      return err(modelText(e, "workflow_catalog"));
    }
  },
};

const workflowNodeContext: ToolDef = {
  name: "workflow_node_context",
  description:
    "What a given step can REFERENCE. Returns the variable paths addressable at that point " +
    "in the workflow — `trigger.*` and each earlier step's `output.*` — as JSON Schemas, " +
    "scope-aware (a step inside a LOOP/MAP/PARALLEL branch sees a different set than one " +
    "outside it). Call this before writing any {{...}} reference. Inventing a reference " +
    "that is not in this list is the single most common way an authored workflow breaks: " +
    "it passes validation shape-wise and then resolves to nothing at run time.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      config: {
        type: "object",
        description:
          "The workflow config to evaluate against. Pass the draft you are building — it " +
          "does not have to be saved. Omit to use the saved config of the workflow in scope.",
      },
      atStepId: {
        type: "string",
        minLength: 1,
        description: "The step id to compute available references for.",
      },
    },
    required: ["atStepId"],
  },
  async handler(params) {
    const atStepId = String(params["atStepId"] ?? "").trim();
    if (!atStepId) return err("workflow_node_context: atStepId is required");

    try {
      let config = params["config"];
      if (!config) {
        const id = requireWorkflowId(params, "workflow_node_context");
        if (isToolResult(id)) return id;
        const wf = (await get(`/workflows/${encodeURIComponent(id)}`)) as { config?: string };
        config = typeof wf.config === "string" ? JSON.parse(wf.config) : wf.config;
      }
      const res = await send("POST", "/schema/available-context", { config, atStepId });
      return okJson(res);
    } catch (e) {
      return err(modelText(e, "workflow_node_context"));
    }
  },
};

// ─── Authoring ───

const workflowList: ToolDef = {
  name: "workflow_list",
  description:
    "List the workflows this user can see, with their folders. Use to find a workflow by " +
    "name when the session was not opened on one, or to pick a folder id for workflow_create.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      folderId: { type: "string", description: "Restrict to one folder." },
    },
  },
  async handler(params) {
    try {
      const folderId = typeof params["folderId"] === "string" ? params["folderId"] : "";
      const [workflows, folders] = await Promise.all([
        get(`/workflows${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`),
        get("/folders"),
      ]);
      return okJson({ ...(workflows as object), ...(folders as object) });
    } catch (e) {
      return err(modelText(e, "workflow_list"));
    }
  },
};

const workflowGet: ToolDef = {
  name: "workflow_get",
  description:
    "Read one workflow: its name, summary, status and full config (trigger + steps). Use " +
    "this before editing so you patch the real current config rather than reconstructing " +
    "it from the conversation. Defaults to the workflow the user has open.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      id: { type: "string", description: "Workflow id. Omit to use the one in scope." },
    },
  },
  async handler(params) {
    const explicit = typeof params["id"] === "string" ? params["id"].trim() : "";
    const id = explicit || requireWorkflowId(params, "workflow_get");
    if (isToolResult(id)) return id;
    try {
      const wf = (await get(`/workflows/${encodeURIComponent(id)}`)) as Record<string, unknown>;
      const config = typeof wf["config"] === "string" ? JSON.parse(wf["config"] as string) : wf["config"];
      return okJson({ ...wf, config });
    } catch (e) {
      return err(modelText(e, "workflow_get"));
    }
  },
};

const workflowValidate: ToolDef = {
  name: "workflow_validate",
  description:
    "Check a workflow config without saving it. Returns { valid, issues[] } where each " +
    "issue names the step and field at fault. Cheap — run it whenever you are unsure, " +
    "rather than saving and reading the failure back.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      config: { type: "object", description: "A full WorkflowConfig: { trigger, steps }." },
    },
    required: ["config"],
  },
  async handler(params) {
    try {
      return okJson(await send("POST", "/workflows/validate", params["config"]));
    } catch (e) {
      return err(modelText(e, "workflow_validate"));
    }
  },
};

const workflowCreate: ToolDef = {
  name: "workflow_create",
  description:
    "Create a new workflow. Validates the config first and refuses to save an invalid one, " +
    "returning the issues so you can fix them and retry. " +
    "The workflow is created but LEFT SWITCHED OFF — its trigger is not registered, so a " +
    "CRON will not fire and a WEBHOOK URL is not live until a person turns it on in the " +
    "builder. Say so when you report back. You can still run it yourself with workflow_run " +
    "to show the user it works.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      name: {
        type: "string",
        minLength: 1,
        description:
          "Letters, digits, spaces and _ ( ) + - only — the backend rejects anything else.",
      },
      config: { type: "object", description: "A full WorkflowConfig: { trigger, steps }." },
      folderId: {
        type: "string",
        description: "Folder to create it in. Required — use workflow_list to find one.",
      },
      summary: {
        type: "string",
        description: "One or two sentences on what it does, shown in the workflow list.",
      },
    },
    required: ["name", "config", "folderId"],
  },
  async handler(params) {
    const config = params["config"];
    try {
      const validation = (await send("POST", "/workflows/validate", config)) as {
        valid?: boolean;
        issues?: unknown[];
      };
      if (!validation.valid) {
        return err(
          "workflow_create: config is not valid, nothing was saved. Fix these and call " +
            `again:\n${JSON.stringify(validation.issues ?? [], null, 2)}`,
        );
      }

      const created = (await send("POST", "/workflows", {
        name: params["name"],
        config,
        folderId: params["folderId"],
        ...(typeof params["summary"] === "string" ? { summary: params["summary"] } : {}),
      })) as { id?: string };

      if (!created.id) return err("workflow_create: backend returned no workflow id");

      // createWorkflow hardcodes status ACTIVE and self-activates, which for a CRON or
      // WEBHOOK trigger means it is live the moment it exists. Nothing an agent authored
      // should start firing before a person has read it, so take the trigger back out of
      // service straight away. Manual runs still work.
      //
      // Handled apart from the create because the two failures need opposite reactions:
      // a failed create means nothing exists and retrying is right; a failed deactivate
      // means the workflow DOES exist and IS live, and retrying would build a second one.
      try {
        await send("POST", `/workflows/${encodeURIComponent(created.id)}/deactivate`, {});
      } catch (e) {
        return err(
          `Workflow ${created.id} was created but could NOT be switched off ` +
            `(${errMsg(e)}). It is LIVE: a CRON trigger will fire and a WEBHOOK URL is ` +
            "reachable. Do not create it again — tell the user to open it and turn it off " +
            "if that is not what they wanted.",
        );
      }

      return okJson({
        id: created.id,
        live: false,
        note: "Created and switched off. A person must turn it on in the builder before its trigger fires.",
      });
    } catch (e) {
      return err(modelText(e, "workflow_create"));
    }
  },
};

const workflowUpdate: ToolDef = {
  name: "workflow_update",
  description:
    "Update an existing workflow. Validates before saving and refuses an invalid config. " +
    "Pass the WHOLE config, not a fragment — read it with workflow_get, change what you " +
    "need, send it back. Editing does not switch a workflow on or off.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      id: { type: "string", description: "Workflow id. Omit to use the one in scope." },
      name: { type: "string", minLength: 1 },
      config: { type: "object", description: "A full WorkflowConfig: { trigger, steps }." },
      summary: { type: "string" },
    },
  },
  async handler(params) {
    const explicit = typeof params["id"] === "string" ? params["id"].trim() : "";
    const id = explicit || requireWorkflowId(params, "workflow_update");
    if (isToolResult(id)) return id;

    const config = params["config"];
    try {
      if (config) {
        const validation = (await send("POST", "/workflows/validate", config)) as {
          valid?: boolean;
          issues?: unknown[];
        };
        if (!validation.valid) {
          return err(
            "workflow_update: config is not valid, nothing was saved. Fix these and call " +
              `again:\n${JSON.stringify(validation.issues ?? [], null, 2)}`,
          );
        }
      }
      const body: Record<string, unknown> = {};
      if (typeof params["name"] === "string") body["name"] = params["name"];
      if (config) body["config"] = config;
      if (typeof params["summary"] === "string") body["summary"] = params["summary"];
      if (Object.keys(body).length === 0) {
        return err("workflow_update: pass at least one of name, config or summary");
      }
      return okJson(await send("PUT", `/workflows/${encodeURIComponent(id)}`, body));
    } catch (e) {
      return err(modelText(e, "workflow_update"));
    }
  },
};

// ─── Running and inspecting ───

const workflowRun: ToolDef = {
  name: "workflow_run",
  description:
    "Run a workflow now and return its executionId. Works even on a workflow that is " +
    "switched off, so this is how you demonstrate one you just built. The run is " +
    "asynchronous — poll workflow_run_get for the outcome rather than assuming success.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      id: { type: "string", description: "Workflow id. Omit to use the one in scope." },
      payload: {
        type: "object",
        description:
          "Trigger input. Must match the trigger's inputSchema — check it with " +
          "workflow_catalog if the trigger declares one.",
      },
    },
  },
  async handler(params) {
    const explicit = typeof params["id"] === "string" ? params["id"].trim() : "";
    const id = explicit || requireWorkflowId(params, "workflow_run");
    if (isToolResult(id)) return id;
    try {
      const res = await send(
        "POST",
        `/workflows/${encodeURIComponent(id)}/trigger`,
        params["payload"] ?? {},
      );
      return okJson(res);
    } catch (e) {
      return err(modelText(e, "workflow_run"));
    }
  },
};

const workflowRunGet: ToolDef = {
  name: "workflow_run_get",
  description:
    "Read one execution: overall status, and every step with its status, output and error. " +
    "Defaults to the run the user has open. Status is COMPLETED | FAILED | RUNNING | " +
    "PENDING | SCHEDULED | CANCELLED | SKIPPED | EXTERNAL_WAIT. EXTERNAL_WAIT is not a " +
    "failure and not a hang — the run is parked at a gate waiting for a person or an " +
    "external callback; say which step, and what it is waiting for.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      id: { type: "string", description: "Execution id. Omit to use the one in scope." },
    },
  },
  async handler(params) {
    const explicit = typeof params["id"] === "string" ? params["id"].trim() : "";
    const id = explicit || (typeof params["executionId"] === "string" ? params["executionId"] : "");
    if (!id) {
      return err(
        "workflow_run_get: no execution in scope. This session was not opened on a run — " +
          "use workflow_run_list to find one.",
      );
    }
    try {
      return okJson(await get(`/executions/${encodeURIComponent(id)}`));
    } catch (e) {
      return err(modelText(e, "workflow_run_get"));
    }
  },
};

const workflowRunList: ToolDef = {
  name: "workflow_run_list",
  description:
    "Recent executions, newest first. Filter by workflow and/or status to answer 'did it " +
    "run last night', 'how often does this fail', 'what is stuck right now'.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      id: { type: "string", description: "Workflow id to filter by. Omit to use the one in scope, if any." },
      status: {
        type: "string",
        enum: [
          "PENDING",
          "SCHEDULED",
          "RUNNING",
          "COMPLETED",
          "FAILED",
          "CANCELLED",
          "SKIPPED",
          "EXTERNAL_WAIT",
        ],
      },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20." },
    },
  },
  async handler(params) {
    const explicit = typeof params["id"] === "string" ? params["id"].trim() : "";
    const scoped = typeof params["workflowId"] === "string" ? params["workflowId"] : "";
    const workflowId = explicit || scoped;
    const query = new URLSearchParams();
    if (workflowId) query.set("workflowId", workflowId);
    if (typeof params["status"] === "string") query.set("status", params["status"]);
    query.set("limit", String(params["limit"] ?? 20));
    try {
      return okJson(await get(`/executions?${query.toString()}`));
    } catch (e) {
      return err(modelText(e, "workflow_run_list"));
    }
  },
};

const workflowStepEvents: ToolDef = {
  name: "workflow_step_events",
  description:
    "The event trail a single step emitted during a run — logs, sub-steps, tool calls, " +
    "progress. Use this when a step failed and workflow_run_get's error line is not enough " +
    "to explain why.",
  inputSchema: {
    type: "object",
    properties: {
      ...RUN_CTX_PROPS,
      stepName: {
        type: "string",
        minLength: 1,
        description: "The step's id as it appears in the run. Omit to use the focused step.",
      },
      id: { type: "string", description: "Execution id. Omit to use the one in scope." },
    },
  },
  async handler(params) {
    const explicit = typeof params["id"] === "string" ? params["id"].trim() : "";
    const execId = explicit || (typeof params["executionId"] === "string" ? params["executionId"] : "");
    const named = typeof params["stepName"] === "string" ? params["stepName"].trim() : "";
    const stepName = named || (typeof params["focusedStepId"] === "string" ? params["focusedStepId"] : "");
    if (!execId) return err("workflow_step_events: no execution in scope, and no id given");
    if (!stepName) return err("workflow_step_events: stepName is required");
    try {
      return okJson(
        await get(
          `/executions/${encodeURIComponent(execId)}/steps/${encodeURIComponent(stepName)}/events`,
        ),
      );
    } catch (e) {
      return err(modelText(e, "workflow_step_events"));
    }
  },
};

export const WORKFLOW_WRITE_TOOL_NAMES = [
  "workflow_create",
  "workflow_update",
  "workflow_run",
] as const;

export const tools: ToolDef[] = [
  workflowCatalog,
  workflowNodeContext,
  workflowList,
  workflowGet,
  workflowValidate,
  workflowCreate,
  workflowUpdate,
  workflowRun,
  workflowRunGet,
  workflowRunList,
  workflowStepEvents,
];

export const WORKFLOW_TOOL_NAMES: string[] = tools.map((tool) => tool.name);
