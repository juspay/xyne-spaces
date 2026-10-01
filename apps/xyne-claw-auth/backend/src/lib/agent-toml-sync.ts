/**
 * Build / apply `.xyne/agents/*.toml` projections for claw-auth Agent rows.
 */

import {
  hashAgentProjection,
  parseAgentToml,
  renderAgentToml,
  normalizePermissionMode,
  validateSystemPromptContract,
  type AgentTomlProjection,
} from "xyne-claw-shared";

export interface AgentRowForToml {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId?: string | null;
  config?: Record<string, unknown> | null;
  kbScope?: string | null;
  skillSlugs?: string[];
  collectionIds?: string[];
}

export async function exportAgentToml(row: AgentRowForToml): Promise<string> {
  const config = row.config ?? {};
  const tools = (config["tools"] as Record<string, unknown> | undefined) ?? {};
  const tools_allow = [
    ...((tools["subagents"] as string[] | undefined) ?? []),
    ...((tools["direct"] as string[] | undefined) ?? []),
    ...((tools["custom"] as string[] | undefined) ?? []),
    ...((tools["gateway"] as string[] | undefined) ?? []),
  ];
  const tools_deny = Array.isArray(config["deniedTools"])
    ? (config["deniedTools"] as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  const projection: AgentTomlProjection = {
    name: row.name,
    description: row.description ?? "",
    slug: row.slug,
    system_prompt: row.systemPrompt,
    ...(row.modelId ? { model: row.modelId } : {}),
    permission_mode: normalizePermissionMode(config["permissionMode"]),
    skill_slugs: row.skillSlugs ?? [],
    tools_allow,
    tools_deny,
    kb_scope: row.kbScope === "USER" ? "USER" : "COLLECTIONS",
    collection_ids: row.collectionIds ?? [],
  };
  const content_hash = await hashAgentProjection(projection);
  return renderAgentToml({ ...projection, content_hash });
}

export type ImportAgentTomlResult =
  | { ok: true; noop: true; projection: AgentTomlProjection }
  | {
      ok: true;
      noop: false;
      projection: AgentTomlProjection;
      systemPrompt: string;
      permissionMode: string;
      deniedTools: string[];
      toolsAllow: string[];
      skillSlugs: string[];
      kbScope: "COLLECTIONS" | "USER";
      collectionIds: string[];
      modelId?: string;
    }
  | { ok: false; error: string };

export async function importAgentToml(
  source: string,
  currentHash?: string | null,
): Promise<ImportAgentTomlResult> {
  const parsed = parseAgentToml(source);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const projection = parsed.projection;
  const incomingHash = await hashAgentProjection(projection);
  if (
    currentHash &&
    (projection.content_hash === currentHash || incomingHash === currentHash)
  ) {
    return { ok: true, noop: true, projection };
  }

  const systemPrompt = projection.system_prompt?.trim() ?? "";
  if (!systemPrompt && projection.system_prompt_file) {
    return {
      ok: false,
      error: "system_prompt_file is declared but file contents must be inlined as system_prompt for import.",
    };
  }
  const promptCheck = validateSystemPromptContract(systemPrompt);
  if (!promptCheck.ok) {
    return { ok: false, error: promptCheck.error ?? "system_prompt failed contract" };
  }

  return {
    ok: true,
    noop: false,
    projection: { ...projection, content_hash: incomingHash },
    systemPrompt,
    permissionMode: projection.permission_mode,
    deniedTools: projection.tools_deny,
    toolsAllow: projection.tools_allow,
    skillSlugs: projection.skill_slugs,
    kbScope: projection.kb_scope,
    collectionIds: projection.collection_ids,
    ...(projection.model ? { modelId: projection.model } : {}),
  };
}
