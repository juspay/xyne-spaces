/**
 * Long step of a draft turn: write the agent's instructions (its system prompt),
 * streamed so the canvas fills as the model writes.
 */
import {
  ensurePromptContract,
  validateSystemPromptContract,
  type AgentPermissionMode,
  type DraftPick,
  type DraftSchedule,
} from "xyne-claw-shared";
import { chatStream, type AuthoringMessage } from "./authoring-llm.js";

export interface InstructionsInput {
  name: string;
  description: string;
  brief: string;
  permissionMode: AgentPermissionMode;
  schedule: Pick<DraftSchedule, "label" | "task"> | null;
  /** Capabilities already chosen, so the prompt names the tools the canvas will have. */
  capabilities: DraftPick[];
  /** Set for an edit: the current prompt and what to change. */
  existing?: { text: string; change: string };
}

const SYSTEM = [
  "You write the instructions (the system prompt) for AI agents in Xyne Spaces. Write them the way a good teammate briefs a new colleague: plain text a person can read at a glance and a model can follow exactly. Return only the instructions, with no preface.",
  "Your own output is plain text: no # headings, no ** or other bold and italics, no tables, no code blocks, no emoji. That is how you write, not something the agent is told, so it never appears in the agent's Rules.",
].join("\n\n");

/** Title of the tools section, and the titles a late tools section goes in front of. */
export const TOOLS_HEADING = "Tools";
export const TOOLS_INSERT_BEFORE: readonly string[] = ["Rules", "Guardrails"];

/** Section titles, in order. Each sits alone on its line; the opening paragraph has none. */
export const INSTRUCTION_SECTIONS = [
  "How you work",
  TOOLS_HEADING,
  "Rules",
  "When you're unsure",
  "When something goes wrong",
] as const;

const PERMISSION_RULES: Record<AgentPermissionMode, string> = {
  "ask-first": "The agent asks the user for approval before it sends, posts, creates, edits or deletes anything.",
  "read-only": "The agent only reads and reports. It never sends, posts, creates, edits or deletes.",
  "can-write": "The agent may act without asking, except it never deletes data, spends money or posts publicly without confirmation.",
};

/** The same rules, as the agent reads them in its own instructions. */
const PERMISSION_RULE_LINES: Record<AgentPermissionMode, string> = {
  "ask-first": "Never send, post, create, edit or delete anything without asking first.",
  "read-only": "Only read and report. Never send, post, create, edit or delete anything.",
  "can-write": "You may act without asking, but never delete data, spend money or post publicly without confirmation.",
};

function capabilityLines(capabilities: DraftPick[]): string {
  if (capabilities.length === 0) return "none chosen; the agent works from what the user gives it.";
  // A long list is summed up per kind, the way the Tools section will show it.
  if (capabilities.length > GROUP_TOOLS_OVER) return toolLines(capabilities).join("\n");
  return capabilities
    .map((c) => `- ${c.label} (${c.hub}${c.access === "write" ? ", may write" : ""})${c.reason ? `: ${c.reason}` : ""}`)
    .join("\n");
}

