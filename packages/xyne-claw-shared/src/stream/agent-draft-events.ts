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
 * reports raw `capabilities`, `ack` and unadjusted identity. claw-auth turns
 * those into the `tools` / `skills` / `knowledge` events the canvas applies,
 * fixes handle collisions, validates the schedule, and composes the reply.
 */

import type { AgentPermissionMode } from "../agent-prompt-contract.js";

export type DraftMode = "chat" | "ask" | "draft" | "edit";

export type DraftField =
  | "name"
  | "handle"
  | "description"
  | "instructions"
  | "tools"
  | "skills"
  | "knowledge"
  | "permission"
  | "schedule";

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

export interface DraftSchedule {
  /** 5-field cron, evaluated in `timezone`. */
  cron: string;
  timezone: string;
  /** Human text, e.g. "Weekdays at 9:00 AM". */
  label: string;
  /** What the agent is asked to do each time it runs. */
  task: string;
}

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
 * Event bodies. `capabilities` and `ack` are xyne-claw → claw-auth only;
 * `tools`, `skills` and `knowledge` are claw-auth → dashboard only.
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
  | { event: "field.start"; field: DraftField }
  | {
      event: "capabilities";
      op: "replace" | "add";
      bound: DraftPick[];
      suggested: DraftPick[];
      remove: DraftCapabilityRemoval[];
    }
  | {
      event: "tools";
      op: "replace" | "add" | "remove";
      /** Same shape the picker's Suggest uses; the canvas maps it with the cached tool catalog. */
      suggestion: {
        subagents: string[];
        integrations: Array<{ slug: string; readTools: string[]; writeTools: string[] }>;
      };
      /** Selection strings to drop (subagent names, tool names, gateway services, custom slugs). */
      removeIds: string[];
      bound: DraftPick[];
      suggested: DraftPick[];
    }
  | {
      event: "skills";
      op: "replace" | "add" | "remove";
      skillIds: string[];
      removeIds: string[];
      bound: DraftPick[];
      suggested: DraftPick[];
    }
  | {
      event: "knowledge";
      op: "replace" | "add" | "remove";
      collectionIds: string[];
      removeIds: string[];
      bound: DraftPick[];
      suggested: DraftPick[];
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
  | { event: "warning"; stage: string; message: string }
  | { event: "done"; status: "completed" | "partial" | "cancelled"; timings: DraftTimings }
  | { event: "error"; code: DraftErrorCode; message: string; retryable: boolean };

/** What goes on the wire: every body plus its position in the turn. */
export type AgentDraftEvent = AgentDraftBody & { seq: number; turnId: string };

/** One complete SSE message, same framing as the run stream (`event:` + `data:` + blank line). */
export function frameDraftEvent(event: AgentDraftEvent): string {
  const { event: name, ...rest } = event;
  return `event: ${name}\ndata: ${JSON.stringify(rest)}\n\n`;
}
