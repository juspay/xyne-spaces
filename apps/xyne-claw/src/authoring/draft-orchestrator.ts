/**
 * One streamed Build-chat turn.
 *
 *   t0  classify (small JSON) ─────────┐
 *       capability judge (speculative) ├─► identity, permission, schedule
 *                                      │   as soon as classify returns
 *       instructions stream ◄──────────┘   start when the judge lands, or
 *                                          2s after classify, whichever is first
 *
 * The judge starts with classify because it only needs the user's message, not
 * classify's answer, and most turns need both. Picks that land after the
 * instructions have started are added as a Tools section, so the instructions
 * still describe the tools the canvas ended up with.
 *
 * A turn that is conversation, not a change, cancels the judge and is answered
 * instead: a web search when the planner asked for one, a streamed answer, then
 * one-tap suggestions or a question card. A vague "make an agent" gets a
 * question card.
 */
import type {
  AgentDraftBody,
  AgentPermissionMode,
  ClawDraftRequest,
  DraftField,
  DraftHub,
  DraftMode,
  DraftPick,
  DraftTimings,
} from "xyne-claw-shared";
import { validateSystemPromptContract } from "xyne-claw-shared";
import { createLogger } from "../logger.js";
import type { AuthoringMessage } from "./authoring-llm.js";
import { AuthoringLlmError } from "./authoring-llm.js";
import { classifyTurn, slugFromName, type ClassifyDecision } from "./classify.js";
import { catalogPicks, judgeCapabilities, type JudgeInput, type JudgedCapabilities } from "./judge.js";
import {
  finishInstructions,
  GROUP_TOOLS_OVER,
  streamInstructions,
  templateInstructions,
  toolsSection,
  TOOLS_HEADING,
  TOOLS_INSERT_BEFORE,
  type InstructionsInput,
  type InstructionsResult,
} from "./instructions.js";
import { answerWithFallback, buildTalkMessages, extractFollowups, type Followups, type FollowupsInput, type TalkResult } from "./talk.js";
import { searchWeb, type WebLookup } from "./web-lookup.js";

export interface DraftDeps {
  classify: (input: ClawDraftRequest, signal: AbortSignal) => Promise<ClassifyDecision>;
  judge: (input: JudgeInput, signal: AbortSignal) => Promise<JudgedCapabilities>;
  instructions: (
    input: InstructionsInput,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ) => Promise<InstructionsResult>;
  /** Whether web search is set up; when it isn't, a lookup is skipped without a word. */
  searchReady: () => boolean;
  search: (queries: string[], objective: string, signal: AbortSignal) => Promise<WebLookup>;
  talk: (
    messages: AuthoringMessage[],
    onDelta: (text: string) => void,
    signal: AbortSignal,
    budgetMs: number,
  ) => Promise<TalkResult>;
  followups: (input: FollowupsInput, signal: AbortSignal) => Promise<Followups>;
  now: () => number;
}

export const DEFAULT_DRAFT_DEPS: DraftDeps = {
  classify: classifyTurn,
  judge: judgeCapabilities,
  instructions: streamInstructions,
  searchReady: () => Boolean(process.env["PARALLEL_API_KEY"]),
  search: searchWeb,
  talk: answerWithFallback,
  followups: extractFollowups,
  now: Date.now,
};

/** How long instructions wait for the judge after classify returns. */
export const CAPABILITY_WAIT_MS = 2_000;
/** Hard cap on a whole turn: planning (≤20s), the judge wait (2s), instructions (≤20s), with room to spare. */
export const TURN_TIMEOUT_MS = 50_000;

const ALL_HUBS: readonly DraftHub[] = ["mcp", "builtin", "subagent", "skill", "knowledge"];
const TOOL_HUBS = new Set<DraftHub>(["mcp", "builtin", "subagent"]);
const VAGUE_CREATE = /^\s*(make|create|build)\s+(me\s+)?(an?\s+)?(agent|bot)\s*[.!?]*\s*$/i;
/** Greetings and acknowledgements: never a reason to rewrite the canvas. */
const SMALL_TALK =
  /^\s*(hi|hii+|hello|hey|yo|sup|thanks|thank you|thx|ok|okay|cool|nice|great|good (morning|afternoon|evening))\b[\s!.?]*$/i;
