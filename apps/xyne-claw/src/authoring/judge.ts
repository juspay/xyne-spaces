/**
 * Capability judge for the streamed agent draft: which MCP products, built-in
 * tools, subagents, skills and knowledge collections does this job need?
 *
 * One fast-model JSON call covers every hub. Ids the model returns are checked
 * against the catalog it was shown, then the shared confidence thresholds
 * decide what is bound to the canvas and what is only suggested.
 */
import {
  BUILTIN_RULE_TABLE,
  applyBuiltinThresholds,
  applyKnowledgeThresholds,
  applyMcpThresholds,
  applySkillThresholds,
  applySubagentThresholds,
  type AppliedHubResult,
  type ClawDraftRequest,
  type DraftHub,
  type DraftPick,
  type JudgedPick,
} from "xyne-claw-shared";
import { chatJson, type AuthoringMessage } from "./authoring-llm.js";

/** How many tool names to show per integration. The judge picks products, not tools. */
const TOOL_NAMES_PER_INTEGRATION = 10;
const MAX_SUBAGENT_PICKS = 4;
/** A pick this sure was named by the user, not inferred. */
const NAMED_CONFIDENCE = 0.95;
const MAX_MCP_PICKS = 6;

/**
 * Products the judge never offers: every agent already has them (App Tools'
 * bot-credential writes) or nobody can connect them (the pinned dashboard and
 * workflow servers). Picking one only adds a pill and a connect card.
 */
export const NOT_PICKABLE_PRODUCTS: ReadonlySet<string> = new Set([
  "xyne-spaces-app-tools",
  "xyne-dashboard",
  "xyne-workflows",
]);

/**
 * Social and news feeds, with the words that name them. Their tools match
 * "mentions" or "posts" in almost any job, so the model reaches for them too
 * often: bound only when the job names one, otherwise kept as a suggestion.
 */
const SOCIAL_PRODUCTS: ReadonlyMap<string, RegExp> = new Map([
  ["x-news", /\b(x|twitter|tweets?|x\.com)\b/i],
  ["twitter", /\b(x|twitter|tweets?|x\.com)\b/i],
  ["reddit", /\b(reddit|subreddits?)\b/i],
  ["rapidapi-linkedin", /\blinked\s?in\b/i],
]);

/** The judge's products: connected ones and gateways, minus those it never offers. */
const pickableProducts = (catalog: JudgeInput["catalog"]): JudgeInput["catalog"]["integrations"] =>
  catalog.integrations.filter(
    (i) => (i.kind === "mcp" || i.kind === "gateway") && !NOT_PICKABLE_PRODUCTS.has(i.slug),
  );

export interface JudgeInput {
  /** The job, in the user's words plus any context worth matching. */
  intent: string;
  catalog: ClawDraftRequest["catalog"];
  skills: ClawDraftRequest["skillCandidates"];
  knowledge: ClawDraftRequest["knowledgeCandidates"];
  hubs: readonly DraftHub[];
}

export interface JudgedCapabilities {
  hubs: Record<DraftHub, AppliedHubResult>;
  /** Flat list of every bound and suggested pick, with labels resolved. */
  bound: DraftPick[];
  suggested: DraftPick[];
}

const truncate = (text: string, max: number): string => {
  const trimmed = (text ?? "").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
};

const names = (tools: Array<{ name: string }>): string => {
  const shown = tools.slice(0, TOOL_NAMES_PER_INTEGRATION).map((t) => t.name).join(", ");
  return tools.length > TOOL_NAMES_PER_INTEGRATION ? `${shown}, +${tools.length - TOOL_NAMES_PER_INTEGRATION} more` : shown;
};

