import type { DecideQuestion } from "./tools/xor/questions.js";
import type { LoopCommandDef } from "./loop-commands.js";

export const LOOP_SKILL_BUNDLES = [
  { id: "understanding-skills", label: "Understanding", summary: "How to write a self-contained HTML explanation with inline SVG diagrams and file:line citations." },
  { id: "design-skills", label: "Design", summary: "Design tokens, layout and component guidance for HTML deliverables." },
  { id: "brand-skills", label: "Brand", summary: "Brand voice and visual identity rules." },
] as const;

export const LOOP_SKILL_BUNDLE_IDS: ReadonlySet<string> = new Set(LOOP_SKILL_BUNDLES.map((b) => b.id));

export const LOOP_TEMPLATE_IDS = ["deadline-checker", "frontier", "cursor-walk", "until-condition", "fix-retry", "sequence"] as const;

export type LoopTemplateId = (typeof LOOP_TEMPLATE_IDS)[number];

export interface LoopTemplate {
  id: LoopTemplateId;
  title: string;
  summary: string;
  example: string;
  graph: LoopCommandDef["graph"];
  exit: LoopCommandDef["exit"];
  deadlineReleases: boolean;
  question: { label: string; placeholder: string; retryWhen: boolean } | null;
  deliverable: "required" | "optional" | "none";
  defaultDurationMin: number;
  maxDurationMin: number;
  exitText: string;
  composite?: boolean;
}

export interface LoopSequenceStep {
  command: string;
  args: string;
}

export const MAX_SEQUENCE_STEPS = 6;
export const MIN_SEQUENCE_STEPS = 2;

export const LOOP_TEMPLATES: readonly LoopTemplate[] = [
  {
    id: "deadline-checker",
    title: "Deadline loop with checker",
    summary: "Works pass after pass until the deadline, recording findings with proof. A second agent checks each pass's findings.",
    example: "Hunt performance regressions in the payments service for 2 hours.",
    graph: "timeboxed",
    exit: "deadline",
    deadlineReleases: true,
    question: null,
    deliverable: "optional",
    defaultDurationMin: 60,
    maxDurationMin: 24 * 60,
    exitText: "EXIT: this run is TIME-BOXED. end-experiment refuses until the deadline, so use the whole window: when one lead dies, pick another. Keep the deliverable current every pass so a run that ends at the deadline still delivers everything it found.",
  },
  {
    id: "frontier",
    title: "Frontier loop",
    summary: "Lists every item in scope as open, closes them one by one with evidence, and ends when nothing is left open (the deadline is only a safety cap).",
    example: "Explain every API route in apps/orders and what it touches.",
    graph: "timeboxed",
    exit: "frontier",
    deadlineReleases: true,
    question: null,
    deliverable: "required",
    defaultDurationMin: 120,
    maxDurationMin: 24 * 60,
    exitText: "EXIT: this run ends when the frontier is EXHAUSTED, not on the clock. First record every item in scope as an open conjecture, then close each (proved or refuted) with evidence; every new item you discover is itself a new open conjecture. When zero remain open and the deliverable is sent, call end-experiment. The deadline is only a safety cap.",
  },
  {
    id: "cursor-walk",
    title: "Cursor walk",
    summary: "Walks an ordered list (commits, tickets, files, rows) from start to end in batches, moving a cursor forward. Ends only when the cursor reaches the end; the clock does not stop it.",
    example: "Walk every ticket closed in Q3, oldest first, and record the root cause of each.",
    graph: "progress",
    exit: "frontier",
    deadlineReleases: false,
    question: null,
    deliverable: "required",
    defaultDurationMin: 240,
    maxDurationMin: 7 * 24 * 60,
    exitText: "EXIT: this run is PROGRESS-gated. Establish the full ordered list once and record the batches ahead of the cursor as open conjectures. Each pass, take the NEXT batch after the cursor, record what it establishes, close it, and record the new cursor position in the ledger. Never re-read batches behind the cursor. You are done only when the cursor reaches the end of the list and the deliverable is sent; the deadline does not end this run.",
  },
  {
    id: "until-condition",
    title: "Until condition",
    summary: "Repeats the task until a yes/no condition you write is met. After every pass, xor reads the agent's reply and decides whether to go again.",
    example: "Keep tuning the query until p95 is under 200 ms.",
    graph: "fix-retry",
    exit: "judge",
    deadlineReleases: true,
    question: { label: "Done when (yes/no)", placeholder: "Does the reply show p95 under 200 ms on the benchmark?", retryWhen: false },
    deliverable: "optional",
    defaultDurationMin: 60,
    maxDurationMin: 24 * 60,
    exitText: "EXIT: after every pass a judge reads your reply and checks the finish condition below. If it is not met, you get another pass; when it is met (or the retries run out) you are asked for the final report. END EVERY PASS with a short, factual status that lets the judge tell whether the condition is met.",
  },
  {
    id: "fix-retry",
    title: "Fix and retry",
    summary: "Runs a check, fixes what it finds, and runs it again. After every pass, xor asks whether problems remain; if yes, it loops back to fix them.",
    example: "Run the integration suite, fix the failures, and re-run until it is green.",
    graph: "fix-retry",
    exit: "judge",
    deadlineReleases: true,
    question: { label: "Problems remain? (yes/no)", placeholder: "Does the reply report failing tests or errors that still need fixing?", retryWhen: true },
    deliverable: "optional",
    defaultDurationMin: 60,
    maxDurationMin: 12 * 60,
    exitText: "EXIT: after every pass a judge reads your reply and asks whether problems remain. If they do, you are sent back to fix them, a few times at most; when the run is clean (or the retries run out) you are asked for the final report. END EVERY PASS with a short status that says plainly what still fails, if anything. Never hide a failure to get a clean run.",
  },
  {
    id: "sequence",
    title: "Sequence of commands",
    summary: "Runs other loop commands one after another in the same thread, each starting when the previous one finishes, then posts a combined summary.",
    example: "/release-check = /ui-test /settings, then /security-scan 30m auth, then /perf-hunt",
    graph: "timeboxed",
    exit: "deadline",
    deadlineReleases: true,
    question: null,
    deliverable: "none",
    defaultDurationMin: 60,
    maxDurationMin: 24 * 60,
    exitText: "",
    composite: true,
  },
];

