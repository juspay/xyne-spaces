/**
 * Create-canvas streamed draft, the claw-auth hop:
 *
 *   dashboard ─POST /claw/api/v1/agents/draft─► claw-auth ─POST /agents/draft─► xyne-claw
 *
 * xyne-claw runs the LLM work and has no database, so this side adds what it
 * can't know (the org's tool catalog, skills, knowledge, the time) and rewrites
 * two things on the way back:
 *
 *   - the engine's raw `capabilities` picks become one `plan` event shaped like
 *     POST /agents/suggest-tools, so the canvas maps it with the same code the
 *     Suggest button and the XOR hub plan already use;
 *   - an `identity.handle` another agent in the org already has gets a free
 *     suffix (`handleAdjusted` says so).
 *
 * Everything else passes through unchanged.
 */
import { DRAFT_HISTORY_TURN_CHARS, DRAFT_HISTORY_TURNS } from "xyne-claw-shared";
import type {
  AgentDraftRequest,
  ClawDraftRequest,
  DraftField,
  DraftPick,
} from "xyne-claw-shared";
import {
  ALL_HUBS,
  toSuggestResponse,
  type Hub,
  type HubSelection,
  type KnowledgeCandidate,
  type SelectionInput,
  type SelectionPlan,
  type SkillCandidate,
  type SuggestCatalog,
  type SuggestToolsData,
} from "./tool-selection.js";

export const DRAFT_FIELDS: readonly DraftField[] = [
  "name",
  "handle",
  "description",
  "instructions",
  "tools",
  "skills",
  "knowledge",
  "permission",
  "schedule",
  "properties",
];

const isString = (value: unknown): value is string => typeof value === "string";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The dashboard's request, or why it is not one. */
export function parseAgentDraftRequest(body: unknown): AgentDraftRequest | string {
  if (!isRecord(body)) return "body is required";
  if (!isString(body["draftId"]) || !isString(body["turnId"])) return "draftId and turnId are required";
  if (!isString(body["message"]) || body["message"].trim().length === 0) return "message is required";
  if (body["message"].length > 4_000) return "message is too long";
  const canvas = body["canvas"];
  if (!isRecord(canvas)) return "canvas is required";
  const timezone = isString(body["timezone"]) && isValidTimezone(body["timezone"]) ? body["timezone"] : "UTC";
  const history = Array.isArray(body["history"])
    ? (body["history"] as unknown[])
        .filter(
          (turn): turn is { role: "user" | "assistant"; text: string } =>
            isRecord(turn) && (turn["role"] === "user" || turn["role"] === "assistant") && isString(turn["text"]),
        )
        .slice(-DRAFT_HISTORY_TURNS)
        .map((turn) => ({ role: turn.role, text: turn.text.slice(0, DRAFT_HISTORY_TURN_CHARS) }))
    : [];
  const userOwned = Array.isArray(body["userOwned"])
    ? (body["userOwned"] as unknown[]).filter((f): f is DraftField => DRAFT_FIELDS.includes(f as DraftField))
    : [];
  const text = (key: string): string => (isString(canvas[key]) ? (canvas[key] as string) : "");
  return {
    draftId: body["draftId"],
    turnId: body["turnId"],
    message: body["message"],
    history,
    userOwned,
    timezone,
    canvas: {
      name: text("name"),
      handle: text("handle"),
      description: text("description"),
      instructions: text("instructions"),
      permissionMode: (canvas["permissionMode"] as AgentDraftRequest["canvas"]["permissionMode"]) ?? "ask-first",
      schedule: (canvas["schedule"] as AgentDraftRequest["canvas"]["schedule"]) ?? null,
      capabilities: Array.isArray(canvas["capabilities"])
        ? (canvas["capabilities"] as AgentDraftRequest["canvas"]["capabilities"])
        : [],
      ...(Array.isArray(canvas["customProperties"])
        ? { customProperties: canvas["customProperties"] as NonNullable<AgentDraftRequest["canvas"]["customProperties"]> }
        : {}),
    },
  };
}

