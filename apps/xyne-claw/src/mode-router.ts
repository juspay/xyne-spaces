import { clipForQuestion } from "xyne-claw-shared";
import { LITELLM } from "./config.js";
import { jevAskOn, judgeBackendConfigured, type JevQuestion } from "./jev.js";
import { createLogger } from "./logger.js";
import { optEnabled } from "./optimizations.js";
import { getRunFlags } from "./run-context.js";
import { TASK_COMMANDS, type TaskCommand } from "./task-commands.js";

const log = createLogger("mode-router");

const ROUTABLE_COMMANDS = new Set(["/review", "/learn"]);
const MIN_TASK_CHARS = 12;
const MAX_TASK_CHARS = 1200;
const REQUEST_TIMEOUT_MS = 4000;
const XOR_TIMEOUT_MS = 700;
/** XOR must be this sure a message is ordinary conversation before we skip the LLM router. */
const XOR_NONE_MIN = 0.6;
/** ...and this sure before it may pick a mode. Anything between falls through to the LLM. */
const XOR_MODE_MIN = 0.7;

export interface ModeRouteResult {
  command: TaskCommand | null;
  source: "explicit" | "model" | "xor" | "none" | "skipped";
}

function routableCommands(): TaskCommand[] {
  return TASK_COMMANDS.filter((command) => ROUTABLE_COMMANDS.has(command.command));
}

function buildSystemPrompt(commands: TaskCommand[]): string {
  const catalogue = commands
    .map((command) => `- ${command.command.slice(1)}: ${command.instruction.slice(0, 400)}`)
    .join("\n");
  return [
    "You route a user's message to a working mode, or to no mode at all.",
    "",
    "Modes:",
    catalogue,
    "",
    "Answer with the mode name alone, or the word none.",
    "Choose a mode only when the message plainly asks for that kind of work.",
    "When the request is ordinary conversation, a question, or ambiguous, answer none.",
    "Never explain your answer.",
  ].join("\n");
}

// What each routable mode plainly means, in one clause a classifier can weigh.
// A routable command without an entry here falls back to its own instruction.
const XOR_MODE_DESCRIPTIONS: Record<string, string> = {
  review: "Critically review code, a PR, a document or a plan and report problems",
  learn: "Teach or explain a topic step by step so the user learns it",
};
const XOR_NONE_DESCRIPTION =
  "Ordinary conversation, a question, a request to build something, or anything ambiguous";
const XOR_INSTRUCTIONS =
  "Which working mode does this message plainly ask for? Choose none for ordinary conversation, questions, requests to build agents, or anything ambiguous.";

/** XOR criterion keys are ids (`[a-z][a-z0-9_]*`), so `/record-skill` becomes `record_skill`. */
function criterionKey(command: TaskCommand): string {
  return command.command.slice(1).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function buildXorQuestion(commands: TaskCommand[]): JevQuestion {
  const criteria: Record<string, string> = {};
  for (const command of commands) {
    const key = criterionKey(command);
    criteria[key] = XOR_MODE_DESCRIPTIONS[key] ?? clipForQuestion(command.instruction, 200);
  }
  criteria["none"] = XOR_NONE_DESCRIPTION;
  return { type: "choice", instructions: XOR_INSTRUCTIONS, criteria };
}

/**
 * One typed `choice` over the routable modes plus `none`. Returns a result only
 * when XOR is sure; null (down, breaker open, no slot, timeout, invalid, or
 * unsure) means the caller keeps its LLM path.
 */
async function routeViaXor(
  trimmed: string,
  commands: TaskCommand[],
  abortSignal: AbortSignal | undefined,
): Promise<ModeRouteResult | null> {
  const started = Date.now();
  const answers = await jevAskOn(
    "xor",
    trimmed.slice(0, MAX_TASK_CHARS),
    { mode: buildXorQuestion(commands) },
    { timeoutMs: XOR_TIMEOUT_MS, purpose: "mode_router", ...(abortSignal ? { signal: abortSignal } : {}) },
  );
  const probabilities = answers?.["mode"]?.probabilities;
  if (!probabilities) {
    log.info("[mode-router] xor unavailable — falling back to the LLM router");
    return null;
  }
  const ms = Date.now() - started;
  const none = probabilities["none"] ?? 0;
  if (none >= XOR_NONE_MIN) {
    log.info(`[mode-router] xor decided none (p=${none.toFixed(2)}, ${ms}ms)`);
    return { command: null, source: "xor" };
  }
  let best: { command: TaskCommand; p: number } | null = null;
  for (const command of commands) {
    const p = probabilities[criterionKey(command)] ?? 0;
    if (!best || p > best.p) best = { command, p };
  }
  if (best && best.p >= XOR_MODE_MIN) {
    log.info(`[mode-router] xor routed to ${best.command.command} (p=${best.p.toFixed(2)}, ${ms}ms)`);
    return { command: best.command, source: "xor" };
  }
  log.info(
    `[mode-router] xor unsure (none=${none.toFixed(2)}, best=${best?.command.command ?? "-"} ${(best?.p ?? 0).toFixed(2)}, ${ms}ms) — falling back to the LLM router`,
  );
  return null;
}

export async function routeTaskMode(
  task: string,
  explicit: TaskCommand | null,
  abortSignal?: AbortSignal,
): Promise<ModeRouteResult> {
  if (explicit) return { command: explicit, source: "explicit" };

  // Create-page chat turns (`instant` / `disableTools`) never want a working
  // mode: skipping saves the round trip, and a routed `/learn` would force-mount
  // `open-url` onto a run that is meant to have no tools.
  const flags = getRunFlags();
  if (flags.instant || flags.disableTools) {
    log.info(`[mode-router] skipped (instant=${flags.instant} disableTools=${flags.disableTools})`);
    return { command: null, source: "skipped" };
  }

  const trimmed = task.trim();
  const commands = routableCommands();
  if (commands.length === 0) return { command: null, source: "skipped" };
  if (trimmed.length < MIN_TASK_CHARS || trimmed.startsWith("/")) {
    return { command: null, source: "skipped" };
  }

  if (optEnabled("xor_mode_router") && judgeBackendConfigured("xor")) {
    const viaXor = await routeViaXor(trimmed, commands, abortSignal);
    if (viaXor) return viaXor;
  }

  if (!LITELLM.apiKey) return { command: null, source: "skipped" };

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;

  try {
    const response = await fetch(`${LITELLM.url.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.fastModel,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: "system", content: buildSystemPrompt(commands) },
          { role: "user", content: trimmed.slice(0, MAX_TASK_CHARS) },
        ],
      }),
      signal,
    });
    if (!response.ok) {
      log.warn(`[mode-router] status=${response.status}`);
      return { command: null, source: "none" };
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const raw = body.choices?.[0]?.message?.content;
    const answer = typeof raw === "string" ? raw.trim().toLowerCase().replace(/^\//, "") : "";
    const picked = commands.find((command) => command.command.slice(1) === answer);
    if (!picked) {
      log.info("[mode-router] llm decided none");
      return { command: null, source: "none" };
    }
    log.info(`[mode-router] llm routed to ${picked.command}`);
    return { command: picked, source: "model" };
  } catch (err) {
    log.warn(`[mode-router] failed: ${err instanceof Error ? err.message : String(err)}`);
    return { command: null, source: "none" };
  }
}
