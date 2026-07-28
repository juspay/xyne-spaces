import crypto from "node:crypto";
import { LITELLM } from "./config.js";
import { createLogger } from "./logger.js";
import type { PendingQuestion } from "xyne-claw-shared";

const log = createLogger("follow-up-generator");
const FOLLOW_UP_TIMEOUT_MS = 60_000;

const FOLLOW_UP_TOOL = {
  type: "function",
  function: {
    name: "record_follow_up_suggestions",
    description: "Record exactly three next messages written in the user's voice for the user to send to the assistant.",
    parameters: {
      type: "object",
      properties: {
        options: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 3,
        },
      },
      required: ["options"],
      additionalProperties: false,
    },
  },
} as const;

const ASSISTANT_TO_USER_QUESTION_PATTERNS = [
  /^what are you\b/i,
  /^what (?:would|do) you (?:like|want|need)\b/i,
  /^would you like me\b/i,
  /^do you (?:have|want|need|prefer)\b/i,
  /^are you\b/i,
  /^can you (?:share|provide|tell me)\b/i,
  /^which .+ would you like me to\b/i,
  /^how would you like me to\b/i,
  /^would you prefer (?:me|that i)\b/i,
  /^should i\b/i,
];

export interface FollowUpAgentContext {
  name?: string;
  description?: string;
}

export interface FollowUpConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export function normalizeFollowUpConversationHistory(
  value: unknown,
): FollowUpConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<FollowUpConversationMessage>((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const role = record["role"];
    const content = record["content"];
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    const trimmed = content.trim();
    return trimmed ? [{ role, content: trimmed.slice(0, 2_000) }] : [];
  }).slice(-12);
}

export function normalizeFollowUpAgentContext(value: unknown): FollowUpAgentContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const context: FollowUpAgentContext = {};
  if (typeof record["name"] === "string" && record["name"].trim()) {
    context.name = record["name"].trim();
  }
  if (typeof record["description"] === "string" && record["description"].trim()) {
    context.description = record["description"].trim();
  }
  return context.name || context.description ? context : undefined;
}

function normalizeSuggestionOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value
    .filter((option): option is string => typeof option === "string")
    .map((option) => option.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return options.length === 3 && new Set(options).size === 3 ? options : undefined;
}

export function parseFollowUpPayload(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const direct = normalizeSuggestionOptions(value);
    if (direct) return direct;
    const textBlocks = value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const text = (item as Record<string, unknown>)["text"];
      return typeof text === "string" ? [text] : [];
    });
    return textBlocks.length > 0 ? parseFollowUpPayload(textBlocks.join("\n")) : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["options", "suggestions", "questions"]) {
      const parsed = normalizeSuggestionOptions(record[key]);
      if (parsed) return parsed;
    }
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;

  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!candidate) continue;
    try {
      const parsed = parseFollowUpPayload(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // Some compatible models ignore tool_choice and return a plain list.
    }
  }

  const listed = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, ""))
    .filter((line) => line.length > 0 && /[?？]$/.test(line));
  return normalizeSuggestionOptions(listed);
}

export function parseFollowUpArguments(raw: string | undefined): string[] | undefined {
  return parseFollowUpPayload(raw);
}

