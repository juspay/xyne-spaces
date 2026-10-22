export const LOOP_KINDS = ["understanding", "framework", "security", "repo-history"] as const;

export type LoopKind = (typeof LOOP_KINDS)[number];

export type LoopKey = "experiment" | LoopKind;

export type LoopCloseCheck = "observation" | "structural-opportunity" | "file-line-explanation" | "decision-rule";

export interface LoopCommandDef {
  key: LoopKey;
  command: string;
  kind: LoopKind | null;
  graph: "timeboxed" | "progress";
  exit: "deadline" | "frontier";
  deadlineReleases: boolean;
  deliverable: "html" | "md" | null;
  proofRule: "delivered-artifact" | "file-line-citation";
  closeCheck: LoopCloseCheck | null;
  skills: readonly string[];
  modeLog: string;
  start: {
    title: string;
    mode: string;
    durationLabel: string;
    seedFrontier: boolean;
  };
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
