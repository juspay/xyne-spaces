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
} from "xyne-claw-shared";
import { chatJson, type AuthoringMessage } from "./authoring-llm.js";

export interface DraftScheduleDecision {
  cron: string;
  label: string;
  task: string;
}

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
  /** The job as the capability judge should read it. */
  capabilityQuery: string;
  capabilityAdds: string[];
  capabilityRemovals: DraftCapabilityRemoval[];
  /** One paragraph for the instructions writer. */
  instructionsBrief: string;
  /** One sentence for the chat reply. */
  ack: string;
}

const ALL_FIELDS: readonly DraftField[] = [
  "name", "handle", "description", "instructions", "tools", "skills", "knowledge", "permission", "schedule",
];
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
  "capabilityQuery": "",
  "capabilityAdds": [],
  "capabilityRemovals": [{"hub": "mcp", "id": ""}],
  "instructionsBrief": "",
  "ack": ""
}

Modes
- "ask": the user has not said what job the agent does ("make an agent", "create a bot"). reply = ONE short question about the job. Draft nothing.
- "chat": small talk, or a question about the agent or canvas. reply = a short answer. Change nothing.
- "draft": the canvas is empty and a job is named. Fill everything. Never ask about risk when the job is named; choose the permission mode yourself. "just draft" or "you pick" means draft with sensible defaults.
- "edit": the canvas already has content and the user asks to change something. Put only the fields that change in "fields" and leave the other keys empty.

"fields" lists what this turn writes, from: name, handle, description, instructions, tools, skills, knowledge, permission, schedule. Never list a field in userOwned.

Fields
- name: 2 to 4 words, Title Case, keep acronyms (DM, PR, QA). handle: lowercase, hyphens, no spaces.
- description: one sentence, at most 140 characters, about what the agent does for the user.
- permission.mode: "ask-first" when the agent may send, post, create, edit or delete (it asks before each), "read-only" when it only reads and reports, "can-write" only when the user says it may act without asking. Default ask-first.
- schedule: null when the user gave no timing. {"cron": "0 9 * * 1-5", "label": "Weekdays at 9:00 AM", "task": "what to do each run"} when they did ("every weekday at 9am"). The cron is a 5-field cron in the user's timezone. Use "clear" when they ask to stop scheduling. Never invent a schedule the user did not ask for.
- capabilityQuery: one or two sentences naming what the job needs (products, actions, data), as if briefing someone choosing tools.
- capabilityAdds: for an edit that adds a tool, product, skill or knowledge, a short phrase for each ("GitHub", "web search"). capabilityRemovals: for an edit that removes one, its hub and id from currentCapabilities.
- instructionsBrief: one paragraph on what the agent does, for whom, in what tone, with which limits. Include the schedule and permission behavior.
- ack: one plain sentence saying what you did ("Drafted a weekday brief agent that reads your DMs and tickets."). No markdown.`;

function canvasSummary(canvas: ClawDraftRequest["canvas"]): string {
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
    `schedule: ${canvas.schedule ? `${canvas.schedule.cron} (${canvas.schedule.label})` : "none"}`,
    `currentCapabilities: ${caps}`,
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

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
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
      ? ALL_FIELDS.filter((f) => f !== "schedule" || raw["schedule"] != null)
      : mode === "edit"
        ? asked
        : [];
  const writable = fields.filter((f) => !owned.has(f));

  const name = text(raw["name"], 60);
  const handle = slugFromName(text(raw["handle"], 60) || name);
  const permissionRaw = raw["permission"] as { mode?: unknown; reason?: unknown } | undefined;
  const schedule = raw["schedule"];
  let scheduleDecision: ClassifyDecision["schedule"];
  if (schedule === "clear") scheduleDecision = "clear";
  else if (schedule && typeof schedule === "object") {
    const s = schedule as { cron?: unknown; label?: unknown; task?: unknown };
    const cron = text(s.cron, 60);
    if (isCronShape(cron)) {
      scheduleDecision = { cron, label: text(s.label, 80) || cron, task: text(s.task, 400) };
    }
  }
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
    capabilityQuery: text(raw["capabilityQuery"], 600) || input.message,
    capabilityAdds: Array.isArray(raw["capabilityAdds"])
      ? (raw["capabilityAdds"] as unknown[]).filter((a): a is string => typeof a === "string").map((a) => a.slice(0, 80)).slice(0, 5)
      : [],
    capabilityRemovals: removals,
    instructionsBrief: text(raw["instructionsBrief"], 900) || input.message,
    ack: text(raw["ack"], 200),
  };
}

export async function classifyTurn(input: ClawDraftRequest, signal?: AbortSignal): Promise<ClassifyDecision> {
  const raw = await chatJson<Record<string, unknown>>(buildClassifyMessages(input), {
    maxTokens: 450,
    timeoutMs: 7_000,
    temperature: 0.2,
    ...(signal ? { signal } : {}),
  });
  return normalizeDecision(raw, input);
}
