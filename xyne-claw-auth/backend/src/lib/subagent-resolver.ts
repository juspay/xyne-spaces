/**
 * Subagent resolution + validation.
 *
 * Built-in subagents live in xyne-claw-shared's SUBAGENT_DEFINITIONS and are
 * not represented in the DB. User-created subagents live in the
 * subagent_definitions table. At name-lookup time, built-ins always win; the
 * write-path validation refuses to create a DB row whose name collides with
 * a built-in, so the runtime "built-in wins" rule cannot mask user intent.
 *
 * The CRUD route handlers use these helpers for validation; the `/run`
 * handler uses `resolveSubagentsForRun` to hydrate the list of customs that
 * gets sent to xyne-claw as part of the run payload.
 */

import type { PrismaClient, SubagentDefinition, Skill, SkillFile } from "@prisma/client";
import { SUBAGENT_DEFINITIONS, type SubagentDefinition as BuiltinDef } from "xyne-claw-shared";

import { createLogger } from "../logger.js";
const log = createLogger("subagent-resolver");

// ── Wire-format types ─────────────────────────────────────────────────────

export interface CustomSubagentSpec {
  name: string;
  description: string;
  progressLabels: string[];
  systemPrompt: string;
  paramName: string;
  paramDescription: string;
  tools: SubagentToolsConfig;
  /** Optional per-MCP-server instance pin. Keys are server types
   *  ("grafana", "elasticsearch"), values are the matching agent-pinned
   *  instance slug ("prod", "staging"). Empty / missing keys = inherit
   *  all agent-level instances of that server type. Read by the runtime
   *  when spawning per-instance MCP processes for this subagent. */
  mcpInstanceMap?: Record<string, string>;
  skills: Array<{
    slug: string;
    name: string;
    description: string;
    content: string;
    files?: Array<{ relativePath: string; content: string; contentType?: string | null }>;
  }>;
}

/** Same shape as AgentToolsConfig from xyne-claw-shared, minus nested
 *  subagents (forbidden — avoids unbounded recursion). */
export interface SubagentToolsConfig {
  direct?: string[];
  custom?: string[];
}

// ── Validation ────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const PARAM_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const DESCRIPTION_MAX_CHARS = 500;
const PROGRESS_LABEL_MAX_CHARS = 80;
const PROGRESS_LABEL_MAX_COUNT = 8;

export class ValidationError extends Error {
  constructor(public field: string, public detail: string) {
    super(`${field}: ${detail}`);
  }
}

export interface SubagentInput {
  name: string;
  description: string;
  progressLabels: unknown;
  systemPrompt: string;
  paramName?: string;
  paramDescription: string;
  tools: unknown;
  skillIds?: string[];
  /** Optional `{ serverType: instanceSlug }` map. Omit or pass `{}` for
   *  the inherit-all default. */
  mcpInstanceMap?: unknown;
}

export interface ValidatedSubagentInput {
  name: string;
  description: string;
  progressLabels: string[];
  systemPrompt: string;
  paramName: string;
  paramDescription: string;
  tools: SubagentToolsConfig;
  skillIds: string[];
  /** Always a plain object (possibly empty). Empty == inherit all. */
  mcpInstanceMap: Record<string, string>;
}

const BUILTIN_NAMES: ReadonlySet<string> = new Set(SUBAGENT_DEFINITIONS.map((d) => d.name));

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ValidationError(field, "must be a string");
  return value;
}

function validateName(raw: unknown, options: { allowBuiltin: boolean }): string {
  const name = asString(raw, "name").trim();
  if (name.length < 2 || name.length > 64) {
    throw new ValidationError("name", "must be 2–64 characters");
  }
  if (!NAME_RE.test(name)) {
    throw new ValidationError("name", "must be kebab-case (lowercase letters, digits, hyphens; no leading/trailing/consecutive hyphens)");
  }
  if (!options.allowBuiltin && BUILTIN_NAMES.has(name)) {
    throw new ValidationError("name", `"${name}" is reserved by a built-in subagent`);
  }
  return name;
}

function validateProgressLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new ValidationError("progressLabels", "must be an array");
  if (raw.length < 1 || raw.length > PROGRESS_LABEL_MAX_COUNT) {
    throw new ValidationError("progressLabels", `must have 1–${PROGRESS_LABEL_MAX_COUNT} entries`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") throw new ValidationError("progressLabels", "all entries must be strings");
    const trimmed = item.trim();
    if (trimmed.length < 1 || trimmed.length > PROGRESS_LABEL_MAX_CHARS) {
      throw new ValidationError("progressLabels", `each entry must be 1–${PROGRESS_LABEL_MAX_CHARS} chars`);
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) throw new ValidationError("progressLabels", "duplicate entries are not allowed");
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function validateSystemPrompt(raw: unknown): string {
  const s = asString(raw, "systemPrompt");
  if (s.trim().length === 0) throw new ValidationError("systemPrompt", "cannot be empty");
  return s;
}

function validateDescription(raw: unknown, field: string): string {
  const s = asString(raw, field).trim();
  if (s.length < 1 || s.length > DESCRIPTION_MAX_CHARS) {
    throw new ValidationError(field, `must be 1–${DESCRIPTION_MAX_CHARS} chars`);
  }
  return s;
}

function validateParamName(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "question";
  const s = asString(raw, "paramName").trim();
  if (s.length < 1 || s.length > 32) throw new ValidationError("paramName", "must be 1–32 chars");
  if (!PARAM_NAME_RE.test(s)) throw new ValidationError("paramName", "must be a valid JS identifier");
  return s;
}

function validateToolsConfig(raw: unknown): SubagentToolsConfig {
  if (!raw || typeof raw !== "object") throw new ValidationError("tools", "must be an object");
  const obj = raw as Record<string, unknown>;
  if ("subagents" in obj && obj["subagents"] !== undefined) {
    throw new ValidationError("tools.subagents", "nested subagents are not allowed inside a subagent's tools config");
  }
  const out: SubagentToolsConfig = {};
  for (const key of ["direct", "custom"] as const) {
    const v = obj[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) throw new ValidationError(`tools.${key}`, "must be a string array");
    const arr: string[] = [];
    for (const item of v) {
      if (typeof item !== "string" || item.length === 0) {
        throw new ValidationError(`tools.${key}`, "all entries must be non-empty strings");
      }
      arr.push(item);
    }
    out[key] = arr;
  }
  // Emptiness check moved up to validateSubagentInput so it can also factor in
  // mcpInstanceMap — a subagent that wraps an MCP server (e.g. a builtin fork
  // like `grafana → grafana-eu`) legitimately has no extra direct/custom
  // tools; its palette comes from the wrapped MCP server. Requiring an extra
  // tool here would block that valid case.
  return out;
}

async function validateSkillIds(prisma: PrismaClient, raw: unknown): Promise<string[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError("skillIds", "must be an array of skill IDs");
  const ids = raw.map((x, i) => {
    if (typeof x !== "string" || x.length === 0) {
      throw new ValidationError(`skillIds[${i}]`, "must be a non-empty string");
    }
    return x;
  });
  if (ids.length === 0) return [];
  const found = await prisma.skill.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const foundIds = new Set(found.map((s) => s.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new ValidationError("skillIds", `unknown skill ID(s): ${missing.join(", ")}`);
  }
  return ids;
}

// Slug constraint kept in sync with SLUG_RE in routes/agents.ts and the
// frontend's SLUG_VALID. Lowercase alnum + hyphen, 1-32 chars.
const MCP_INSTANCE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
// Server-type constraint mirrors McpServer.type: lowercase alnum + hyphen.
const MCP_SERVER_TYPE_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Validate an optional `{ serverType: instanceSlug }` map. Empty / missing
 *  → `{}` (caller treats as inherit-all). Bad shape or bad keys/values throws. */
function validateMcpInstanceMap(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("mcpInstanceMap", "must be an object of { serverType: instanceSlug }");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MCP_SERVER_TYPE_RE.test(key)) {
      throw new ValidationError("mcpInstanceMap", `invalid server type "${key}"`);
    }
    if (typeof value !== "string" || !MCP_INSTANCE_SLUG_RE.test(value)) {
      throw new ValidationError(
        "mcpInstanceMap",
        `value for "${key}" must be a valid instance slug (lowercase alnum + hyphen, 1-32 chars)`,
      );
    }
    out[key] = value;
  }
  return out;
}

export async function validateSubagentInput(
  prisma: PrismaClient,
  input: SubagentInput,
  options: { isCreate: boolean },
): Promise<ValidatedSubagentInput> {
  const name = validateName(input.name, { allowBuiltin: false });
  // On update, the route handler must verify `name` matches the URL and
  // refuse name changes. Validation here treats name as just a string check.
  if (options.isCreate) {
    const existing = await prisma.subagentDefinition.findUnique({ where: { name }, select: { id: true } });
    if (existing) {
      throw new ValidationError("name", `a subagent named "${name}" already exists`);
    }
  }
  const tools = validateToolsConfig(input.tools);
  const mcpInstanceMap = validateMcpInstanceMap(input.mcpInstanceMap);

  // Tools are OPTIONAL — a subagent with no tools (just a system prompt + skills)
  // is a valid reasoning/summarize/critique helper. We intentionally do NOT block
  // on an empty tool set; the UI also treats tools as optional. (Shapes are still
  // validated above.)

  return {
    name,
    description: validateDescription(input.description, "description"),
    progressLabels: validateProgressLabels(input.progressLabels),
    systemPrompt: validateSystemPrompt(input.systemPrompt),
    paramName: validateParamName(input.paramName),
    paramDescription: validateDescription(input.paramDescription, "paramDescription"),
    tools,
    skillIds: await validateSkillIds(prisma, input.skillIds),
    mcpInstanceMap,
  };
}

// ── Resolution ────────────────────────────────────────────────────────────

type DbRowWithSkills = SubagentDefinition & {
  skills: Array<{ skill: Skill & { files: SkillFile[] } }>;
};

/**
 * Convert a DB row + joined skills into the wire-format spec sent to
 * xyne-claw. Built-ins are NOT routed through this — they live in code on
 * the xyne-claw side and the resolver only emits custom rows.
 */
export function toCustomSubagentSpec(row: DbRowWithSkills): CustomSubagentSpec {
  const rawMap = row.mcpInstanceMap as Record<string, unknown> | null | undefined;
  // Defensive: only forward keys whose values are strings — anything else
  // was either bad data or pre-validation. Keeps the wire spec clean.
  const cleanMap: Record<string, string> = {};
  if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
    for (const [k, v] of Object.entries(rawMap)) {
      if (typeof v === "string") cleanMap[k] = v;
    }
  }
  return {
    name: row.name,
    description: row.description,
    progressLabels: row.progressLabels as string[],
    systemPrompt: row.systemPrompt,
    paramName: row.paramName,
    paramDescription: row.paramDescription,
    tools: row.tools as SubagentToolsConfig,
    ...(Object.keys(cleanMap).length > 0 ? { mcpInstanceMap: cleanMap } : {}),
    skills: row.skills.map((s) => ({
      slug: s.skill.slug,
      name: s.skill.name,
      description: s.skill.description,
      content: s.skill.content,
      ...(s.skill.files.length > 0
        ? {
            files: s.skill.files.map((f) => ({
              relativePath: f.relativePath,
              content: f.content,
              contentType: f.contentType,
            })),
          }
        : {}),
    })),
  };
}

