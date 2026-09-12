/**
 * Xyne Spaces automation-management tools.
 *
 * These are exposed by the xyne-spaces MCP server and call the backend's
 * /api/automations/claw/* routes, which accept both user Bearer tokens and
 * app Bearer tokens (authenticateUserOrApp). That makes them usable from
 * headless agent runs as well as interactive Claw sessions.
 *
 * Design: few, broad tools rather than many narrow ones. A read tool takes an
 * id for the full record or filters for a filtered page, and returns the whole
 * payload rather than a summary — an agent debugging an automation needs the
 * config and the run context, not a pretty line of text.
 */

import { errMsg } from "../../lib/errors.js";
import { spacesFetch } from "./xyne-spaces-client.js";
import type { HandlerContext, ToolDef, ToolResult } from "./xyne-spaces-tools.js";

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function withToolErrors(
  label: string,
  fn: (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult>,
): (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult> {
  return async (params, ctx) => {
    try {
      return await fn(params, ctx);
    } catch (e) {
      return err(`${label}: ${errMsg(e)}`);
    }
  };
}

/** Mirrors AutomationView on the backend — note `config` carries the whole
 *  trigger/conditions/steps tree, which is the part an agent actually needs. */
type Automation = {
  id: string;
  workspaceId?: string;
  name: string;
  description: string | null;
  status: string;
  config?: Record<string, unknown>;
  createdById?: string;
  createdAt?: string;
  updatedAt?: string;
  automationSeriesId?: string | null;
  eventType?: string;
};

/** POST / and PUT /:id wrap the automation; GET /:id returns it bare. */
type AutomationWrappedResponse = { data?: { automation?: Automation } };
type AutomationDetailResponse = { data?: Automation };

type AutomationListResponse = {
  data?: Automation[];
  pagination?: { limit: number; nextCursor: string | null; hasMore: boolean };
};

/** Mirrors AutomationRunSummaryView. The backend field is `completedAt`,
 *  NOT `finishedAt` — an earlier revision guessed wrong and silently dropped
 *  the finish time from every run it printed. */
type RunSummary = {
  id: string;
  automationId: string;
  status: string;
  error?: string | null;
  startedAt?: string;
  completedAt?: string | null;
};

type RunsListResponse = {
  data?: { runs?: RunSummary[]; nextCursor?: string | null };
};

type RunDetailResponse = {
  data?: {
    run?: RunSummary & {
      triggerData?: Record<string, unknown>;
      context?: Record<string, unknown>;
    };
    state?: unknown;
    steps?: Array<{
      id: string;
      stepName: string;
      status: string;
      data?: unknown;
      createdAt?: string;
      updatedAt?: string;
    }>;
  };
};

type ValidateResponse = { data?: { valid?: boolean } & Record<string, unknown> };
type SchemaListResponse = { data?: Array<Record<string, unknown>> };
type SchemaDetailResponse = { data?: Record<string, unknown> };

function json(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function formatAutomationLine(a: Automation): string {
  const desc = a.description ? ` — ${a.description}` : "";
  const trigger = a.config?.["trigger"] as { type?: string } | undefined;
  const trig = trigger?.type ? ` trigger=${trigger.type}` : "";
  const updated = a.updatedAt ? ` updated=${a.updatedAt}` : "";
  return `- \`${a.id}\` **${a.name}** [${a.status}]${trig}${desc}${updated}`;
}

function formatRunLine(run: RunSummary): string {
  const done = run.completedAt ? ` completed=${run.completedAt}` : "";
  const error = run.error ? ` error=${JSON.stringify(run.error)}` : "";
  return `- \`${run.id}\` automation=${run.automationId} [${run.status}] started=${
    run.startedAt ?? "unknown"
  }${done}${error}`;
}

function setIfString(q: URLSearchParams, args: Record<string, unknown>, key: string): void {
  const v = args[key];
  if (typeof v === "string" && v.trim()) q.set(key, v.trim());
}

function setIfNumber(q: URLSearchParams, args: Record<string, unknown>, key: string): void {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) q.set(key, String(v));
}

const automationsGet: ToolDef = {
  name: "automations-get",
  description:
    "Read automations. Pass `id` for ONE automation with its complete definition — status, " +
    "ownership, timestamps and the full config: the trigger, the schedule, and every step " +
    "including the conditions nested inside CONDITIONAL and SWITCH steps. " +
    "Omit `id` to list automations, narrowed by any combination of status, triggerType, name " +
    "and pagination. ARCHIVED automations are hidden unless includeArchived is true. " +
    "Use this before automations-update so the config you send is based on the real current one.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: ["string", "null"],
        description: "Automation id. When given, returns that automation in full and ignores the filters.",
      },
      status: {
        type: ["string", "null"],
        description:
          "Filter by status, e.g. DRAFT, PENDING_APPROVAL, ACTIVE, DISABLED, ARCHIVED.",
      },
      triggerType: {
        type: ["string", "null"],
        description: "Filter to automations using this trigger type (see automations-schema).",
      },
      name: {
        type: ["string", "null"],
        description: "Case-insensitive substring match on the automation name.",
      },
      includeArchived: {
        type: ["boolean", "null"],
        description: "Include ARCHIVED automations in the list. Default false.",
      },
      limit: { type: ["integer", "null"], description: "Max items (default 50, max 100)." },
      cursor: { type: ["string", "null"], description: "Cursor from a previous list response." },
    },
  },
  handler: withToolErrors("Get automations error", async (args, _ctx) => {
    const id = typeof args["id"] === "string" ? args["id"].trim() : "";

    if (id) {
      const resp = (await spacesFetch(
        `/api/automations/claw/${encodeURIComponent(id)}`,
      )) as AutomationDetailResponse;
      const a = resp.data;
      if (!a) return err("Backend did not return an automation.");
      return ok(`Automation **${a.name}** \`${a.id}\` [${a.status}]\n${json(a)}`);
    }

    const query = new URLSearchParams();
    setIfString(query, args, "status");
    setIfString(query, args, "triggerType");
    setIfString(query, args, "name");
    setIfString(query, args, "cursor");
    setIfNumber(query, args, "limit");
    if (args["includeArchived"] === true) query.set("includeArchived", "true");

    const qs = query.toString();
    const resp = (await spacesFetch(
      `/api/automations/claw${qs ? `?${qs}` : ""}`,
    )) as AutomationListResponse;
    const list = resp.data ?? [];
    if (list.length === 0) return ok("No automations found.");

    const next = resp.pagination?.nextCursor
      ? `\nNext cursor: \`${resp.pagination.nextCursor}\``
      : "";
    return ok(
      `${list.length} automation(s):\n${list.map(formatAutomationLine).join("\n")}${next}\n` +
        "Call again with `id` for an automation's full config.",
    );
  }),
};

