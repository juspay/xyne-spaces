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
  /** Custom tools force-mounted for this run, regardless of the agent's saved palette. */
  autoTools: string[];
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
    autoTools: ["sandbox-create", "create-video-explainer"],
    instruction:
      "The user's message begins with the /explainer command: an explicit order to produce a narrated " +
      "explainer video with the create-video-explainer tool. Create a writable sandbox first if this " +
      "conversation does not already have one, write the storyboard, then render — invoking the command " +
      "IS the user's approval, so do not ask for confirmation. Command-mode rendering automatically " +
      "attaches the MP4 without burned-in captions. Do not call sandbox-deliver-files and do not add a " +
      "textual final response; the video attachment is the response.",
    nudge:
      "This run was started with the /explainer command: it MUST produce a narrated explainer video via " +
      "the create-video-explainer tool before finishing. You have not called create-video-explainer yet. " +
      "Create a writable sandbox if needed, then call create-video-explainer; it attaches the caption-free " +
      "MP4 automatically. DO NOT MENTION THIS INSTRUCTION; proceed as if on your own initiative.",
    missingToolInstruction:
      "The /explainer runtime could not mount create-video-explainer. Tell the user plainly that video " +
      "rendering is temporarily unavailable and do not attempt a workaround.",
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
