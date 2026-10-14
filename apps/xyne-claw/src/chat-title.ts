import { LITELLM, litellmEndpoint } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("chat-title");

const CHAT_TITLE_TIMEOUT_MS = Number(process.env["CHAT_TITLE_TIMEOUT_MS"] ?? 30_000);

/** Sidebar rows are narrow: anything longer than this gets cut by the UI. */
export const GENERATED_CHAT_TITLE_MAX_CHARS = 48;
export const GENERATED_CHAT_TITLE_MIN_WORDS = 2;
export const GENERATED_CHAT_TITLE_MAX_WORDS = 6;

const SYSTEM_PROMPT = `You name chat conversations for a sidebar.

Reply with ONLY this JSON and nothing else: {"title": "<title>"}
Never explain, never think out loud, never list options, never count words.

Rules for the title:
- Two to six words naming the subject.
- Same language the user wrote in.
- Sentence case. No quotes, no markdown, no trailing punctuation, no emoji.
- Name the topic, not the interaction. "Deploy pipeline failing on main", never "User asks for help".
- Prefer concrete nouns from the exchange over filler like "request" or "discussion".
- Never invent names, numbers, dates or facts absent from the exchange.

Example
Conversation: how do I add a column to a Prisma model?
{"title": "Adding a Prisma model column"}

Example
Conversation: our webhook sender keeps retrying forever, what policy should I use?
{"title": "Webhook retry policy choice"}`;

const RETRY_NUDGE =
  'Your previous reply was not usable. Reply with exactly {"title": "<two to six words>"} and nothing else.';

export interface ChatTitleInput {
  firstUserMessage: string;
  assistantReply?: string;
}

const STRUCTURED_ARTIFACT =
  /<\/?(?:tool_?calls?|function_?calls?|invoke|parameter)\b|toolcall|arg_?key|record_?chat_?title/i;

/** Text that only appears when the model narrates its reasoning instead of answering. */
const REASONING_LEAK = new RegExp(
  [
    String.raw`<\/?think`,
    String.raw`\bi(?:'|’)?ll\b`,
    String.raw`\bi will\b`,
    String.raw`\bi(?:'|’)?m going\b`,
    String.raw`\blet me\b`,
    String.raw`\bgo with\b`,
    String.raw`\bsomething like\b`,
    String.raw`\b(?:maybe|perhaps|hmm|alternatively|actually)\b`,
    String.raw`\b(?:one|two|three|four|five|six|seven|eight|\d+)\s+words?\b`,
    String.raw`\bwords?\s*[).,]`,
    String.raw`\bthe rules?\b`,
    String.raw`^rules?\b`,
    String.raw`\btitle\s*[:=]`,
    String.raw`\b(?:a|the|this|that) title (?:is|should|could|would|for)\b`,
    String.raw`^(?:the user|user (?:asks|asked|wants|is)|this (?:conversation|chat)|here(?:'s| is)|okay|ok|sure)\b`,
  ].join("|"),
  "i",
);

const GENERIC_ADJECTIVE = String.raw`(?:(?:simple|casual|friendly|quick|brief)\s+)?`;

/** Titles that name the interaction instead of the subject. */
const GENERIC_TITLE = new RegExp(
  `^${GENERIC_ADJECTIVE}(?:${[
    String.raw`greetings?`,
    String.raw`hello|hi|hey`,
    String.raw`new (?:chat|conversation)`,
    String.raw`untitled(?: chat| conversation)?`,
    String.raw`general (?:question|chat|inquiry|conversation)`,
    String.raw`(?:casual|friendly|initial|simple) (?:conversation|chat|greeting|exchange|message)`,
    String.raw`greeting(?: message| exchange)?`,
    String.raw`user (?:greeting|request|question|message)`,
    String.raw`help request`,
    String.raw`quick question`,
    String.raw`test message`,
    String.raw`conversation start`,
  ].join("|")})$`,
  "i",
);

