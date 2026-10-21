/**
 * ask-user-question on a messenger.
 *
 * In Spaces the question set is one card with tabs and a Submit button. A
 * phone chat has nothing like it, so the set is asked the way a person would
 * text it: one question at a time, each as the messenger's own control —
 * reply buttons for a short single choice, a list for a longer one, a
 * numbered list for "pick any", plain text for an open question. Typing the
 * answer works everywhere, which is also what a channel without native cards
 * (Baileys) relies on.
 *
 * When the account has a published form (WhatsApp Flows, `questionFormId`),
 * a set that would otherwise take several messages goes out as ONE native
 * form instead, and its submission answers every question at once.
 *
 * Either way the answers come back as the same message Spaces sends after its
 * card is submitted, so the agent continues identically on every surface.
 */
import { randomBytes } from "node:crypto";
import type { UserQuestion, UserQuestionOption } from "xyne-claw-shared";
import { createLogger } from "../../logger.js";
import { redisService } from "../../redis.js";
import { REDIS_PREFIX } from "./const.js";
import { newCardToken, parkOptions, type ParkedOption } from "./cards.js";
import { enqueueOutbound } from "./delivery.js";
import { getChannel, type ChannelDeliveryTarget, type InteractiveCard, type InteractiveLimits } from "./plugin.js";
import { getAccount, toChannelAccount } from "./store.js";

const log = createLogger("channel-questions");

/** Matches the pending-question store in Spaces: an unanswered set is
 *  forgotten after a day. */
const QUESTION_TTL_S = 24 * 60 * 60;
/** The tool appends this to every choice question; on a phone "skip" is
 *  also accepted typed. */
export const SKIP_ANSWER = "Skip this question";

/** Form slots in the published Flow (whatsapp-cloud/forms.ts). A larger set
 *  is asked one question at a time instead. */
export const MAX_FORM_QUESTIONS = 5;
export const FORM_SCREEN = "QUESTIONS";
/** A choice slot needs a non-empty data source even while hidden. */
const FORM_PLACEHOLDER_OPTION = { id: "_", title: "-" };
const FORM_MAX_OPTIONS = 20;

export interface QuestionSession {
  questionId: string;
  accountId: string;
  chatId: string;
  senderId: string;
  userId: string;
  agentSlug?: string;
  conversationId?: string;
  questions: UserQuestion[];
  /** The question currently on screen. */
  index: number;
  /** "Question: answer" lines, in the Spaces answer-summary format. */
  answers: string[];
  /** Set when the whole set went out as one native form. */
  formToken?: string;
}

function redis() {
  return redisService.getConnection();
}

function sessionKey(accountId: string, chatId: string, senderId: string): string {
  return `${REDIS_PREFIX}:question:${accountId}:${chatId}:${senderId}`;
}

async function saveSession(session: QuestionSession): Promise<void> {
  await redis().set(
    sessionKey(session.accountId, session.chatId, session.senderId),
    JSON.stringify(session),
    "EX",
    QUESTION_TTL_S,
  );
}

/** The question set waiting on this person in this chat, if any. */
export async function pendingQuestion(accountId: string, chatId: string, senderId: string): Promise<QuestionSession | null> {
  try {
    const raw = await redis().get(sessionKey(accountId, chatId, senderId));
    return raw ? (JSON.parse(raw) as QuestionSession) : null;
  } catch (err) {
    log.warn(`[questions] lookup failed account=${accountId}: ${String(err)}`);
    return null;
  }
}

/** /new and /stop mean the questions no longer matter either. */
export async function clearPendingQuestion(accountId: string, chatId: string, senderId: string): Promise<void> {
  await redis()
    .del(sessionKey(accountId, chatId, senderId))
    .catch(() => undefined);
}

function optionsOf(question: UserQuestion): Array<{ label: string; description?: string }> {
  return (question.options ?? []).map((option: string | UserQuestionOption) =>
    typeof option === "string"
      ? { label: option }
      : { label: option.label, ...(option.description ? { description: option.description } : {}) },
  );
}

