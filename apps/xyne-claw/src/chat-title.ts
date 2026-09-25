import { LITELLM } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("chat-title");

const CHAT_TITLE_TIMEOUT_MS = Number(process.env["CHAT_TITLE_TIMEOUT_MS"] ?? 30_000);

export const CHAT_TITLE_MAX_CHARS = 60;

const SYSTEM_PROMPT = `You name chat conversations.

Reply with ONLY the title. Never explain, never describe the user, never restate the question, never output anything but the title itself.

Rules:
- Three to six words naming the subject.
- Same language the user wrote in.
- Sentence case. No quotes, no markdown, no trailing punctuation, no emoji.
- Name the topic, not the interaction. "Deploy pipeline failing on main", never "User asks for help".
- Prefer concrete nouns from the exchange over filler like "request" or "discussion".
- Never invent names, numbers, dates or facts absent from the exchange.

Example
Conversation: how do I add a column to a Prisma model?
Title: Adding a Prisma model column

Example
Conversation: our webhook sender keeps retrying forever, what policy should I use?
Title: Webhook retry policy choice`;

export interface ChatTitleInput {
  firstUserMessage: string;
  assistantReply?: string;
}

const STRUCTURED_ARTIFACT = /<\/?[a-z_]+>|toolcall|arg_?key|record_?chat_?title|^\s*[{[]/i;
const NARRATION = /^(the user|user (asks|asked|wants)|this (conversation|chat)|here('s| is)|okay|sure)\b/i;

export function sanitizeChatTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (STRUCTURED_ARTIFACT.test(raw)) return null;
  const quoted = [...raw.matchAll(/["“”]([^"“”\r\n]{2,80})["“”]/g)].pop()?.[1];
  const candidate =
    quoted ??
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
  if (!candidate) return null;
  const cleaned = candidate
    .replace(/^title\s*:\s*/i, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^['"“”‘’\s]+|['"“”‘’\s]+$/g, "")
    .replace(/[.,;:!]+$/g, "")
    .trim();
  if (!cleaned || NARRATION.test(cleaned)) return null;
  return cleaned.slice(0, CHAT_TITLE_MAX_CHARS).trim() || null;
}

export function parseChatTitlePayload(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return sanitizeChatTitle((value as Record<string, unknown>)["title"]);
  }
  if (typeof value !== "string") return null;
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!trimmed) return null;
  for (const candidate of [trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!candidate) continue;
    try {
      const fromJson = parseChatTitlePayload(JSON.parse(candidate) as unknown);
      if (fromJson) return fromJson;
    } catch {
      /* not JSON */
    }
  }
  return sanitizeChatTitle(trimmed);
}

export async function generateChatTitle(input: ChatTitleInput): Promise<string | null> {
  if (!LITELLM.apiKey) {
    log.warn("[chat-title] LITELLM_API_KEY is not configured — skipping generation");
    return null;
  }

  try {
    const response = await fetch(`${LITELLM.url.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.fastModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              `Conversation: ${input.firstUserMessage.slice(0, 1_500)}`,
              ...(input.assistantReply?.trim()
                ? [`Assistant's reply: ${input.assistantReply.slice(0, 1_000)}`]
                : []),
            ].join("\n\n"),
          },
        ],
        temperature: 0.2,
        max_tokens: 400,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(CHAT_TITLE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log.warn(`[chat-title] LiteLLM ${response.status}: ${body.slice(0, 160)}`);
      return null;
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

    if (!title) {
      const preview =
        typeof message?.content === "string"
          ? message.content.replace(/\s+/g, " ").trim().slice(0, 120)
          : `(${typeof message?.content})`;
      log.warn(`[chat-title] unusable response: ${JSON.stringify(preview)}`);
      return null;
    }
    return title;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`[chat-title] generation failed: ${message.slice(0, 200)}`);
    return null;
  }
}