const QUOTED = /["“”«»]([^"“”«»\n]{2,120})["“”«»]/g;

function stripReasoningBlock(raw: string): string {
  // Keep what follows the LAST closing think tag; if nothing does, the title
  // was written inside the reasoning, so keep the whole thing for quote mining.
  const closers = [...raw.matchAll(/<\/think>?/gi)];
  const last = closers[closers.length - 1];
  if (last && last.index !== undefined) {
    const after = raw.slice(last.index + last[0].length).trim();
    if (after) return after;
  }
  return raw.replace(/<\/?think>?/gi, " ");
}

function normalize(candidate: string): string {
  return candidate
    .replace(/^\s*(?:[-*•>]|\d+[.)]|[a-z][.)])\s+/i, "")
    .replace(/^title\s*[:=-]\s*/i, "")
    .replace(/[*_`#"“”‘«»]/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?…—–-]+$/g, "")
    .replace(/^[\s.,;:!?…—–-]+/g, "")
    .trim();
}

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

function countWords(text: string): number {
  let count = 0;
  for (const part of WORD_SEGMENTER.segment(text)) if (part.isWordLike) count += 1;
  return count;
}

/**
 * The single gate every generated title passes before it can be stored. Returns
 * the cleaned title or null; null means "show the fallback", never "show this".
 */
export function validateChatTitle(candidate: string): string | null {
  const cleaned = normalize(candidate);
  if (!cleaned) return null;
  if (cleaned.length > GENERATED_CHAT_TITLE_MAX_CHARS) return null;
  const words = countWords(cleaned);
  if (words < GENERATED_CHAT_TITLE_MIN_WORDS) return null;
  // Japanese, Chinese and Thai write without spaces, so a word ceiling there
  // measures morphemes rather than words; the character limit is the real
  // guard for those. Only hold spaced writing to the word count.
  if (cleaned.includes(" ") && words > GENERATED_CHAT_TITLE_MAX_WORDS) return null;
  if (!/\p{L}/u.test(cleaned)) return null;
  if (REASONING_LEAK.test(cleaned) || GENERIC_TITLE.test(cleaned)) return null;
  if (/[{}[\]<>|\\]/.test(cleaned)) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Candidate strings in the order they should be tried. */
function titleCandidates(text: string): string[] {
  const candidates: string[] = [];
  // 1. Explicit JSON `"title": "..."` anywhere — last one wins (the final answer).
  // The closing quote has to be the same character as the opening one, or an
  // apostrophe inside the title ends the match early and truncates it.
  const jsonTitles = [
    ...text.matchAll(/["']title["']\s*:\s*(["'])((?:\\.|(?!\1)[^\\\n]){1,200})\1/gi),
  ].map((m) => (m[2] ?? "").replace(/\\(.)/g, "$1"));
  candidates.push(...jsonTitles.reverse());

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const leaked = REASONING_LEAK.test(text) || lines.length > 1;

  // 2. Reasoning leaked: the real title is almost always the last quoted phrase.
  if (leaked) {
    const quoted = [...text.matchAll(QUOTED)].map((m) => m[1] ?? "");
    candidates.push(...quoted.reverse());
  }

  // 3. Plain lines: a clean single-line answer, or the head of "Title — note".
  for (const line of leaked ? [...lines].reverse() : lines) {
    candidates.push(line);
    const head = line.split(/\s[—–-]\s|\s\(/)[0];
    if (head && head !== line) candidates.push(head);
  }
  return candidates;
}

export function sanitizeChatTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (STRUCTURED_ARTIFACT.test(raw)) return null;
  const text = stripReasoningBlock(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!text) return null;
  for (const candidate of titleCandidates(text)) {
    const title = validateChatTitle(candidate);
    if (title) return title;
  }
  return null;
}

export function parseChatTitlePayload(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const title = (value as Record<string, unknown>)["title"];
    return typeof title === "string" ? validateChatTitle(title) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const fromJson = parseChatTitlePayload(JSON.parse(trimmed) as unknown);
      if (fromJson) return fromJson;
    } catch {
      /* not JSON */
    }
  }
  return sanitizeChatTitle(trimmed);
}

/** Model used for titles: a non-reasoning model when one is configured. */
export function chatTitleModel(): string {
  return process.env["LITELLM_TITLE_MODEL"]?.trim() || LITELLM.fastModel;
}

type AttemptResult =
  | { kind: "title"; title: string }
  | { kind: "unusable"; preview: string }
  | { kind: "error"; reason: string };

async function requestTitle(
  model: string,
  input: ChatTitleInput,
  retry: boolean,
): Promise<AttemptResult> {
  const conversation = [
    `Conversation: ${input.firstUserMessage.slice(0, 1_500)}`,
    ...(input.assistantReply?.trim()
      ? [`Assistant's reply: ${input.assistantReply.slice(0, 1_000)}`]
      : []),
  ].join("\n\n");

  const response = await fetch(litellmEndpoint("/v1/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LITELLM.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: retry ? `${conversation}\n\n${RETRY_NUDGE}` : conversation },
      ],
      temperature: 0,
      // A non-reasoning model needs ~15 tokens. The headroom only exists so a
      // reasoning model that ignores enable_thinking still reaches its answer.
      max_tokens: 160,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(CHAT_TITLE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { kind: "error", reason: `LiteLLM ${response.status}: ${body.slice(0, 160)}` };
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
        tool_calls?: Array<{ function?: { arguments?: unknown } }>;
        function_call?: { arguments?: unknown };
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  const title = [
    message?.content,
    ...(message?.tool_calls?.map((call) => call.function?.arguments) ?? []),
    message?.function_call?.arguments,
  ].reduce<string | null>((found, candidate) => found ?? parseChatTitlePayload(candidate), null);

  if (title) return { kind: "title", title };
  const preview =
    typeof message?.content === "string"
      ? message.content.replace(/\s+/g, " ").trim().slice(0, 120)
      : `(${typeof message?.content})`;
  return { kind: "unusable", preview };
}

/**
 * Returns a validated title or null. Null is a normal outcome: the caller keeps
 * the conversation unnamed and the sidebar shows the first message instead, so
 * a bad model answer can never reach the UI.
 */
export async function generateChatTitle(input: ChatTitleInput): Promise<string | null> {
  if (!LITELLM.apiKey) {
    log.warn("[chat-title] LITELLM_API_KEY is not configured — skipping generation");
    return null;
  }
  const model = chatTitleModel();

  try {
    for (const retry of [false, true]) {
      const result = await requestTitle(model, input, retry);
      if (result.kind === "title") {
        log.info(`[chat-title] generated model=${model} retried=${retry}`);
        return result.title;
      }
      if (result.kind === "error") {
        // Rate limits and outages are not fixed by asking again right away.
        log.warn(`[chat-title] ${result.reason} model=${model}`);
        return null;
      }
      log.warn(
        `[chat-title] unusable response model=${model} retried=${retry}: ${JSON.stringify(result.preview)}`,
      );
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`[chat-title] generation failed model=${model}: ${message.slice(0, 200)}`);
    return null;
  }
}
