/**
 * Declarative projection of a claw-auth Agent row ↔ `.xyne/agents/<slug>.toml`.
 * Postgres remains source of truth. Secrets must never appear in the file.
 */

import { normalizePermissionMode, type AgentPermissionMode } from "./agent-prompt-contract.js";

export const AGENT_TOML_FORBIDDEN_KEYS = [
  "signing_secret",
  "spaces_app_token",
  "spaces_app_id",
  "service_account",
  "service_account_token",
  "mcp_token",
  "api_key",
  "password",
] as const;

export interface AgentTomlProjection {
  name: string;
  description: string;
  slug?: string;
  system_prompt?: string;
  system_prompt_file?: string;
  model?: string;
  permission_mode: AgentPermissionMode;
  skill_slugs: string[];
  tools_allow: string[];
  tools_deny: string[];
  kb_scope: "COLLECTIONS" | "USER";
  collection_ids: string[];
  /** Optional content hash of a prior export — re-import is a no-op when equal. */
  content_hash?: string;
}

export type AgentTomlParseResult =
  | { ok: true; projection: AgentTomlProjection }
  | { ok: false; error: string };

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseArray(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((part) => stripQuotes(part.trim()))
    .filter(Boolean);
}

/**
 * Minimal TOML subset parser for agent projections (no nested tables beyond
 * [tools] / [context] / [approval]). Avoids adding a TOML dependency.
 */
export function parseAgentToml(source: string): AgentTomlParseResult {
  const text = source.replace(/\r\n/g, "\n");
  for (const key of AGENT_TOML_FORBIDDEN_KEYS) {
    if (new RegExp(`^\\s*${key}\\s*=`, "im").test(text) || new RegExp(`\\[${key}\\]`, "i").test(text)) {
      return { ok: false, error: `Forbidden key "${key}" — secrets cannot be imported from TOML.` };
    }
  }

  const flat: Record<string, string> = {};
  let section = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim().toLowerCase();
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    const path = section ? `${section}.${key}` : key;
    flat[path] = value;
  }

  const name = flat["name"] ? stripQuotes(flat["name"]) : "";
  if (!name) return { ok: false, error: "name is required" };

  const description = flat["description"] ? stripQuotes(flat["description"]) : "";
  const slug = flat["slug"] ? stripQuotes(flat["slug"]) : undefined;
  const system_prompt = flat["system_prompt"]
    ? stripQuotes(flat["system_prompt"]).replace(/\\n/g, "\n")
    : undefined;
  const system_prompt_file = flat["system_prompt_file"]
    ? stripQuotes(flat["system_prompt_file"])
    : undefined;
  const model = flat["model"] ? stripQuotes(flat["model"]) : undefined;
  const permission_mode = normalizePermissionMode(
    flat["approval.mode"]
      ? stripQuotes(flat["approval.mode"])
      : flat["permission_mode"]
        ? stripQuotes(flat["permission_mode"])
        : undefined,
  );

  const skill_slugs = flat["skill_slugs"]
    ? parseArray(flat["skill_slugs"])
    : flat["skills.slugs"]
      ? parseArray(flat["skills.slugs"])
      : [];
  const tools_allow = flat["tools.allow"]
    ? parseArray(flat["tools.allow"])
    : flat["tools.mcp_servers"]
      ? parseArray(flat["tools.mcp_servers"])
      : [];
  const tools_deny = flat["tools.deny"]
    ? parseArray(flat["tools.deny"])
    : flat["tools.disallowed_tools"]
      ? parseArray(flat["tools.disallowed_tools"])
      : [];

  const kbRaw = flat["context.kb_scope"]
    ? stripQuotes(flat["context.kb_scope"])
    : flat["kb_scope"]
      ? stripQuotes(flat["kb_scope"])
      : "COLLECTIONS";
  const kb_scope: "COLLECTIONS" | "USER" = kbRaw === "USER" ? "USER" : "COLLECTIONS";
  const collection_ids = flat["context.collection_ids"]
    ? parseArray(flat["context.collection_ids"])
    : flat["collection_ids"]
      ? parseArray(flat["collection_ids"])
      : [];
  const content_hash = flat["content_hash"] ? stripQuotes(flat["content_hash"]) : undefined;

  if (!system_prompt && !system_prompt_file) {
    return { ok: false, error: "system_prompt or system_prompt_file is required" };
  }

  return {
    ok: true,
    projection: {
      name,
      description,
      ...(slug ? { slug } : {}),
      ...(system_prompt ? { system_prompt } : {}),
      ...(system_prompt_file ? { system_prompt_file } : {}),
      ...(model ? { model } : {}),
      permission_mode,
      skill_slugs,
      tools_allow,
      tools_deny,
      kb_scope,
      collection_ids,
      ...(content_hash ? { content_hash } : {}),
    },
  };
}

export function renderAgentToml(projection: AgentTomlProjection): string {
  const lines: string[] = [
    `# Xyne agent projection — import via claw-auth. Secrets are never stored here.`,
    `name = ${JSON.stringify(projection.name)}`,
    `description = ${JSON.stringify(projection.description)}`,
  ];
  if (projection.slug) lines.push(`slug = ${JSON.stringify(projection.slug)}`);
  if (projection.model) lines.push(`model = ${JSON.stringify(projection.model)}`);
  if (projection.system_prompt) {
    lines.push(`system_prompt = ${JSON.stringify(projection.system_prompt)}`);
  }
  if (projection.system_prompt_file) {
    lines.push(`system_prompt_file = ${JSON.stringify(projection.system_prompt_file)}`);
  }
  lines.push(`permission_mode = ${JSON.stringify(projection.permission_mode)}`);
  lines.push(`skill_slugs = [${projection.skill_slugs.map((s) => JSON.stringify(s)).join(", ")}]`);
  lines.push(`kb_scope = ${JSON.stringify(projection.kb_scope)}`);
  lines.push(`collection_ids = [${projection.collection_ids.map((s) => JSON.stringify(s)).join(", ")}]`);
  if (projection.content_hash) {
    lines.push(`content_hash = ${JSON.stringify(projection.content_hash)}`);
  }
  lines.push("");
  lines.push("[tools]");
  lines.push(`allow = [${projection.tools_allow.map((s) => JSON.stringify(s)).join(", ")}]`);
  lines.push(`deny = [${projection.tools_deny.map((s) => JSON.stringify(s)).join(", ")}]`);
  lines.push("");
  lines.push("[approval]");
  lines.push(`mode = ${JSON.stringify(projection.permission_mode)}`);
  lines.push("");
  return lines.join("\n");
}

/** Stable hash of projection fields used for export/import no-op detection. */
export async function hashAgentProjection(projection: AgentTomlProjection): Promise<string> {
  const payload = JSON.stringify({
    name: projection.name,
    description: projection.description,
    slug: projection.slug ?? "",
    system_prompt: projection.system_prompt ?? "",
    system_prompt_file: projection.system_prompt_file ?? "",
    model: projection.model ?? "",
    permission_mode: projection.permission_mode,
    skill_slugs: projection.skill_slugs,
    tools_allow: projection.tools_allow,
    tools_deny: projection.tools_deny,
    kb_scope: projection.kb_scope,
    collection_ids: projection.collection_ids,
  });
  const data = new TextEncoder().encode(payload);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Node fallback
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(payload).digest("hex");
}
