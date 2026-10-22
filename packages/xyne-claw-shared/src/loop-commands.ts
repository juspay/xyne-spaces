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
  help: LoopCommandHelp;
  modeLog: string;
  start: {
    title: string;
    mode: string;
    durationLabel: string;
    seedFrontier: boolean;
  };
}

export interface LoopCommandHelp {
  summary: string;
  argsHint: string;
  details: readonly string[];
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
    help: {
      summary: "Explore until a deadline",
      argsHint: "<duration> [focus]",
      details: [
        "Duration is `<number><m|h|d>`, e.g. `/experiment 90m`, `/experiment 8h`, `/experiment 14d`. Omit it for 1h; anything over the 30d cap is clamped to 30d.",
        "Pin a model with `provider=… model=…`.",
        "`/experiment status` · `/experiment list` · `/experiment findings [id]` · `/experiment stop` — these work for every loop command",
      ],
    },
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
    help: {
      summary: "Explain every path in scope until the frontier is exhausted",
      argsHint: "[duration] [focus]",
      details: [
        "Ends when the code-path frontier is exhausted, not on the clock; the duration is only a safety cap. Delivers one self-contained HTML document.",
      ],
    },
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
    help: {
      summary: "Find structural gaps (convention drift, missing paved paths, duplication) until the candidate list is exhausted",
      argsHint: "[duration cap] [focus]",
      details: [
        "Delivers one markdown report grouped by tag, with a tag index.",
      ],
    },
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
    help: {
      summary: "Hunt exploitable defects until the deadline, keeping leads and confirmed findings apart",
      argsHint: "<duration> [focus]",
      details: [
        "Time-boxed: uses the whole window. Delivers one markdown report with a reproduction for every confirmed finding.",
      ],
    },
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
    help: {
      summary: "Walk git history oldest to newest and write down the coding rules each change established",
      argsHint: "[focus]",
      details: [
        "Ends when the walk reaches HEAD, not on the clock. Delivers one self-contained HTML decision log.",
      ],
    },
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
