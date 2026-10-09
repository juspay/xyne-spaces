export type CommandSurface = "webhook" | "ai-screen";
export type CommandKind = "task-prefix" | "control";
export type CommandSection = "autonomy" | "producing" | "controlling";

export interface CommandDef {
  name: string;
  aliases?: readonly string[];
  label: string;
  help: string;
  argsHint?: string;
  section: CommandSection;
  kind: CommandKind;
  surfaces: readonly CommandSurface[];
}

const BOTH: readonly CommandSurface[] = ["webhook", "ai-screen"];
const WEBHOOK_ONLY: readonly CommandSurface[] = ["webhook"];

export const COMMAND_REGISTRY: readonly CommandDef[] = [
  {
    name: "goal",
    label: "Goal",
    help: "Work autonomously until a condition is met",
    argsHint: "<condition>",
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "experiment",
    label: "Experiment",
    help: "Explore until a deadline",
    argsHint: "<duration> [focus]",
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "understanding",
    label: "Understanding",
    help: "Explain every path in scope until the frontier is exhausted",
    argsHint: "[duration] [focus]",
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "design",
    label: "Design",
    help: "Produce a self-contained HTML artifact",
    argsHint: "<brief>",
    section: "producing",
    kind: "task-prefix",
    surfaces: BOTH,
  },
  {
    name: "dashboard",
    label: "Dashboard",
    help: "Live-data dashboard snapshot, refreshable on a schedule",
    argsHint: "<brief>",
    section: "producing",
    kind: "task-prefix",
    surfaces: BOTH,
  },
  {
    name: "explainer",
    label: "Explainer",
    help: "Narrated explainer video",
    argsHint: "<topic>",
    section: "producing",
    kind: "task-prefix",
    surfaces: BOTH,
  },
  {
    name: "learn",
    label: "Learn",
    help: "Open your links, read them, and teach you the topic",
    argsHint: "<topic or links>",
    section: "producing",
    kind: "task-prefix",
    surfaces: BOTH,
  },
  {
    name: "review",
    label: "Review",
    help: "Review or explain your code changes, with a diagram",
    argsHint: "<what to review>",
    section: "producing",
    kind: "task-prefix",
    surfaces: BOTH,
  },
  {
    name: "spec",
    label: "Spec",
    help: "Interview you, then write the specification onto the ticket",
    argsHint: "<ticket>",
    section: "producing",
    kind: "task-prefix",
    surfaces: BOTH,
  },
  {
    name: "record-skill",
    label: "Record skill",
    help: "Turn a recorded walkthrough into a reusable skill",
    section: "producing",
    kind: "task-prefix",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "stop",
    aliases: ["goal clear"],
    label: "Stop",
    help: "Stop the current run, drop queued messages, clear the active goal",
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "clear",
    label: "Clear",
    help: "Wipe this thread's context and start fresh",
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "compact",
    label: "Compact",
    help: "Summarize and shrink the context, then continue",
    argsHint: "[focus]",
    section: "controlling",
    kind: "control",
    surfaces: BOTH,
  },
  {
    name: "queue",
    label: "Queue",
    help: "Show messages waiting behind the current run, or add one",
    argsHint: "[message | clear]",
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "fast",
    label: "Fast mode",
    help: "Call tools directly instead of delegating to subagents",
    argsHint: "[task | off]",
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "status",
    label: "Status",
    help: "Debug panel for this thread's current run",
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "debug",
    label: "Debug",
    help: "One HTML file with the full execution trace of the current run",
    argsHint: "[all]",
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "help",
    label: "Help",
    help: "Show the available commands",
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
];

export const COMMAND_SECTION_ORDER: readonly CommandSection[] = ["autonomy", "producing", "controlling"];

export const COMMAND_SECTION_LABELS: Record<CommandSection, string> = {
  autonomy: "Autonomy",
  producing: "Producing something",
  controlling: "Controlling this thread",
};

function normalizeToken(token: string): string {
  return token.trim().replace(/^\//, "").toLowerCase();
}

export function commandsForSurface(surface: CommandSurface): readonly CommandDef[] {
  return COMMAND_REGISTRY.filter(def => def.surfaces.includes(surface));
}

export function findCommand(token: string): CommandDef | undefined {
  const normalized = normalizeToken(token);
  return COMMAND_REGISTRY.find(
    def => def.name === normalized || (def.aliases?.some(alias => alias.toLowerCase() === normalized) ?? false),
  );
}

export function taskPrefixCommandNames(): readonly string[] {
  return COMMAND_REGISTRY.filter(def => def.kind === "task-prefix").map(def => def.name);
}