function integrationLine(i: JudgeInput["catalog"]["integrations"][number]): string {
  const about = i.description?.trim() ? ` — ${truncate(i.description, 140)}` : "";
  const reads = i.readTools.length > 0 ? ` | read: ${names(i.readTools)}` : "";
  const writes = i.writeTools.length > 0 ? ` | write: ${names(i.writeTools)}` : "";
  return `- ${i.slug} | ${i.label}${about}${reads}${writes}`;
}

export function buildJudgePrompt(input: JudgeInput): string {
  const wanted = new Set(input.hubs);
  const products = pickableProducts(input.catalog);
  const builtins = input.catalog.integrations.filter((i) => i.kind === "builtin" || i.kind === "custom");
  const sections: string[] = [];
  if (wanted.has("mcp")) {
    sections.push(`Products (MCP / gateway; id = slug):\n${products.map(integrationLine).join("\n") || "(none)"}`);
  }
  if (wanted.has("builtin")) {
    sections.push(`Built-in tools (id = slug):\n${builtins.map(integrationLine).join("\n") || "(none)"}`);
  }
  if (wanted.has("subagent")) {
    sections.push(
      `Subagents (id = name):\n${input.catalog.subagents.map((s) => `- ${s.name}: ${truncate(s.description, 110)}`).join("\n") || "(none)"}`,
    );
  }
  if (wanted.has("skill")) {
    sections.push(
      `Skills (id = slug):\n${input.skills.map((s) => `- ${s.slug}: ${truncate(`${s.name} — ${s.description}`, 120)}`).join("\n") || "(none)"}`,
    );
  }
  if (wanted.has("knowledge")) {
    sections.push(
      `Knowledge collections (id = id):\n${input.knowledge.map((k) => `- ${k.id}: ${truncate(k.name, 80)}`).join("\n") || "(none)"}`,
    );
  }
  const shape = [...wanted]
    .map((hub) => `  "${hub}": [{"id":"…","confidence":0.0,"reason":"under 12 words"${hub === "mcp" ? ',"access":"read|write"' : ""}}]`)
    .join(",\n");
  return [
    "Pick what this agent needs from the catalog below. Judge every hub in one answer.",
    "",
    "Job:",
    truncate(input.intent, 1500),
    "",
    ...sections.flatMap((s) => [s, ""]),
    "Rules:",
    "- Use only ids listed above. Never invent one.",
    "- Return an empty array for a hub the job does not clearly need. Fewer is better.",
    "- confidence is 0 to 1. A product or tool the user names outright is 1.0.",
    "- mcp: set access to \"write\" only when the job must send, post, create, edit or delete. Reading and reporting is \"read\".",
    "- Pick at most 2 subagents, 3 skills, 1 knowledge collection.",
    "- Judge a product by its description. Tool lists can be partial: a product may list only its write tools.",
    "- A messaging or email product is needed only when the job names it or must send through it.",
    "- Mentions, DMs, messages, activity, channels, threads and tickets with no product named are the user's Xyne Spaces (xyne-spaces). They never mean X/Twitter, Reddit or Slack.",
    "- Social and news feeds (X/Twitter, Reddit, LinkedIn) only when the job names them or their content (tweets, subreddits).",
    "- Gmail, Google Calendar and Google Drive are the google product; Outlook, Teams and OneDrive are microsoft.",
    "- Telling or sending the user the result (\"send me\", \"tell me\", \"remind me\", \"a report\") happens in the agent's own chat. It needs no messaging product (Slack, email) unless the job names one.",
    "- Running on a schedule is built in. A calendar product is only for reading or changing the user's calendar.",
    "",
    "Return only JSON in this shape:",
    `{\n${shape}\n}`,
  ].join("\n");
}

interface RawPick {
  id?: unknown;
  confidence?: unknown;
  reason?: unknown;
  access?: unknown;
}

