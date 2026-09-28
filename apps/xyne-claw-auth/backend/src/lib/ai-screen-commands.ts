import { parseSlashCommand } from "./parseSlashCommand.js";
import { buildCompactTask } from "./webhook-commands/compact.js";

export interface AiScreenCommandResult {
  task: string;
}

export function applyAiScreenCommand(message: string): AiScreenCommandResult {
  const slash = parseSlashCommand(message);
  if (slash?.kind === "compact") {
    return { task: buildCompactTask(slash) };
  }
  return { task: message.trim() };
}
