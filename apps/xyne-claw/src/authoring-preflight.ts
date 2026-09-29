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

const MAX_TOOL_IDS = 20;
const MAX_SKILLS = 2;
// claw-auth's own suggest-tools budget is 20s; past 12s the authoring turn is
// better off going ahead with its normal prompt than waiting for a closed set.
const REQUEST_TIMEOUT_MS = 12_000;

function pushName(out: string[], value: unknown): void {
  if (typeof value === "string" && value.trim()) out.push(value.trim());
}

/** Tool names from `{slug, readTools, writeTools}` rows: bound `integrations`, or `suggested.integrations`. */
function pushIntegrationTools(out: string[], rows: unknown): void {
  if (!Array.isArray(rows)) return;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const slug = typeof row["slug"] === "string" ? row["slug"].trim() : "";
    const readTools = Array.isArray(row["readTools"]) ? row["readTools"] : [];
    const writeTools = Array.isArray(row["writeTools"]) ? row["writeTools"] : [];
    for (const name of [...readTools, ...writeTools]) pushName(out, name);
    // Custom / gateway groups often grant by slug when tool names are empty.
    if (slug && readTools.length === 0 && writeTools.length === 0) out.push(slug);
  }
}

/** Rows of `data.suggested.<hub>` (absent on older claw-auth responses). */
function suggestedRows(data: Record<string, unknown>, hub: string): unknown[] {
  const suggested = data["suggested"];
  if (!suggested || typeof suggested !== "object") return [];
  const rows = (suggested as Record<string, unknown>)[hub];
  return Array.isArray(rows) ? rows : [];
}

function rowString(raw: unknown, key: string): unknown {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
}

/**
 * The closed tool set is what claw-auth BOUND to the draft plus what it only
 * SUGGESTED (one-click chips): the model may use either, bound first so the
 * cap drops suggestions before it drops anything the agent already has.
 * Old responses carry no `suggested`, and read the same as before.
 */
function extractToolIds(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const subagents = data["subagents"];
  if (Array.isArray(subagents)) for (const name of subagents) pushName(out, name);
  pushIntegrationTools(out, data["integrations"]);
  for (const row of suggestedRows(data, "subagents")) pushName(out, rowString(row, "name"));
  pushIntegrationTools(out, suggestedRows(data, "integrations"));
  return [...new Set(out)].slice(0, MAX_TOOL_IDS);
}

function extractSkillSlugs(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const bound = data["skillSlugs"];
  if (Array.isArray(bound)) for (const slug of bound) pushName(out, slug);
  for (const row of suggestedRows(data, "skills")) pushName(out, rowString(row, "slug"));
  return [...new Set(out)].slice(0, MAX_SKILLS);
}

/**
 * `writes` is claw-auth's 0..1 probability that the job changes data somewhere.
 * Older responses lack it, so the intent text is the fallback.
 */
function derivePermissionMode(data: Record<string, unknown>, intent: string): "ask-first" | "read-only" {
  const writes = data["writes"];
  if (typeof writes === "number" && Number.isFinite(writes)) return writes >= 0.5 ? "ask-first" : "read-only";
  return /write|send|delete|post|pay|force-?push/i.test(intent) ? "ask-first" : "read-only";
}

/**
 * Returns null when AUTHORING_PREFLIGHT=off, auth unreachable or timed out, or
 * the job looks vague (caller keeps the normal authoring prompt).
 */
export async function fetchAuthoringPreflight(args: {
  intent: string;
  userId: string;
}): Promise<AuthoringPreflightResult | null> {
  if ((process.env["AUTHORING_PREFLIGHT"] ?? "").trim().toLowerCase() === "off") return null;
  const intent = args.intent.trim();
  if (intent.length < 12) return null;
  // Vague create asks — keep the "ask what job" path.
  if (/^(make|create|build)\s+(me\s+)?(an?\s+)?(agent|bot)\s*\.?$/i.test(intent)) {
    return null;
  }

  try {
    const res = await fetch(`${SERVER.authServiceUrl}/claw/api/v1/agents/suggest-tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
        "x-user-id": args.userId,
      },
      body: JSON.stringify({ description: intent }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
    const skillSlugs = extractSkillSlugs(body.data);
    if (tools.length === 0 && skillSlugs.length === 0) return null;

    const permissionMode = derivePermissionMode(body.data, intent);

    const note = [
      "## Authoring closed set",
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
    // The timeout signal aborts the fetch or the body read; either lands here.
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    log.warn(
      timedOut
        ? `[authoring-preflight] suggest-tools timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `[authoring-preflight] failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
