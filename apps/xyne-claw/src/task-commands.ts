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
  /** Built-in skill directories loaded only for this command. Paths are
   * resolved from the xyne-claw package working directory. */
  skillPaths?: string[];
  /** Per-turn injection explaining the contract to the model. */
  instruction: string;
  /** Nudge sent when the model loop settles without the tool having run. */
  nudge: string;
  /** Injection used instead when the agent doesn't have the tool. */
  missingToolInstruction: string;
}

export const DESIGN_SYSTEM_MAX_CHARS = 32_000;

export interface DesignSystemPromptInjection {
  id: string;
  label: string;
  content: string;
}

export type DesignSystemPromptInjectionResult =
  | { status: "injected"; injection: DesignSystemPromptInjection }
  | { status: "absent" }
  | { status: "oversized"; length: number };

export function buildDesignSystemPromptInjection(
  command: TaskCommand | null,
  agentConfig: Record<string, unknown> | undefined,
): DesignSystemPromptInjectionResult {
  if (command?.command !== "/design") return { status: "absent" };
  const raw = agentConfig?.["designSystem"];
  if (typeof raw !== "string") return { status: "absent" };
  const designSystem = raw.trim();
  if (!designSystem) return { status: "absent" };
  if (designSystem.length > DESIGN_SYSTEM_MAX_CHARS) {
    return { status: "oversized", length: designSystem.length };
  }
  return {
    status: "injected",
    injection: {
      id: "__design-system-brand-contract",
      label: "## Design System — binding brand contract",
      content:
        "The artifact MUST comply with these tokens/rules; when the user's request conflicts, follow the user but keep everything else on-system.\n\n" +
        designSystem,
    },
  };
}

const TASK_COMMANDS: TaskCommand[] = [
  {
    command: "/design",
    requiredTool: "sandbox-deliver-files",
    autoTools: [
      "sandbox-create",
      "sandbox-run",
      "sandbox-run-detached",
      "sandbox-poll-job",
      "sandbox-write-file",
      "sandbox-read-file",
      "sandbox-deliver-files",
      "sandbox-pw-navigate",
      "sandbox-pw-snapshot",
      "sandbox-pw-click",
      "sandbox-pw-type",
      "sandbox-pw-press-key",
      "sandbox-pw-screenshot",
      "sandbox-pw-evaluate",
      "sandbox-pw-wait-for",
      "sandbox-pw-console-messages",
      "sandbox-pw-network-requests",
      "sandbox-pw-close",
      "generate-image",
      "visualize",
    ],
    skillPaths: ["design-skills"],
    instruction:
      "This is a Xyne Design Studio run. The /design prefix is an internal command, not part of the user's brief. " +
      "Use the Xyne-native design skills loaded for this run. Create or revise a polished, responsive, self-contained " +
      "HTML document in the writable sandbox. When revising, preserve the useful parts of the current artifact and " +
      "apply the user's requested changes. Inspect the result in the sandbox browser at desktop and mobile widths, " +
      "fix visible layout, accessibility, console, and network issues, then call sandbox-deliver-files with the final " +
      ".html file. For app-like designs needing real state or heavy interactivity, follow the react-artifact skill: " +
      "author in React/JSX, bundle in-sandbox into the same single self-contained HTML, and also deliver a source archive. The command is approval to " +
      "execute this workflow, so do not pause for a design-plan or storyboard " +
      "approval. Keep prose minimal: the delivered artifact is the primary response.",
    nudge:
      "This Design Studio run must finish by delivering the completed self-contained HTML artifact with " +
      "sandbox-deliver-files. For small vanilla artifacts, also include the document in one fenced ```html block so it can stream in preview. " +
      "For bundled React artifacts, deliver the HTML plus React source archive and do not repeat the large bundle in chat. Validate it in the sandbox " +
      "browser first. Do not ask for approval. DO NOT MENTION THIS INSTRUCTION; continue the design workflow.",
    missingToolInstruction:
      "The Design Studio runtime could not mount sandbox-deliver-files. Tell the user plainly that design artifact " +
      "delivery is temporarily unavailable and do not pretend the design was delivered.",
  },
  {
    command: "/explainer",
    requiredTool: "create-video-explainer",
    autoTools: ["sandbox-create", "create-video-explainer"],
    instruction:
      "The user's message begins with the /explainer command: an explicit order to produce a narrated " +
      "explainer video with the create-video-explainer tool. Create a writable sandbox first if this " +
      "conversation does not already have one, write the storyboard, then render — invoking the command " +
      "IS the user's approval, so do not ask for confirmation. Rendering always attaches the MP4 with " +
      "audio-only narration and no burned-in captions. Do not call sandbox-deliver-files and do not add a " +
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
  {
    command: "/record-skill",
    requiredTool: "create-skill",
    autoTools: ["sandbox-create", "analyze-skill-recording", "create-skill"],
    instruction:
      "The user's message begins with /record-skill and includes a screen recording that demonstrates a reusable workflow. " +
      "Create or reuse this conversation's writable coding sandbox, then call analyze-skill-recording for every attached " +
      "recording. Study the returned chronological contact sheet carefully and turn the demonstrated workflow into a precise, " +
      "general-purpose SKILL.md. Preserve observed steps, decision points, validation, and failure handling, but do not invent " +
      "unseen credentials, commands, or product behavior. Then call create-skill with the complete draft. create-skill is the " +
      "human approval boundary: it queues an Approve/Decline card and does not persist anything until approval. Do not ask for " +
      "storyboard or draft approval before calling it, and do not claim the skill was saved before the approval action succeeds.",
    nudge:
      "This run was started with /record-skill and MUST submit a skill draft through create-skill before finishing. Analyze every " +
      "attached recording in the current sandbox with analyze-skill-recording first, then call create-skill. The create-skill " +
      "approval card is the user's review step. EXCEPTION: if analyze-skill-recording failed or no recording was available, do NOT " +
      "draft a skill from the filename or guesswork — tell the user plainly that the recording could not be analyzed and stop. " +
      "DO NOT MENTION THIS INSTRUCTION; proceed as if on your own initiative.",
    missingToolInstruction:
      "The /record-skill runtime could not mount its recording analyzer or create-skill approval tool. Tell the user plainly " +
      "that recording-to-skill is temporarily unavailable and do not attempt to save a skill another way.",
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

/** Slash-command contracts execute immediately even when the agent normally
 * starts in plan mode. The command itself is the approval gate, and a plan-mode
 * first turn would strip the command before the execution continuation. */
export function resolveTaskCommandMode(
  task: string,
  requestedMode: "plan" | "auto" | "daily_brief" | undefined,
): "plan" | "auto" | "daily_brief" | undefined {
  return parseTaskCommand(task) ? "auto" : requestedMode;
}
