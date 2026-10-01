/**
 * Streamed agent drafting (Hub create canvas).
 *
 * One request drafts or edits the whole canvas and answers as an SSE stream,
 * so the first field lands in about a second instead of after every LLM call
 * has finished. The same event shapes are used in two hops:
 *
 *   dashboard ⇄ claw-auth  POST /claw/api/v1/agents/draft   (AgentDraftRequest)
 *   claw-auth ⇄ xyne-claw  POST /agents/draft               (ClawDraftRequest)
 *
 * xyne-claw runs the LLM work and knows nothing about the database, so it
 * reports raw `capabilities` and unadjusted identity. claw-auth turns the
 * capabilities into one `plan` event (the POST /agents/suggest-tools shape, so
 * the canvas reuses the Suggest mapping), fixes handle collisions and checks
 * the schedule. Everything else passes through.
 */

import type { AgentPermissionMode } from "../agent-prompt-contract.js";

/** `reset` is "start over": the page clears the canvas and nothing is drafted. */
export type DraftMode = "chat" | "ask" | "draft" | "edit" | "reset";

export type DraftField =
  | "name"
  | "handle"
  | "description"
  | "instructions"
  | "tools"
  | "skills"
  | "knowledge"
  | "permission"
  | "schedule"
  /** The user's typed custom properties (Budget: 500, Priority: high). */
  | "properties";

export type DraftHub = "mcp" | "builtin" | "subagent" | "skill" | "knowledge";

export type DraftErrorCode =
  | "rate_limited"
  | "llm_timeout"
  | "catalog_unavailable"
  | "bad_request"
  | "cancelled"
  | "internal";

/** One catalog item the judge picked, with what the canvas needs to show it. */
export interface DraftPick {
  hub: DraftHub;
  /** Catalog id: integration slug, custom tool id, subagent name, skill slug/id, collection id. */
  id: string;
  label: string;
  confidence: number;
  reason: string;
  /** MCP picks only: whether the job must write, not just read. */
  access?: "read" | "write";
  /** MCP picks only: the connector the user has not connected yet. */
  requiresConnection?: string;
}

/** A capability already on the canvas, as the model needs to see it to edit. */
export interface DraftCapabilityRef {
  hub: DraftHub;
  /** The exact string stored in the canvas selection for this item. */
  id: string;
  label: string;
}

export interface DraftCapabilityRemoval {
  hub: DraftHub;
  id: string;
}

interface DraftScheduleBase {
  timezone: string;
  /** Human text, e.g. "Weekdays at 9:00 AM" or "Oct 3, 9:00 AM". */
  label: string;
  /** What the agent is asked to do each time it runs. */
  task: string;
}

export type DraftSchedule =
  /** Repeats on a 5-field cron, evaluated in `timezone`. */
  | (DraftScheduleBase & { kind: "repeat"; cron: string })
  /** Runs once, at an absolute instant (ISO string). */
  | (DraftScheduleBase & { kind: "once"; at: string });

export type DraftPropertyType = "text" | "number" | "checkbox" | "tags" | "date" | "datetime";

/**
 * A custom property row on the canvas. `value` is the row's own string form:
 * "true"/"false" for checkbox, "YYYY-MM-DD" for date, "YYYY-MM-DDTHH:mm" for
 * datetime, comma-separated for tags.
 */
export interface DraftCustomProperty {
  title: string;
  type: DraftPropertyType;
  value: string;
}

/** Properties are matched by title (case-insensitive): set adds or replaces, remove drops. */
export type DraftPropertyOp =
  | ({ op: "set" } & DraftCustomProperty)
  | { op: "remove"; title: string };

export interface DraftTimings {
  firstFieldMs?: number;
  capabilitiesMs?: number;
  instructionsMs?: number;
  totalMs: number;
}

export interface AgentDraftCanvas {
  name: string;
  handle: string;
  description: string;
  instructions: string;
  permissionMode: AgentPermissionMode;
  schedule: DraftSchedule | null;
  capabilities: DraftCapabilityRef[];
  /** Custom property rows already on the canvas. */
  customProperties?: DraftCustomProperty[];
}

/**
 * How much conversation each hop keeps: enough for a chat about other agents
 * to stay coherent. The planning call keeps its own, shorter slice.
 */
export const DRAFT_HISTORY_TURNS = 12;
export const DRAFT_HISTORY_TURN_CHARS = 2_000;

/** A step the Build chat took before answering, shown above the reply. */
export interface DraftActivity {
  id: string;
  kind: "search";
  status: "running" | "done" | "failed";
  /** "Searching the web: Codex review agent" */
  label: string;
  detail?: string;
  sources?: Array<{ title: string; url: string }>;
}

/** A change the conversation points at. Tapping it sends `message` as the next turn. */
export interface DraftSuggestion {
  id: string;
  /** Short, imperative: "Add a PR review step". */
  label: string;
  /** The full request the user would send. */
  message: string;
}

/** One follow-up question, in the UserQuestion shape the question card renders. */
export interface DraftQuestion {
  id: string;
  /** One or two words, shown as the question's chip: "Job", "Schedule". */
  label: string;
  question: string;
  type: "single_choice" | "multiple_choice";
  /** Two to four. The card adds its own "Something else" and skip. */
  options: Array<{ label: string; description?: string }>;
}