const automationsRuns: ToolDef = {
  name: "automations-runs",
  description:
    "List automation execution runs, filtered by automationId, status and a time window. With no " +
    "automationId it lists runs across the whole workspace, so you can find what failed recently " +
    "without checking each automation one by one. Each row gives the run id, its automation, " +
    "status, error and timings — pass a run id to automations-run to open it in full.",
  inputSchema: {
    type: "object",
    properties: {
      automationId: {
        type: ["string", "null"],
        description: "Restrict the list to one automation's runs. Omit for workspace-wide.",
      },
      status: {
        type: ["string", "null"],
        description:
          "Filter by run status, e.g. PENDING, RUNNING, COMPLETED, FAILED, CANCELLED, EXTERNAL_WAIT, SKIPPED.",
      },
      from: { type: ["integer", "null"], description: "Window start, Unix epoch ms (inclusive)." },
      to: { type: ["integer", "null"], description: "Window end, Unix epoch ms (inclusive)." },
      limit: { type: ["integer", "null"], description: "Max runs (default 50, max 200)." },
      cursor: { type: ["string", "null"], description: "Cursor from a previous list response." },
    },
  },
  handler: withToolErrors("Automation runs error", async (args, _ctx) => {
    const query = new URLSearchParams();
    setIfString(query, args, "automationId");
    setIfString(query, args, "status");
    setIfString(query, args, "cursor");
    setIfNumber(query, args, "limit");
    setIfNumber(query, args, "from");
    setIfNumber(query, args, "to");

    const qs = query.toString();
    const resp = (await spacesFetch(
      `/api/automations/claw/runs${qs ? `?${qs}` : ""}`,
    )) as RunsListResponse;
    const runs = resp.data?.runs ?? [];
    if (runs.length === 0) return ok("No runs found.");

    const next = resp.data?.nextCursor ? `\nNext cursor: \`${resp.data.nextCursor}\`` : "";
    return ok(
      `${runs.length} run(s):\n${runs.map(formatRunLine).join("\n")}${next}\n` +
        "Call again with `runId` for a run's full context and step data.",
    );
  }),
};

