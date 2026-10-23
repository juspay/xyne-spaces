import type { DecideQuestion } from "./tools/xor/questions.js";
import { LOOP_SKILL_BUNDLE_IDS } from "./loop-templates.js";

export const LOOP_KINDS = ["understanding", "framework", "security", "repo-history", "ui-test", "custom"] as const;

export type LoopKind = (typeof LOOP_KINDS)[number];

export type LoopKey = "experiment" | LoopKind;

export type LoopCloseCheck = "observation" | "structural-opportunity" | "file-line-explanation" | "decision-rule";

export interface LoopCommandDef {
  key: LoopKey;
  command: string;
  kind: LoopKind | null;
  graph: "timeboxed" | "progress" | "fix-retry";
  exit: "deadline" | "frontier" | "judge";
  deadlineReleases: boolean;
  deliverable: "html" | "md" | null;
  proofRule: "delivered-artifact" | "file-line-citation";
  closeCheck: LoopCloseCheck | null;
  skills: readonly string[];
  subagents?: readonly string[];
  positional?: "route";
  judge?: LoopJudge;
  modeLog: string;
  custom?: CustomLoopInfo;
  start: {
    title: string;
    mode: string;
    durationLabel: string;
    seedFrontier: boolean;
  };
}

export interface CustomLoopInfo {
  id: string;
  template: string;
  instruction: string;
  description: string;
  exitText: string;
}

export interface LoopJudge {
  questions: readonly DecideQuestion[];
  retryWhen: { question: string; value: string | boolean };
  maxRetries: number;
}

const TIMEBOXED_START = {
  title: "**/experiment started**",
  mode: "Mode: time-boxed autonomous exploration",
  durationLabel: "Duration",
  seedFrontier: false,
} as const;

export const LOOP_COMMANDS: readonly LoopCommandDef[] = [
  {
    key: "experiment",
    command: "/experiment",
    kind: null,
    graph: "timeboxed",
    exit: "deadline",
    deadlineReleases: true,
    deliverable: null,
    proofRule: "delivered-artifact",
    closeCheck: null,
    skills: [],
    modeLog: "Experiment mode — injected experiment tools (epoch {epoch}, remaining {remaining})",
    start: TIMEBOXED_START,
  },
  {
    key: "understanding",
    command: "/understanding",
    kind: "understanding",
    graph: "timeboxed",
    exit: "frontier",
    deadlineReleases: true,
    deliverable: "html",
    proofRule: "file-line-citation",
    closeCheck: "file-line-explanation",
    skills: ["understanding-skills"],
    modeLog: "Understanding mode — injected experiment tools (epoch {epoch}, coverage-gated exit)",
    start: {
      title: "**/understanding started**",
      mode: "Mode: coverage-gated understanding loop (ends when the code-path frontier is exhausted)",
      durationLabel: "Safety cap",
      seedFrontier: true,
    },
  },
  {
    key: "framework",
    command: "/framework",
    kind: "framework",
    graph: "timeboxed",
    exit: "frontier",
    deadlineReleases: true,
    deliverable: "md",
    proofRule: "delivered-artifact",
    closeCheck: "structural-opportunity",
    skills: [],
    modeLog: "Framework mode — injected experiment tools (epoch {epoch}, candidate-gated exit)",
    start: TIMEBOXED_START,
  },
  {
    key: "security",
    command: "/security-scan",
    kind: "security",
    graph: "timeboxed",
    exit: "deadline",
    deadlineReleases: true,
    deliverable: null,
    proofRule: "delivered-artifact",
    closeCheck: "observation",
    skills: [],
    modeLog: "Security mode — injected experiment tools (epoch {epoch}, observation-gated closes)",
    start: TIMEBOXED_START,
  },
  {
    key: "repo-history",
    command: "/repo-history",
    kind: "repo-history",
    graph: "progress",
    exit: "frontier",
    deadlineReleases: false,
    deliverable: "html",
    proofRule: "delivered-artifact",
    closeCheck: "decision-rule",
    skills: [],
    modeLog: "Repo-history mode — injected experiment tools (epoch {epoch}, progress-gated exit at HEAD)",
    start: TIMEBOXED_START,
  },
  {
    key: "ui-test",
    command: "/ui-test",
    kind: "ui-test",
    graph: "fix-retry",
    exit: "judge",
    deadlineReleases: true,
    deliverable: null,
    proofRule: "delivered-artifact",
    closeCheck: null,
    skills: [],
    subagents: ["ui-tester"],
    positional: "route",
    judge: {
      questions: [
        {
          id: "fixtureErrors",
          type: "yesno",
          question:
            "Does this UI test report show fixture or harness problems that kept variations from rendering as intended: requests served by the fallback mock, missing or wrong mock fixtures, a harness error, or a dev server that was not running?",
        },
      ],
      retryWhen: { question: "fixtureErrors", value: true },
      maxRetries: 4,
    },
    modeLog: "UI-test mode — injected experiment tools (epoch {epoch}, judge-gated fix-and-retry)",
    start: {
      title: "**/ui-test started**",
      mode: "Mode: plan the variations, run the UI harness, fix fixtures until the judge finds none broken, then report with videos",
      durationLabel: "Safety cap",
      seedFrontier: false,
    },
  },
];

