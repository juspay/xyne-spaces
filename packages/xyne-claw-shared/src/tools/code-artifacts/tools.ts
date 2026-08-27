import crypto from "node:crypto";
import type { ToolDefinition, ToolExecutionContext, UiWidget } from "../types.js";
import { publishUiWidget } from "../ui-widget.js";

function widgetId(context: ToolExecutionContext | undefined, type: UiWidget["type"]): string {
  return `${type}:${context?.toolCallId ?? crypto.randomUUID()}`;
}

async function postWidget(context: ToolExecutionContext | undefined, widget: UiWidget): Promise<string | null> {
  try {
    await publishUiWidget(context, widget);
    return null;
  } catch (err) {
    return `Error publishing ${widget.type} widget: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const postCodeBlock: ToolDefinition = {
  slug: "post-code-block",
  name: "Post Code Block",
  description:
    "Post a code snippet into the thread as its own card — monospaced, syntax-highlighted, " +
    "with a copy button. Use this when the code IS the answer (a patch you would apply, a " +
    "config the user must paste, a query you ran) and the reader will want to copy it. Do " +
    "NOT use it for short inline expressions — put those in backticks in your reply instead, " +
    "and do not repeat the snippet in your text after posting it. " +
    "`language` is a syntax-highlighting hint (typescript, python, sql, bash, json, …); omit " +
    "it only when the content genuinely has no language. To show a CHANGE to an existing " +
    "file, use post-diff instead — it renders the change inline as unified +/− lines.",
  source: "custom:code-artifacts",
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "The snippet body, verbatim. No surrounding ``` fences." },
      language: { type: "string", description: "Syntax highlighting hint, e.g. typescript" },
    },
    required: ["code"],
  },
  async execute(params, context) {
    const code = typeof params["code"] === "string" ? params["code"] : "";
    if (!code.trim()) return "Error: code is required.";
    const rawLanguage = params["language"];
    const language = typeof rawLanguage === "string" && rawLanguage.trim() ? rawLanguage.trim() : undefined;

    const error = await postWidget(context, {
      id: widgetId(context, "code"),
      type: "code",
      operation: "create",
      payload: { code, ...(language ? { language } : {}) },
    });
    if (error) return error;
    return `Posted a ${language ?? "code"} snippet (${code.split("\n").length} lines) to the thread. Do not repeat it in your reply — the user can already see and copy it.`;
  },
};

export const postDiff: ToolDefinition = {
  slug: "post-diff",
  name: "Post Diff",
  description:
    "Post a proposed edit into the thread as a diff card — file path, +N/−M stat, and the " +
    "changed lines rendered in place with an expand-to-full-patch control. Use this whenever " +
    "you are showing a change to an existing file, instead of pasting before/after blocks. " +
    "`patch` is unified-diff text: `@@` hunk headers with ` `/`+`/`-` line prefixes. Bare " +
    "hunks are fine — the file headers are added for you from `path`. " +
    "This card only DISPLAYS the change: it applies nothing and asks the user for nothing, so " +
    "if you need the edit made, still say what you intend to do next.",
  source: "custom:code-artifacts",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repo-relative file path, e.g. src/push/token.ts" },
      patch: { type: "string", description: "Unified diff text with @@ hunk headers" },
    },
    required: ["path", "patch"],
  },
  async execute(params, context) {
    const path = typeof params["path"] === "string" ? params["path"].trim() : "";
    const patch = typeof params["patch"] === "string" ? params["patch"] : "";
    if (!path) return "Error: path is required.";
    if (!patch.trim()) return "Error: patch is required.";
    if (!/^@@|^diff --git |^--- /m.test(patch)) {
      return "Error: patch must be unified-diff text (at least one @@ hunk header).";
    }

    const error = await postWidget(context, {
      id: widgetId(context, "diff"),
      type: "diff",
      operation: "create",
      payload: { path, patch },
    });
    if (error) return error;
    return `Posted a diff card for ${path} to the thread. Do not repeat the patch in your reply — the user can already see it.`;
  },
};