export interface ResolvedSubagent {
  source: "builtin" | "custom";
  builtin?: BuiltinDef;
  custom?: CustomSubagentSpec;
}

/**
 * Resolve a list of subagent names to either a built-in (returned as-is) or
 * a hydrated custom spec. Built-ins always win on tie; unknown names are
 * silently dropped (logged as a warning) so a stale agent.config doesn't
 * crash the /run handler.
 */
export async function resolveSubagentsForRun(
  prisma: PrismaClient,
  requestedNames: string[],
): Promise<ResolvedSubagent[]> {
  if (!requestedNames || requestedNames.length === 0) return [];

  const builtinByName = new Map(SUBAGENT_DEFINITIONS.map((d) => [d.name, d]));
  const missingFromBuiltins = requestedNames.filter((n) => !builtinByName.has(n));

  const customRows = missingFromBuiltins.length > 0
    ? await prisma.subagentDefinition.findMany({
        where: { name: { in: missingFromBuiltins }, enabled: true },
        include: { skills: { include: { skill: { include: { files: true } } } } },
      })
    : [];
  const customByName = new Map(customRows.map((r) => [r.name, r as DbRowWithSkills]));

  const resolved: ResolvedSubagent[] = [];
  for (const name of requestedNames) {
    const builtin = builtinByName.get(name);
    if (builtin) {
      resolved.push({ source: "builtin", builtin });
      continue;
    }
    const custom = customByName.get(name);
    if (custom) {
      resolved.push({ source: "custom", custom: toCustomSubagentSpec(custom) });
      continue;
    }
    log.warn(`[subagent-resolver] Unknown subagent name "${name}" — skipping`);
  }
  return resolved;
}

/**
 * Subset helper used by the /run handler: returns ONLY the custom subagents
 * that need to cross the wire to xyne-claw. Built-ins live in claw's
 * bundled code and don't need to be sent.
 */
export async function resolveCustomSubagentsForRun(
  prisma: PrismaClient,
  requestedNames: string[],
): Promise<CustomSubagentSpec[]> {
  const all = await resolveSubagentsForRun(prisma, requestedNames);
  return all
    .filter((r): r is ResolvedSubagent & { source: "custom"; custom: CustomSubagentSpec } => r.source === "custom" && !!r.custom)
    .map((r) => r.custom);
}