/** "1 of 3" under every question of a multi-part set, nothing for one. */
function progressFooter(session: QuestionSession, index: number): string | undefined {
  return session.questions.length > 1 ? `${index + 1} of ${session.questions.length}` : undefined;
}

/**
 * One question as what gets sent: a card whose options are parked as answer
 * tokens, or plain text whose reply is read by `interpretTypedAnswer`.
 * Exported for tests; the token minting is the only impure part.
 */
export function renderQuestion(
  session: QuestionSession,
  index: number,
  limits: InteractiveLimits | undefined,
): { card?: InteractiveCard; text?: string; parked: Array<{ token: string; option: ParkedOption }> } {
  const question = session.questions[index]!;
  const options = optionsOf(question);
  const footer = progressFooter(session, index);
  const header = question.label;

  if (question.type === "single_choice" && options.length > 0 && options.length <= (limits?.listRows ?? 10)) {
    const parked = options.map((option) => ({
      token: newCardToken(),
      option: {
        action: { kind: "answer" as const, questionId: session.questionId, index, value: option.label },
        chatId: session.chatId,
        senderId: session.senderId,
        userId: session.userId,
        ...(session.conversationId ? { conversationId: session.conversationId } : {}),
        ...(session.agentSlug ? { agentSlug: session.agentSlug } : {}),
      },
    }));
    // Buttons only when every label survives the button cap intact: a clipped
    // "Deploy to stagi…" is a worse answer than a list row that shows it all.
    const fitsButtons =
      !!limits && options.length <= limits.buttons && options.every((option) => option.label.length <= limits.buttonTitleChars);
    const card: InteractiveCard = fitsButtons
      ? {
          kind: "buttons",
          body: question.question,
          ...(header ? { header } : {}),
          ...(footer ? { footer } : {}),
          buttons: options.map((option, i) => ({ id: parked[i]!.token, title: option.label })),
        }
      : {
          kind: "list",
          body: question.question,
          ...(header ? { header } : {}),
          ...(footer ? { footer } : {}),
          button: "Choose",
          sections: [
            {
              rows: options.map((option, i) => {
                const clipped = option.label.length > (limits?.rowTitleChars ?? 24);
                const description = option.description ?? (clipped ? option.label : undefined);
                return { id: parked[i]!.token, title: option.label, ...(description ? { description } : {}) };
              }),
            },
          ],
        };
    return { card, parked };
  }

  const lines: string[] = [];
  if (header) lines.push(`**${header}**`);
  lines.push(question.question);
  if (question.type === "open_ended") {
    if (question.placeholder?.trim()) lines.push(`_${question.placeholder.trim()}_`);
  } else {
    lines.push("");
    options.forEach((option, i) =>
      lines.push(option.description ? `${i + 1}. ${option.label} — ${option.description}` : `${i + 1}. ${option.label}`),
    );
    lines.push("");
    lines.push(question.type === "multiple_choice" ? "Reply with the numbers, like 1, 3." : "Reply with the number.");
  }
  if (footer) lines.push(`_${footer}_`);
  return { text: lines.join("\n"), parked: [] };
}

/**
 * What a typed reply means for this question. Numbers pick options, an exact
 * label picks that option, "skip" skips, and anything else is taken as the
 * person's own answer — the agent is better at reading "the second one, but
 * only on Fridays" than a parser would be.
 */
export function interpretTypedAnswer(question: UserQuestion, text: string): string {
  const reply = text.trim();
  if (/^skip( (it|this|this one|this question))?\.?$/i.test(reply)) return SKIP_ANSWER;
  const labels = optionsOf(question).map((option) => option.label);
  if (question.type === "open_ended" || labels.length === 0) return reply;
  const exact = labels.find((label) => label.toLowerCase() === reply.toLowerCase());
  if (exact) return exact;
  const numbers = /^#?\s*\d{1,2}(\s*(,|&|and|\s)\s*#?\s*\d{1,2})*\s*\.?$/i.test(reply)
    ? [...reply.matchAll(/\d{1,2}/g)].map((m) => Number(m[0]))
    : [];
  const picked = [...new Set(numbers)].filter((n) => n >= 1 && n <= labels.length).map((n) => labels[n - 1]!);
  if (picked.length === 0) return reply;
  return question.type === "multiple_choice" ? picked.join(", ") : picked[0]!;
}

