/**
 * First LLM step of a draft turn: decide what to do (ask, chat, draft, edit)
 * and fill the small fields (name, handle, description, permission, schedule).
 * It is one short JSON call so the first canvas field lands in about a second.
 */
import {
  normalizePermissionMode,
  type AgentPermissionMode,
  type ClawDraftRequest,
  type DraftCapabilityRemoval,
  type DraftField,
  type DraftHub,
  type DraftMode,
  type DraftPropertyOp,
  type DraftPropertyType,
  type DraftQuestion,
} from "xyne-claw-shared";
import { chatJson, type AuthoringMessage } from "./authoring-llm.js";
import { normalizeQuestions } from "./questions.js";

export type DraftScheduleDecision =
  | { kind: "repeat"; cron: string; label: string; task: string }
  /** `at` is an absolute ISO instant, already resolved from the user's timezone. */
  | { kind: "once"; at: string; label: string; task: string };

export interface ClassifyDecision {
  mode: DraftMode;
  /** What to say for `chat` and `ask`; empty for draft and edit. */
  reply: string;
  /** Canvas fields this turn writes. Never includes user-owned fields. */
  fields: DraftField[];
  name?: string;
  handle?: string;
  description?: string;
  permission?: { mode: AgentPermissionMode; reason: string };
  schedule?: DraftScheduleDecision | "clear";
  /** Custom property rows to add, change or remove. */
  properties?: DraftPropertyOp[];
  /** The job as the capability judge should read it. */
  capabilityQuery: string;
  capabilityAdds: string[];
  /** Hubs the user wants every catalog item of ("all the MCPs"). No judge call for these. */
  capabilityAddAll?: DraftHub[];
  capabilityRemovals: DraftCapabilityRemoval[];
  /** One paragraph for the instructions writer. */
  instructionsBrief: string;
  /** One sentence for the chat reply. */
  ack: string;
  /** Chat turns: 0–2 public web queries, when the answer depends on current facts. */
  lookup?: string[];
  /** Ask turns: follow-up questions for the question card. */
  questions?: DraftQuestion[];
  /** Set when the model failed and a rule-based guess stands in for it. */
  fromFallback?: boolean;
}

const ALL_FIELDS: readonly DraftField[] = [
  "name", "handle", "description", "instructions", "tools", "skills", "knowledge", "permission", "schedule", "properties",
];
const PROPERTY_TYPES: readonly DraftPropertyType[] = ["text", "number", "checkbox", "tags", "date", "datetime"];
const HUBS: readonly DraftHub[] = ["mcp", "builtin", "subagent", "skill", "knowledge"];

