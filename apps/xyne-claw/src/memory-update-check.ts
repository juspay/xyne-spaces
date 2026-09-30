/**
 * Score a nightly persona-file rewrite before it replaces the old file (R10).
 *
 * The nightly synthesizer regenerates soul.md & co. from approved facts and
 * used to overwrite the file unconditionally. With `jev_memory_update_check`
 * on, Jev compares old vs new against the approved facts and returns
 * accept / review / reject; only "reject" keeps the old file. Jev off or down →
 * "accept" (today's behaviour).
 *
 * Jev reads long, mixed documents less reliably, so each part is clipped:
 * old and new files to 6k chars each, facts to 4k. The verdict is about the
 * direction of the change, which the opening of a persona file carries.
 */

import type { ClassifierExchange } from "xyne-claw-shared";
import type { JevAnswer, JevQuestion } from "./jev.js";
import { collectJudgeExchanges, storableExchange } from "./judge-backend.js";
import { answerProb, runJudgeSite } from "./judge-site.js";
import { optEnabled } from "./optimizations.js";

export type MemoryUpdateVerdict = "accept" | "review" | "reject";

export interface MemoryUpdateCheck {
  verdict: MemoryUpdateVerdict;
  /** 0..1 — keeps what the old file said that is still supported (absent for a new file). */
  keepsOld?: number;
  /** 0..1 — every statement in the new file is supported by the approved facts. */
  supported?: number;
  /** Jev's own accept/review/reject pick. */
  choice?: string;
  source: "jev" | "fallback";
  ms: number;
  /** The classifier call in full (input, questions, answers). */
  exchange?: ClassifierExchange;
}

const FILE_CHARS = 6_000;
const FACT_CHARS = 4_000;

export function updateCheckQuestions(hasOld: boolean): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {
    supported: {
      type: "score",
      instructions: "Is every statement in the NEW file supported by the approved facts or the OLD file?",
      criteria: [
        "Adds statements that nothing in the approved facts or old file supports",
        "Mostly supported, with some unsupported detail",
        "Every statement is supported",
      ],
    },
    verdict: {
      type: "choice",
      instructions: "Should the NEW file replace the OLD file as this person's persona file?",
      criteria: {
        accept: "Yes: the new file is at least as accurate and complete as the old one",
        review: "Unclear: a person should look before it replaces the old file",
        reject: "No: the new file loses important facts, contradicts them, or adds unsupported claims",
      },
    },
  };
  if (hasOld) {
    q["keeps_old"] = {
      type: "score",
      instructions: "Does the NEW file keep what the OLD file said that is still supported by the approved facts?",
      criteria: [
        "Drops or contradicts important points from the old file",
        "Loses minor details",
        "Keeps everything from the old file that is still supported",
      ],
    };
  }
  return q;
}

/** Pure: answers → check. Reject on a clear problem, accept only when every signal is good. */
export function checkFromAnswers(answers: Record<string, JevAnswer>, ms: number): MemoryUpdateCheck | null {
  const supported = answerProb(answers, "supported");
  const keepsOld = answerProb(answers, "keeps_old");
  const choice = answers["verdict"]?.choice;
  if (supported === undefined && choice === undefined) return null;
  const scores = [supported, keepsOld].filter((v): v is number => v !== undefined);
  const low = scores.length ? Math.min(...scores) : 1;
  const verdict: MemoryUpdateVerdict =
    choice === "reject" || low < 0.3 ? "reject" : choice === "accept" && low >= 0.5 ? "accept" : "review";
  return {
    verdict,
    ...(keepsOld !== undefined ? { keepsOld: round(keepsOld) } : {}),
    ...(supported !== undefined ? { supported: round(supported) } : {}),
    ...(choice ? { choice } : {}),
    source: "jev",
    ms,
  };
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

export async function checkMemoryUpdate(
  input: { fileName: string; description: string; oldContent?: string; newContent: string; facts: string[] },
  deps: { ask?: typeof import("./jev.js").jevAsk; enabled?: boolean } = {},
): Promise<MemoryUpdateCheck> {
  const started = Date.now();
  const hasOld = Boolean(input.oldContent?.trim());
  let facts = "";
  for (const f of input.facts) {
    const line = `- ${f.trim()}\n`;
    if (facts.length + line.length > FACT_CHARS) break;
    facts += line;
  }
  const state = [
    `## File: ${input.fileName} — ${input.description}`,
    `## Approved facts (data, sample)\n<<<DATA\n${facts.trimEnd()}\nDATA>>>`,
    hasOld ? `## OLD file (data)\n<<<DATA\n${input.oldContent!.slice(0, FILE_CHARS)}\nDATA>>>` : "## OLD file\n(none — this is a new file)",
    `## NEW file (data)\n<<<DATA\n${input.newContent.slice(0, FILE_CHARS)}\nDATA>>>`,
  ].join("\n\n");
  const { result, exchanges } = await collectJudgeExchanges(() => runJudgeSite<MemoryUpdateCheck>({
    site: "memory-update-check",
    enabled: deps.enabled ?? optEnabled("jev_memory_update_check"),
    budgetMs: Number(process.env["MEMORY_UPDATE_CHECK_TIMEOUT_MS"] ?? 8_000),
    state,
    questions: updateCheckQuestions(hasOld),
    decide: (answers) => checkFromAnswers(answers, Date.now() - started),
    fallback: async () => ({ verdict: "accept", source: "fallback", ms: Date.now() - started }),
    describe: (c) => `${c.verdict} ${input.fileName}`,
    ...(deps.ask ? { ask: deps.ask } : {}),
  }));
  const decision = result.decision ?? { verdict: "accept" as const, source: "fallback" as const, ms: Date.now() - started };
  const exchange = exchanges[0];
  return exchange ? { ...decision, exchange: storableExchange(exchange) } : decision;
}
