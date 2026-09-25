/**
 * propose-agent — the terminal tool for AGENT AUTHORING (agent.config.agentAuthoring).
 *
 * An agent asked to "build me an agent" investigates (search_tools /
 * list_agents), then calls propose-agent exactly ONCE with the full draft, which:
 *   1. captures the spec into a closure ref (read back by run.ts), and
 *   2. HARD-STOPS the turn via abortRun — nothing is created yet, so there is
 *      nothing further to say and the model must not narrate a created agent.
 *
 * run.ts recovers ref.value in its catch block (the abort lands there) and puts
 * it on the /webhook/result callback as `pendingAgentCard`. claw-auth validates
 * the requested tools against the org catalog, persists the draft as an
 * AgentRequest row, and posts the `agent` artifact card (variant "draft", phase
 * "pending"). The agent is created only when the user approves that card.
 *
 * Structurally identical to propose-plan.ts (ref + idempotency + abortRun) —
 * that pattern is the repo's established "agent authors an artifact, human
 * decides" shape, and reusing it keeps the abort/recovery wiring in one style.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  MAX_SYSTEM_PROMPT_CHARS,
  normalizePermissionMode,
  validateSystemPromptContract,
  type AgentPermissionMode,
} from "xyne-claw-shared";
import { createLogger } from "./logger.js";

const log = createLogger("propose-agent");

export const PROPOSE_AGENT_TOOL_NAME = "propose-agent";
const MAX_NAME = 80;
const MAX_SLUG = 80;
const MAX_DESC = 300;
/** The pod's cap. claw-auth persists this verbatim; the card truncates for display. */
const MAX_SYSTEM_PROMPT = MAX_SYSTEM_PROMPT_CHARS;
const MAX_TOOLS = 40;
const MAX_SKILLS = 20;
const MAX_DENIED = 40;
/** One or two sentences — this is a chat line, not a second description. */
const MAX_SUMMARY = 400;

/** The drafted agent — read back by run.ts and shipped as `pendingAgentCard`. */
export interface ProposedAgentSpec {
  name: string;
  /** Kebab-case; derived from `name` when the model omits it. */
  slug: string;
  description: string;
  systemPrompt: string;
  modelId?: string;
  color?: string;
  /** Flat tool slugs / subagent names. claw-auth resolves these against the org
   *  catalog and reports back anything it could not match — the pod deliberately
   *  does NOT guess, because only claw-auth knows what this org has. */
  tools: string[];
  /** Permission mode stored on agent.config.permissionMode. Default ask-first. */
  permissionMode?: AgentPermissionMode;
  /** Skill slugs to attach on approve (must exist in the org). */
  skillSlugs?: string[];
  /** Tool slugs the agent must never receive, even if listed in tools. */
  deniedTools?: string[];
  mcps?: string[];
  /** Skill names or slugs. Resolved by claw-auth against the org's skill
   *  library; unmatched names are reported on the card, never persisted. */
  skills?: string[];
  /** Collection names the agent should be able to look things up in, plus whose
   *  access decides what it can read. */
  knowledge?: { scope?: "COLLECTIONS" | "USER"; collections?: string[] };
  /** Providers tried in order, e.g. ["claude", "codex"]. */
  providerOrder?: string[];
  memory?: { enabled: boolean; requiresApproval?: boolean };
  /** 'personal' belongs to the requester, 'global' is org-wide. */
  scope?: "personal" | "global";
  /** One line the agent says in the thread alongside the card. The card can only
   *  show WHAT was drafted; this is where the agent says why it made the calls it
   *  did. Optional — claw-auth falls back to a neutral line. */
  summary?: string;
}

/**
 * The run-result payload for the `agent` artifact.
 *
 * A union so every agent surface travels on ONE transport: the draft carries the
 * proposed spec, the profile carries only a slug — claw-auth reads that agent's
 * real row and describes it, because an agent must not be able to narrate
 * capabilities it doesn't have onto an official-looking card.
 */
export type PendingAgentCard =
  | { variant: "draft"; agent: ProposedAgentSpec }
  | { variant: "profile"; slug?: string }
  | { variant: "profile-list"; slugs: string[] }
  | { variant: "summary" };