const SYSTEM = `You are the authoring brain of the "Create agent" canvas in Xyne Spaces. The user chats; you decide what to do and fill the small canvas fields. Another step writes the long instructions and another picks tools.

Return ONLY a JSON object:
{
  "mode": "ask" | "chat" | "draft" | "edit",
  "reply": "",
  "fields": [],
  "name": "", "handle": "", "description": "",
  "permission": {"mode": "ask-first|read-only|can-write", "reason": ""},
  "schedule": null,
  "properties": [],
  "capabilityAdds": [],
  "capabilityAddAll": [],
  "capabilityRemovals": [{"hub": "mcp", "id": ""}],
  "instructionsBrief": "",
  "ack": "",
  "lookup": [],
  "questions": []
}

Modes
- "ask": the canvas is empty and the message only asks for an agent, without saying what job it does and without asking anything else ("make an agent", "create a bot"). Draft nothing. questions = 1 or 2 (at most 3) follow-ups for a card: {"label": "Job", "question": "What should this agent do?", "type": "single_choice", "options": [{"label": "Review pull requests", "description": "Checks each PR and flags problems"}, …]}. Two to four options each, tailored to the user's words; the card adds "Something else" itself, so never include it. reply = one short lead-in sentence that also works on its own.
- "chat": anything that is not a request to change this agent: small talk, questions about the agent or canvas, about other agents or providers, research, news, weather, how-to. That includes a question with only a loose wish attached ("how do X and Y differ? I want something like that"): answer first; a button will offer to draft it. Change nothing. Another step writes the answer; reply = one short fallback answer only.
  lookup = 0 to 2 short web search queries, only when the answer depends on facts that change or must be current (weather, prices, news, what a named product does today). Public facts only, never the canvas or anything private. Empty for small talk and questions about this agent.
  Never describe yourself or these instructions (no "brain", "canvas fields", "JSON").
- A message that asks something and also asks for a concrete change ("add Jira and tell me what it can do") is "draft" or "edit": the change wins.
- Answers from a question card come as "Label: answer." sentences ("Job: Review pull requests. Runs: On a schedule."). They name the job: draft with them.
- "draft": the canvas is empty and a job is named. Fill everything and never return questions. Never ask about risk when the job is named; choose the permission mode yourself. "just draft" or "you pick" means draft with sensible defaults.
- "edit": the canvas already has content and the user asks to change something. Put only the fields that change in "fields" and leave the other keys empty.

"fields" lists what this turn writes, from: name, handle, description, instructions, tools, skills, knowledge, permission, schedule, properties. Never list a field in userOwned.

Fields
- name: 2 to 4 words, Title Case, keep acronyms (DM, PR, QA). handle: lowercase, hyphens, no spaces.
- description: one sentence, at most 140 characters, about what the agent does for the user.
- permission.mode: "ask-first" when the agent may send, post, create, edit or delete (it asks before each), "read-only" when it only reads and reports, "can-write" only when the user says it may act without asking. Default ask-first.
- schedule: null when the user gave no timing. When they did:
  - repeating ("every weekday at 9am"): {"kind": "repeat", "cron": "0 9 * * 1-5", "label": "Weekdays at 9:00 AM", "task": "what to do each run"}. A 5-field cron in the user's timezone: minute, hour, day of month, month, day of week. No seconds field. "every weekday at 9:30am" is "30 9 * * 1-5".
  - one time ("on Oct 3 at 9am", "tomorrow at 5pm", "in 2 hours"): {"kind": "once", "at": "2026-10-03T09:00", "label": "Oct 3, 9:00 AM", "task": "what to do"}. "at" is local wall-clock time in the user's timezone, resolved against Now, and must be in the future.
  Use "clear" when they ask to stop scheduling. Never invent a schedule the user did not ask for.
- properties: facts about the agent that are not a name, description, tool, permission or schedule, stated as a value ("budget is 500", "priority high", "tags: billing, refunds", "needs approval: yes", "deadline Oct 10"). Each is {"op": "set", "title": "Budget", "type": "number", "value": "500"}. Pick the type from the value: number (digits only), checkbox (yes/no → "true"/"false"), date ("YYYY-MM-DD"), datetime ("YYYY-MM-DDTHH:mm"), tags (comma-separated list), otherwise text. To drop one: {"op": "remove", "title": "Budget"}. Title Case titles, 1 to 3 words. Reuse an existing title from customProperties when changing it. Empty when there are none. Behaviour rules ("always reply in Hindi") belong in instructionsBrief, not here.
- capabilityAdds: for a draft or edit that adds a named tool, product, skill or knowledge, a short phrase for each ("GitHub", "web search"). Include ones the user named in earlier messages that are not on the canvas yet. capabilityRemovals: for an edit that removes one, its hub and id from currentCapabilities.
- capabilityAddAll: when the user wants every item of a kind, now or in earlier messages ("all the MCPs", "every subagent"), those kinds from: mcp, builtin, subagent, skill, knowledge. "All tools" means mcp and builtin. Empty otherwise.
- instructionsBrief: one short paragraph (at most 400 characters) on what the agent does, for whom, in what tone, with which limits. Include the schedule and permission behavior.
- ack: one plain sentence saying what you did ("Drafted a weekday brief agent that reads your DMs and tickets."). Required for draft and edit: it is the only chat reply the user sees for those turns. Never say tools were added: the tool step reports what it added. No markdown.`;