/** A question, not a change: without the planner, answer rather than rewrite the canvas. */
const QUESTION = /\?\s*$|^\s*(what|who|how|why|when|where|which|is|are|can|could|does|do|should|will)\b/i;
/** "Start over" with nothing else said: without the planner, clear rather than edit. */
const START_OVER =
  /^\s*(let'?s\s+|please\s+|can you\s+)?(start (over|again|afresh|fresh|from (a )?(clean slate|scratch))|(from )?(a )?clean slate|clear (the canvas|everything|it all|all)|wipe (it|the canvas|everything)|reset( the canvas| everything| it)?|scrap (this|it|everything))\b[\s!.?]*$/i;
/** Time kept back at the end of a turn for follow-ups and the closing event. */
const TALK_RESERVE_MS = 6_000;

const log = createLogger("agent-draft");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Earlier titles for a section, so an old prompt's section is replaced, not duplicated. */
const SECTION_ALIASES: Record<string, readonly string[]> = { tools: ["When to use each tool"] };

/** A section title alone on its line: `Rules`, `Rules:` or `## Rules`. */
const titleLine = (titles: readonly string[]): string =>
  `(?:#{1,3}[ \\t]*)?(?:${titles.map(escapeRe).join("|")})[ \\t]*:?[ \\t]*(?=\\n|$)`;

/** Where a section ends: a blank line before the next title, a `## ` heading, or the end. */
const SECTION_END = "(?=\\n[ \\t]*\\n(?:#{1,3}[ \\t]*)?[^\\s\\d-][^\\n]{0,40}\\n|\\n#{1,3} |$)";

/** The body of the section titled `heading` (title line excluded), or null when there is none. */
function sectionBody(text: string, heading: string): string | null {
  const titles = [heading, ...(SECTION_ALIASES[heading.toLowerCase()] ?? [])];
  const match = new RegExp(`(?:^|\\n)${titleLine(titles)}([\\s\\S]*?)${SECTION_END}`, "i").exec(text);
  return match ? match[1]! : null;
}

/** Whether the text has a section with one of these titles. */
function hasSection(text: string, titles: readonly string[]): boolean {
  return titles.some((title) => sectionBody(text, title) !== null);
}

/**
 * The tools section's lines, keyed by lowercased tool name ("- Slack: post the
 * digest." under "slack"), so a rebuilt section keeps what was written for a tool.
 */
export function toolLinesIn(text: string): Map<string, string> {
  const lines = new Map<string, string>();
  for (const line of (sectionBody(text, TOOLS_HEADING) ?? "").split("\n")) {
    const match = /^\s*-\s+([^:\n]{1,80}):\s+\S/.exec(line);
    if (match) lines.set(match[1]!.trim().toLowerCase(), line.trim());
  }
  return lines;
}

/** Drop the section titled `heading`, and the blank line in front of it. */
function dropSection(text: string, heading: string): string {
  const titles = [heading, ...(SECTION_ALIASES[heading.toLowerCase()] ?? [])];
  const existing = new RegExp(`(^|\\n)[ \\t]*\\n?${titleLine(titles)}[\\s\\S]*?${SECTION_END}`, "i");
  return text.replace(existing, (_m, lead: string) => lead).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Replace the section titled `heading` with `section` (title line included), or
 * add it: in front of the first `insertBefore` title the text has, else at the end.
 */
export function replaceSection(
  text: string,
  heading: string,
  section: string,
  insertBefore: readonly string[] = [],
): string {
  const titles = [heading, ...(SECTION_ALIASES[heading.toLowerCase()] ?? [])];
  const existing = new RegExp(`(^|\\n)${titleLine(titles)}[\\s\\S]*?${SECTION_END}`, "i");
  if (existing.test(text)) return text.replace(existing, (_m, lead: string) => `${lead}${section}`);
  if (insertBefore.length > 0) {
    const next = new RegExp(`(^|\\n)${titleLine(insertBefore)}`, "i").exec(text);
    if (next) {
      const at = next.index + next[1]!.length;
      return `${text.slice(0, at)}${section}\n\n${text.slice(at)}`;
    }
  }
  return `${text.trimEnd()}\n\n${section}`;
}

const FIELD_WORDS: Record<DraftField, string> = {
  name: "name",
  handle: "handle",
  description: "description",
  instructions: "instructions",
  tools: "tools",
  skills: "skills",
  knowledge: "knowledge",
  permission: "permission mode",
  schedule: "schedule",
  properties: "properties",
};

/**
 * The chat line for a draft or edit when the model left `ack` blank. The ack is
 * the only chat text those turns send, so without this the canvas fills and the
 * chat stays empty. Exported for tests.
 */
export function defaultAck(
  mode: DraftMode,
  name: string,
  fields: readonly DraftField[],
  landed: boolean,
): string {
  if (!landed) return "Nothing on the canvas needed changing.";
  if (mode === "draft") return name.trim() ? `Drafted ${name.trim()}.` : "Drafted the agent.";
  if (fields.length === 0 || fields.length > 3) return "Updated the canvas.";
  const words = fields.map((f) => FIELD_WORDS[f]);
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return `Updated the ${list}.`;
}

/** What the tools step put on the canvas this turn. */
interface CapabilityOutcome {
  bound: DraftPick[];
  suggested: DraftPick[];
  /** Picks that were already on the canvas, so nothing new landed for them. */
  already: DraftPick[];
}

const NO_CAPABILITIES: CapabilityOutcome = { bound: [], suggested: [], already: [] };
const CAPABILITY_FIELDS = new Set<DraftField>(["tools", "skills", "knowledge"]);

const pickKey = (pick: Pick<DraftPick, "hub" | "id">): string => `${pick.hub}:${pick.id}`;

/** First pick for each catalog item wins. */
function uniquePicks(picks: DraftPick[]): DraftPick[] {
  const seen = new Set<string>();
  return picks.filter((pick) => !seen.has(pickKey(pick)) && Boolean(seen.add(pickKey(pick))));
}

/** "github-mcp" and "GitHub MCP" compare equal. */
const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "a", "a and b", "a, b and c". */
function joinWords(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}


/** Singular and plural names of each kind, for chat replies. */
const HUB_NOUN: Record<DraftHub, readonly [string, string]> = {
  mcp: ["MCP server", "MCP servers"],
  builtin: ["built-in tool", "built-in tools"],
  subagent: ["subagent", "subagents"],
  skill: ["skill", "skills"],
  knowledge: ["knowledge collection", "knowledge collections"],
};

/** Over this many names, a kind is counted instead of listed. */
const NAMES_IN_ACK = 3;

/** Each name, or one count once there are too many to read. */
function namesOrCount(picks: DraftPick[], hub: DraftHub): string[] {
  if (picks.length <= NAMES_IN_ACK) return picks.map((p) => p.label);
  const count = `${picks.length} ${HUB_NOUN[hub][1]}`;
  return [hub === "mcp" && picks.every((p) => p.access !== "write") ? `${count} with read access` : count];
}

/**
 * The chat line for the tools that landed: "Added 6 MCP servers with read access
 * and 4 subagents. Figma and HubSpot aren't connected yet, so they're suggestions
 * on the canvas." Empty when nothing landed. Exported for tests.
 */
export function capabilityAck(outcome: Pick<CapabilityOutcome, "bound" | "suggested">): string {
  const sentences: string[] = [];
  const added = ALL_HUBS.flatMap((hub) => {
    const ofHub = outcome.bound.filter((p) => p.hub === hub);
    return ofHub.length > 0 ? namesOrCount(ofHub, hub) : [];
  });
  if (added.length > 0) sentences.push(`Added ${joinWords(added)}.`);
  const unconnected = outcome.suggested.filter((p) => p.requiresConnection);
  if (unconnected.length > 0) {
    const one = unconnected.length === 1;
    sentences.push(
      `${joinWords(namesOrCount(unconnected, "mcp")).replace(/ with read access$/, "")} ${one ? "isn't" : "aren't"} connected yet, so ${
        one ? "it's a suggestion" : "they're suggestions"
      } on the canvas.`,
    );
  }
  const offered = outcome.suggested.filter((p) => !p.requiresConnection);
  if (offered.length > 0) {
    const names = offered.length <= NAMES_IN_ACK ? joinWords(offered.map((p) => p.label)) : `${offered.length} more`;
    sentences.push(`${names} ${offered.length === 1 ? "is a suggestion" : "are suggestions"} on the canvas.`);
  }
  return sentences.join(" ");
}

/** Past this many tools an agent answers slower and picks the wrong tool more often. */
export const CROWDED_TOOLS_OVER = 25;

/**
 * About how many tools an agent loads: an MCP's read tools (and its writes when
 * it may write), a built-in's tools, one per subagent. Canvas items don't say
 * their access, so their MCPs count reads only.
 */
function toolCount(caps: readonly DraftPick[], catalog: ClawDraftRequest["catalog"]): number {
  const bySlug = new Map(catalog.integrations.map((i) => [i.slug, i]));
  return caps.reduce((sum, cap) => {
    if (cap.hub === "subagent") return sum + 1;
    const integration = cap.hub === "mcp" || cap.hub === "builtin" ? bySlug.get(cap.id) : undefined;
    if (!integration) return sum;
    const writes = cap.hub === "builtin" || cap.access === "write" ? integration.writeTools.length : 0;
    return sum + integration.readTools.length + writes;
  }, 0);
}

/**
 * A heads-up when this turn takes the agent past CROWDED_TOOLS_OVER tools, or
 * adds a whole kind to an agent that is already past it. Exported for tests.
 */
export function crowdedNote(
  before: readonly DraftPick[],
  after: readonly DraftPick[],
  catalog: ClawDraftRequest["catalog"],
  addedAll: boolean,
): string {
  const now = toolCount(after, catalog);
  if (now <= CROWDED_TOOLS_OVER || (toolCount(before, catalog) > CROWDED_TOOLS_OVER && !addedAll)) return "";
  return `This agent now has about ${now} tools. Over ${CROWDED_TOOLS_OVER} makes it slower and more likely to pick the wrong one, so remove any it won't need.`;
}

const RESET_ACK = "Cleared the canvas. Tell me what this agent should do and I'll draft it fresh.";

function fallbackDecision(input: ClawDraftRequest): ClassifyDecision {
  const canvasEmpty = !input.canvas.name.trim() && !input.canvas.instructions.trim();
  const message = input.message.trim();
  if (canvasEmpty && (message.length < 12 || VAGUE_CREATE.test(message))) {
    return {
      mode: "ask",
      reply: "What job should this agent do for you?",
      fields: [],
      capabilityQuery: message,
      capabilityAdds: [],
      capabilityRemovals: [],
      instructionsBrief: message,
      ack: "",
      fromFallback: true,
    };
  }
  if (!canvasEmpty && START_OVER.test(message)) {
    return {
      mode: "reset",
      reply: "",
      fields: [],
      capabilityQuery: message,
      capabilityAdds: [],
      capabilityRemovals: [],
      instructionsBrief: message,
      ack: RESET_ACK,
      fromFallback: true,
    };
  }
  if (SMALL_TALK.test(message) || QUESTION.test(message)) {
    return {
      mode: "chat",
      reply: !SMALL_TALK.test(message)
        ? "I couldn't answer that just now. Try asking again in a moment."
        : canvasEmpty
          ? "Hi! What job should this agent do for you?"
          : "Hi! Tell me what to change: the name, tools, schedule, properties or instructions.",
      fields: [],
      capabilityQuery: message,
      capabilityAdds: [],
      capabilityRemovals: [],
      instructionsBrief: message,
      ack: "",
      fromFallback: true,
    };
  }
  // "Create a release copilot for…" → "Release Copilot", not "Create A Release Copilot".
  const job = message
    .split(/[.\n]/)[0]!
    .replace(/^\s*(please\s+)?(create|make|build|draft|set\s+up)\s+(me\s+)?(an?\s+|the\s+)?/i, "")
    .replace(/\b(agent|bot)\s+(that|which|to)\b.*$/i, "$1")
    .replace(/\s+(for|that|which|to|who)\b.*$/i, "");
  const words = job.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 4);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "New Agent";
  return {
    mode: canvasEmpty ? "draft" : "edit",
    reply: "",
    fields: canvasEmpty
      ? ["name", "handle", "description", "instructions", "tools", "skills", "knowledge", "permission"]
      : ["instructions"],
    ...(canvasEmpty ? { name, handle: slugFromName(name), description: message.slice(0, 140) } : {}),
    permission: { mode: "ask-first", reason: "Default until you choose." },
    capabilityQuery: message,
    capabilityAdds: [],
    capabilityRemovals: [],
    instructionsBrief: message,
    ack: canvasEmpty ? `Drafted ${name}.` : "Updated the instructions.",
    fromFallback: true,
  };
}

export async function runDraftTurn(
  input: ClawDraftRequest,
  emitBody: (body: AgentDraftBody) => void,
  signal: AbortSignal,
  deps: DraftDeps = DEFAULT_DRAFT_DEPS,
): Promise<void> {
  const t0 = deps.now();
  const turnSignal = AbortSignal.any([signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);
  const judgeAbort = new AbortController();
  const judgeSignal = AbortSignal.any([turnSignal, judgeAbort.signal]);
  const timings: DraftTimings = { totalMs: 0 };
  let partial = false;
  /** Whether anything reached the canvas this turn. */
  let landed = false;
  const elapsed = (): number => deps.now() - t0;
  const emit = (body: AgentDraftBody): void => {
    if (
      body.event === "identity" ||
      body.event === "permission" ||
      body.event === "schedule" ||
      body.event === "properties" ||
      body.event === "capabilities" ||
      body.event === "instructions.done"
    ) {
      landed = true;
    }
    if (
      timings.firstFieldMs === undefined &&
      (body.event === "identity" ||
        body.event === "permission" ||
        body.event === "schedule" ||
        body.event === "properties" ||
        body.event === "instructions.delta" ||
        body.event === "capabilities")
    ) {
      timings.firstFieldMs = elapsed();
    }
    emitBody(body);
  };
  const warn = (stage: string, message: string): void => {
    partial = true;
    emit({ event: "warning", stage, message });
  };
  const finish = (status: "completed" | "partial" | "cancelled"): void => {
    timings.totalMs = elapsed();
    emit({ event: "done", status, timings });
  };

  emit({ event: "started", draftId: input.draftId });

  const owned = new Set(input.userOwned);
  const ownsHub = (hub: DraftHub): boolean =>
    owned.has(hub === "skill" ? "skills" : hub === "knowledge" ? "knowledge" : "tools");
  const onCanvas = new Set(input.canvas.capabilities.map((c) => `${c.hub}:${c.id}`));

  /** Judge calls that failed this turn (not cancelled). Said in chat once the tools step settles. */
  const judgeFailures: string[] = [];
  const runJudge = (intent: string, hubs: readonly DraftHub[], pass: string): Promise<JudgedCapabilities | null> =>
    deps
      .judge(
        { intent, catalog: input.catalog, skills: input.skillCandidates, knowledge: input.knowledgeCandidates, hubs },
        judgeSignal,
      )
      .catch((err: unknown) => {
        if (!(err instanceof AuthoringLlmError && err.kind === "aborted")) {
          const kind = err instanceof AuthoringLlmError ? err.kind : "error";
          judgeFailures.push(kind);
          log.warn(
            `turn ${input.turnId}: ${pass} judge failed (${kind}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return null;
      });

  try {
    // Start the judge with classify: it only needs the message. The mode isn't
    // known yet, so it reads every kind; a first draft drops the ones the user
    // filled in by hand once it is.
    const judgeIntent = input.message.trim();
    const judgeWanted = !VAGUE_CREATE.test(judgeIntent) && judgeIntent.length >= 8;
    const judgePromise: Promise<JudgedCapabilities | null> = judgeWanted
      ? runJudge(judgeIntent, ALL_HUBS, "first")
      : Promise.resolve(null);

    let decision: ClassifyDecision;
    try {
      decision = await deps.classify(input, turnSignal);
    } catch (err) {
      if (turnSignal.aborted) throw err;
      decision = fallbackDecision(input);
      // A chat or ask fallback carries its own reply; a draft or edit says what it skipped.
      if (decision.mode === "draft" || decision.mode === "edit") {
        const slow = err instanceof AuthoringLlmError && err.kind === "timeout";
        warn(
          "classify",
          `${slow ? "This one took too long to plan in full" : "I couldn't plan this one in full"}, so I ${
            decision.mode === "draft" ? "drafted the basics" : "made a simple change"
          }. Send it again to fill in the rest.`,
        );
      } else {
        partial = true;
      }
    }

    emit({ event: "mode", mode: decision.mode, fields: decision.fields });

    // Start over: the page clears the canvas when it sees the mode; there is nothing to draft.
    if (decision.mode === "reset") {
      judgeAbort.abort();
      emit({ event: "ack", text: decision.ack || RESET_ACK });
      finish("completed");
      return;
    }

    if (decision.mode === "ask") {
      judgeAbort.abort();
      emit({ event: "reply.delta", text: decision.reply || "What job should this agent do for you?" });
      if (decision.questions?.length) {
        emit({ event: "question", id: `${input.turnId}-q`, questions: decision.questions });
      }
      finish(partial ? "partial" : "completed");
      return;
    }

    if (decision.mode === "chat") {
      judgeAbort.abort();
      // Without the planner a greeting gets its stock reply. Anything else still
      // goes to the talk model (its own model, with the rest of the turn's
      // budget), so a slow planner doesn't turn a real question away.
      if (decision.fromFallback && SMALL_TALK.test(input.message)) {
        emit({ event: "reply.delta", text: decision.reply || "Tell me what you want to change." });
        finish("partial");
        return;
      }

      // 1. Look it up, when the answer depends on current facts.
      let web: WebLookup | null = null;
      if (decision.lookup?.length && deps.searchReady()) {
        const running = { id: "search-1", kind: "search" as const, label: `Searching the web: ${decision.lookup[0]}` };
        emit({ event: "activity", ...running, status: "running" });
        web = await deps.search(decision.lookup, input.message, turnSignal);
        emit(
          web.ok
            ? {
                event: "activity",
                ...running,
                status: "done",
                label: "Searched the web",
                detail: `${web.sources.length} source${web.sources.length === 1 ? "" : "s"}`,
                sources: web.sources,
              }
            : {
                event: "activity",
                ...running,
                status: "failed",
                label: "Couldn't reach web search",
                detail: web.reason === "timeout" ? "It took too long." : "It returned an error.",
              },
        );
      }

      // 2. Answer, streamed.
      let answer: TalkResult = { text: "", cutOff: false };
      try {
        answer = await deps.talk(
          buildTalkMessages(input, web),
          (text) => emit({ event: "reply.delta", text }),
          turnSignal,
          Math.max(4_000, TURN_TIMEOUT_MS - elapsed() - TALK_RESERVE_MS),
        );
      } catch (err) {
        if (turnSignal.aborted) throw err;
        partial = true;
      }
      if (!answer.text.trim()) {
        emit({ event: "reply.delta", text: decision.reply || "I couldn't answer that just now. Try asking again in a moment." });
      } else if (answer.cutOff) {
        warn("talk", "The answer was cut off. Ask again for the rest.");
      }

      // 3. What next: a question card, or changes to apply with a tap.
      if (answer.text.trim() && !SMALL_TALK.test(input.message)) {
        const next = await deps
          .followups({ message: input.message, reply: answer.text, canvas: input.canvas }, turnSignal)
          .catch(() => null);
        if (next?.questions.length) {
          emit({ event: "question", id: `${input.turnId}-q`, questions: next.questions });
        } else if (next?.suggestions.length) {
          emit({ event: "suggestion", suggestions: next.suggestions });
        }
      }
      finish(partial ? "partial" : "completed");
      return;
    }

    // A first draft fills in around what the user wrote by hand (classify skips
    // those too; this holds even if the model slips). An edit is the user asking
    // for a change, so it writes over their own text; the field they are typing
    // in right now is still guarded on the canvas.
    const editing = decision.mode === "edit";
    const fields = new Set(editing ? decision.fields : decision.fields.filter((f) => !owned.has(f)));
    const hubWritable = (hub: DraftHub): boolean => editing || !ownsHub(hub);
    const newName = fields.has("name") ? decision.name : undefined;
    const newHandle = fields.has("handle") ? decision.handle : undefined;
    const newDescription = fields.has("description") ? decision.description : undefined;
    const permissionMode: AgentPermissionMode =
      decision.permission && fields.has("permission") ? decision.permission.mode : input.canvas.permissionMode;
    const name = newName ?? input.canvas.name;
    const description = newDescription ?? input.canvas.description;

    // Small fields land first.
    if (newName || newHandle || newDescription) {
      emit({ event: "field.start", field: newName ? "name" : newHandle ? "handle" : "description" });
      emit({
        event: "identity",
        ...(newName ? { name: newName } : {}),
        ...(newHandle ? { handle: newHandle } : {}),
        ...(newDescription ? { description: newDescription } : {}),
      });
    }
    if (decision.permission && fields.has("permission")) {
      emit({ event: "permission", mode: decision.permission.mode, reason: decision.permission.reason });
    }
    if (decision.schedule === "clear") {
      emit({ event: "schedule", op: "clear" });
    } else if (decision.schedule && fields.has("schedule")) {
      emit({ event: "field.start", field: "schedule" });
      emit({ event: "schedule", op: "set", ...decision.schedule, timezone: input.timezone });
    }
    if (decision.properties?.length && fields.has("properties")) {
      emit({ event: "field.start", field: "properties" });
      emit({ event: "properties", ops: decision.properties });
    }

    // Capabilities: removals need no model call; "all the MCPs" is the catalog
    // itself; named additions use the judge.
    const removals = decision.capabilityRemovals.filter((r) => hubWritable(r.hub));
    const adds = decision.capabilityAdds;
    const addAll = (decision.capabilityAddAll ?? []).filter(hubWritable);
    const capsAsked = adds.length > 0 || addAll.length > 0;
    const wantsCaps =
      decision.mode === "draft" ||
      fields.has("tools") ||
      fields.has("skills") ||
      fields.has("knowledge") ||
      capsAsked;
    if (!wantsCaps) judgeAbort.abort();

    // The first judge read only this message. Additions it never saw (named in
    // earlier messages) get their own pass now, without waiting for it; if it
    // failed, the ones it did see get one more try.
    const namedHubs = ALL_HUBS.filter((hub) => hubWritable(hub) && !addAll.includes(hub));
    const saw = (phrase: string): boolean => judgeWanted && squash(input.message).includes(squash(phrase));
    const addPass = (phrases: string[]): Promise<JudgedCapabilities | null> =>
      phrases.length > 0 && namedHubs.length > 0
        ? runJudge(`Add these to the agent, by name: ${phrases.join(", ")}.`, namedHubs, "add")
        : Promise.resolve(null);
    const unseenPass = wantsCaps ? addPass(adds.filter((a) => !saw(a))) : Promise.resolve(null);

    const existing: DraftPick[] =
      decision.mode === "edit"
        ? input.canvas.capabilities
            .filter((c) => !removals.some((r) => r.hub === c.hub && r.id === c.id))
            .map((c): DraftPick => ({ hub: c.hub, id: c.id, label: c.label, confidence: 1, reason: "" }))
        : [];

    const sendCapabilities = (passes: Array<JudgedCapabilities | null>): CapabilityOutcome => {
      // For a kind the user wants all of, the catalog decides what is bound or only
      // offered; the judge adds nothing there but the write access it was asked for.
      const judgedPicks = (list: "bound" | "suggested"): DraftPick[] =>
        passes
          .flatMap((p) => p?.[list] ?? [])
          .filter((pick) => hubWritable(pick.hub) && !addAll.includes(pick.hub));
      const writes = new Set(
        passes.flatMap((p) => p?.bound ?? []).filter((pick) => pick.access === "write").map(pickKey),
      );
      const all = addAll.length > 0
        ? catalogPicks(addAll, { catalog: input.catalog, skills: input.skillCandidates, knowledge: input.knowledgeCandidates })
        : { bound: [], suggested: [] };
      const withWrites = (pick: DraftPick): DraftPick => (writes.has(pickKey(pick)) ? { ...pick, access: "write" } : pick);
      const boundAll = uniquePicks([...judgedPicks("bound"), ...all.bound.map(withWrites)]);
      const boundKeys = new Set(boundAll.map(pickKey));
      const suggestedAll = uniquePicks([...judgedPicks("suggested"), ...all.suggested]).filter(
        (p) => !boundKeys.has(pickKey(p)),
      );
      const keep = (pick: DraftPick): boolean => !onCanvas.has(pickKey(pick));
      const readOnly = permissionMode === "read-only";
      const shape = (pick: DraftPick): DraftPick =>
        readOnly && pick.hub === "mcp" ? { ...pick, access: "read" } : pick;
      const bound = boundAll.filter(keep).map(shape);
      const suggested = suggestedAll.filter(keep).map(shape);
      const outcome: CapabilityOutcome = { bound, suggested, already: boundAll.filter((p) => !keep(p)) };
      if (bound.length === 0 && suggested.length === 0 && removals.length === 0) return outcome;
      const firstHub = [...bound, ...suggested][0]?.hub;
      emit({ event: "field.start", field: firstHub && !TOOL_HUBS.has(firstHub) ? (firstHub === "skill" ? "skills" : "knowledge") : "tools" });
      emit({
        event: "capabilities",
        op: decision.mode === "draft" ? "replace" : "add",
        bound,
        suggested,
        remove: removals,
      });
      timings.capabilitiesMs = elapsed();
      return outcome;
    };

    const capabilitiesDone: Promise<CapabilityOutcome> = wantsCaps
      ? Promise.all([judgePromise, unseenPass]).then(async ([first, unseen]) => {
          const retry = first === null && judgeWanted ? await addPass(adds.filter(saw)) : null;
          return sendCapabilities([first, unseen, retry]);
        })
      : Promise.resolve(removals.length > 0 ? sendCapabilities([]) : NO_CAPABILITIES);

    /** The agent's tools once this turn lands, for the instructions' Tools section. */
    const finalTools = (outcome: CapabilityOutcome): DraftPick[] => [...existing, ...outcome.bound];

    // Instructions.
    let outcome: CapabilityOutcome;
    if (fields.has("instructions")) {
      const early = wantsCaps
        ? await Promise.race([capabilitiesDone, sleep(CAPABILITY_WAIT_MS).then(() => undefined)])
        : NO_CAPABILITIES;
      const known: DraftPick[] = [...existing, ...(early?.bound ?? [])];
      const instructionsInput: InstructionsInput = {
        name,
        description,
        brief: decision.instructionsBrief,
        permissionMode,
        schedule:
          decision.schedule && decision.schedule !== "clear"
            ? decision.schedule
            : decision.schedule === "clear"
              ? null
              : input.canvas.schedule,
        capabilities: known,
        ...(decision.mode === "edit" && input.canvas.instructions.trim()
          ? { existing: { text: input.canvas.instructions, change: input.message } }
          : {}),
      };
      emit({ event: "field.start", field: "instructions" });
      let result: InstructionsResult;
      try {
        result = await deps.instructions(
          instructionsInput,
          (text) => emit({ event: "instructions.delta", text }),
          turnSignal,
        );
      } catch (err) {
        if (turnSignal.aborted) throw err;
        warn("instructions", "The instructions took too long, so I used a simple version to edit.");
        result = finishInstructions(templateInstructions(instructionsInput), instructionsInput);
      }

      // Tools chosen after the instructions started still belong in them, and a
      // long list is summed up per kind the same way every time.
      outcome = early ?? (await capabilitiesDone);
      const tools = finalTools(outcome);
      if ((early === undefined && outcome.bound.length > 0) || tools.length > GROUP_TOOLS_OVER) {
        const previous = new Map([...toolLinesIn(input.canvas.instructions), ...toolLinesIn(result.text)]);
        const section = toolsSection(tools, previous);
        emit({ event: "instructions.section", heading: section.heading, markdown: section.markdown });
        result = finishInstructions(
          replaceSection(result.text, section.heading, section.markdown, TOOLS_INSERT_BEFORE),
          instructionsInput,
        );
      }
      timings.instructionsMs = elapsed();
      emit({
        event: "instructions.done",
        text: result.text,
        contract: result.contract,
        repaired: result.repaired,
      });
    } else {
      outcome = await capabilitiesDone;
      // A tools-only edit: bring the instructions' Tools section up to date
      // without a model call, leaving the rest of the prompt as the user has it.
      const current = input.canvas.instructions;
      const changed = outcome.bound.length > 0 || removals.length > 0;
      if (
        decision.mode === "edit" &&
        changed &&
        !owned.has("instructions") &&
        current.trim() &&
        hasSection(current, [TOOLS_HEADING, ...TOOLS_INSERT_BEFORE])
      ) {
        const tools = finalTools(outcome);
        const text =
          tools.length > 0
            ? replaceSection(current, TOOLS_HEADING, toolsSection(tools, toolLinesIn(current)).markdown, TOOLS_INSERT_BEFORE)
            : dropSection(current, TOOLS_HEADING);
        if (text !== current) {
          emit({ event: "field.start", field: "instructions" });
          emit({ event: "instructions.done", text, contract: validateSystemPromptContract(text), repaired: false });
        }
      }
    }

    // The model's ack can claim an edit that never reached the canvas.
    let ack =
      editing && !landed
        ? defaultAck("edit", name, [], false)
        : decision.ack || defaultAck(decision.mode, name, [...fields], landed);
    const nothingAdded = outcome.bound.length === 0 && outcome.suggested.length === 0;
    if (capsAsked) {
      // Say what the tools step actually did, never what the planner expected it to.
      const others = [...fields].filter((f) => !CAPABILITY_FIELDS.has(f));
      const lead =
        decision.mode === "draft"
          ? defaultAck("draft", name, [], true)
          : others.length > 0
            ? defaultAck("edit", name, others, true)
            : "";
      const asked = [...addAll.map((hub) => `all ${HUB_NOUN[hub][1]}`), ...adds];
      let line = capabilityAck(outcome);
      if (nothingAdded && outcome.already.length > 0) {
        line = outcome.already.length > 3
          ? "They're all on the canvas already."
          : `${joinWords(outcome.already.map((p) => p.label))} ${outcome.already.length === 1 ? "is" : "are"} already on the canvas.`;
      } else if (nothingAdded && judgeFailures.length > 0) {
        warn("capabilities", `Couldn't add ${joinWords(asked)} automatically. You can add ${asked.length === 1 ? "it" : "them"} from the canvas.`);
      } else if (nothingAdded) {
        line = `Couldn't find ${joinWords(asked)} among your tools.`;
      }
      ack = [lead, line].filter(Boolean).join(" ");
    } else if (wantsCaps && nothingAdded && judgeFailures.length > 0) {
      warn("capabilities", "Couldn't pick tools automatically. You can add them from the canvas.");
    }
    const note = crowdedNote(existing, finalTools(outcome), input.catalog, addAll.length > 0);
    if (note && outcome.bound.length > 0) ack = [ack, note].filter(Boolean).join(" ");
    if (ack) emit({ event: "ack", text: ack });
    finish(partial ? "partial" : "completed");
  } catch (err) {
    judgeAbort.abort();
    if (signal.aborted) {
      finish("cancelled");
      return;
    }
    if (turnSignal.aborted) {
      emit({ event: "error", code: "llm_timeout", message: "The draft took too long. What landed is on the canvas; try again for the rest.", retryable: true });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    emit({ event: "error", code: "internal", message: message.slice(0, 200), retryable: true });
  }
}
