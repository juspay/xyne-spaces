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

const SYSTEM =
  "You write system prompts for AI agents in Xyne Spaces. Return only the prompt, in markdown, with no preface and no code fence.";

const HEADINGS = [
  "## Identity & tone",
  "## Operational Workflow",
  "## When to use each tool",
  "## Guardrails",
  "## Decision rules",
  "## Error recovery",
] as const;

const PERMISSION_RULES: Record<AgentPermissionMode, string> = {
  "ask-first": "The agent asks the user for approval before it sends, posts, creates, edits or deletes anything.",
  "read-only": "The agent only reads and reports. It never sends, posts, creates, edits or deletes.",
  "can-write": "The agent may act without asking, except it never deletes data, spends money or posts publicly without confirmation.",
};

function capabilityLines(capabilities: DraftPick[]): string {
  if (capabilities.length === 0) return "none chosen; the agent works from what the user gives it.";
  return capabilities
    .map((c) => `- ${c.label} (${c.hub}${c.access === "write" ? ", may write" : ""})${c.reason ? `: ${c.reason}` : ""}`)
    .join("\n");
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
    "Use exactly these headings, in this order:",
    ...HEADINGS,
    "Operational Workflow is a numbered list. Guardrails is a bulleted list of what the agent must never do.",
    "Name only the tools listed above, in the section \"When to use each tool\".",
    "Write 350 to 600 words. Second person (\"You are…\"). No filler.",
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
        "Apply the change. Keep every part that is unaffected exactly as written. Return the full prompt.",
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

/** Apply the contract to text produced by any path (streamed, or a template fallback). */
export function finishInstructions(text: string, input: Pick<InstructionsInput, "permissionMode" | "name">): InstructionsResult {
  const stripped = text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const ensured = ensurePromptContract(stripped, { permissionMode: input.permissionMode, name: input.name });
  return { text: ensured.text, contract: validateSystemPromptContract(ensured.text), repaired: ensured.repaired };
}

/** Section for tools that were chosen after the instructions started streaming. */
export function toolsSection(capabilities: DraftPick[]): { heading: string; markdown: string } {
  const lines = capabilities.map((c) => `- Use ${c.label} ${c.reason ? `to ${c.reason.replace(/\.$/, "").toLowerCase()}` : "when the job needs it"}.`);
  return { heading: "When to use each tool", markdown: `## When to use each tool\n${lines.join("\n")}` };
}

/** Plain prompt used when the instructions call fails or times out, so the canvas is never left empty. */
export function templateInstructions(input: InstructionsInput): string {
  const name = input.name || "a focused assistant";
  const tools = input.capabilities.length
    ? input.capabilities.map((c) => `- ${c.label}`).join("\n")
    : "- None. Work from what the user gives you.";
  return [
    "## Identity & tone",
    `You are ${name}. ${input.brief}`,
    "",
    "## Operational Workflow",
    "1. Read the request and gather what you need.",
    "2. Do the work in small steps and check each result.",
    "3. Report what you did and anything you could not finish.",
    "",
    "## When to use each tool",
    tools,
    "",
    "## Guardrails",
    `- ${PERMISSION_RULES[input.permissionMode]}`,
    "",
    "## Decision rules",
    "- If the request is unclear, ask one short question.",
    "",
    "## Error recovery",
    "- If a tool fails, say so and continue with what you have.",
  ].join("\n");
}