/** The message the agent's next run starts with — the same wording Spaces
 *  uses after its question card is submitted (routes/flow-action.ts). */
export function answersTask(answers: string[]): string {
  return `The user answered your questions. Continue the task based on these answers:\n${answers.join("\n")}`;
}

async function sendQuestion(session: QuestionSession, index: number): Promise<void> {
  const plugin = getChannel((await getAccount(session.accountId))?.surface.key ?? "");
  const rendered = renderQuestion(session, index, plugin?.capabilities.interactive);
  if (rendered.parked.length) await parkOptions(session.accountId, rendered.parked);
  await enqueueOutbound(
    session.accountId,
    rendered.card
      ? { kind: "card", chatId: session.chatId, card: rendered.card }
      : { kind: "text", chatId: session.chatId, text: rendered.text ?? "" },
  );
}

/**
 * The form's `data` for one send: every slot either carries a question or is
 * hidden. Field names are the contract with the published Flow JSON, which
 * reads `q{i}_show`, `q{i}_text`, `q{i}_single`/`q{i}_multi`/`q{i}_open`,
 * `q{i}_options` and the `*_req` flags.
 */
export function formDataFor(questions: UserQuestion[], heading: string): Record<string, unknown> {
  const data: Record<string, unknown> = { heading };
  for (let i = 0; i < MAX_FORM_QUESTIONS; i += 1) {
    const question = questions[i];
    const options = question
      ? optionsOf(question)
          .slice(0, FORM_MAX_OPTIONS)
          .map((option, n) => ({
            id: String(n),
            title: option.label.slice(0, 30),
            ...(option.description ? { description: option.description.slice(0, 300) } : {}),
          }))
      : [];
    const required = question ? question.required !== false : false;
    data[`q${i}_show`] = !!question;
    data[`q${i}_text`] = question ? (question.label ? `${question.label}: ${question.question}` : question.question) : "-";
    data[`q${i}_single`] = question?.type === "single_choice";
    data[`q${i}_multi`] = question?.type === "multiple_choice";
    data[`q${i}_open`] = question?.type === "open_ended";
    data[`q${i}_single_req`] = question?.type === "single_choice" && required;
    data[`q${i}_multi_req`] = question?.type === "multiple_choice" && required;
    data[`q${i}_open_req`] = question?.type === "open_ended" && required;
    data[`q${i}_options`] = options.length ? options : [FORM_PLACEHOLDER_OPTION];
  }
  return data;
}

/** A form submission → the same "Question: answer" lines as typed answers.
 *  Option ids are indexes into the options as they were sent. */
export function answersFromForm(questions: UserQuestion[], fields: Record<string, unknown>): string[] {
  const lines: string[] = [];
  questions.slice(0, MAX_FORM_QUESTIONS).forEach((question, i) => {
    const labels = optionsOf(question).map((option) => option.label);
    const byId = (id: unknown): string | null => {
      const n = typeof id === "string" && /^\d+$/.test(id) ? Number(id) : NaN;
      return Number.isInteger(n) && labels[n] ? labels[n]! : null;
    };
    let answer = "";
    if (question.type === "open_ended") {
      const value = fields[`q${i}_open_ans`];
      answer = typeof value === "string" ? value.trim() : "";
    } else if (question.type === "multiple_choice") {
      const value = fields[`q${i}_many`];
      answer = (Array.isArray(value) ? value : [])
        .map(byId)
        .filter((label): label is string => !!label)
        .join(", ");
    } else {
      answer = byId(fields[`q${i}_one`]) ?? "";
    }
    lines.push(`${question.question}: ${answer || SKIP_ANSWER}`);
  });
  return lines;
}

