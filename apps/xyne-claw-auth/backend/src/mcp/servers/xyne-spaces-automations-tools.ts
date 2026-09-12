/**
 * Xyne Spaces automation-management tools.
 *
 * These are exposed by the xyne-spaces MCP server and call the backend's
 * /api/automations/claw/* routes, which accept both user Bearer tokens and
 * app Bearer tokens (authenticateUserOrApp). That makes them usable from
 * headless agent runs as well as interactive Claw sessions.
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

type AutomationResponse = {
  data: {
    automation: {
      id: string;
      name: string;
      description: string | null;
      status: string;
      trigger?: { type: string };
      createdAt?: string;
      updatedAt?: string;
    };
  };
};

type AutomationListResponse = {
  data: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    trigger?: { type: string };
    createdAt?: string;
    updatedAt?: string;
  }>;
  pagination?: { limit: number; nextCursor: string | null; hasMore: boolean };
};

/** GET /:id returns the automation directly under `data`, NOT wrapped in
 *  `{ automation }` the way POST / and PUT /:id do. That asymmetry matches the
 *  existing /api/automations contract, so the tool bends to it, not the route. */
type AutomationDetailResponse = {
  data: AutomationListResponse["data"][number];
};

type ValidateResponse = {
  data?: { valid?: boolean } & Record<string, unknown>;
};

type SchemaListResponse = {
  data?: Array<{ type?: string; name?: string; description?: string; category?: string }>;
};

type SchemaDetailResponse = {
  data?: Record<string, unknown>;
};

type RunSummary = {
  id: string;
  automationId: string;
  status: string;
  startedAt?: string;
  finishedAt?: string | null;
};

type RunsListResponse = {
  data: {
    runs: RunSummary[];
    nextCursor: string | null;
  };
};

type RunDetailResponse = {
  data: {
    run: {
      id: string;
      automationId: string;
      status: string;
      startedAt?: string;
      finishedAt?: string | null;
      error?: string | null;
    };
    state?: unknown;
    steps?: Array<{
      id: string;
      stepName: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

function formatAutomation(a: AutomationListResponse["data"][number]): string {
  const desc = a.description ? ` — ${a.description}` : "";
  const updated = a.updatedAt ? ` (updated ${a.updatedAt})` : "";
  return `- **${a.name}** \`${a.id}\` [${a.status}]${desc}${updated}`;
}

function formatRun(run: RunSummary): string {
  const finished = run.finishedAt ? ` → finished ${run.finishedAt}` : "";
  return `- \`${run.id}\` [${run.status}] started ${run.startedAt ?? "unknown"}${finished}`;
}

const automationsCreate: ToolDef = {
  name: "automations-create",
  description:
    "Create a new automation (always starts in DRAFT status). " +
    "Provide a name, optional description, and a config object describing the trigger, conditions, and steps. " +
    "Returns the created automation including its id.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Human-readable name for the automation.",
      },
      description: {
        type: ["string", "null"],
        description: "Optional description of what the automation does.",
      },
      config: {
        type: "object",
        description:
          "Automation configuration object: { trigger: {...}, conditions: [...], steps: [...] }.",
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

    const body = {
      name,
      description: args["description"] ?? null,
      config: args["config"],
    };

    const resp = (await spacesFetch("/api/automations/claw", {
      method: "POST",
      body: JSON.stringify(body),
    })) as AutomationResponse;
    const a = resp.data?.automation;
    if (!a) return err("Backend did not return an automation.");

    return ok(
      `Created automation **${a.name}** \`${a.id}\`\nStatus: ${a.status}\nTrigger: ${a.trigger?.type ?? "unknown"}`,
    );
  }),
};

const automationsList: ToolDef = {
  name: "automations-list",
  description:
    "List automations in the current workspace. Supports pagination via cursor.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Maximum items to return (default 50, max 100).",
      },
      cursor: {
        type: ["string", "null"],
        description: "Opaque cursor from a previous list response for pagination.",
      },
    },
  },
  handler: withToolErrors("List automations error", async (args, _ctx) => {
    const query = new URLSearchParams();
    if (typeof args["limit"] === "number") query.set("limit", String(args["limit"]));
    if (typeof args["cursor"] === "string") query.set("cursor", args["cursor"]);

    const resp = (await spacesFetch(
      `/api/automations/claw?${query.toString()}`,
    )) as AutomationListResponse;
    const list = resp.data ?? [];
    if (list.length === 0) return ok("No automations found.");

    const pagination = resp.pagination;
    const nextLine = pagination?.nextCursor
      ? `\nNext cursor: \`${pagination.nextCursor}\``
      : "";
    return ok(list.map(formatAutomation).join("\n") + nextLine);
  }),
};

