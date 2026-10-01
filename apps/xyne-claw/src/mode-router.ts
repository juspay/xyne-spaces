import { LITELLM, litellmEndpoint } from "./config.js";
import type { JevAnswer, JevQuestion } from "./jev.js";
import { runJudgeSite } from "./judge-site.js";
import { createLogger } from "./logger.js";
import { optEnabled } from "./optimizations.js";
import { TASK_COMMANDS, type TaskCommand } from "./task-commands.js";

const log = createLogger("mode-router");

const ROUTABLE_COMMANDS = new Set(["/review", "/learn"]);
const MIN_TASK_CHARS = 12;
const MAX_TASK_CHARS = 1200;
const REQUEST_TIMEOUT_MS = 4000;

export interface ModeRouteResult {
  command: TaskCommand | null;
  source: "explicit" | "model" | "jev" | "none" | "skipped";
}

// A wrong mode has side effects (it changes the whole run), so Jev must be
// more sure to pick a mode than to pick "none".
const JEV_MODE_AT = Number(process.env["MODE_ROUTER_JEV_MODE_AT"] ?? 0.85);
const JEV_NONE_AT = Number(process.env["MODE_ROUTER_JEV_NONE_AT"] ?? 0.7);

export function modeQuestion(commands: TaskCommand[]): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {
    none: "Ordinary conversation, a question, or anything that does not plainly ask for one of the other modes",
  };
  for (const c of commands) criteria[c.command.slice(1)] = c.instruction.replace(/\s+/g, " ").slice(0, 300);
  return { mode: { type: "choice", instructions: "Which working mode does the user's message plainly ask for?", criteria } };
}

/** Pure: answers → route, or null (unsure → LLM router). Exported for tests. */
export function routeFromJev(
  commands: TaskCommand[],
  answers: Record<string, JevAnswer>,
): ModeRouteResult | null {
  const a = answers["mode"];
  const pick = a?.choice;
  if (!pick) return null;
  const p = a.probabilities?.[pick] ?? a.confidence ?? 0;
  if (pick === "none") return p >= JEV_NONE_AT ? { command: null, source: "jev" } : null;
  const command = commands.find((c) => c.command.slice(1) === pick);
  if (!command || p < JEV_MODE_AT) return null;
  return { command, source: "jev" };
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

export async function routeTaskMode(
  task: string,
  explicit: TaskCommand | null,
  abortSignal?: AbortSignal,
): Promise<ModeRouteResult> {
  if (explicit) return { command: explicit, source: "explicit" };

  const trimmed = task.trim();
  const commands = routableCommands();
  if (!LITELLM.apiKey || commands.length === 0) return { command: null, source: "skipped" };
  if (trimmed.length < MIN_TASK_CHARS || trimmed.startsWith("/")) {
    return { command: null, source: "skipped" };
  }

  const routed = await runJudgeSite<ModeRouteResult>({
    site: "mode-router",
    enabled: optEnabled("jev_mode_router"),
    budgetMs: 1_500,
    state: `## The user's message (data)\n<<<DATA\n${trimmed.slice(0, MAX_TASK_CHARS)}\nDATA>>>`,
    questions: modeQuestion(commands),
    decide: (answers) => routeFromJev(commands, answers),
    fallback: () => routeTaskModeLlm(trimmed, commands, abortSignal),
    describe: (r) => `${r.command?.command ?? "none"} via ${r.source}`,
    ...(abortSignal ? { signal: abortSignal } : {}),
  });
  return routed.decision ?? { command: null, source: "none" };
}

async function routeTaskModeLlm(
  trimmed: string,
  commands: TaskCommand[],
  abortSignal?: AbortSignal,
): Promise<ModeRouteResult> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;

  try {
    const response = await fetch(litellmEndpoint("/v1/chat/completions"), {
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
    if (!picked) return { command: null, source: "none" };
    log.info(`[mode-router] routed to ${picked.command}`);
    return { command: picked, source: "model" };
  } catch (err) {
    log.warn(`[mode-router] failed: ${err instanceof Error ? err.message : String(err)}`);
    return { command: null, source: "none" };
  }
}
