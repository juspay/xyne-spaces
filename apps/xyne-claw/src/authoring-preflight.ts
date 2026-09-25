/**
 * Chat agent-authoring preflight — ask claw-auth /suggest-tools for a closed
 * catalog pick, then inject exact slugs into the authoring turn.
 */
import { createLogger } from "./logger.js";
import { SERVER } from "./config.js";

const log = createLogger("authoring-preflight");

export interface AuthoringPreflightResult {
  tools: string[];
  skillSlugs: string[];
  permissionMode: "ask-first" | "read-only";
  note: string;
}

function extractToolIds(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const subagents = data["subagents"];
  if (Array.isArray(subagents)) {
    for (const name of subagents) {
      if (typeof name === "string" && name.trim()) out.push(name.trim());
    }
  }
  const integrations = data["integrations"];
  if (Array.isArray(integrations)) {
    for (const raw of integrations) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const slug = typeof row["slug"] === "string" ? row["slug"].trim() : "";
      const readTools = Array.isArray(row["readTools"]) ? row["readTools"] : [];
      const writeTools = Array.isArray(row["writeTools"]) ? row["writeTools"] : [];
      for (const name of [...readTools, ...writeTools]) {
        if (typeof name === "string" && name.trim()) out.push(name.trim());
      }
      // Custom / gateway groups often grant by slug when tool names are empty.
      if (slug && readTools.length === 0 && writeTools.length === 0) out.push(slug);
    }
  }
  return [...new Set(out)].slice(0, 20);
}

/**
 * Returns null when LAYA_SUGGEST=off, auth unreachable, or the job looks vague
 * (caller keeps the normal authoring prompt).
 */
export async function fetchAuthoringPreflight(args: {
  intent: string;
  userId: string;
}): Promise<AuthoringPreflightResult | null> {
  const mode = (process.env["LAYA_SUGGEST"] ?? "fast").trim().toLowerCase();
  if (mode === "off") return null;
  const intent = args.intent.trim();
  if (intent.length < 12) return null;
  // Vague create asks — keep the "ask what job" path.
  if (/^(make|create|build)\s+(me\s+)?(an?\s+)?(agent|bot)\s*\.?$/i.test(intent)) {
    return null;
  }

  try {
    const res = await fetch(`${SERVER.authServiceUrl}/api/v1/agents/suggest-tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
        "x-user-id": args.userId,
      },
      body: JSON.stringify({ description: intent }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      log.warn(`[authoring-preflight] suggest-tools HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      success?: boolean;
      data?: Record<string, unknown>;
    };
    if (!body.success || !body.data || typeof body.data !== "object") return null;
    const tools = extractToolIds(body.data);
    const skillSlugs = Array.isArray(body.data["skillSlugs"])
      ? (body.data["skillSlugs"] as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim())
          .slice(0, 2)
      : [];
    if (tools.length === 0 && skillSlugs.length === 0) return null;

    const permissionMode: "ask-first" | "read-only" = /write|send|delete|post|pay|force-?push/i.test(
      intent,
    )
      ? "ask-first"
      : "read-only";

    const note = [
      "## Authoring closed set (Laya gap fill)",
      "The job is named. Call `propose-agent` THIS turn with exact identifiers from this closed set.",
      "Do NOT call `list_available_tools`. Do NOT ask a risk question — permissionMode is already set.",
      `permissionMode: ${permissionMode}`,
      tools.length > 0 ? `tools (exact): ${JSON.stringify(tools)}` : "tools: []",
      skillSlugs.length > 0
        ? `skillSlugs (exact): ${JSON.stringify(skillSlugs)}`
        : "skillSlugs: []",
      "You may omit tools that are clearly unused, but you must not invent identifiers outside this list.",
    ].join("\n");

    log.info(
      `[authoring-preflight] tools=${tools.length} skills=${skillSlugs.length} permission=${permissionMode}`,
    );
    return { tools, skillSlugs, permissionMode, note };
  } catch (err) {
    log.warn(
      `[authoring-preflight] failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
