import crypto from "node:crypto";
import type { ToolDefinition, UserQuestion, UserQuestionType } from "../types.js";
import { userQuestionOptionLabel, type UserQuestionOption } from "../../types/ui-widget.js";
import { publishUiWidget } from "../ui-widget.js";

const SKIP_QUESTION_OPTION = "Skip this question";

/** Accepts a plain label or `{ label, description }`; drops blank entries. */
function normalizeOption(option: unknown): string | UserQuestionOption | null {
  if (typeof option === "string") return option.trim() || null;
  if (!option || typeof option !== "object") return null;
  const raw = option as Record<string, unknown>;
  const label = typeof raw["label"] === "string" ? raw["label"].trim() : "";
  if (!label) return null;
  const description = typeof raw["description"] === "string" ? raw["description"].trim() : "";
  return description ? { label, description } : label;
}

export const ASK_QUESTION_CONFIG_SCHEMA = {
  XYNE_CLAW_AUTH_URL: {
    label: "Claw Auth Service URL",
    default: "http://localhost:3003",
    required: true as const,
    placeholder: "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003",
  },
};

function normalizeBaseUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\/+$/, "") : null;
}

function errorCauseMessage(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const cause = (err as Error & { cause?: unknown }).cause;
  if (!cause) return null;
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    const code = typeof record["code"] === "string" ? record["code"] : undefined;
    const syscall = typeof record["syscall"] === "string" ? record["syscall"] : undefined;
    const address = typeof record["address"] === "string" ? record["address"] : undefined;
    const port = typeof record["port"] === "number" || typeof record["port"] === "string" ? String(record["port"]) : undefined;
    const hostname = typeof record["hostname"] === "string" ? record["hostname"] : undefined;
    return [code, syscall, hostname ?? address, port].filter(Boolean).join(" ") || JSON.stringify(cause);
  }
  return String(cause);
}