const automationsRun: ToolDef = {
  name: "automations-run",
  description:
    "Open ONE automation run in full: status, error, timings, the trigger data that started it, " +
    "the accumulated execution context, and every step with its recorded input/output data. " +
    "This is the tool for debugging a failure — use automations-runs first to find the run id.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string", description: "Run (execution) id, from automations-runs." },
    },
    required: ["runId"],
  },
  handler: withToolErrors("Automation run error", async (args, _ctx) => {
    const runId = String(args["runId"] ?? "").trim();
    if (!runId) return err("runId is required.");

    const resp = (await spacesFetch(
      `/api/automations/claw/runs/${encodeURIComponent(runId)}`,
    )) as RunDetailResponse;
    const run = resp.data?.run;
    if (!run) return err("Backend did not return a run.");

    return ok(
      `Run \`${run.id}\` [${run.status}] of automation ${run.automationId}\n${json(resp.data)}`,
    );
  }),
};

const automationsCreate: ToolDef = {
  name: "automations-create",
  description:
    "Create a new automation. It always starts in DRAFT and does not run until a human approves " +
    "it in Spaces. Call automations-schema first to learn the valid trigger and step types, and " +
    "automations-validate to check the config before creating.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable name for the automation." },
      description: {
        type: ["string", "null"],
        description: "Optional description of what the automation does.",
      },
      config: {
        type: "object",
        description:
          "Automation configuration: { trigger: { type, config }, schedule?, steps: [...] }. " +
          "There is NO top-level conditions array — conditions live inside control-flow steps " +
          "(CONDITIONAL has config.condition/if_true/if_false, SWITCH has config.cases[].condition). " +
          "Every step needs a unique `id`. Use {{context.<path>}} strings to reference runtime values.",
      },
    },
    required: ["name", "config"],
  },
  handler: withToolErrors("Create automation error", async (args, _ctx) => {
    const name = String(args["name"] ?? "").trim();
    if (!name) return err("name is required.");
    if (!args["config"] || typeof args["config"] !== "object") {
      return err("config is required and must be an object.");
    }

    const resp = (await spacesFetch("/api/automations/claw", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: args["description"] ?? null,
        config: args["config"],
      }),
    })) as AutomationWrappedResponse;
    const a = resp.data?.automation;
    if (!a) return err("Backend did not return an automation.");

    return ok(
      `Created automation **${a.name}** \`${a.id}\` [${a.status}].\n` +
        "It stays in DRAFT until a human approves it in Spaces.\n" +
        json(a),
    );
  }),
};