function formEligible(questions: UserQuestion[]): boolean {
  if (questions.length === 0 || questions.length > MAX_FORM_QUESTIONS) return false;
  // A single short choice is better as buttons than as a form behind a tap.
  return questions.length > 1 || questions[0]!.type !== "single_choice";
}

/**
 * Start asking. Replaces any earlier set still waiting in this chat — the
 * agent asked again, so the old questions are no longer what it needs.
 */
export async function askChannelQuestions(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  questionId: string;
  questions: UserQuestion[];
  agentSlug?: string;
  conversationId?: string;
}): Promise<void> {
  const { target } = input;
  if (input.questions.length === 0) return;
  const session: QuestionSession = {
    questionId: input.questionId,
    accountId: target.connectedSurfaceId,
    chatId: target.chatId,
    senderId: target.senderId,
    userId: input.userId,
    ...(input.agentSlug ? { agentSlug: input.agentSlug } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    questions: input.questions,
    index: 0,
    answers: [],
  };

  const row = await getAccount(target.connectedSurfaceId);
  const plugin = row ? getChannel(row.surface.key) : undefined;
  const formId = row
    ? ((toChannelAccount(row).channelConfig as { questionFormId?: unknown } | null)?.questionFormId as string | undefined)
    : undefined;
  if (plugin?.sendForm && formId && formEligible(input.questions)) {
    session.formToken = randomBytes(12).toString("base64url");
    await saveSession(session);
    const count = input.questions.length;
    await enqueueOutbound(session.accountId, {
      kind: "form",
      chatId: session.chatId,
      form: {
        formId,
        token: session.formToken,
        screen: FORM_SCREEN,
        data: formDataFor(input.questions, count === 1 ? "One quick question" : `${count} quick questions`),
        body: count === 1 ? input.questions[0]!.question : `I need ${count} quick answers before I carry on.`,
        cta: "Answer",
      },
    });
    log.info(`[questions] sent ${count} question(s) as a form account=${session.accountId} question=${input.questionId}`);
    return;
  }

  await saveSession(session);
  await sendQuestion(session, 0);
  log.info(`[questions] asking ${input.questions.length} question(s) account=${session.accountId} question=${input.questionId}`);
}

export type AnswerOutcome =
  /** The next question is on its way; nothing to dispatch. */
  | { kind: "next" }
  /** Every question is answered: route `task` like a message from the person. */
  | { kind: "done"; task: string; agentSlug?: string }
  /** The answer was for a question that is no longer on screen. */
  | { kind: "stale" };

/** Record the answer to the question on screen and move on. */
export async function answerPendingQuestion(
  session: QuestionSession,
  answer: string,
  expected?: { questionId: string; index: number },
): Promise<AnswerOutcome> {
  if (expected && (expected.questionId !== session.questionId || expected.index !== session.index)) return { kind: "stale" };
  const question = session.questions[session.index];
  if (!question) return { kind: "stale" };
  const next: QuestionSession = {
    ...session,
    index: session.index + 1,
    answers: [...session.answers, `${question.question}: ${answer.trim() || SKIP_ANSWER}`],
  };
  if (next.index < next.questions.length) {
    await saveSession(next);
    await sendQuestion(next, next.index);
    return { kind: "next" };
  }
  await clearPendingQuestion(session.accountId, session.chatId, session.senderId);
  return { kind: "done", task: answersTask(next.answers), ...(session.agentSlug ? { agentSlug: session.agentSlug } : {}) };
}

/** A submitted form answers the whole set in one go. */
export async function answerFromFormReply(
  session: QuestionSession,
  reply: { token: string; fields: Record<string, unknown> },
): Promise<AnswerOutcome> {
  if (!session.formToken || reply.token !== session.formToken) return { kind: "stale" };
  await clearPendingQuestion(session.accountId, session.chatId, session.senderId);
  return {
    kind: "done",
    task: answersTask(answersFromForm(session.questions, reply.fields)),
    ...(session.agentSlug ? { agentSlug: session.agentSlug } : {}),
  };
}
