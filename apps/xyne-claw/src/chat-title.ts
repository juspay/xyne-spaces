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

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

function wordsOf(text: string): string[] {
  const words: string[] = [];
  for (const part of WORD_SEGMENTER.segment(text.toLowerCase())) {
    if (part.isWordLike) words.push(part.segment);
  }
  return words;
}

/** Short Latin words ("the", "a", "can") are too common to prove a title is on topic. */
const isSubjectWord = (word: string): boolean => word.length >= 4 || /[^a-z]/.test(word);

/**
 * The single gate before a title is stored. Shape checks plus one grounding
 * check: the title must reuse a subject word from the conversation itself.
 * That rejects "Greeting" / "Casual conversation" without any word list.
 */
export function validateChatTitle(candidate: string, conversation: string): string | null {
  const cleaned = candidate
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?…]+$/, "")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > GENERATED_CHAT_TITLE_MAX_CHARS) return null;
  if (/[\n{}[\]<>|\\"`*#]/.test(cleaned)) return null;
  if (!/\p{L}/u.test(cleaned)) return null;
  const titleWords = wordsOf(cleaned);
  if (titleWords.length < GENERATED_CHAT_TITLE_MIN_WORDS) return null;
  // Japanese, Chinese and Thai write without spaces, so a word ceiling there
  // measures morphemes rather than words; the character limit is the real
  // guard for those. Only hold spaced writing to the word count.
  if (cleaned.includes(" ") && titleWords.length > GENERATED_CHAT_TITLE_MAX_WORDS) return null;
  const conversationWords = new Set(wordsOf(conversation));
  if (!titleWords.some((word) => isSubjectWord(word) && conversationWords.has(word))) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * The answer must BE {"title": "..."}. Prose, reasoning, or a title buried in
 * text is rejected, not repaired, so nothing has to recognise reasoning words.
 */
export function parseChatTitlePayload(value: unknown, conversation: string): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const title = (value as Record<string, unknown>)["title"];
    return typeof title === "string" ? validateChatTitle(title, conversation) : null;
  }
  if (typeof value !== "string") return null;
  // A reasoning model may put a <think> block first; only what follows it is the answer.
  const answer = (value.split(/<\/think>/i).pop() ?? "")
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/gi, "")
    .trim();
  if (!answer) return null;
  try {
    return parseChatTitlePayload(JSON.parse(answer) as unknown, conversation);
  } catch {
    return null;
  }
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
  ].reduce<string | null>(
    (found, candidate) => found ?? parseChatTitlePayload(candidate, conversation),
    null,
  );

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