/** `- Slack: post the standup summary.` One line of the tools section. */
function toolLine(c: Pick<DraftPick, "label" | "reason">): string {
  const reason = c.reason?.trim().replace(/[.\s]+$/, "");
  return `- ${c.label}: ${reason ? `${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : "use it when the job needs it"}.`;
}

/** Over this many tools, a kind with more than GROUP_KIND_OVER of them gets one line. */
export const GROUP_TOOLS_OVER = 8;
const GROUP_KIND_OVER = 3;

const KIND_LABEL: Record<DraftPick["hub"], string> = {
  mcp: "MCP servers",
  builtin: "Built-in tools",
  subagent: "Subagents",
  skill: "Skills",
  knowledge: "Knowledge",
};

const KIND_HINT: Partial<Record<DraftPick["hub"], string>> = {
  subagent: " Hand a task to the one that owns that product.",
  knowledge: " Search them before answering from memory.",
};

/**
 * The tools section's lines: one per tool, or for a long list one per kind
 * ("- MCP servers, read only: Jira, GitHub."). `previous` keeps the line an
 * earlier prompt already had for a tool, keyed by lowercased label.
 */
function toolLines(capabilities: DraftPick[], previous?: ReadonlyMap<string, string>): string[] {
  const single = (c: DraftPick): string => previous?.get(c.label.toLowerCase()) ?? toolLine(c);
  if (capabilities.length <= GROUP_TOOLS_OVER) return capabilities.map(single);
  const lines: string[] = [];
  for (const hub of Object.keys(KIND_LABEL) as Array<DraftPick["hub"]>) {
    const ofKind = capabilities.filter((c) => c.hub === hub);
    if (ofKind.length === 0) continue;
    if (ofKind.length <= GROUP_KIND_OVER) {
      lines.push(...ofKind.map(single));
      continue;
    }
    const readOnly = hub === "mcp" && ofKind.every((c) => c.access !== "write");
    lines.push(
      `- ${KIND_LABEL[hub]}${readOnly ? ", read only" : ""}: ${[...new Set(ofKind.map((c) => c.label))].join(", ")}.${KIND_HINT[hub] ?? ""}`,
    );
  }
  return lines;
}

export function buildInstructionsMessages(input: InstructionsInput): AuthoringMessage[] {
  const facts = [
    `Agent name: ${input.name || "(unnamed)"}`,
    input.description ? `Description: ${input.description}` : "",
    `What it does: ${input.brief}`,
    `Permission: ${PERMISSION_RULES[input.permissionMode]}`,
    input.schedule
      ? `Runs on a schedule: ${input.schedule.label}${input.schedule.task ? `. Each run: ${input.schedule.task}` : ""}`
      : "Runs when the user asks.",
    `Tools it has:\n${capabilityLines(input.capabilities)}`,
  ].filter(Boolean);
  const format = [
    "Format:",
    "- Open with two or three sentences and no title: who you are (\"You are …\"), who you help, and your tone.",
    "- Then these sections, in this order. Put each title alone on its own line, exactly as written, with a blank line before it:",
    ...INSTRUCTION_SECTIONS.map((title) => `  ${title}`),
    "- How you work: numbered steps (1., 2., 3.), one action per step.",
    `- ${TOOLS_HEADING}: one line per tool listed above, like "- Slack: post the standup summary in the team channel.", saying when to use it. A line that lists several tools stays one line. Name no other tools. Leave the section out when there are none.`,
    "- Rules: lines starting with \"- \" for what you must always or never do.",
    "- When you're unsure, and When something goes wrong: one to three lines each, starting with \"- \".",
    "Short, concrete sentences in everyday words. Second person. 180 to 400 words.",
  ].join("\n");
  const user = input.existing
    ? [
        ...facts,
        "",
        "Current prompt:",
        "---",
        input.existing.text,
        "---",
        `Change requested: ${input.existing.change}`,
        "Apply the change and return the full prompt. Keep the wording of every part the change does not touch. If the current prompt uses markdown (# headings, ** bold), drop the symbols and use the format below.",
        format,
      ].join("\n")
    : [...facts, "", format].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

export interface InstructionsResult {
  text: string;
  contract: { ok: boolean; error?: string };
  repaired: boolean;
}

/**
 * Stream the prompt. `onDelta` gets each chunk; the result has the contract
 * check applied, repairing a missing Workflow or Guardrails section so the draft
 * can always be saved.
 */
export async function streamInstructions(
  input: InstructionsInput,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<InstructionsResult> {
  let full = "";
  for await (const delta of chatStream(buildInstructionsMessages(input), {
    maxTokens: 1100,
    timeoutMs: 20_000,
    temperature: 0.5,
    ...(signal ? { signal } : {}),
  })) {
    full += delta;
    onDelta(delta);
  }
  return finishInstructions(full, input);
}

/**
 * Markdown the writer slipped in anyway (heading marks, bold markers, star
 * bullets), and the blank line it likes to leave between a title and its list.
 * The canvas shows the prompt as plain text, where these read as noise.
 */
export function plainInstructions(text: string): string {
  return text
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/^([ \t]*)[*•][ \t]+/gm, "$1- ")
    .replace(/^([^\s\d-][^\n.!?]{0,40})\n[ \t]*\n(?=[ \t]*(?:-|\d+\.)[ \t])/gm, "$1\n");
}

/** Apply the contract to text produced by any path (streamed, or a template fallback). */
export function finishInstructions(text: string, input: Pick<InstructionsInput, "permissionMode" | "name">): InstructionsResult {
  const stripped = plainInstructions(text.replace(/^```(?:markdown|md|text)?\s*/i, "").replace(/\s*```\s*$/i, ""));
  const ensured = ensurePromptContract(stripped, { permissionMode: input.permissionMode, name: input.name });
  return { text: ensured.text, contract: validateSystemPromptContract(ensured.text), repaired: ensured.repaired };
}

/**
 * The tools section, rebuilt from the agent's full tool list: for tools chosen
 * after the instructions started streaming, a long list, or a tools-only edit.
 */
export function toolsSection(
  capabilities: DraftPick[],
  previous?: ReadonlyMap<string, string>,
): { heading: string; markdown: string } {
  return { heading: TOOLS_HEADING, markdown: [TOOLS_HEADING, ...toolLines(capabilities, previous)].join("\n") };
}

/** Plain prompt used when the instructions call fails or times out, so the canvas is never left empty. */
export function templateInstructions(input: InstructionsInput): string {
  const name = input.name || "a focused assistant";
  return [
    `You are ${name}. ${input.brief}`.trim(),
    "",
    "How you work",
    "1. Read the request and gather what you need.",
    "2. Do the work in small steps and check each result.",
    "3. Report what you did and anything you could not finish.",
    ...(input.capabilities.length > 0 ? ["", TOOLS_HEADING, ...toolLines(input.capabilities)] : []),
    "",
    "Rules",
    `- ${PERMISSION_RULE_LINES[input.permissionMode]}`,
    "",
    "When you're unsure",
    "- If the request is unclear, ask one short question.",
    "",
    "When something goes wrong",
    "- If a tool fails, say so and carry on with what you have.",
  ].join("\n");
}