function cleanPicks(raw: unknown, known: Map<string, string>): Array<JudgedPick & { access?: "read" | "write" }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<JudgedPick & { access?: "read" | "write" }> = [];
  for (const item of raw as RawPick[]) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
    // An empty catalog list means we had nothing to check against: accept nothing.
    if (!known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence)
      ? Math.min(1, Math.max(0, item.confidence))
      : 0.5;
    out.push({
      id: item.id,
      confidence,
      reason: typeof item.reason === "string" ? truncate(item.reason, 100) : "",
      ...(item.access === "write" ? { access: "write" as const } : item.access === "read" ? { access: "read" as const } : {}),
    });
  }
  return out;
}

const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Built-in ids whose rule-table trigger matches the job, so the lower judge bar applies. */
export function ruleMatchedBuiltinIds(
  intent: string,
  builtins: ReadonlyArray<{ slug: string; label: string }>,
): Set<string> {
  const matched = new Set<string>();
  for (const rule of BUILTIN_RULE_TABLE) {
    if (!rule.re.test(intent)) continue;
    for (const builtin of builtins) {
      const hay = normalize(`${builtin.slug} ${builtin.label}`);
      if (rule.needles.some((needle) => hay.includes(normalize(needle)))) matched.add(builtin.slug);
    }
  }
  return matched;
}

/** Apply catalog checks and thresholds to the model's raw answer. Exported for tests. */
export function resolveJudgement(raw: Record<string, unknown>, input: JudgeInput): JudgedCapabilities {
  const wanted = new Set(input.hubs);
  const products = pickableProducts(input.catalog);
  const builtins = input.catalog.integrations.filter((i) => i.kind === "builtin" || i.kind === "custom");
  const labels: Record<DraftHub, Map<string, string>> = {
    mcp: new Map(products.map((i) => [i.slug, i.label])),
    builtin: new Map(builtins.map((i) => [i.slug, i.label])),
    subagent: new Map(input.catalog.subagents.map((s) => [s.name, s.name])),
    skill: new Map(input.skills.map((s) => [s.slug, s.name])),
    knowledge: new Map(input.knowledge.map((k) => [k.id, k.name])),
  };
  const empty: AppliedHubResult = { bound: [], suggested: [], none: true };
  const hubs: Record<DraftHub, AppliedHubResult> = {
    mcp: empty,
    builtin: empty,
    subagent: empty,
    skill: empty,
    knowledge: empty,
  };
  const access = new Map<string, "read" | "write">();
  const connection = new Map(products.filter((p) => p.requiresConnection).map((p) => [p.slug, p.requiresConnection as string]));

  for (const hub of ["mcp", "builtin", "subagent", "skill", "knowledge"] as const) {
    if (!wanted.has(hub)) continue;
    const picks = cleanPicks(raw[hub], labels[hub]);
    if (hub === "mcp") {
      for (const pick of picks) if (pick.access) access.set(pick.id, pick.access);
    }
    const trimmed = picks.map(({ id, confidence, reason }) => ({ id, confidence, reason }));
    hubs[hub] =
      hub === "mcp"
        ? demoteUnnamedSocial(applyMcpThresholds(trimmed.slice(0, MAX_MCP_PICKS)), input.intent)
        : hub === "builtin"
          ? applyBuiltinThresholds(trimmed, ruleMatchedBuiltinIds(input.intent, builtins))
          : hub === "subagent"
            ? applySubagentThresholds(
                trimmed.slice(0, MAX_SUBAGENT_PICKS),
                // Delegation changes how the agent runs: bind only what the user named
                // (the judge scores a named item 1.0); the rest are suggestions.
                new Set(trimmed.filter((p) => p.confidence >= NAMED_CONFIDENCE).map((p) => p.id)),
              )
            : hub === "skill"
              ? applySkillThresholds(trimmed)
              : applyKnowledgeThresholds(trimmed.slice(0, 1));
  }

  const toPick = (hub: DraftHub) => (pick: JudgedPick): DraftPick => ({
    hub,
    id: pick.id,
    label: labels[hub].get(pick.id) ?? pick.id,
    confidence: pick.confidence,
    reason: pick.reason,
    ...(hub === "mcp" ? { access: access.get(pick.id) ?? "read" } : {}),
    ...(hub === "mcp" && connection.has(pick.id) ? { requiresConnection: connection.get(pick.id) as string } : {}),
  });
  const bound: DraftPick[] = [];
  const suggested: DraftPick[] = [];
  for (const hub of ["mcp", "builtin", "subagent", "skill", "knowledge"] as const) {
    bound.push(...hubs[hub].bound.map(toPick(hub)));
    suggested.push(...hubs[hub].suggested.map(toPick(hub)));
  }
  return { hubs, bound, suggested };
}