const automationsUpdate: ToolDef = {
  name: "automations-update",
  description:
    "Update an automation. Send only the fields you want to change: name, description and/or " +
    "config. If the automation is not your own editable DRAFT, this creates a NEW DRAFT version " +
    "rather than mutating the live one. Read the current config with automations-get first — a " +
    "config you send replaces the previous one wholesale.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Automation id to update." },
      name: { type: ["string", "null"], description: "New name." },
      description: { type: ["string", "null"], description: "New description; null clears it." },
      config: { type: "object", description: "Replacement configuration object." },
    },
    required: ["id"],
  },
  handler: withToolErrors("Update automation error", async (args, _ctx) => {
    const id = String(args["id"] ?? "").trim();
    if (!id) return err("id is required.");

    const body: Record<string, unknown> = {};
    if (typeof args["name"] === "string") body["name"] = args["name"];
    if (args["description"] !== undefined) body["description"] = args["description"];
    if (args["config"] !== undefined) {
      if (typeof args["config"] !== "object" || args["config"] === null) {
        return err("config must be an object if provided.");
      }
      body["config"] = args["config"];
    }
    if (Object.keys(body).length === 0) {
      return err("Provide at least one of name, description or config to update.");
    }

    const resp = (await spacesFetch(`/api/automations/claw/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    })) as AutomationWrappedResponse;
    const a = resp.data?.automation;
    if (!a) return err("Backend did not return an automation.");

    const versioned = a.id !== id ? ` (new DRAFT version of \`${id}\`)` : "";
    return ok(`Updated **${a.name}** \`${a.id}\` [${a.status}]${versioned}\n${json(a)}`);
  }),
};

const automationsValidate: ToolDef = {
  name: "automations-validate",
  description:
    "Check an automation config without saving anything. Use it to iterate on a config before " +
    "automations-create or automations-update instead of learning about mistakes from a failure.",
  inputSchema: {
    type: "object",
    properties: {
      config: {
        type: "object",
        description:
          "Configuration to validate: { trigger: { type, config }, schedule?, steps: [...] }. " +
          "Conditions are not top-level; they belong to CONDITIONAL and SWITCH steps.",
      },
    },
    required: ["config"],
  },
  handler: withToolErrors("Validate automation error", async (args, _ctx) => {
    if (!args["config"] || typeof args["config"] !== "object") {
      return err("config is required and must be an object.");
    }

    const resp = (await spacesFetch("/api/automations/claw/validate", {
      method: "POST",
      body: JSON.stringify({ config: args["config"] }),
    })) as ValidateResponse;
    const result = resp.data;
    if (!result) return err("Backend did not return a validation result.");

    if (result.valid === true) return ok("Config is valid.");
    return ok(`Config is NOT valid:\n${json(result)}`);
  }),
};

const automationsSchema: ToolDef = {
  name: "automations-schema",
  description:
    "Discover the automation vocabulary before authoring a config. List the available trigger " +
    "types, step types or condition operators; pass `type` to get the full JSON Schema for one " +
    "trigger or step including every parameter it accepts. Call this before automations-create so " +
    "the config references real types instead of guessed ones.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["triggers", "steps", "operators"],
        description: "Which part of the vocabulary to fetch.",
      },
      type: {
        type: ["string", "null"],
        description:
          "Optional. With kind=triggers or kind=steps, fetch the full schema for this one type " +
          "instead of the list. Ignored for kind=operators.",
      },
    },
    required: ["kind"],
  },
  handler: withToolErrors("Automation schema error", async (args, _ctx) => {
    const kind = String(args["kind"] ?? "").trim();
    if (kind !== "triggers" && kind !== "steps" && kind !== "operators") {
      return err('kind must be one of "triggers", "steps", or "operators".');
    }

    const type = typeof args["type"] === "string" ? args["type"].trim() : "";

    if (kind === "operators") {
      const resp = (await spacesFetch(
        "/api/automations/claw/schema/operators",
      )) as SchemaListResponse;
      const list = resp.data ?? [];
      if (list.length === 0) return ok("No operators found.");
      return ok(
        "Condition operators:\n" +
          list
            .map((o) => {
              const row = o as { value?: string; requiresValue?: boolean };
              return `- \`${row.value}\`${row.requiresValue === false ? " (no value needed)" : ""}`;
            })
            .join("\n"),
      );
    }

    if (type) {
      const resp = (await spacesFetch(
        `/api/automations/claw/schema/${kind}/${encodeURIComponent(type)}`,
      )) as SchemaDetailResponse;
      const detail = resp.data;
      if (!detail) return err(`Backend did not return a schema for "${type}".`);
      return ok(`Schema for ${kind.slice(0, -1)} \`${type}\`:\n${json(detail)}`);
    }

    const resp = (await spacesFetch(
      `/api/automations/claw/schema/${kind}`,
    )) as SchemaListResponse;
    const list = resp.data ?? [];
    if (list.length === 0) return ok(`No ${kind} found.`);

    return ok(
      `Available ${kind} (call again with \`type\` for full parameters):\n` +
        list
          .map((m) => {
            const row = m as { type?: string; name?: string; description?: string };
            const desc = row.description ? ` — ${row.description}` : "";
            return `- \`${row.type}\` ${row.name ?? ""}${desc}`.replace(/\s+$/, "");
          })
          .join("\n"),
    );
  }),
};