export function fallbackFollowUpSuggestions(
  task: string,
  agentContext?: FollowUpAgentContext,
  conversationHistory: FollowUpConversationMessage[] = [],
): string[] {
  const normalized = task.trim().replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();
  if (!normalized) {
    return [
      "What would you like help working through?",
      "Can you share the goal or problem you have in mind?",
      "Would you like an explanation, an example, or a concrete plan?",
    ];
  }
  if (/^(hi|hello|hey|hiya|howdy)\b/.test(lower)) {
    // Description is the product-facing statement of purpose and therefore
    // outranks incidental tool/system-prompt vocabulary. This prevents a
    // broad agent with one code-adjacent capability from turning every
    // greeting suggestion into a coding task.
    const agentText = (
      agentContext?.description || agentContext?.name ||
      ""
    ).toLowerCase();
    const grounded: string[] = [];
    if (/\b(workspace|search|find|knowledge)\b/.test(agentText)) {
      grounded.push("Can you help me find and summarize something from my workspace?");
    }
    if (/\b(document|doc|write|creation|draft)\b/.test(agentText)) {
      grounded.push("Can you create or improve a document for me?");
    }
    if (/\b(data|analysis|analytics|spreadsheet)\b/.test(agentText)) {
      grounded.push("Can you analyze some data and explain the key findings?");
    }
    if (/\b(research|web|source)\b/.test(agentText)) {
      grounded.push("Can you research a topic and summarize the strongest evidence?");
    }
    if (/\b(ticket|project|task|planning)\b/.test(agentText)) {
      grounded.push("Can you help me turn an idea into clear tasks and next steps?");
    }
    if (/\b(code|coding|programming|software|debug|repository|developer)\b/.test(agentText)) {
      grounded.push("Can you review or debug a piece of code for me?");
    }
    if (grounded.length >= 3) return [...new Set(grounded)].slice(0, 3);
    return [
      ...new Set(grounded),
      "What kinds of tasks are you best equipped to handle?",
      "Can you show me a concrete example of one of your capabilities?",
      "Which of your capabilities would be most useful to start with?",
    ].slice(0, 3);
  }
  if (/\b(cod(e|ing)|programming|developer|software)\b/.test(lower)) {
    return [
      "Can you show me how you would debug a failing function?",
      "Can you review and refactor a code snippet for me?",
      "Can you help me design an API or system architecture?",
    ];
  }
  if (/\b(compare|difference|versus|\bvs\b)\b/.test(lower)) {
    return [
      "What are the most important trade-offs between these options?",
      "Which option would you recommend for a typical use case, and why?",
      "Can you give me a concrete scenario where each option is the better fit?",
    ];
  }
  if (/\b(summarize|summary|recap)\b/.test(lower)) {
    return [
      "What are the three most important takeaways?",
      "Which points require action or a decision?",
      "Can you expand on the most consequential point?",
    ];
  }
  if (conversationHistory.length > 0) {
    return [
      "Can you expand on the most important part of that?",
      "Can you give me a concrete example based on what you just explained?",
      "What would be a useful next step from here?",
    ];
  }
  if (/\b(explain|how|why|what|understand)\b/.test(lower)) {
    return [
      "Can you walk through a concrete example?",
      "What are the common mistakes or misconceptions here?",
      "What should I learn or try next?",
    ];
  }
  return [
    "What would a strong first step look like?",
    "Which trade-offs or risks should I consider?",
    "Can you show me a concrete example of the recommended approach?",
  ];
}

export function areUserVoiceFollowUps(suggestions: string[]): boolean {
  return suggestions.every(
    (suggestion) =>
      !ASSISTANT_TO_USER_QUESTION_PATTERNS.some((pattern) => pattern.test(suggestion.trim())),
  );
}

export interface FollowUpGenerationResult {
  suggestions: string[];
  source: "model" | "fallback";
  model: string;
  failureCode?: "missing_api_key" | "http_error" | "invalid_payload" | "request_error";
  failureMessage?: string;
  httpStatus?: number;
}

export interface FollowUpLifecycleEvent {
  seq: number;
  at: string;
  kind: "follow_up_generation_start" | "follow_up_generation_end";
  data: Record<string, unknown>;
}

interface FollowUpLifecycleContext {
  seq: number;
  at: string;
  sessionId: string;
  model: string;
  generationInput: string;
  conversationMessageCount: number;
  agentContext?: FollowUpAgentContext;
}

export function buildFollowUpGenerationStartEvent(
  context: FollowUpLifecycleContext,
): FollowUpLifecycleEvent {
  return {
    seq: context.seq,
    at: context.at,
    kind: "follow_up_generation_start",
    data: {
      sessionId: context.sessionId,
      model: context.model,
      generationInput: context.generationInput,
      conversationMessageCount: context.conversationMessageCount,
      agentContextProvided: Boolean(context.agentContext),
      ...(context.agentContext?.name ? { agentContextName: context.agentContext.name } : {}),
      ...(context.agentContext?.description
        ? { agentContextDescription: context.agentContext.description }
        : {}),
    },
  };
}