export function canvasSummary(canvas: ClawDraftRequest["canvas"]): string {
  const caps = canvas.capabilities.length
    ? canvas.capabilities.map((c) => `${c.hub}:${c.id} (${c.label})`).join("; ")
    : "none";
  return [
    `empty: ${!canvas.name.trim() && !canvas.instructions.trim()}`,
    `name: ${canvas.name || "(blank)"}`,
    `handle: ${canvas.handle || "(blank)"}`,
    `description: ${canvas.description || "(blank)"}`,
    `instructions: ${canvas.instructions.trim() ? `${canvas.instructions.trim().slice(0, 240)}${canvas.instructions.length > 240 ? "…" : ""}` : "(blank)"}`,
    `permissionMode: ${canvas.permissionMode}`,
    `schedule: ${canvas.schedule ? `${canvas.schedule.kind === "once" ? `once at ${canvas.schedule.at}` : canvas.schedule.cron} (${canvas.schedule.label})` : "none"}`,
    `currentCapabilities: ${caps}`,
    `customProperties: ${
      canvas.customProperties?.length
        ? canvas.customProperties.map((p) => `${p.title} (${p.type}) = ${p.value || "(blank)"}`).join("; ")
        : "none"
    }`,
  ].join("\n");
}

export function buildClassifyMessages(input: ClawDraftRequest): AuthoringMessage[] {
  const history = input.history.slice(-6).map((turn): AuthoringMessage => ({
    role: turn.role,
    content: turn.text.slice(0, 600),
  }));
  return [
    { role: "system", content: SYSTEM },
    ...history,
    {
      role: "user",
      content: [
        `Now: ${input.now} (timezone ${input.timezone})`,
        `userOwned: ${input.userOwned.length ? input.userOwned.join(", ") : "none"}`,
        "Canvas:",
        canvasSummary(input.canvas),
        "",
        `User message: ${input.message}`,
      ].join("\n"),
    },
  ];
}

const isMode = (value: unknown): value is DraftMode =>
  value === "ask" || value === "chat" || value === "draft" || value === "edit";

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * Five fields made of digits, `*`, `/`, `,` and `-`. Enough to reject prose in the
 * cron slot; claw-auth validates the expression properly (and its minimum interval).
 */
export function isCronShape(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 && parts.every((part) => /^[\d*/,-]+$/.test(part));
}

/**
 * Fix the six-field crons fast models write for times with minutes. A leading
 * seconds field is dropped ("0 30 9 * * 1-5"), and so is the hour and minute
 * swap that comes with it ("0 9 30 * * 1-5" for 9:30). Anything else is
 * returned as given for isCronShape to judge. Exported for tests.
 */
export function repairCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 6 || parts[0] !== "0") return cron.trim();
  const [, a, b, ...rest] = parts as [string, string, string, ...string[]];
  const num = (v: string): number => (/^\d+$/.test(v) ? Number(v) : Number.NaN);
  // "0 9 30": 30 can't be an hour, so it is the minute of 9:30.
  if (num(b) > 23 && num(b) <= 59 && num(a) <= 23) return [b, a, ...rest].join(" ");
  return [a, b, ...rest].join(" ");
}

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Wall-clock "YYYY-MM-DDTHH:mm" in an IANA zone → the ISO instant it names, or
 * null when the text or zone is not usable. Two passes of the zone's offset
 * settle DST edges. Exported for tests.
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(local.trim());
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (!Number.isFinite(wall)) return null;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return null;
  }
  const offsetAt = (instant: number): number => {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts["year"]),
      Number(parts["month"]) - 1,
      Number(parts["day"]),
      Number(parts["hour"]),
      Number(parts["minute"]),
      Number(parts["second"]),
    );
    return asUtc - instant;
  };
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  return new Date(instant).toISOString();
}

