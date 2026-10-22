import { COMMAND_REGISTRY, COMMAND_SECTION_LABELS, COMMAND_SECTION_ORDER, type CommandDef } from "@xyne/shared/commands";
import { LOOP_COMMANDS } from "xyne-claw-shared";

export interface HelpCommand {
  name: string;
  aliases?: readonly string[];
  help: string;
  argsHint?: string;
  details?: readonly string[];
  section: CommandDef["section"];
  kind: CommandDef["kind"];
}

const OVERRIDES: Record<string, Pick<HelpCommand, "argsHint" | "details">> = {
  goal: { details: ["`/goal status` — show the active goal and its turn count"] },
  queue: {
    details: [
      "`/queue` — show waiting messages · `/queue <message>` — run it after the current run without interrupting · `/queue clear` — drop waiting messages",
    ],
  },
  fast: { details: ["Quicker for short asks; use normal mode for deep investigations."] },
  debug: {
    argsHint: "[all | chain]",
    details: [
      "`/debug all` — the same trace for every earlier session in this thread, newest first",
      "`/debug chain` — why the agent workflow bound to this channel did or did not hand off",
    ],
  },
  help: { argsHint: "[command]", details: ["`/help <command>` — usage and details for one command"] },
};

const EXTRA: Array<HelpCommand & { after: string }> = [
  {
    name: "eval",
    help: "Run the question once on every configured provider, then attach a timing comparison",
    argsHint: "<question>",
    details: ["`providers=claude,codex` narrows it."],
    section: "controlling",
    kind: "control",
    after: "debug",
  },
];

function buildCommands(): HelpCommand[] {
  const loops = new Map(
    LOOP_COMMANDS.map((def) => [
      def.command.slice(1),
      { help: def.help.summary, argsHint: def.help.argsHint, details: def.help.details },
    ]),
  );
  const commands: HelpCommand[] = COMMAND_REGISTRY.filter((def) => def.surfaces.includes("webhook")).map((def) => ({
    name: def.name,
    ...(def.aliases ? { aliases: def.aliases } : {}),
    help: def.help,
    ...(def.argsHint ? { argsHint: def.argsHint } : {}),
    section: def.section,
    kind: def.kind,
    ...loops.get(def.name),
    ...OVERRIDES[def.name],
  }));
  let lastLoop = commands.map((c) => c.name).filter((name) => loops.has(name)).pop() ?? "goal";
  for (const [name, loop] of loops) {
    if (commands.some((c) => c.name === name)) continue;
    const at = commands.findIndex((c) => c.name === lastLoop);
    commands.splice(at + 1, 0, { name, ...loop, section: "autonomy", kind: "control" });
    lastLoop = name;
  }
  for (const { after, ...extra } of EXTRA) {
    if (commands.some((c) => c.name === extra.name)) continue;
    commands.splice(commands.findIndex((c) => c.name === after) + 1, 0, extra);
  }
  return commands;
}

export const CLAW_COMMANDS: readonly HelpCommand[] = buildCommands();

export function findClawCommand(token: string): HelpCommand | undefined {
  const normalized = token.trim().replace(/^\//, "").toLowerCase();
  return CLAW_COMMANDS.find(
    (def) => def.name === normalized || (def.aliases?.some((alias) => alias.toLowerCase() === normalized) ?? false),
  );
}

function usageLine(def: HelpCommand): string {
  return `/${def.name}${def.argsHint ? ` ${def.argsHint}` : ""}`;
}

export function renderCommandList(): string[] {
  const lines: string[] = [];
  for (const section of COMMAND_SECTION_ORDER) {
    const defs = CLAW_COMMANDS.filter((def) => def.section === section);
    if (defs.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(`*${COMMAND_SECTION_LABELS[section]}*`);
    for (const def of defs) lines.push(`- \`${usageLine(def)}\` — ${def.help}`);
  }
  return lines;
}

export function renderCommandHelp(def: HelpCommand): string {
  return [
    `**\`${usageLine(def)}\`**`,
    def.help,
    ...(def.details?.length ? ["", ...def.details.map((detail) => `- ${detail}`)] : []),
    ...(def.aliases?.length ? ["", `Also: ${def.aliases.map((alias) => `\`/${alias}\``).join(", ")}`] : []),
  ].join("\n");
}
