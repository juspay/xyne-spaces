export const TASK_COMMAND_NAMES = ["explainer", "record-skill", "design", "dashboard", "spec", "review", "learn"] as const;

export type TaskCommandName = (typeof TASK_COMMAND_NAMES)[number];

export const IMMEDIATE_TASK_COMMAND_RE = new RegExp(`^\\/(?:${TASK_COMMAND_NAMES.join("|")})(?:\\s|$)`, "i");

export const RECORD_SKILL_COMMAND_RE = /^\/record-skill(?:\s|$)/i;

export const LOCAL_SANDBOX_COMMANDS = ["design", "dashboard", "spec", "review", "learn"] as const;

export type LocalSandboxCommandName = (typeof LOCAL_SANDBOX_COMMANDS)[number];

export const LOCAL_SANDBOX_COMMAND_RE = new RegExp(`^\\/(?:${LOCAL_SANDBOX_COMMANDS.join("|")})(?:\\s|$)`, "i");

export function parseLocalSandboxCommand(task: string): LocalSandboxCommandName | null {
  const match = new RegExp(`^\\/(${LOCAL_SANDBOX_COMMANDS.join("|")})(?:\\s|$)`, "i").exec(task.trim());
  const name = match?.[1]?.toLowerCase();
  return (LOCAL_SANDBOX_COMMANDS as readonly string[]).includes(name ?? "") ? (name as LocalSandboxCommandName) : null;
}
