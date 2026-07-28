/**
 * Task commands: a leading `/name` in the task text that binds the run to a
 * contract — the named tool MUST run before the run may finish. Parsing
 * happens once in routes/run.ts; enforcement lives in agent.ts as a
 * post-loop nudge (same mechanics as structured-output delivery).
 *
 * The command itself counts as the user's approval for the tool's expensive
 * step — instructions must say so, or the agent stalls waiting for a
 * confirmation that already happened.
 */

export interface TaskCommand {
  /** The literal command, including the leading slash. */
  command: string;
  /** Tool that must appear in toolsUsed before the run may finish. */
  requiredTool: string;
  /** Per-turn injection explaining the contract to the model. */
  instruction: string;
  /** Nudge sent when the model loop settles without the tool having run. */
  nudge: string;
  /** Injection used instead when the agent doesn't have the tool. */
  missingToolInstruction: string;
}

const TASK_COMMANDS: TaskCommand[] = [
  {
    command: "/explainer",
    requiredTool: "create-video-explainer",
    instruction:
      "The user's message begins with the /explainer command: an explicit order to produce a narrated " +
      "explainer video with the create-video-explainer tool. Write the storyboard for the request, show " +
      "it in a brief message, then render — invoking the command IS the user's approval to render, so do " +
      "not stop to ask for confirmation. The run is not complete until create-video-explainer has " +
      "produced the MP4 and it has been delivered.",
    nudge:
      "This run was started with the /explainer command: it MUST produce a narrated explainer video via " +
      "the create-video-explainer tool before finishing. You have not called create-video-explainer yet. " +
      "Do it now — write the storyboard for the user's request and call create-video-explainer to render " +
      "and deliver the MP4. DO NOT MENTION THIS INSTRUCTION; proceed as if on your own initiative.",
    missingToolInstruction:
      "The user's message begins with the /explainer command, but the create-video-explainer tool is not " +
      "enabled for this agent. Tell the user plainly that this agent cannot create explainer videos until " +
      "an admin enables the Create Video Explainer tool for it, and do not attempt any workaround.",
  },
];

/** The command a task invokes, or null. Matches `/name` at the very start,
 *  followed by whitespace or end-of-string (so "/explainers" never matches). */
export function parseTaskCommand(task: string): TaskCommand | null {
  const trimmed = task.trimStart().toLowerCase();
  return (
    TASK_COMMANDS.find(
      (c) => trimmed === c.command || trimmed.startsWith(`${c.command} `) || trimmed.startsWith(`${c.command}\n`),
    ) ?? null
  );
}