/** Shared ref the tool writes the accepted draft into (mirrors ProposePlanRef). */
export interface ProposeAgentRef {
  /** Narrowed to the draft member — this ref never holds a profile card. */
  value?: Extract<PendingAgentCard, { variant: "draft" }>;
  /** How many duplicate calls arrived after the first accepted draft. */
  duplicates?: number;
  /** How many times the tool rejected a call — telemetry / fail-open backstop. */
  rejections?: number;
}

/** Kebab-case slug, matching the validator claw-auth applies before persisting. */
export function normalizeAgentSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG);
}

export function buildProposeAgentTool(
  ref: ProposeAgentRef,
  abortRun?: () => void,
): ToolDefinition {
  return {
    name: PROPOSE_AGENT_TOOL_NAME,
    label: "Propose Agent",
    description: [
      "Draft a NEW agent and STOP. Calling this ENDS your turn immediately — the user",
      "gets an agent card showing exactly what you drafted, and the agent is created",
      "ONLY if they approve it. Nothing is saved by this call.",
      "",
      "BEFORE calling: run `search_tools` (and `list_agents` if you need to see",
      "what already exists). `tools` must contain EXACT identifiers from that catalog —",
      "subagent names or custom tool slugs, one per entry, no prose. Anything that does",
      "not match is dropped and reported on the card, so guessing costs the user a tool.",
      "",
      "Write `systemPrompt` in the second person with these sections: Identity & tone;",
      "Operational Workflow (numbered steps); When to use each tool; Guardrails (must not);",
      "Decision rules; Error recovery; two Contrastive examples (robotic vs calibrated).",
      "Keep the always-on prompt thin: put long procedures in a skill via create-skill, then",
      "pass that slug in `skillSlugs`. A one-line prompt is rejected.",
      "",
      "If the user only said 'make an agent' with no job, do NOT call this tool — ask what",
      "job it should do first (at most two questions). If the job can send, delete, pay,",
      "force-push, or post publicly, ask one closed risk question before calling.",
      "",
      "`permissionMode`: ask-first (default), read-only, or can-write. Omit → ask-first.",
      "`deniedTools`: exact slugs this agent must never receive.",
      "",
      "`description` is the single line shown in the agent picker — what it does, not how.",
      "",
      "MCPs vs subagents: when the user asks for an INTEGRATION by name — 'add the github",
      "MCP', 'give it Bitbucket' — put that name in `mcps`, not in `tools`. Several",
      "integrations also ship a subagent under the SAME name, and a name in `tools` always",
      "resolves to the subagent, so the user asks for an MCP and gets a subagent instead.",
      "Use `tools` for subagents, individual tool slugs and built-in tools.",
      "",
      "Set `skills`, `knowledge`, `providerOrder`, `memory` and `scope` ONLY when the user",
      "actually asked for them — an unrequested provider or a wrong knowledge scope is worse",
      "than leaving the org default. Like `tools`, these are matched against the org catalog",
      "by claw-auth: give the names the user said, do not invent ids.",
      "",
      "ALSO write `summary`: one or two sentences you say to the user next to the card,",
      "explaining what you built and WHY you made the key calls — which tools you granted",
      "and anything you deliberately left out. The card already lists the name, description",
      "and tools, so do NOT restate them; this is your reasoning, in your own voice.",
      "",
      "Call this exactly ONCE, and do not call any other tool after it.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Human-readable agent title, e.g. 'Ticket Triage'.",
        },
        slug: {
          type: "string",
          description:
            "Optional kebab-case identifier, e.g. 'ticket-triage'. Derived from `name` when omitted.",
        },
        description: {
          type: "string",
          description: "One line shown in the agent picker — what this agent does.",
        },
        systemPrompt: {
          type: "string",
          description:
            "Thin operating instructions with Workflow + Guardrails sections (and preferred contrastive examples). Long procedures belong in a skill.",
        },
        modelId: {
          type: "string",
          description:
            "Optional model id. Omit unless the user asked for a specific model — the org default is used otherwise.",
        },
        color: {
          type: "string",
          description: "Optional hex tint for the agent avatar, e.g. '#6366f1'.",
        },
        tools: {
          type: "array",
          description:
            "Exact tool slugs / subagent names from search_tools. Grant only what the agent's job needs.",
          items: { type: "string" },
        },
        permissionMode: {
          type: "string",
          description: "ask-first | read-only | can-write. Default ask-first.",
        },
        skillSlugs: {
          type: "array",
          description:
            "Org skill slugs to attach on approve (from create-skill / list skills). Prefer one procedure skill.",
          items: { type: "string" },
        },
        deniedTools: {
          type: "array",
          description: "Exact tool slugs this agent must never receive.",
          items: { type: "string" },
        },
        mcps: {
          type: "array",
          description:
            "Integration names the user asked for AS MCPs, e.g. ['github', 'bitbucket']. claw-auth grants that integration's tools. Use this whenever the user says 'add the X MCP' — putting the same name in `tools` grants the X SUBAGENT instead, which is a different thing.",
          items: { type: "string" },
        },
        skills: {
          type: "array",
          description:
            "Skill names or slugs from list_available_tools that this agent should be able to run. Omit when the user asked for none.",
          items: { type: "string" },
        },
        knowledge: {
          type: "object",
          additionalProperties: false,
          description:
            "What this agent can look things up in. Omit entirely unless the user named collections or said whose access should apply.",
          properties: {
            scope: {
              type: "string",
              enum: ["COLLECTIONS", "USER"],
              description:
                "COLLECTIONS reads the collections listed below. USER reads whatever the asking user can already see.",
            },
            collections: {
              type: "array",
              description: "Collection names the user asked for, exactly as they said them.",
              items: { type: "string" },
            },
          },
        },
        providerOrder: {
          type: "array",
          description:
            "AI providers tried in order, e.g. ['claude', 'codex']. Omit unless the user named one — the org default is used otherwise.",
          items: { type: "string" },
        },
        memory: {
          type: "object",
          additionalProperties: false,
          description:
            "Whether this agent remembers things between conversations. Omit unless the user asked for memory.",
          properties: {
            enabled: { type: "boolean" },
            requiresApproval: {
              type: "boolean",
              description: "Whether new memories need a human review before they are kept.",
            },
          },
          required: ["enabled"],
        },
        scope: {
          type: "string",
          enum: ["personal", "global"],
          description:
            "'personal' belongs to the requester (the default); 'global' is org-wide. Only set 'global' when the user clearly asked for everyone.",
        },
        summary: {
          type: "string",
          description:
            "One or two sentences you say in the thread next to the card — what you built and WHY you made the key calls (which tools you granted and what you left out). Do NOT restate the name, description or tool list: the card already shows those. Write it as yourself, to the user.",
        },
      },
      required: ["name", "description", "systemPrompt"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const reject = (text: string) => {
        ref.rejections = (ref.rejections ?? 0) + 1;
        return { content: [{ type: "text" as const, text }], details: { error: true } };
      };

      // Idempotency: the draft is proposed EXACTLY ONCE per turn. Repeat calls
      // (some models re-emit after the abort) are a no-op — the first draft stands.
      if (ref.value !== undefined) {
        ref.duplicates = (ref.duplicates ?? 0) + 1;
        log.info(`[propose-agent] duplicate call #${ref.duplicates} ignored — first draft stands`);
        return {
          content: [
            {
              type: "text" as const,
              text: "You have ALREADY proposed this agent — that first call is final and is queued for the user's approval. Do NOT call propose-agent again. Stop here and produce no further output.",
            },
          ],
          details: { duplicate: true },
        };
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};
      const name = typeof p["name"] === "string" ? p["name"].trim().slice(0, MAX_NAME) : "";
      if (!name) {
        return reject("Rejected: `name` is required. Call propose-agent again with the agent's title.");
      }

      const description =
        typeof p["description"] === "string" ? p["description"].trim().slice(0, MAX_DESC) : "";
      if (!description) {
        return reject(
          "Rejected: `description` is required — one line describing what this agent does, shown in the agent picker.",
        );
      }

      const systemPrompt =
        typeof p["systemPrompt"] === "string" ? p["systemPrompt"].trim().slice(0, MAX_SYSTEM_PROMPT) : "";
      const promptCheck = validateSystemPromptContract(systemPrompt);
      if (!promptCheck.ok) {
        return reject(`Rejected: ${promptCheck.error} Then call propose-agent again.`);
      }

      const slug = normalizeAgentSlug(
        typeof p["slug"] === "string" && p["slug"].trim() ? p["slug"] : name,
      );
      if (!slug) {
        return reject(
          "Rejected: could not derive a slug from `name`. Provide `slug` explicitly as lowercase words separated by hyphens.",
        );
      }

      // Tools are passed through as-authored: claw-auth owns the org catalog and
      // reports unmatched entries on the card. Only shape is enforced here.
      const tools = (Array.isArray(p["tools"]) ? (p["tools"] as unknown[]) : [])
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim())
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, MAX_TOOLS);

      const stringList = (raw: unknown, cap: number): string[] =>
        (Array.isArray(raw) ? (raw as unknown[]) : [])
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => v.trim())
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .slice(0, cap);

      const skillSlugs = stringList(p["skillSlugs"], MAX_SKILLS);
      const deniedTools = stringList(p["deniedTools"], MAX_DENIED);
      const permissionMode = normalizePermissionMode(p["permissionMode"]);

      const mcps = stringList(p["mcps"], MAX_TOOLS);
      const skills = stringList(p["skills"], MAX_TOOLS);
      const providerOrder = stringList(p["providerOrder"], 8);

      const rawKnowledge = (p["knowledge"] ?? {}) as Record<string, unknown>;
      const knowledgeScope: "COLLECTIONS" | "USER" | undefined =
        rawKnowledge["scope"] === "USER"
          ? "USER"
          : rawKnowledge["scope"] === "COLLECTIONS"
            ? "COLLECTIONS"
            : undefined;
      const collections = stringList(rawKnowledge["collections"], MAX_TOOLS);
      const knowledge =
        knowledgeScope || collections.length > 0
          ? {
              ...(knowledgeScope ? { scope: knowledgeScope } : {}),
              ...(collections.length > 0 ? { collections } : {}),
            }
          : undefined;

      const rawMemory = p["memory"] as Record<string, unknown> | undefined;
      const memory =
        rawMemory && typeof rawMemory["enabled"] === "boolean"
          ? {
              enabled: rawMemory["enabled"],
              ...(typeof rawMemory["requiresApproval"] === "boolean"
                ? { requiresApproval: rawMemory["requiresApproval"] }
                : {}),
            }
          : undefined;

      const scope = p["scope"] === "global" || p["scope"] === "personal" ? p["scope"] : undefined;

      const modelId = typeof p["modelId"] === "string" ? p["modelId"].trim().slice(0, 120) : "";
      const color = typeof p["color"] === "string" ? p["color"].trim().slice(0, 32) : "";
      const summary = typeof p["summary"] === "string" ? p["summary"].trim().slice(0, MAX_SUMMARY) : "";

      ref.value = {
        variant: "draft",
        agent: {
          name,
          slug,
          description,
          systemPrompt,
          tools,
          permissionMode,
          ...(skillSlugs.length > 0 ? { skillSlugs } : {}),
          ...(deniedTools.length > 0 ? { deniedTools } : {}),
          ...(mcps.length > 0 ? { mcps } : {}),
          ...(skills.length > 0 ? { skills } : {}),
          ...(knowledge ? { knowledge } : {}),
          ...(providerOrder.length > 0 ? { providerOrder } : {}),
          ...(memory ? { memory } : {}),
          ...(scope ? { scope } : {}),
          ...(modelId ? { modelId } : {}),
          ...(color ? { color } : {}),
          ...(summary ? { summary } : {}),
        },
      };
      log.info(
        `[propose-agent] accepted name="${name}" slug=${slug} promptLen=${systemPrompt.length} tools=${tools.length} permission=${permissionMode}`,
      );

      // Hard-stop the turn — nothing exists yet and nothing further can be done
      // until the user approves. Wired by run.ts to AbortController.abort().
      try {
        abortRun?.();
      } catch {
        // Never let an abort-wiring bug poison the draft path.
      }

      return {
        content: [
          {
            type: "text" as const,
            text: "STOP — the agent draft was sent to the user for approval. Do NOT continue, do NOT call any more tools, and do NOT tell the user the agent exists: it is created only if they approve the card.",
          },
        ],
        details: { slug, tools: tools.length },
      };
    },
  };
}