/** Dashboard → claw-auth. */
export interface AgentDraftRequest {
  draftId: string;
  /** One per send. A duplicate in flight is rejected. */
  turnId: string;
  message: string;
  /** Last few turns, oldest first. */
  history: Array<{ role: "user" | "assistant"; text: string }>;
  canvas: AgentDraftCanvas;
  /** Fields the user has edited or is editing; the draft must not overwrite them. */
  userOwned: DraftField[];
  /** Browser IANA zone, used to read "9am" and to store the schedule. */
  timezone: string;
}

export interface DraftCatalog {
  subagents: Array<{ name: string; description: string }>;
  integrations: Array<{
    slug: string;
    label: string;
    /** `builtin` and `custom` are built-in tools; `mcp` and `gateway` are connected products. */
    kind: "mcp" | "builtin" | "custom" | "gateway";
    /** Set for MCP servers that are not connected for this user. */
    requiresConnection?: string;
    /** What the product is for, in one line (the server's own description). */
    description?: string;
    readTools: Array<{ name: string; description: string; riskLevel: string }>;
    writeTools: Array<{ name: string; description: string; riskLevel: string }>;
  }>;
}

/** claw-auth → xyne-claw. */
export interface ClawDraftRequest extends AgentDraftRequest {
  userId: string;
  /** ISO time, so "tomorrow" and "every Monday" resolve against the user's clock. */
  now: string;
  catalog: DraftCatalog;
  skillCandidates: Array<{ slug: string; name: string; description: string }>;
  knowledgeCandidates: Array<{ id: string; name: string }>;
}

/**
 * Event bodies. `capabilities` is xyne-claw → claw-auth only; `plan` is
 * claw-auth → dashboard only.
 */
export type AgentDraftBody =
  | { event: "started"; draftId: string }
  | { event: "mode"; mode: DraftMode; fields: DraftField[] }
  | {
      event: "identity";
      name?: string;
      handle?: string;
      description?: string;
      /** Set when the handle was changed because the requested one is taken. */
      handleAdjusted?: { requested: string; reason: "taken" };
    }
  | { event: "permission"; mode: AgentPermissionMode; reason: string }
  | ({ event: "schedule"; op: "set" } & DraftSchedule)
  | { event: "schedule"; op: "clear" }
  | { event: "schedule"; op: "invalid"; text: string; error: string }
  | { event: "properties"; ops: DraftPropertyOp[] }
  | { event: "field.start"; field: DraftField }
  | {
      event: "capabilities";
      op: "replace" | "add";
      bound: DraftPick[];
      suggested: DraftPick[];
      remove: DraftCapabilityRemoval[];
    }
  | {
      event: "plan";
      /** `replace` on a first draft, `add` on an edit. */
      op: "replace" | "add";
      plan: DraftToolPlan;
      remove: DraftCapabilityRemoval[];
    }
  | { event: "instructions.delta"; text: string }
  | { event: "instructions.section"; heading: string; markdown: string }
  | {
      event: "instructions.done";
      text: string;
      contract: { ok: boolean; error?: string };
      /** True when a missing Workflow/Guardrails section was added to pass the contract. */
      repaired: boolean;
    }
  | { event: "ack"; text: string }
  | { event: "reply.delta"; text: string }
  /** A chat turn's research step, sent as it starts and again when it ends. */
  | ({ event: "activity" } & DraftActivity)
  /** After a chat reply: changes the user can apply with one tap. */
  | { event: "suggestion"; suggestions: DraftSuggestion[] }
  /** Follow-up questions, shown as a card; the answers come back as the next turn. */
  | { event: "question"; id: string; questions: DraftQuestion[] }
  | { event: "warning"; stage: string; message: string }
  | { event: "done"; status: "completed" | "partial" | "cancelled"; timings: DraftTimings }
  | { event: "error"; code: DraftErrorCode; message: string; retryable: boolean };

/**
 * Capabilities as the canvas applies them: the POST /agents/suggest-tools
 * response shape. `integrations` / `subagents` / `skillSlugs` / `knowledgeIds`
 * are bound; `suggested` become one-click chips.
 */
export interface DraftToolPlan {
  subagents: string[];
  integrations: Array<{ slug: string; readTools: string[]; writeTools: string[] }>;
  skillSlugs: string[];
  knowledgeIds: string[];
  suggested: {
    integrations: Array<{ slug: string; label: string; confidence: number; readTools: string[]; writeTools: string[] }>;
    subagents: Array<{ name: string; confidence: number }>;
    skills: Array<{ slug: string; confidence: number }>;
    knowledge: Array<{ id: string; name: string; confidence: number }>;
  };
  reasoning: Record<string, string>;
  source: string;
}

/** What goes on the wire: every body plus its position in the turn. */
export type AgentDraftEvent = AgentDraftBody & { seq: number; turnId: string };

/** One complete SSE message, same framing as the run stream (`event:` + `data:` + blank line). */
export function frameDraftEvent(event: AgentDraftEvent): string {
  const { event: name, ...rest } = event;
  return `event: ${name}\ndata: ${JSON.stringify(rest)}\n\n`;
}