const automationsGet: ToolDef = {
  name: "automations-get",
  description: "Fetch a single automation by id.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Automation id.",
      },
    },
    required: ["id"],
  },
  handler: withToolErrors("Get automation error", async (args, _ctx) => {
    const id = String(args["id"] ?? "").trim();
    if (!id) return err("id is required.");

    const resp = (await spacesFetch(
      `/api/automations/claw/${encodeURIComponent(id)}`,
    )) as AutomationDetailResponse;
    const a = resp.data;
    if (!a) return err("Backend did not return an automation.");

    const lines = [
      `**${a.name}** \`${a.id}\``,
      `Status: ${a.status}`,
      a.description ? `Description: ${a.description}` : null,
      `Trigger: ${a.trigger?.type ?? "unknown"}`,
      a.createdAt ? `Created: ${a.createdAt}` : null,
      a.updatedAt ? `Updated: ${a.updatedAt}` : null,
    ].filter((l): l is string => l !== null);

    return ok(lines.join("\n"));
  }),
};

const automationsUpdate: ToolDef = {
  name: "automations-update",
  description:
    "Update an existing automation. If the automation is already approved/live, this creates a new DRAFT version. " +
    "Only provide the fields you want to change: name, description, and/or config.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Automation id to update.",
      },
      name: {
        type: "string",
        description: "New name for the automation.",
      },
      description: {
        type: ["string", "null"],
        description: "New description. Use null to clear it.",
      },
      config: {
        type: "object",
        description: "Replacement automation configuration object.",
      },
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

    const resp = (await spacesFetch(`/api/automations/claw/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    })) as AutomationResponse;
    const a = resp.data?.automation;
    if (!a) return err("Backend did not return an automation.");

    return ok(
      `Updated automation **${a.name}** \`${a.id}\`\nStatus: ${a.status}\nTrigger: ${a.trigger?.type ?? "unknown"}`,
    );
  }),
};

const automationsListRuns: ToolDef = {
  name: "automations-list-runs",
  description:
    "List execution runs for a specific automation, optionally filtered by status and time range.",
  inputSchema: {
    type: "object",
    properties: {
      automationId: {
        type: "string",
        description: "Automation id whose runs should be listed.",
      },
      limit: {
        type: "integer",
        description: "Maximum runs to return (default 50, max 200).",
      },
      cursor: {
        type: ["string", "null"],
        description: "Opaque cursor from a previous list response for pagination.",
      },
      status: {
        type: ["string", "null"],
        description:
          "Filter by run status, e.g. PENDING, RUNNING, COMPLETED, FAILED, CANCELLED, EXTERNAL_WAIT, SKIPPED.",
      },
      from: {
        type: ["integer", "null"],
        description: "Start of time window as Unix epoch milliseconds (inclusive).",
      },
      to: {
        type: ["integer", "null"],
        description: "End of time window as Unix epoch milliseconds (inclusive).",
      },
    },
    required: ["automationId"],
  },
  handler: withToolErrors("List automation runs error", async (args, _ctx) => {
    const automationId = String(args["automationId"] ?? "").trim();
    if (!automationId) return err("automationId is required.");

    const query = new URLSearchParams();
    if (typeof args["limit"] === "number") query.set("limit", String(args["limit"]));
    if (typeof args["cursor"] === "string") query.set("cursor", args["cursor"]);
    if (typeof args["status"] === "string") query.set("status", args["status"]);
    if (typeof args["from"] === "number") query.set("from", String(args["from"]));
    if (typeof args["to"] === "number") query.set("to", String(args["to"]));

    const resp = (await spacesFetch(
      `/api/automations/claw/${encodeURIComponent(automationId)}/runs?${query.toString()}`,
    )) as RunsListResponse;
    const runs = resp.data?.runs ?? [];
    if (runs.length === 0) return ok("No runs found.");

    const nextLine = resp.data?.nextCursor
      ? `\nNext cursor: \`${resp.data.nextCursor}\``
      : "";
    return ok(runs.map(formatRun).join("\n") + nextLine);
  }),
};