export const askUserQuestion: ToolDefinition = {
  slug: "ask-user-question",
  name: "Ask User Question",
  description:
    "Use this only when you need the user's decision or missing information before you can safely continue. " +
    "Do not use it for facts you can determine with available context or tools. Batch related, independent questions " +
    "into one card (1-8 questions) instead of asking them one at a time. Each question needs `question` and `type`: " +
    "`single_choice` for exactly one option, `multiple_choice` for one or more options, or `open_ended` for free text. " +
    "Choice questions require 2-8 concise `options`; open-ended questions must not include options. Each option is " +
    "either a label string or `{ label, description }` — prefer the object form and give every option a short " +
    "description explaining the trade-off, since the UI renders it as a second line under the label. " +
    "The UI adds a default 'Skip this question' response, so do not add your own skip option. Use a short, " +
    "human-readable `label` for the question tab (for example, 'Version scope') and an optional stable `id`; when " +
    "id is omitted, q1, q2, etc. are generated. Set `required: false` only when the question is genuinely optional. " +
    "A new agent run automatically starts with the structured answers and any per-question notes as context. " +
    "IMPORTANT: After calling this tool, you MUST stop immediately. Do NOT continue working, " +
    "do NOT call any other tools, do NOT make assumptions about the answer. Just report that " +
    "you've asked the question and end your response. The user's answer will arrive in a new run.",
  source: "custom:ask-question",
  configSchema: ASK_QUESTION_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "One or more questions to ask together (at most 8).",
        items: { type: "object", properties: {
          id: { type: "string" }, label: { type: "string" }, question: { type: "string" }, type: { type: "string", enum: ["single_choice", "multiple_choice", "open_ended"], description: "single_choice, multiple_choice, or open_ended" }, options: { type: "array", description: "Choice questions only: 2-8 options. Each is an object with a `label` and an optional one-line `description` shown under it. A plain string is also accepted as a bare label.", items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"] } }, required: { type: "boolean" }, placeholder: { type: "string" },
        }, required: ["question", "type"] },
      },
    },
    required: ["questions"],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const rawQuestions = params["questions"];
    if (!Array.isArray(rawQuestions) || rawQuestions.length < 1 || rawQuestions.length > 8) return "Error: provide 1-8 questions.";
    const validTypes: UserQuestionType[] = ["single_choice", "multiple_choice", "open_ended"];
    const questions: UserQuestion[] = [];
    for (let index = 0; index < rawQuestions.length; index += 1) {
      const raw = rawQuestions[index] as Record<string, unknown>;
      const question = typeof raw?.["question"] === "string" ? raw["question"].trim() : "";
      const type = raw?.["type"] as UserQuestionType;
      const options = Array.isArray(raw?.["options"]) ? (raw["options"] as unknown[]).map(normalizeOption).filter((option): option is string | UserQuestionOption => option !== null) : undefined;
      if (!question || !validTypes.includes(type)) return `Error: question ${index + 1} needs a prompt and a valid type.`;
      if (type !== "open_ended" && (!options || options.length < 2 || options.length > 8)) return `Error: ${type} question ${index + 1} needs 2-8 options.`;
      if (type === "open_ended" && options?.length) return `Error: open_ended question ${index + 1} must not include options.`;
      questions.push({ id: typeof raw["id"] === "string" && raw["id"].trim() ? raw["id"].trim() : `q${index + 1}`, ...(typeof raw["label"] === "string" && raw["label"].trim() ? { label: raw["label"].trim() } : {}), question, type, ...(options ? { options: options.some(option => userQuestionOptionLabel(option) === SKIP_QUESTION_OPTION) ? options : [...options, SKIP_QUESTION_OPTION] } : {}), ...(typeof raw["required"] === "boolean" ? { required: raw["required"] } : {}), ...(type === "open_ended" && typeof raw["placeholder"] === "string" ? { placeholder: raw["placeholder"] } : {}) });
    }
    if (new Set(questions.map(question => question.id)).size !== questions.length) return "Error: each question id must be unique.";

    const meta = context.meta ?? {};
    const authUrl =
      normalizeBaseUrl(context.config["XYNE_CLAW_AUTH_URL"]) ??
      normalizeBaseUrl(process.env["XYNE_CLAW_AUTH_URL"]) ??
      normalizeBaseUrl(context.config["CLAW_AUTH_URL"]) ??
      normalizeBaseUrl(process.env["CLAW_AUTH_URL"]) ??
      "http://localhost:3003";
    const pendingQuestionsUrl = `${authUrl}/claw/api/v1/pending-questions`;
    const questionId = crypto.randomUUID();

    // Store question in xyne-claw-auth Redis
    try {
      const res = await fetch(pendingQuestionsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(context.s2sKey ? { "x-s2s-key": context.s2sKey } : {}),
        },
        body: JSON.stringify({
          questionId,
          userId: meta["userId"],
          agentSlug: meta["agentSlug"],
          channelId: meta["channelId"],
          conversationId: meta["conversationId"],
          questions,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      // Guard before res.json(): a wrong path / proxy error returns an HTML
      // page, and res.json() would throw a cryptic "Unexpected token '<'".
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return `Error storing question: HTTP ${res.status} ${body.slice(0, 120)}`;
      }
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) return `Error storing question: ${data.error ?? "unknown"}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = errorCauseMessage(err);
      return `Error posting question to ${pendingQuestionsUrl}: ${message}${cause ? ` (${cause})` : ""}`;
    }

    // Push to pendingQuestions collector so it's included in callback
    context.pendingQuestions?.push({ questionId, questions });

    // Publish immediately when the run has a live widget transport. The final
    // callback retains pendingQuestions as a retry path; claw-auth deduplicates
    // both deliveries by this stable widget id.
    try {
      await publishUiWidget(context, {
        id: `question:${questionId}`,
        type: "question",
        operation: "create",
        payload: { questionId, questions },
      });
    } catch {
      // The final callback remains the durable fallback for questions.
    }

    return `STOP — Posted ${questions.length} question(s) to the user. Do NOT continue working. Do NOT call any more tools. Do NOT assume an answer. Simply tell the user you've asked the questions and wait. A new agent run will start automatically when they answer.`;
  },
};
