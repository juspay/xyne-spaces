/**
 * Xyne Dashboard MCP tool definitions — the dashboard-ai agent's toolset.
 *
 * Deliberately a DEDICATED server (never merged into xyne-spaces): these tools
 * are pinned to the `dashboard-ai` agent only, so no other agent's palette can
 * see them. Every tool calls the Spaces backend's /api/dashboard/claw/*
 * endpoints, which validate query plans against the live data source and
 * persist emit-tool changes server-side.
 *
 * `dataSourceId`, `draftId`, and `focusedComponentId` are injected per-session
 * by claw-auth's MCP /call boundary (see mcp/run-scalars.ts) — the model never
 * supplies them.
 */

import { spacesFetch } from "./xyne-spaces-client.js";
import { errMsg } from "../../lib/errors.js";

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

/** The Spaces endpoints reply { text } even on 4xx; spacesFetch wraps non-2xx
 *  bodies into its Error message. Dig the model-facing text back out so the
 *  agent reads "Query validation failed …" instead of a JSON-escaped blob. */
function modelText(e: unknown, tool: string): string {
  const raw = errMsg(e);
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { text?: string };
      if (parsed && typeof parsed.text === "string" && parsed.text) return parsed.text;
    } catch {
      // fall through to the raw message
    }
  }
  return `${tool} failed: ${raw}`;
}

// Injected per-run by claw-auth — declared so schema validation tolerates the
// injected keys, described so the model leaves them alone.
const RUN_CTX_PROPS = {
  dataSourceId: { type: "string", description: "Set automatically for this session — never provide." },
  draftId: { type: "string", description: "Set automatically for this session — never provide." },
  focusedComponentId: { type: "string", description: "Set automatically for this session — never provide." },
} as const;

const VISUAL_TYPES = [
  "KPI",
  "KPI_COMPARE",
  "BAR_CHART",
  "PIE_CHART",
  "LINE_CHART",
  "AREA_CHART",
  "SCATTER_CHART",
  "DATA_TABLE",
] as const;

const POSITION_SCHEMA = {
  type: "object",
  description: "Grid position { x, y, w, h } on a 12-column grid. Optional — omitted tiles auto-place below existing ones.",
  properties: {
    x: { type: "integer", minimum: 0 },
    y: { type: "integer", minimum: 0 },
    w: { type: "integer", minimum: 1, maximum: 12 },
    h: { type: "integer", minimum: 1 },
  },
  required: ["x", "y", "w", "h"],
} as const;

const COMPONENT_CONFIG_SCHEMA = {
  type: "object",
  description: "Per-tile runtime hints. Set timeColumn on any time-scopable tile so the dashboard time-range picker can filter it; set unit when the measured value has a natural unit.",
  properties: {
    timeColumn: { type: "string", description: "Temporal column the time-range picker filters on, e.g. \"placed_at\" or qualified \"orders.placed_at\"." },
    unit: { type: "string", description: "Terse unit label, e.g. \"%\", \"hours\", \"$\", \"orders\"." },
    unitPosition: { type: "string", enum: ["prefix", "suffix"] },
  },
} as const;

const QUERY_PLAN_SCHEMA = {
  type: "object",
  description: "A queryPlan object — { model, schema?, joins?, select?, where?, groupBy?, measures?, orderBy?, take?, skip? }. dataSourceId is set automatically.",
} as const;

/** Read tool: forwards its params (plus injected dataSourceId) to a Spaces endpoint. */
function readTool(
  name: string,
  description: string,
  route: string,
  argProps: Record<string, unknown>,
  required?: string[],
): ToolDef {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { ...RUN_CTX_PROPS, ...argProps },
      ...(required && required.length > 0 ? { required } : {}),
    },
    async handler(params) {
      try {
        const data = (await spacesFetch(route, {
          method: "POST",
          body: JSON.stringify(params),
        })) as { text?: string };
        return ok(data.text ?? "");
      } catch (e) {
        return err(modelText(e, name));
      }
    },
  };
}

/** Emit tool: wraps the model's args into { dataSourceId, draftId, focusedComponentId, args }. */
function emitTool(
  name: string,
  description: string,
  route: string,
  argProps: Record<string, unknown>,
  required?: string[],
): ToolDef {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { ...RUN_CTX_PROPS, ...argProps },
      ...(required && required.length > 0 ? { required } : {}),
    },
    async handler(params) {
      const { dataSourceId, draftId, focusedComponentId, ...args } = params;
      try {
        const data = (await spacesFetch(route, {
          method: "POST",
          body: JSON.stringify({ dataSourceId, draftId, focusedComponentId, args }),
        })) as { text?: string; id?: string };
        return ok(data.text ?? `Applied ${name}.`);
      } catch (e) {
        return err(modelText(e, name));
      }
    },
  };
}