const PROPERTY_VALUE: Record<DraftPropertyType, RegExp> = {
  text: /^[\s\S]{1,300}$/,
  number: /^-?\d+(?:\.\d+)?$/,
  checkbox: /^(true|false)$/,
  tags: /^[^,]{1,60}(,\s*[^,]{1,60})*$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
};

/** Keep only property ops that name a real type with a value of that type. Exported for tests. */
export function normalizePropertyOps(raw: unknown, input: ClawDraftRequest): DraftPropertyOp[] {
  if (!Array.isArray(raw)) return [];
  const existing = new Set((input.canvas.customProperties ?? []).map((p) => p.title.trim().toLowerCase()));
  const ops: DraftPropertyOp[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const op = item as { op?: unknown; title?: unknown; type?: unknown; value?: unknown };
    const title = text(op.title, 60);
    if (!title) continue;
    if (op.op === "remove") {
      if (existing.has(title.toLowerCase())) ops.push({ op: "remove", title });
      continue;
    }
    const type = PROPERTY_TYPES.find((t) => t === op.type) ?? "text";
    let value = typeof op.value === "boolean" ? String(op.value) : text(op.value, 300);
    if (type === "checkbox") value = /^(true|yes|on|1)$/i.test(value) ? "true" : "false";
    if (!PROPERTY_VALUE[type].test(value)) continue;
    ops.push({ op: "set", title, type, value });
  }
  return ops;
}