export function buildFollowUpGenerationEndEvent(
  context: FollowUpLifecycleContext & {
    startedAt: string;
    generation: FollowUpGenerationResult;
  },
): FollowUpLifecycleEvent {
  const rawDurationMs = new Date(context.at).getTime() - new Date(context.startedAt).getTime();
  return {
    seq: context.seq,
    at: context.at,
    kind: "follow_up_generation_end",
    data: {
      sessionId: context.sessionId,
      status: context.generation.source === "fallback" ? "fallback" : "completed",
      source: context.generation.source,
      model: context.generation.model,
      suggestionCount: context.generation.suggestions.length,
      durationMs: Number.isFinite(rawDurationMs) ? Math.max(0, rawDurationMs) : 0,
      generationInput: context.generationInput,
      conversationMessageCount: context.conversationMessageCount,
      agentContextProvided: Boolean(context.agentContext),
      ...(context.agentContext?.name ? { agentContextName: context.agentContext.name } : {}),
      ...(context.generation.failureCode ? { failureCode: context.generation.failureCode } : {}),
      ...(context.generation.failureMessage
        ? { failureMessage: context.generation.failureMessage }
        : {}),
      ...(context.generation.httpStatus !== undefined
        ? { httpStatus: context.generation.httpStatus }
        : {}),
    },
  };
}

function fallbackResult(
  task: string,
  agentContext: FollowUpAgentContext | undefined,
  conversationHistory: FollowUpConversationMessage[],
  failure: Omit<FollowUpGenerationResult, "suggestions" | "source" | "model">,
): FollowUpGenerationResult {
  return {
    suggestions: fallbackFollowUpSuggestions(task, agentContext, conversationHistory),
    source: "fallback",
    model: LITELLM.fastModel,
    ...failure,
  };
}

function describeRequestError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 300);
  const cause = error.cause;
  const causeMessage = cause instanceof Error
    ? cause.message
    : cause && typeof cause === "object" && "message" in cause
      ? String(cause.message)
      : "";
  return [...new Set([error.message, causeMessage].filter(Boolean))].join(": ").slice(0, 300);
}

