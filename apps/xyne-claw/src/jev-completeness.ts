import { jevAsk, jevEnabled, jevThreshold, type JevQuestion } from "./jev.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("jev-completeness");

const MAX_TASK_CHARS = 4_000;
const MAX_ANSWER_CHARS = 12_000;

export type AnswerVerdict = "complete" | "partial" | "intent-only";

export interface AnswerAssessment {
  verdict: AnswerVerdict;
  answered: number;
  finished: number;
  intent: number;
}

export interface AssessAnswerInput {
  task: string;
  answer: string;
  pendingPlanItems?: number;
  toolCalls?: number;
}

function buildState(input: AssessAnswerInput): string {
  const plan = input.pendingPlanItems
    ? `\n\nPlan items still open when the run ended: ${input.pendingPlanItems}`
    : "";
  return (
    `The user asked:\n${input.task.slice(0, MAX_TASK_CHARS)}\n\n` +
    `The agent's final reply was:\n${input.answer.slice(0, MAX_ANSWER_CHARS)}${plan}`
  );
}

export async function assessAnswer(input: AssessAnswerInput): Promise<AnswerAssessment | null> {
  if (!jevEnabled() || !input.task.trim() || !input.answer.trim()) return null;

  const questions: Record<string, JevQuestion> = {
    answered: {
      type: "noul",
      instructions:
        "The final reply delivers the result the user asked for, rather than only describing " +
        "what the agent intends to do next.",
    },
    finished: {
      type: "noul",
      instructions:
        "The final reply reads as finished work, rather than stopping partway through the task.",
    },
    intent: {
      type: "noul",
      instructions:
        "The final reply is a statement of intent — it announces an action the agent has not " +
        "yet carried out, such as \"I'll pull the data now\".",
    },
  };

  const started = Date.now();
  const answers = await jevAsk(buildState(input), questions, { purpose: "answer-completeness" });
  if (!answers) return null;

  const answered = answers["answered"]?.noul ?? 0;
  const finished = answers["finished"]?.noul ?? 0;
  const intent = answers["intent"]?.noul ?? 0;
  const threshold = jevThreshold("JEV_COMPLETENESS_THRESHOLD", 0.5);

  const verdict: AnswerVerdict =
    intent >= threshold && answered < threshold
      ? "intent-only"
      : answered >= threshold && finished >= threshold
        ? "complete"
        : "partial";

  metric.observe("answer_completeness_ms", Date.now() - started, {
    verdict,
    answered: Math.round(answered * 100),
    finished: Math.round(finished * 100),
    intent: Math.round(intent * 100),
    ...(input.pendingPlanItems ? { pendingPlanItems: input.pendingPlanItems } : {}),
    ...(input.toolCalls ? { toolCalls: input.toolCalls } : {}),
  });

  if (verdict !== "complete") {
    log.warn(
      `[jev-completeness] run ended ${verdict} — answered=${answered.toFixed(2)} ` +
      `finished=${finished.toFixed(2)} intent=${intent.toFixed(2)}` +
      `${input.pendingPlanItems ? ` pendingPlanItems=${input.pendingPlanItems}` : ""}`,
    );
  }
  return { verdict, answered, finished, intent };
}