/** Social feeds the job doesn't name move from bound to suggested (see SOCIAL_PRODUCTS). */
function demoteUnnamedSocial(result: AppliedHubResult, intent: string): AppliedHubResult {
  const unnamed = (pick: JudgedPick): boolean => {
    const named = SOCIAL_PRODUCTS.get(pick.id);
    return named !== undefined && !named.test(intent);
  };
  const moved = result.bound.filter(unnamed);
  if (moved.length === 0) return result;
  return { ...result, bound: result.bound.filter((p) => !unnamed(p)), suggested: [...result.suggested, ...moved] };
}

/**
 * Every catalog item in the given hubs, for "add all the MCPs" and the like: no
 * model call and none of the judge's caps, since the user asked for all of them.
 * MCPs get read access (writes stay something to ask for by name), so one with
 * no read tools is left out: the canvas would have nothing to turn on. A product
 * the user hasn't connected is only suggested, so the canvas can offer to connect it.
 */
export function catalogPicks(
  hubs: readonly DraftHub[],
  input: Pick<JudgeInput, "catalog" | "skills" | "knowledge">,
): { bound: DraftPick[]; suggested: DraftPick[] } {
  const wanted = new Set(hubs);
  const bound: DraftPick[] = [];
  const suggested: DraftPick[] = [];
  const item = (hub: DraftHub, id: string, label: string): DraftPick => ({ hub, id, label, confidence: 1, reason: "" });
  if (wanted.has("mcp")) {
    for (const i of input.catalog.integrations) {
      if ((i.kind !== "mcp" && i.kind !== "gateway") || i.readTools.length === 0 || NOT_PICKABLE_PRODUCTS.has(i.slug)) continue;
      const pick: DraftPick = { ...item("mcp", i.slug, i.label), access: "read" };
      if (i.requiresConnection) suggested.push({ ...pick, requiresConnection: i.requiresConnection });
      else bound.push(pick);
    }
  }
  if (wanted.has("builtin")) {
    for (const i of input.catalog.integrations) {
      if (i.kind === "builtin" || i.kind === "custom") bound.push(item("builtin", i.slug, i.label));
    }
  }
  if (wanted.has("subagent")) {
    for (const s of input.catalog.subagents) bound.push(item("subagent", s.name, s.name));
  }
  if (wanted.has("skill")) {
    for (const s of input.skills) bound.push(item("skill", s.slug, s.name));
  }
  if (wanted.has("knowledge")) {
    for (const k of input.knowledge) bound.push(item("knowledge", k.id, k.name));
  }
  return { bound, suggested };
}

export async function judgeCapabilities(input: JudgeInput, signal?: AbortSignal): Promise<JudgedCapabilities> {
  const messages: AuthoringMessage[] = [
    {
      role: "system",
      content:
        "You judge which catalog items an AI agent needs. Return only compact JSON. Prefer fewer items over guessing. Never invent ids.",
    },
    { role: "user", content: buildJudgePrompt(input) },
  ];
  const raw = await chatJson<Record<string, unknown>>(messages, {
    maxTokens: 700,
    timeoutMs: 9_000,
    temperature: 0.1,
    ...(signal ? { signal } : {}),
  });
  return resolveJudgement(raw, input);
}