export async function generateFollowUpSuggestions(
  task: string,
  agentContext?: FollowUpAgentContext,
  conversationHistory: FollowUpConversationMessage[] = [],
  abortSignal?: AbortSignal,
): Promise<FollowUpGenerationResult> {
  if (!LITELLM.apiKey) {
    return fallbackResult(task, agentContext, conversationHistory, {
      failureCode: "missing_api_key",
      failureMessage: "LITELLM_API_KEY is not configured",
    });
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
          {
            role: "system",
            content: `Generate exactly three suggested follow-up messages that the USER could click and send to the ASSISTANT next.

Requirements:
- Write every suggestion in the user's voice as an immediately sendable message.
- Ask the assistant to perform a task, explain something, evaluate something, or continue the current work.
- Predict natural and useful next turns primarily from the conversation history.
- Make all three suggestions meaningfully different and advance the conversation in distinct directions.
- Keep each suggestion concise and specific.
- Do not answer the suggested messages.

Do not:
- Ask the user for context, requirements, preferences, or details.
- Interview the user, offer help, or ask whether the user wants help.
- Generate assistant-style questions such as "What are you working on?"
- Invent names, project details, IDs, dates, metrics, technologies, constraints, or facts absent from the conversation.
- Repeat or paraphrase the user's previous message.
- Use generic filler such as "Can you tell me more?" or "What else should I know?"
- Produce overlapping suggestions that differ only in wording.

Context handling:
- Treat conversation history as the primary source of intent.
- Use the selected agent's name and description only to understand its capabilities and expected role.
- For a clear active task, suggest logical next actions related to that task.
- When a prior response explains a concept, suggest a deeper explanation, concrete example, practical implementation, comparison, validation, or troubleshooting where relevant.
- For a greeting or vague request without useful history, derive three practical starting requests from the agent description.
- For a general-purpose agent, stay broadly useful and do not assume an unestablished domain.

Good examples:
- "Can you show me a concrete example?"
- "What are the main trade-offs between these approaches?"
- "Can you rewrite this as production-ready code?"
- "How would you debug this issue step by step?"
- "Can you verify whether this handles the edge cases?"

Bad examples:
- "What are you working on?"
- "Would you like me to help?"
- "Do you have a specific framework in mind?"
- "Can you provide more context?"
- "Tell me more about this."

Call record_follow_up_suggestions exactly once with exactly three strings.`,
          },
          {
            role: "user",
            content: [
              conversationHistory.length > 0
                ? `Previous conversation:\n${conversationHistory.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n")}`
                : "",
              `Current user request:\n${task.slice(0, 4_000)}`,
              agentContext
                ? [
                    `Selected agent: ${agentContext.name ?? "Unnamed agent"}`,
                    agentContext.description ? `Agent description: ${agentContext.description.slice(0, 1_500)}` : "",
                  ].filter(Boolean).join("\n\n")
                : "No agent metadata was provided. Keep suggestions domain-neutral and do not assume coding, research, or any other specialty.",
            ].join("\n\n"),
          },
        ],
        tools: [FOLLOW_UP_TOOL],
        tool_choice: {
          type: "function",
          function: { name: FOLLOW_UP_TOOL.function.name },
        },
        temperature: 0.4,
      }),
      signal: abortSignal
        ? AbortSignal.any([abortSignal, AbortSignal.timeout(FOLLOW_UP_TIMEOUT_MS)])
        : AbortSignal.timeout(FOLLOW_UP_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log.warn(`[follow-up-generator] LiteLLM ${response.status}: ${body.slice(0, 160)}; using fallback`);
      return fallbackResult(task, agentContext, conversationHistory, {
        failureCode: "http_error",
        failureMessage: `LiteLLM returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
        httpStatus: response.status,
      });
    }

    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          content?: unknown;
          tool_calls?: Array<{ function?: { arguments?: unknown } }>;
          function_call?: { arguments?: unknown };
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason;
    const suggestions = [
      ...(message?.tool_calls?.map((call) => call.function?.arguments) ?? []),
      message?.function_call?.arguments,
      message?.content,
    ].reduce<string[] | undefined>(
      (found, candidate) => found ?? parseFollowUpPayload(candidate),
      undefined,
    );
    if (!suggestions || !areUserVoiceFollowUps(suggestions)) {
      const contentPreview = typeof message?.content === "string"
        ? message.content.replace(/\s+/g, " ").trim().slice(0, 160)
        : "";
      const firstArguments = message?.tool_calls?.[0]?.function?.arguments;
      const argumentsPreview = typeof firstArguments === "string"
        ? firstArguments.replace(/\s+/g, " ").trim().slice(0, 160)
        : "";
      const responseShape = [
        `toolCalls=${message?.tool_calls?.length ?? 0}`,
        `argumentsType=${Array.isArray(firstArguments) ? "array" : typeof firstArguments}`,
        `finishReason=${finishReason ?? "unknown"}`,
        `legacyFunctionCall=${message?.function_call ? "yes" : "no"}`,
        `contentType=${Array.isArray(message?.content) ? "array" : typeof message?.content}`,
        ...(argumentsPreview ? [`argumentsPreview=${JSON.stringify(argumentsPreview)}`] : []),
        ...(contentPreview ? [`contentPreview=${JSON.stringify(contentPreview)}`] : []),
      ].join(", ");
      return fallbackResult(task, agentContext, conversationHistory, {
        failureCode: "invalid_payload",
        failureMessage: suggestions
          ? `Model returned assistant-to-user questions instead of messages written in the user's voice (${responseShape})`
          : `Model response did not contain exactly three unique follow-up questions (${responseShape})`,
      });
    }
    return { suggestions, source: "model", model: LITELLM.fastModel };
  } catch (err) {
    const failureMessage = describeRequestError(err);
    log.warn(`[follow-up-generator] generation failed: ${failureMessage}; using fallback`);
    return fallbackResult(task, agentContext, conversationHistory, { failureCode: "request_error", failureMessage });
  }
}

export function asFollowUpPendingQuestion(options: string[]): PendingQuestion {
  return {
    questionId: crypto.randomUUID(),
    question: "Related questions",
    options,
    purpose: "follow_up_suggestions",
  };
}

export function shouldGenerateFollowUpsForRun(
  enabled: boolean | undefined,
  answer: string,
  pendingQuestions: ReadonlyArray<Pick<PendingQuestion, "purpose">>,
): boolean {
  return (
    enabled === true &&
    answer.trim().length > 0 &&
    !pendingQuestions.some((question) => question.purpose === "follow_up_suggestions")
  );
}