const DEFAULT_LOOP = LOOP_COMMANDS[0]!;

export function parseLoopKind(value: unknown): LoopKind | undefined {
  return (LOOP_KINDS as readonly unknown[]).includes(value) ? (value as LoopKind) : undefined;
}

export function withLoopKind(value: unknown): { kind: LoopKind } | Record<string, never> {
  const kind = parseLoopKind(value);
  return kind ? { kind } : {};
}

export function loopCommandFor(kind: unknown): LoopCommandDef {
  const parsed = parseLoopKind(kind);
  return LOOP_COMMANDS.find((def) => def.kind === parsed) ?? DEFAULT_LOOP;
}

export function loopCommandForWord(text: string): LoopCommandDef | undefined {
  const lower = text.toLowerCase();
  return [...LOOP_COMMANDS]
    .sort((a, b) => b.command.length - a.command.length)
    .find((def) => lower.startsWith(def.command));
}

export function loopModeLog(def: LoopCommandDef, vars: { epoch: number; remaining: string }): string {
  return def.modeLog.replace("{epoch}", String(vars.epoch)).replace("{remaining}", vars.remaining);
}

const GRAPHS = new Set(["timeboxed", "progress", "fix-retry"]);
const EXITS = new Set(["deadline", "frontier", "judge"]);
const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120).slice(0, max) : [];

export function loopFromPayload(raw: unknown): LoopCommandDef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const custom = o["custom"] as Record<string, unknown> | undefined;
  const command = typeof o["command"] === "string" && /^\/[a-z][a-z0-9-]{1,40}$/.test(o["command"]) ? o["command"] : null;
  if (!command || !custom || typeof custom["id"] !== "string" || typeof custom["instruction"] !== "string") return undefined;
  if (!GRAPHS.has(String(o["graph"])) || !EXITS.has(String(o["exit"]))) return undefined;
  const deliverable = o["deliverable"] === "md" || o["deliverable"] === "html" ? o["deliverable"] : null;
  return {
    key: "custom",
    command,
    kind: "custom",
    graph: o["graph"] as LoopCommandDef["graph"],
    exit: o["exit"] as LoopCommandDef["exit"],
    deadlineReleases: o["deadlineReleases"] !== false,
    deliverable,
    proofRule: "delivered-artifact",
    closeCheck: null,
    skills: strings(o["skills"], 10).filter((s) => LOOP_SKILL_BUNDLE_IDS.has(s)),
    subagents: strings(o["subagents"], 8),
    modeLog: `${command} — injected experiment tools (epoch {epoch}, remaining {remaining})`,
    custom: {
      id: custom["id"],
      template: typeof custom["template"] === "string" ? custom["template"] : "",
      instruction: custom["instruction"].slice(0, 8_000),
      description: typeof custom["description"] === "string" ? custom["description"].slice(0, 300) : "",
      exitText: typeof custom["exitText"] === "string" ? custom["exitText"].slice(0, 2_000) : "",
    },
    start: { title: `**${command} started**`, mode: "", durationLabel: "Duration", seedFrontier: false },
  };
}

export function resolveLoop(ctx: { kind?: unknown; loop?: LoopCommandDef | undefined } | undefined | null): LoopCommandDef {
  return ctx?.loop ?? loopCommandFor(ctx?.kind);
}