/** The request xyne-claw gets: the dashboard's, plus what only this side knows. */
export function buildClawDraftRequest(args: {
  request: AgentDraftRequest;
  userId: string;
  now: Date;
  catalog: SuggestCatalog & {
    integrations: Array<SuggestCatalog["integrations"][number] & { kind: "mcp" | "builtin" | "custom" | "gateway" }>;
  };
  skills: SkillCandidate[];
  knowledge: KnowledgeCandidate[];
}): ClawDraftRequest {
  return {
    ...args.request,
    userId: args.userId,
    now: args.now.toISOString(),
    catalog: args.catalog,
    skillCandidates: args.skills.map((s) => ({ slug: s.slug, name: s.name, description: s.description })),
    knowledgeCandidates: args.knowledge.map((k) => ({ id: k.id, name: k.name })),
  };
}

const HUB_OF: Record<DraftPick["hub"], Hub> = {
  mcp: "mcp",
  builtin: "builtin",
  subagent: "subagent",
  skill: "skill",
  knowledge: "knowledge",
};

/**
 * The engine's picks as a suggest-tools response. Write tools are granted only
 * for picks the engine marked `access: "write"`, the same 0.5 cut the XOR path uses.
 */
export function planFromCapabilities(
  capabilities: { bound: DraftPick[]; suggested: DraftPick[] },
  input: Pick<SelectionInput, "intent" | "catalog" | "knowledge">,
): SuggestToolsData {
  const hubs = {} as Record<Hub, HubSelection>;
  for (const hub of ALL_HUBS) hubs[hub] = { hub, bound: [], suggested: [], none: true };
  const writeBySlug: Record<string, number> = {};
  const add = (pick: DraftPick, into: "bound" | "suggested"): void => {
    const hub = HUB_OF[pick.hub];
    hubs[hub][into].push({ id: pick.id, confidence: pick.confidence, reason: pick.reason });
    hubs[hub].none = false;
    if (pick.access === "write") writeBySlug[pick.id] = 1;
  };
  capabilities.bound.forEach((pick) => add(pick, "bound"));
  capabilities.suggested.forEach((pick) => add(pick, "suggested"));
  const needs = {} as Record<Hub, number>;
  for (const hub of ALL_HUBS) {
    needs[hub] = Math.max(0, ...[...hubs[hub].bound, ...hubs[hub].suggested].map((p) => p.confidence));
  }
  const plan: SelectionPlan = {
    hubs,
    needs,
    writes: Object.keys(writeBySlug).length > 0 ? 1 : 0,
    writeBySlug,
    scored: [],
  };
  return toSuggestResponse(
    plan,
    { ...input, namedText: input.intent, skills: [], hubs: [...ALL_HUBS] },
    { source: "xor", latencyMs: 0 },
  );
}

/** One parsed SSE message. `data` keeps `seq` and `turnId`. */
export interface SseMessage {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Split a growing SSE buffer into complete messages. Comment frames
 * (`: keepalive`) are dropped; the unfinished tail is returned for the next chunk.
 */
export function readSseMessages(buffer: string): { messages: SseMessage[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const messages: SseMessage[] = [];
  for (const frame of frames) {
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(data.join("\n"));
      if (isRecord(parsed)) messages.push({ event, data: parsed });
    } catch {
      // A malformed frame is skipped, not fatal: the rest of the turn still lands.
    }
  }
  return { messages, rest };
}

/** `name` + `data` back into one SSE frame, the same framing xyne-claw uses. */
export function frameSse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** First free `handle`, `handle-2`, `handle-3`… given a lookup of taken handles. */
export async function freeHandle(handle: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(handle))) return handle;
  for (let n = 2; n < 50; n++) {
    const candidate = `${handle.slice(0, 44)}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${handle.slice(0, 40)}-${Date.now().toString(36).slice(-6)}`;
}

/**
 * Why a repeating schedule would be refused when the agent is saved, or null.
 * Mirrors the scheduled-jobs minimum-interval rule, so the canvas can say so now.
 */
export function cronIntervalProblem(cron: string, minIntervalMinutes: number): string | null {
  if (minIntervalMinutes <= 0) return null;
  const minute = cron.trim().split(/\s+/)[0] ?? "";
  if (minute === "*") return `Schedules can run at most every ${minIntervalMinutes} minutes.`;
  const step = /^\*\/(\d+)$/.exec(minute);
  if (step && Number(step[1]) < minIntervalMinutes) {
    return `Schedules can run at most every ${minIntervalMinutes} minutes.`;
  }
  return null;
}