export const postChart: ToolDefinition = {
  slug: "post-chart",
  name: "Post Chart",
  description:
    "Post a chart into the thread. Use it when the SHAPE of the data is the point (a spike, a " +
    "cliff, a trend, a split) and a sentence would undersell it. Do NOT use it to dump numbers: " +
    "if the reader needs exact values, write them out or use a table instead. " +
    "Pick `type`: `bar` to compare categories, `line` for a trend over time, `area` for a trend " +
    "where the volume matters, `pie` or `donut` for parts of a whole (only when the parts sum to " +
    "something meaningful and there are at most ~6 of them). " +
    "`bar`/`pie`/`donut` take `points` ({label, value}, at most 24, in the order you want them " +
    "read). `line`/`area` take `series` ({x, y}, plus an optional `series` name per row to draw " +
    "several lines on one chart). " +
    "`caption` is where the conclusion goes, e.g. 'Push failures per day · 4.2.1 shipped Tue'.",
  source: "custom:code-artifacts",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["bar", "line", "area", "pie", "donut"], description: "bar, line, area, pie, or donut" },
      points: {
        type: "array",
        description: "bar/pie/donut only. 1-24 points, in display order.",
        minItems: 1,
        maxItems: 24,
        items: {
          type: "object",
          properties: { label: { type: "string" }, value: { type: "number" } },
          required: ["label", "value"],
        },
      },
      series: {
        type: "array",
        description: "line/area only. Points along an x axis; repeat `series` to draw multiple lines.",
        minItems: 1,
        maxItems: 200,
        items: {
          type: "object",
          properties: { x: { type: "string" }, y: { type: "number" }, series: { type: "string" } },
          required: ["x", "y"],
        },
      },
      caption: { type: "string", description: "One line under the chart stating the takeaway." },
    },
    required: ["type"],
  },
  async execute(params, context) {
    const type = typeof params["type"] === "string" ? params["type"].trim().toLowerCase() : "";
    const rawCaption = params["caption"];
    const caption = typeof rawCaption === "string" && rawCaption.trim() ? rawCaption.trim() : undefined;

    if (type === "line" || type === "area") {
      const raw = params["series"];
      if (!Array.isArray(raw) || raw.length < 1) return `Error: ${type} charts need a 'series' array.`;
      if (raw.length > 200) return "Error: at most 200 series points — aggregate the data first.";
      const series: Array<{ x: string; y: number; series?: string }> = [];
      for (let i = 0; i < raw.length; i += 1) {
        const row = raw[i] as Record<string, unknown>;
        const x = typeof row?.["x"] === "string" ? row["x"].trim() : "";
        const y = row?.["y"];
        const name = typeof row?.["series"] === "string" && row["series"].trim() ? row["series"].trim() : undefined;
        if (!x) return `Error: series point ${i + 1} needs an x value.`;
        if (typeof y !== "number" || !Number.isFinite(y)) return `Error: series point ${i + 1} needs a finite y.`;
        series.push({ x, y, ...(name ? { series: name } : {}) });
      }
      const error = await postWidget(context, {
        id: widgetId(context, "chart"),
        type: "chart",
        operation: "create",
        payload: { type, series, ...(caption ? { caption } : {}) },
      });
      if (error) return error;
      const lines = new Set(series.map((point) => point.series ?? "")).size;
      return `Posted a ${type} chart (${series.length} points, ${lines} series) to the thread. Do not list the values again — state what the shape means.`;
    }

    if (type === "bar" || type === "pie" || type === "donut") {
      const raw = params["points"];
      if (!Array.isArray(raw) || raw.length < 1) return `Error: ${type} charts need a 'points' array.`;
      if (raw.length > 24) return "Error: at most 24 points — aggregate or trim the series first.";
      const points: Array<{ label: string; value: number }> = [];
      for (let i = 0; i < raw.length; i += 1) {
        const point = raw[i] as Record<string, unknown>;
        const label = typeof point?.["label"] === "string" ? point["label"].trim() : "";
        const value = point?.["value"];
        if (!label) return `Error: point ${i + 1} needs a label.`;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return `Error: point ${i + 1} needs a finite numeric value.`;
        }
        points.push({ label, value });
      }
      const error = await postWidget(context, {
        id: widgetId(context, "chart"),
        type: "chart",
        operation: "create",
        payload: { type, points, ...(caption ? { caption } : {}) },
      });
      if (error) return error;
      return `Posted a ${points.length}-point ${type} chart to the thread. Do not list the values again — state what the shape means.`;
    }

    return "Error: type must be one of bar, line, area, pie, donut.";
  },
};