const automationsGetRun: ToolDef = {
  name: "automations-get-run",
  description:
    "Fetch full details of a single automation run, including step-level statuses and state.",
  inputSchema: {
    type: "object",
    properties: {
      runId: {
        type: "string",
        description: "Run (execution) id.",
      },
    },
    required: ["runId"],
  },
  handler: withToolErrors("Get automation run error", async (args, _ctx) => {
    const runId = String(args["runId"] ?? "").trim();
    if (!runId) return err("runId is required.");

    const resp = (await spacesFetch(
      `/api/automations/claw/runs/${encodeURIComponent(runId)}`,
    )) as RunDetailResponse;
    const run = resp.data?.run;
    if (!run) return err("Backend did not return a run.");

    const lines = [
      `Run \`${run.id}\``,
      `Automation: ${run.automationId}`,
      `Status: ${run.status}`,
      run.startedAt ? `Started: ${run.startedAt}` : null,
      run.finishedAt ? `Finished: ${run.finishedAt}` : null,
      run.error ? `Error: ${run.error}` : null,
    ].filter((l): l is string => l !== null);

    const steps = resp.data?.steps ?? [];
    if (steps.length > 0) {
      lines.push("", "Steps:");
      for (const step of steps) {
        lines.push(`- ${step.stepName} [${step.status}]`);
      }
    }

    return ok(lines.join("\n"));
  }),
};

const automationsSubmit: ToolDef = {
  name: "automations-submit",
  description:
    "Submit a DRAFT automation for approval. This is the ONLY way an automation leaves DRAFT — " +
    "automations-create and automations-update both leave it in DRAFT, and a DRAFT never runs. " +
    "Approval itself is a human/admin action, so the automation becomes PENDING_APPROVAL, not ACTIVE.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Automation id to submit for approval.",
      },
    },
    required: ["id"],
  },
  handler: withToolErrors("Submit automation error", async (args, _ctx) => {
    const id = String(args["id"] ?? "").trim();
    if (!id) return err("id is required.");

    const resp = (await spacesFetch(
      `/api/automations/claw/${encodeURIComponent(id)}/submit`,
      { method: "POST" },
    )) as AutomationResponse;
    const a = resp.data?.automation;
    if (!a) return err("Backend did not return an automation.");

    return ok(`Submitted **${a.name}** \`${a.id}\` for approval.\nStatus: ${a.status}`);
  }),
};

const automationsValidate: ToolDef = {
  name: "automations-validate",
  description:
    "Check an automation config without saving anything. Use this to iterate on a config " +
    "before calling automations-create or automations-update, rather than learning about " +
    "mistakes from a failed create.",
  inputSchema: {
    type: "object",
    properties: {
      config: {
        type: "object",
        description:
          "Automation configuration object to validate: { trigger: {...}, conditions: [...], steps: [...] }.",
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
    return ok(`Config is NOT valid:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
  }),
};

const automationsSchema: ToolDef = {
  name: "automations-schema",
  description:
    "Discover the automation vocabulary before authoring a config. List the available trigger " +
    "types, step types, or condition operators; pass `type` to get the full JSON Schema for one " +
    "trigger or step, including its parameters. Call this before automations-create so the config " +
    "references real types instead of guessed ones.",
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
      return ok(`Schema for ${kind.slice(0, -1)} \`${type}\`:\n\`\`\`json\n${JSON.stringify(detail, null, 2)}\n\`\`\``);
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
            const desc = m.description ? ` — ${m.description}` : "";
            return `- \`${m.type}\` ${m.name ?? ""}${desc}`.replace(/\s+$/, "");
          })
          .join("\n"),
    );
  }),
};

export const automationTools: ToolDef[] = [
  automationsCreate,
  automationsList,
  automationsGet,
  automationsUpdate,
  automationsSubmit,
  automationsValidate,
  automationsSchema,
  automationsListRuns,
  automationsGetRun,
];