const automationsSubmit: ToolDef = {
  name: "automations-submit",
  description:
    "Submit an automation for approval. This is the only way out of DRAFT — automations-create " +
    "and automations-update both leave it in DRAFT, and a DRAFT never runs. The automation moves " +
    "to PENDING_APPROVAL, not ACTIVE: a human still approves it in Spaces. Only the author may " +
    "submit, the automation must be DRAFT or PENDING_APPROVAL, and re-submitting something " +
    "already pending is a no-op.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Automation id to submit for approval." },
    },
    required: ["id"],
  },
  handler: withToolErrors("Submit automation error", async (args, _ctx) => {
    const id = String(args["id"] ?? "").trim();
    if (!id) return err("id is required.");

    const resp = (await spacesFetch(
      `/api/automations/claw/${encodeURIComponent(id)}/submit`,
      { method: "POST" },
    )) as AutomationWrappedResponse;
    const a = resp.data?.automation;
    if (!a) return err("Backend did not return an automation.");

    return ok(
      `Submitted **${a.name}** \`${a.id}\` for approval.\nStatus: ${a.status}\n` +
        "A human still has to approve it in Spaces before it runs.",
    );
  }),
};

const automationsVersions: ToolDef = {
  name: "automations-versions",
  description:
    "List every version in an automation's lineage. Each version is its own row with its own id, " +
    "so pass any of those ids to automations-get to open that version in full, or to " +
    "automations-diff to compare two of them.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "Any automation id in the lineage." } },
    required: ["id"],
  },
  handler: withToolErrors("Automation versions error", async (args, _ctx) => {
    const id = String(args["id"] ?? "").trim();
    if (!id) return err("id is required.");
    const resp = (await spacesFetch(
      `/api/automations/claw/${encodeURIComponent(id)}/versions`,
    )) as AutomationListResponse;
    const versions = resp.data ?? [];
    if (versions.length === 0) return ok("No versions found.");
    return ok(
      `${versions.length} version(s) in this lineage:\n` +
        versions.map(formatAutomationLine).join("\n"),
    );
  }),
};