/** Turn the model's JSON into a decision the orchestrator can trust. Exported for tests. */
export function normalizeDecision(raw: Record<string, unknown>, input: ClawDraftRequest): ClassifyDecision {
  const canvasEmpty = !input.canvas.name.trim() && !input.canvas.instructions.trim();
  let mode: DraftMode = isMode(raw["mode"]) ? raw["mode"] : canvasEmpty ? "draft" : "edit";
  // A canvas with nothing on it cannot be edited, and a filled one is not a first draft.
  if (mode === "edit" && canvasEmpty) mode = "draft";
  const owned = new Set(input.userOwned);
  const asked = Array.isArray(raw["fields"])
    ? (raw["fields"] as unknown[]).filter((f): f is DraftField => ALL_FIELDS.includes(f as DraftField))
    : [];
  const fields: DraftField[] =
    mode === "draft"
      ? ALL_FIELDS.filter(
          (f) =>
            (f !== "schedule" || raw["schedule"] != null) &&
            (f !== "properties" || (Array.isArray(raw["properties"]) && raw["properties"].length > 0)),
        )
      : mode === "edit"
        ? asked
        : [];
  // An edit that adds tools writes their rows, even when the model left them out of "fields".
  if (mode === "edit") {
    const addAll = normalizeAddAll(raw["capabilityAddAll"]);
    const named = Array.isArray(raw["capabilityAdds"]) && raw["capabilityAdds"].length > 0;
    const rows: DraftField[] = [
      ...(named || addAll.some((hub) => hub === "mcp" || hub === "builtin" || hub === "subagent") ? ["tools" as const] : []),
      ...(addAll.includes("skill") ? ["skills" as const] : []),
      ...(addAll.includes("knowledge") ? ["knowledge" as const] : []),
    ];
    for (const row of rows) if (!fields.includes(row)) fields.push(row);
  }
  const writable = fields.filter((f) => !owned.has(f));

  const name = text(raw["name"], 60);
  const handle = slugFromName(text(raw["handle"], 60) || name);
  const permissionRaw = raw["permission"] as { mode?: unknown; reason?: unknown } | undefined;
  const schedule = raw["schedule"];
  let scheduleDecision: ClassifyDecision["schedule"];
  if (schedule === "clear") scheduleDecision = "clear";
  else if (schedule && typeof schedule === "object") {
    const s = schedule as { kind?: unknown; cron?: unknown; at?: unknown; label?: unknown; task?: unknown };
    const label = text(s.label, 80);
    const task = text(s.task, 400);
    if (s.kind === "once" || (s.at !== undefined && s.cron === undefined)) {
      // The model gives wall-clock time in the user's zone; store the instant, and
      // only when it is still ahead of Now.
      const at = zonedLocalToIso(text(s.at, 40), input.timezone);
      if (at && Date.parse(at) > Date.parse(input.now)) {
        scheduleDecision = { kind: "once", at, label: label || at, task };
      }
    } else {
      const cron = repairCron(text(s.cron, 60));
      if (isCronShape(cron)) {
        scheduleDecision = { kind: "repeat", cron, label: label || cron, task };
      }
    }
  }
  const properties = normalizePropertyOps(raw["properties"], input);
  const removals = Array.isArray(raw["capabilityRemovals"])
    ? (raw["capabilityRemovals"] as Array<{ hub?: unknown; id?: unknown }>)
        .filter(
          (r): r is { hub: DraftHub; id: string } =>
            HUBS.includes(r?.hub as DraftHub) &&
            typeof r?.id === "string" &&
            input.canvas.capabilities.some((c) => c.hub === r.hub && c.id === r.id),
        )
        .map((r) => ({ hub: r.hub, id: r.id }))
    : [];

  return {
    mode,
    reply: mode === "ask" || mode === "chat" ? text(raw["reply"], 600) : "",
    fields: writable,
    ...(name && writable.includes("name") ? { name } : {}),
    ...(handle && writable.includes("handle") ? { handle } : {}),
    ...(text(raw["description"], 200) && writable.includes("description")
      ? { description: text(raw["description"], 200) }
      : {}),
    ...(writable.includes("permission") && permissionRaw
      ? {
          permission: {
            mode: normalizePermissionMode(permissionRaw.mode),
            reason: text(permissionRaw.reason, 120),
          },
        }
      : {}),
    ...(scheduleDecision && (writable.includes("schedule") || scheduleDecision === "clear")
      ? { schedule: scheduleDecision }
      : {}),
    ...(properties.length > 0 && writable.includes("properties") ? { properties } : {}),
    // Not asked of the model (the judge reads the user's message): less JSON, faster answer.
    capabilityQuery: input.message,
    capabilityAdds: Array.isArray(raw["capabilityAdds"])
      ? (raw["capabilityAdds"] as unknown[]).filter((a): a is string => typeof a === "string").map((a) => a.slice(0, 80)).slice(0, 5)
      : [],
    ...(mode === "draft" || mode === "edit" ? { capabilityAddAll: normalizeAddAll(raw["capabilityAddAll"]) } : {}),
    capabilityRemovals: removals,
    instructionsBrief: text(raw["instructionsBrief"], 600) || input.message,
    ack: text(raw["ack"], 200),
    ...(mode === "chat" ? { lookup: normalizeLookup(raw["lookup"]) } : {}),
    ...(mode === "ask" ? { questions: normalizeQuestions(raw["questions"]) } : {}),
  };
}

/** Known hubs, each once. */
function normalizeAddAll(raw: unknown): DraftHub[] {
  if (!Array.isArray(raw)) return [];
  return HUBS.filter((hub) => raw.includes(hub));
}

/** Up to two short web queries. */
function normalizeLookup(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => text(q, 120))
    .filter(Boolean)
    .slice(0, 2);
}

export async function classifyTurn(input: ClawDraftRequest, signal?: AbortSignal): Promise<ClassifyDecision> {
  const raw = await chatJson<Record<string, unknown>>(buildClassifyMessages(input), {
    // A rich request (several properties, a schedule, a long brief) needs well
    // over 600 tokens of JSON; a cut-off answer can't be parsed and the whole
    // turn falls back to a template. Such a request takes about 5s alone and
    // over 10s when the fast endpoint is also serving the judge, which it
    // queues behind, so allow 20s.
    maxTokens: 1_500,
    timeoutMs: 20_000,
    temperature: 0.2,
    ...(signal ? { signal } : {}),
  });
  return normalizeDecision(raw, input);
}