export function fillStepArgs(args: string, focus: string | undefined): string {
  return args.includes("{focus}") ? args.replaceAll("{focus}", focus ?? "").replace(/\s+/g, " ").trim() : args.trim();
}

export function getLoopTemplate(id: string): LoopTemplate | undefined {
  return LOOP_TEMPLATES.find((t) => t.id === id);
}

export interface CustomLoopCommand {
  id: string;
  name: string;
  description: string;
  template: LoopTemplateId;
  instruction: string;
  skills: string[];
  subagents: string[];
  deliverable: "md" | "html" | null;
  judgeQuestion: string | null;
  maxPasses: number | null;
}

export const DEFAULT_MAX_RETRIES = 6;

export function buildCustomLoopDef(c: CustomLoopCommand): LoopCommandDef {
  const t = getLoopTemplate(c.template);
  if (!t) throw new Error(`unknown loop template ${c.template}`);
  if (t.composite) throw new Error(`${c.template} is a sequence of commands, not a loop`);
  const judgeQuestion: DecideQuestion | null =
    t.question && c.judgeQuestion?.trim() ? { id: "condition", type: "yesno", question: c.judgeQuestion.trim() } : null;
  const command = `/${c.name}`;
  return {
    key: "custom",
    command,
    kind: "custom",
    graph: t.graph,
    exit: t.exit,
    deadlineReleases: t.deadlineReleases,
    deliverable: t.deliverable === "none" ? null : c.deliverable,
    proofRule: "delivered-artifact",
    closeCheck: null,
    skills: c.skills.filter((s) => LOOP_SKILL_BUNDLE_IDS.has(s)),
    ...(c.subagents.length > 0 ? { subagents: c.subagents } : {}),
    ...(t.graph === "fix-retry" && judgeQuestion && t.question
      ? { judge: { questions: [judgeQuestion], retryWhen: { question: "condition", value: t.question.retryWhen }, maxRetries: c.maxPasses ?? DEFAULT_MAX_RETRIES } }
      : {}),
    modeLog: `${command} (${t.title}) — injected experiment tools (epoch {epoch}, remaining {remaining})`,
    custom: {
      id: c.id,
      template: t.id,
      instruction: c.instruction,
      description: c.description,
      exitText: judgeQuestion ? `${t.exitText}\nFinish condition the judge checks: "${judgeQuestion.question}"` : t.exitText,
    },
    start: {
      title: `**${command} started**`,
      mode: `Mode: ${t.title.toLowerCase()} — ${t.summary}`,
      durationLabel: t.exit === "deadline" ? "Duration" : "Safety cap",
      seedFrontier: false,
    },
  };
}
