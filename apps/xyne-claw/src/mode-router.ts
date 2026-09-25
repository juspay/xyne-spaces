import { LITELLM } from "./config.js";
import { createLogger } from "./logger.js";
import { TASK_COMMANDS, type TaskCommand } from "./task-commands.js";

const log = createLogger("mode-router");

const ROUTABLE_COMMANDS = new Set(["/review", "/learn"]);
const MIN_TASK_CHARS = 12;
const MAX_TASK_CHARS = 1200;
const REQUEST_TIMEOUT_MS = 4000;

export interface ModeRouteResult {
  command: TaskCommand | null;
  source: "explicit" | "model" | "none" | "skipped";
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
    if (!picked) return { command: null, source: "none" };
    log.info(`[mode-router] routed to ${picked.command}`);
    return { command: picked, source: "model" };
  } catch (err) {
    log.warn(`[mode-router] failed: ${err instanceof Error ? err.message : String(err)}`);
    return { command: null, source: "none" };
  }
}