export const tools: ToolDef[] = [
  readTool(
    "list_schema",
    "Compact index of ALL tables in the data source (name, approx rows, column count), paginated. Use get_table_schema for full columns + stats of specific tables.",
    "/api/dashboard/claw/list-schema",
    { offset: { type: "integer", minimum: 0, description: "Pagination offset (default 0)." } },
  ),
  readTool(
    "get_table_schema",
    "Full column detail (types, distinct counts, enum values, ranges, sample values) plus FK relationships for up to 10 named tables. Accepts \"schema.table\" or bare table names.",
    "/api/dashboard/claw/get-table-schema",
    {
      tables: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 10,
        description: "Table names, e.g. [\"core.orders\", \"payments\"].",
      },
    },
    ["tables"],
  ),
  readTool(
    "run_query",
    "Execute a read-only query plan against the data source and return up to 50 sample rows. Use this to validate a metric or inspect real values (e.g. SELECT DISTINCT a column) before adding a component. The queryPlan is the same JSON DSL used by add_component.",
    "/api/dashboard/claw/run-query",
    { queryPlan: QUERY_PLAN_SCHEMA },
    ["queryPlan"],
  ),
  emitTool(
    "set_dashboard_meta",
    "Set the dashboard title and optional description. Call once on a new draft.",
    "/api/dashboard/claw/set-meta",
    {
      title: { type: "string", minLength: 1 },
      description: { type: "string" },
    },
  ),
  emitTool(
    "add_component",
    "Add a chart, KPI, or table to the dashboard. queryPlan defines what data to show. The server validates the plan against the real data source and persists the tile; the result includes the new component's id.",
    "/api/dashboard/claw/add-component",
    {
      visualType: { type: "string", enum: [...VISUAL_TYPES] },
      title: { type: "string", minLength: 1 },
      queryPlan: QUERY_PLAN_SCHEMA,
      position: POSITION_SCHEMA,
      componentConfig: COMPONENT_CONFIG_SCHEMA,
    },
    ["visualType", "title", "queryPlan"],
  ),
  emitTool(
    "update_component",
    "Modify an existing component on the dashboard. Reference its id from the draft summary in your context. Partial — only pass the fields to change.",
    "/api/dashboard/claw/update-component",
    {
      componentId: { type: "string", minLength: 1 },
      visualType: { type: "string", enum: [...VISUAL_TYPES] },
      title: { type: "string", minLength: 1 },
      queryPlan: QUERY_PLAN_SCHEMA,
      position: POSITION_SCHEMA,
      componentConfig: COMPONENT_CONFIG_SCHEMA,
    },
    ["componentId"],
  ),
  emitTool(
    "remove_component",
    "Remove a component from the dashboard.",
    "/api/dashboard/claw/remove-component",
    { componentId: { type: "string", minLength: 1 } },
    ["componentId"],
  ),
  {
    name: "suggest_components",
    description:
      "Offer the user 2–5 CLICKABLE options instead of guessing or writing a wall of prose. Return a short, friendly message plus 2–5 { label: the button text, prompt: what gets asked when they click it }. Use this whenever giving the user a choice beats picking for them: (a) the request is broad or vague and there are several good directions; (b) what they asked for isn't possible on this data source — say so plainly and offer what IS available; (c) you want to confirm scope before building a lot.",
    inputSchema: {
      type: "object",
      properties: {
        ...RUN_CTX_PROPS,
        message: { type: "string", minLength: 1, description: "One or two sentences, plain language, no markdown." },
        suggestions: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              label: { type: "string", minLength: 1, maxLength: 80 },
              prompt: { type: "string", minLength: 1, maxLength: 300 },
            },
            required: ["label", "prompt"],
          },
        },
      },
      required: ["message", "suggestions"],
    },
    // UI-only: the dashboard chat reads the args off the tool invocation and
    // renders suggestion chips — no backend call to make.
    async handler(params) {
      const { message, suggestions } = params;
      return ok(JSON.stringify({ message, suggestions }));
    },
  },
  emitTool(
    "drill_result",
    "Present an inline drill-down result in the chat: a chart or table derived from the FOCUSED component, breaking its metric down by a dimension or slicing it. The result is shown to the user inline and is NOT added to the dashboard. Use run_query first to validate the breakdown against real data.",
    "/api/dashboard/claw/drill-result",
    {
      title: { type: "string", minLength: 1 },
      visualType: { type: "string", enum: [...VISUAL_TYPES] },
      queryPlan: QUERY_PLAN_SCHEMA,
    },
    ["title", "visualType", "queryPlan"],
  ),
];