const automationsDiff: ToolDef = {
  name: "automations-diff",
  description:
    "Compare two automations (usually two versions of the same lineage) and report what changed: " +
    "name, status, description, trigger, schedule, and steps added, removed or modified. " +
    "Use it before automations-submit to check an edit did what you intended.",
  inputSchema: {
    type: "object",
    properties: {
      fromId: { type: "string", description: "Baseline automation id." },
      toId: { type: "string", description: "Automation id to compare against the baseline." },
    },
    required: ["fromId", "toId"],
  },
  handler: withToolErrors("Automation diff error", async (args, _ctx) => {
    const fromId = String(args["fromId"] ?? "").trim();
    const toId = String(args["toId"] ?? "").trim();
    if (!fromId || !toId) return err("fromId and toId are both required.");

    const [fromResp, toResp] = (await Promise.all([
      spacesFetch(`/api/automations/claw/${encodeURIComponent(fromId)}`),
      spacesFetch(`/api/automations/claw/${encodeURIComponent(toId)}`),
    ])) as [AutomationDetailResponse, AutomationDetailResponse];
    const from = fromResp.data;
    const to = toResp.data;
    if (!from || !to) return err("Backend did not return both automations.");

    const lines: string[] = [];
    const field = (label: string, a: unknown, b: unknown): void => {
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        lines.push(`- ${label}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      }
    };
    field("name", from.name, to.name);
    field("status", from.status, to.status);
    field("description", from.description, to.description);
    field("trigger", from.config?.["trigger"], to.config?.["trigger"]);
    field("schedule", from.config?.["schedule"], to.config?.["schedule"]);

    // Steps compared by id, so a reorder is not reported as a rewrite.
    type Step = { id?: string };
    const stepList = (a: Automation): Step[] =>
      Array.isArray(a.config?.["steps"]) ? (a.config["steps"] as Step[]) : [];
    const fromSteps = new Map(stepList(from).map((s) => [s.id ?? "", s]));
    const toSteps = new Map(stepList(to).map((s) => [s.id ?? "", s]));
    for (const [stepId, step] of fromSteps) {
      if (!toSteps.has(stepId)) lines.push(`- step removed: \`${stepId}\``);
      else if (JSON.stringify(step) !== JSON.stringify(toSteps.get(stepId))) {
        lines.push(`- step changed: \`${stepId}\``);
      }
    }
    for (const [stepId] of toSteps) {
      if (!fromSteps.has(stepId)) lines.push(`- step added: \`${stepId}\``);
    }

    if (lines.length === 0) return ok(`No differences between \`${fromId}\` and \`${toId}\`.`);
    return ok(`Differences (\`${fromId}\` -> \`${toId}\`):\n${lines.join("\n")}`);
  }),
};

const automationsEdit: ToolDef = {
  name: "automations-edit",
  description:
    "Make TARGETED edits to an automation's step tree without resending the whole config. " +
    "Prefer this over automations-update for step-level changes: it cannot clobber a concurrent " +
    "edit and you do not have to reproduce the tree. Steps nest, so address them by step id. " +
    "Operations: add-step, update-step, delete-step, move-step, set-condition (CONDITIONAL), " +
    "set-case-condition (SWITCH), set-trigger, set-schedule. Applied in order and all-or-nothing: " +
    "if one fails nothing is saved. Editing your own DRAFT updates it in place; editing anything " +
    "live creates a new DRAFT version.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Automation id to edit." },
      operations: {
        type: "array",
        description:
          "Ordered operations. Examples: " +
          '{"op":"add-step","step":{"id":"s3","type":"SEND_MESSAGE","config":{}},"parentId":"cond","branch":"if_true"}; ' +
          '{"op":"update-step","stepId":"s3","config":{"text":"hi"}}; ' +
          '{"op":"delete-step","stepId":"s3"}; ' +
          '{"op":"move-step","stepId":"s3","index":0}; ' +
          '{"op":"set-condition","stepId":"cond","condition":{}}; ' +
          '{"op":"set-case-condition","stepId":"sw","caseIndex":0,"condition":{}}; ' +
          '{"op":"set-trigger","trigger":{"type":"TICKET_CREATED","config":{}}}; ' +
          '{"op":"set-schedule","schedule":null}. ' +
          "branch is if_true / if_false / default / {caseIndex}. update-step merges config unless " +
          "replace:true. Every new step needs a unique id.",
        items: { type: "object" },
      },
    },
    required: ["id", "operations"],
  },
  handler: withToolErrors("Edit automation error", async (args, _ctx) => {
    const id = String(args["id"] ?? "").trim();
    if (!id) return err("id is required.");
    const operations = args["operations"];
    if (!Array.isArray(operations) || operations.length === 0) {
      return err("operations must be a non-empty array.");
    }

    const resp = (await spacesFetch(`/api/automations/claw/${encodeURIComponent(id)}/config`, {
      method: "PATCH",
      body: JSON.stringify({ operations }),
    })) as AutomationWrappedResponse;
    const a = resp.data?.automation;
    if (!a) return err("Backend did not return an automation.");

    const versioned = a.id !== id ? ` (new DRAFT version of \`${id}\`)` : "";
    return ok(`Edited **${a.name}** \`${a.id}\` [${a.status}]${versioned}\n${json(a)}`);
  }),
};

