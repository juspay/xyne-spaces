import { classifyToolRisk } from "xyne-claw-shared";
import { hashContent, hashTag } from "../agent-index/render.js";
import type { RiskLevel, ToolBlob, ToolParam, ToolRow } from "./types.js";

/**
 * Render stage: a `tools` row becomes one searchable document.
 *
 * Pure — no database, no network calls.
 */

/** Long descriptions are kept whole; the provider chunks past this anyway. */
const MAX_DESCRIPTION = 4_000;
/** Enough to convey what a tool takes without pasting a whole JSON Schema. */
const MAX_PARAMS = 12;
const MAX_PARAM_DESCRIPTION = 160;

/** `custom:google` / `mcp:github` → `google` / `github`. */
export function integrationOf(source: string): string {
  const idx = source.indexOf(":");
  return idx >= 0 ? source.slice(idx + 1) : source;
}

/** `google-calendar-list-events` → `Google Calendar List Events`. */
function humanise(value: string): string {
  return value
    .split(/[-_:]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clamp(value: string, max: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Flatten a JSON Schema's top level only — nested object shapes are dropped.
 * Required params sort first.
 */
export function extractParams(inputSchema: unknown): ToolParam[] {
  const schema = inputSchema as { properties?: Record<string, unknown>; required?: unknown } | null;
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") return [];

  const required = new Set(
    Array.isArray(schema?.required) ? schema.required.filter((r): r is string => typeof r === "string") : [],
  );

  const params = Object.entries(properties).map(([name, raw]) => {
    const prop = (raw ?? {}) as { type?: unknown; description?: unknown; enum?: unknown };
    const type = typeof prop.type === "string" ? prop.type : Array.isArray(prop.enum) ? "enum" : "any";
    return {
      name,
      type,
      required: required.has(name),
      description: clamp(typeof prop.description === "string" ? prop.description : "", MAX_PARAM_DESCRIPTION),
    };
  });

  return params
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name))
    .slice(0, MAX_PARAMS);
}

function renderParamLines(params: ToolParam[]): string[] {
  if (params.length === 0) return ["Parameters: none."];
  return [
    "Parameters:",
    ...params.map((p) => {
      const head = `  ${p.name} (${p.type}${p.required ? ", required" : ""})`;
      return p.description ? `${head} — ${p.description}` : head;
    }),
  ];
}

/**
 * The text that gets embedded.
 *
 * Parameter names/descriptions are included — they carry nouns (channel, repo,
 * query) a terse `description` often omits. Risk, counts, and enablement are
 * excluded here; they're exact-filter tags instead (see `toolTags`).
 */
export function renderToolDoc(tool: ToolRow): string {
  const integration = integrationOf(tool.source);
  return [
    `# ${tool.name}  (${humanise(integration)})`,
    "",
    clamp(tool.description, MAX_DESCRIPTION) || "(no description)",
    "",
    ...renderParamLines(extractParams(tool.inputSchema)),
  ].join("\n");
}

export function toolTag(slug: string): string {
  return `tool:${slug}`;
}

export function readToolTag(tags: string[] | undefined): string | null {
  const tag = (tags ?? []).find((t) => t.startsWith("tool:"));
  return tag ? tag.slice("tool:".length) : null;
}

/**
 * Tags are the filter surface — exact narrowing, not semantic search.
 *
 * `params:` is bucketed (none/optional/required) instead of one tag per
 * parameter, to avoid flooding the tag bank.
 */
export function toolTags(tool: ToolRow, isWrite?: boolean): string[] {
  const params = extractParams(tool.inputSchema);
  return [
    toolTag(tool.slug),
    "kind:tool",
    `integration:${integrationOf(tool.source)}`,
    `risk:${classifyToolRisk(tool.name, isWrite)}`,
    `enabled:${tool.enabled}`,
    `params:${params.length === 0 ? "none" : params.some((p) => p.required) ? "required" : "optional"}`,
  ];
}

export function renderToolBlob(tool: ToolRow, isWrite?: boolean): ToolBlob {
  const content = renderToolDoc(tool);
  const contentHash = hashContent(content);
  return {
    slug: tool.slug,
    content,
    contentHash,
    tags: [...toolTags(tool, isWrite), hashTag(contentHash)],
    metadata: {
      slug: tool.slug,
      name: tool.name,
      source: tool.source,
      integration: integrationOf(tool.source),
      risk: classifyToolRisk(tool.name, isWrite),
      contentHash,
    },
  };
}
