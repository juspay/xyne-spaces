import { parseSlashCommand } from "./parseSlashCommand.js";
import { buildCompactTask } from "./webhook-commands/compact.js";

export interface AiScreenCommandResult {
  task: string;
  /** /compact: claw compacts the session before this run, as on the webhook. */
  compactBeforeRun?: true;
}

export function applyAiScreenCommand(message: string): AiScreenCommandResult {
  const slash = parseSlashCommand(message);
  if (slash?.kind === "compact") {
    return { task: buildCompactTask(slash), compactBeforeRun: true };
  }
  return { task: message.trim() };
}
