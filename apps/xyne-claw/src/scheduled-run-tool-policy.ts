/**
 * Tools that require an interactive Spaces thread and therefore cannot be used
 * safely by unattended scheduled runs.
 *
 * Direct A2A tools (`call-agent` / `ask_<slug>`) are deliberately not listed:
 * they execute the callee in-process and return its result to the caller.
 */
const SCHEDULED_INTERACTIVE_ONLY_TOOLS = new Set([
  "schedule-task",
  "propose-agent-call",
]);

export function filterScheduledRunTools<T extends { name: string }>(tools: readonly T[]): T[] {
  return tools.filter((tool) => !SCHEDULED_INTERACTIVE_ONLY_TOOLS.has(tool.name));
}
