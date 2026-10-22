export type CommandSurface = "webhook" | "ai-screen";
export type CommandKind = "task-prefix" | "control";
export type CommandSection = "autonomy" | "producing" | "controlling";

export interface CommandDef {
  name: string;
  aliases?: readonly string[];
  label: string;
  help: string;
  argsHint?: string;
  details?: readonly string[];
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
    details: [
      "`/goal status` — show the active goal and its turn count",
    ],
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "experiment",
    label: "Experiment",
    help: "Explore until a deadline",
    argsHint: "<duration> [focus]",
    details: [
      "Duration is `<number><m|h|d>`, e.g. `/experiment 90m`, `/experiment 8h`, `/experiment 14d`. Omit it for 1h; anything over the 30d cap is clamped to 30d.",
      "Pin a model with `provider=… model=…`.",
      "`/experiment status` · `/experiment list` · `/experiment findings [id]` · `/experiment stop` — these work for every loop command",
    ],
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "understanding",
    label: "Understanding",
    help: "Explain every path in scope until the frontier is exhausted",
    argsHint: "[duration] [focus]",
    details: [
      "Ends when the code-path frontier is exhausted, not on the clock; the duration is only a safety cap. Delivers one self-contained HTML document.",
    ],
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "framework",
    label: "Framework",
    help: "Find structural gaps (convention drift, missing paved paths, duplication) until the candidate list is exhausted",
    argsHint: "[duration cap] [focus]",
    details: ["Delivers one markdown report grouped by tag, with a tag index."],
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "security-scan",
    label: "Security scan",
    help: "Hunt exploitable defects until the deadline, keeping leads and confirmed findings apart",
    argsHint: "<duration> [focus]",
    details: ["Time-boxed: uses the whole window. Delivers one markdown report with a reproduction for every confirmed finding."],
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "repo-history",
    label: "Repo history",
    help: "Walk git history oldest to newest and write down the coding rules each change established",
    argsHint: "[focus]",
    details: ["Ends when the walk reaches HEAD, not on the clock. Delivers one self-contained HTML decision log."],
    section: "autonomy",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "ui-test",
    label: "UI test",
    help: "Render every state of one page with mocked APIs, fix the fixtures until a judge finds none broken, then report with videos",
    argsHint: "<route> [focus]",
    details: [
      "Needs the agent to have sandbox tools; the ui-tester subagent is added for the run.",
      "e.g. `/ui-test /settings/billing`",
    ],
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
    details: [
      "`/queue` — show waiting messages · `/queue <message>` — run it after the current run without interrupting · `/queue clear` — drop waiting messages",
    ],
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "fast",
    label: "Fast mode",
    help: "Call tools directly instead of delegating to subagents",
    argsHint: "[task | off]",
    details: [
      "Quicker for short asks; use normal mode for deep investigations.",
    ],
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
    argsHint: "[all | chain]",
    details: [
      "`/debug all` — the same trace for every earlier session in this thread, newest first",
      "`/debug chain` — why the agent workflow bound to this channel did or did not hand off",
    ],
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "eval",
    label: "Eval",
    help: "Run the question once on every configured provider, then attach a timing comparison",
    argsHint: "<question>",
    details: ["`providers=claude,codex` narrows it."],
    section: "controlling",
    kind: "control",
    surfaces: WEBHOOK_ONLY,
  },
  {
    name: "help",
    label: "Help",
    help: "Show the available commands",
    argsHint: "[command]",
    details: ["`/help <command>` — usage and details for one command"],
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

function usageLine(def: CommandDef): string {
  return `/${def.name}${def.argsHint ? ` ${def.argsHint}` : ""}`;
}

export function renderCommandList(surface: CommandSurface): string[] {
  const lines: string[] = [];
  for (const section of COMMAND_SECTION_ORDER) {
    const defs = commandsForSurface(surface).filter(def => def.section === section);
    if (defs.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(`*${COMMAND_SECTION_LABELS[section]}*`);
    for (const def of defs) lines.push(`- \`${usageLine(def)}\` — ${def.help}`);
  }
  return lines;
}

export function renderCommandHelp(def: CommandDef): string {
  return [
    `**\`${usageLine(def)}\`**`,
    def.help,
    ...(def.details?.length ? ["", ...def.details.map(detail => `- ${detail}`)] : []),
    ...(def.aliases?.length ? ["", `Also: ${def.aliases.map(alias => `\`/${alias}\``).join(", ")}`] : []),
  ].join("\n");
}
