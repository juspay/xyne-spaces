import type { SlashCommand } from "../parseSlashCommand.js";

// The run resumes the session, forces a compaction, and answers this task —
// a short summary for the user while the context shrinks.
export function buildCompactTask(slash: SlashCommand | null): string {
  return slash?.kind === "compact" && slash.instructions
    ? `The user ran /compact. Summarize the conversation so far concisely, focusing on: ${slash.instructions}. Then we continue.`
    : "The user ran /compact. Give a concise summary of the conversation so far so we can continue with a smaller context.";
}