const automationsClone: ToolDef = {
  name: "automations-clone",
  description:
    "Copy an automation into a brand-new DRAFT owned by you. The clone starts its own lineage, " +
    "so approving it never touches the original. Useful for building from a working example " +
    "instead of authoring a config from scratch.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Automation id to copy." },
      name: {
        type: ["string", "null"],
        description: 'Name for the copy. Defaults to "<original name> (copy)".',
      },
    },
    required: ["id"],
  },
  handler: withToolErrors("Clone automation error", async (args, _ctx) => {
    const id = String(args["id"] ?? "").trim();
    if (!id) return err("id is required.");
    const body: Record<string, unknown> = {};
    if (typeof args["name"] === "string" && args["name"].trim()) body["name"] = args["name"].trim();

    const resp = (await spacesFetch(`/api/automations/claw/${encodeURIComponent(id)}/clone`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as AutomationWrappedResponse;
    const a = resp.data?.automation;
    if (!a) return err("Backend did not return an automation.");
    return ok(`Cloned \`${id}\` into **${a.name}** \`${a.id}\` [${a.status}]\n${json(a)}`);
  }),
};

const automationsAgents: ToolDef = {
  name: "automations-agents",
  description:
    "List the agents a RUN_AGENT step can call. Check this before putting an agent into a step " +
    "config so the automation references a real agent instead of a guessed name.",
  inputSchema: { type: "object", properties: {} },
  handler: withToolErrors("Automation agents error", async (_args, _ctx) => {
    const resp = (await spacesFetch("/api/automations/claw/agents")) as SchemaListResponse;
    const agents = resp.data ?? [];
    if (agents.length === 0) return ok("No agents available.");
    return ok(`${agents.length} agent(s):\n${json(agents)}`);
  }),
};

const automationsPending: ToolDef = {
  name: "automations-pending",
  description:
    "List automations waiting on a human approval decision in this workspace (PENDING_APPROVAL). " +
    "Use it to report what is blocked; approving is a human action and is not exposed as a tool.",
  inputSchema: { type: "object", properties: {} },
  handler: withToolErrors("Pending automations error", async (_args, _ctx) => {
    const resp = (await spacesFetch("/api/automations/claw/pending")) as AutomationListResponse;
    const pending = resp.data ?? [];
    if (pending.length === 0) return ok("No automations are pending approval.");
    return ok(
      `${pending.length} awaiting approval:\n${pending.map(formatAutomationLine).join("\n")}`,
    );
  }),
};

const automationsWebhook: ToolDef = {
  name: "automations-webhook",
  description:
    "Get the webhook URL for a WEBHOOK-triggered automation, and whether a signing secret has " +
    "been issued. The secret itself is shown only once at creation and is never returned here.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "Automation id." } },
    required: ["id"],
  },
  handler: withToolErrors("Automation webhook error", async (args, _ctx) => {
    const id = String(args["id"] ?? "").trim();
    if (!id) return err("id is required.");
    const resp = (await spacesFetch(
      `/api/automations/claw/${encodeURIComponent(id)}/webhook`,
    )) as { data?: { url?: string; issued?: boolean } };
    const data = resp.data;
    if (!data?.url) return err("Backend did not return webhook details.");
    return ok(
      `Webhook URL: ${data.url}\nSecret issued: ${data.issued ? "yes" : "no"}`,
    );
  }),
};

export const automationTools: ToolDef[] = [
  automationsGet,
  automationsVersions,
  automationsDiff,
  automationsRuns,
  automationsRun,
  automationsCreate,
  automationsUpdate,
  automationsEdit,
  automationsClone,
  automationsSubmit,
  automationsValidate,
  automationsSchema,
  automationsAgents,
  automationsPending,
  automationsWebhook,
];
