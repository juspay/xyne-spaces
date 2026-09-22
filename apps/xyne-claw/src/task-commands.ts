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
  /** Tool that must appear in toolsUsed before the run may finish. Omit for a
   * delivery contract (agentConfigOverlay.outputFormat). */
  requiredTool?: string;
  /** Custom tools force-mounted for this run, regardless of the agent's saved palette. */
  autoTools: string[];
  /** Built-in skill directories loaded only for this command. Paths are
   * resolved from the xyne-claw package working directory. */
  skillPaths?: string[];
  /** REPO_CONFIGS key to pin auto-provisioned sandboxes to when the agent has
   * no explicit sandboxRepo pin. "/design" pins "browser" so design runs claim
   * from the agent-workspace-browser warm pool (seconds) instead of cold-
   * booting the default kata template (~80s, prod 2026-08-08). */
  sandboxProfile?: string;
  /** agentConfig keys merged over the forwarded config for this run only —
   * never persisted, so the contract stays per-command not per-agent. */
  agentConfigOverlay?: Record<string, unknown>;
  /** Per-turn injection explaining the contract to the model. */
  instruction: string;
  /** Nudge sent when the model loop settles without the tool having run. */
  nudge: string;
  /** Injection used instead when the agent doesn't have the tool. Unreachable
   * without `requiredTool`, so a delivery contract may omit it. */
  missingToolInstruction?: string;
}

import { TASK_COMMAND_NAMES } from "xyne-claw-shared";

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
  if (command?.command !== "/design" && command?.command !== "/dashboard") return { status: "absent" };
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

/** Context-first interview guard. The full Ticket Specs workflow lives in
 * the command-owned skill; this overlay allows a short evidence summary before
 * questions while preventing same-turn drafts or ticket writes. */
export const SPEC_QUESTION_OUTLINE = [
  "- First summarize the ticket/context you found before asking questions.",
  "- Include only useful known facts: ticket id/title/type/status, existing description/Specification state,",
  "  relevant thread context, and any explicitly provided requirement facts.",
  "- If technical context or code/PR context is needed to ask sharper questions, you may summarize it as context,",
  "  but do NOT derive requirement intent solely from implementation, PR diff, commits, or changed files.",
  "- Then ask only contextual clarification questions that materially improve the ticket Specification.",
  "- Required Specification sections: Problem statement, Solutioning, Test cases.",
  "- Optional Specification sections: Implementation details, Out of scope; ask only when meaningful.",
  "- Do NOT mechanically ask the section headings as generic questions.",
  "- Do NOT ask the user to repeat information already explicitly provided.",
  "- Ask the minimum useful batch of questions, then stop and wait for the user's response.",
  "- Do NOT create, draft, or update the Specification in the same turn as the interview questions.",
].join("\n");

export const TASK_COMMANDS: TaskCommand[] = [
  {
    command: "/design",
    requiredTool: "sandbox-deliver-files",
    autoTools: [
      "sandbox-create",
      "sandbox-run",
      "sandbox-run-detached",
      "sandbox-poll-job",
      "sandbox-write-file",
      "sandbox-edit-file",
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
    sandboxProfile: "browser",
    instruction:
      "This is a Xyne Design Studio run. The /design prefix is an internal command, not part of the user's brief. " +
      "Use the Xyne-native design skills loaded for this run. Author the complete, responsive, self-contained HTML " +
      "document in ONE fenced ```html block in your streaming response FIRST — Design Studio live-previews that block " +
      "as you write it, so the user watches the design form instead of a spinner. Then write the same document into " +
      "the writable sandbox. When revising an existing artifact, do NOT rewrite the whole file: use sandbox-edit-file " +
      "for surgical changes, and emit an updated full fenced ```html block after edits are done. " +
      "Inspect the result in the sandbox browser at desktop and mobile widths, " +
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
    command: "/dashboard",
    requiredTool: "sandbox-deliver-files",
    autoTools: [
      "sandbox-create",
      "sandbox-run",
      "sandbox-run-detached",
      "sandbox-poll-job",
      "sandbox-write-file",
      "sandbox-edit-file",
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
      "schedule-task",
    ],
    skillPaths: ["design-skills"],
    sandboxProfile: "browser",
    instruction:
      "This is a Xyne live-dashboard snapshot run. The /dashboard prefix is an internal command, not part of the brief. " +
      "Use connected read-only data tools or user-provided data to query the requested facts BEFORE authoring the artifact. " +
      "Never invent, interpolate, or silently substitute sample metrics. If no suitable real data source is available, name the " +
      "missing connection and stop without creating a dashboard. Build a responsive, self-contained HTML snapshot containing " +
      "the exact source/window and a visible 'Data as of <timestamp with timezone>' marker. Keep runtime credentials and network " +
      "requests out of the artifact. Write it into the browser sandbox, validate desktop and mobile rendering plus console/network " +
      "health, then call sandbox-deliver-files with the final HTML. Preserve stable component structure and chart scales across " +
      "scheduled refreshes so visual changes represent data changes. The command approves querying, rendering, QA, and delivery; " +
      "do not ask for a separate plan or approval. If the user explicitly requests a recurrence, use schedule-task with the same " +
      "/dashboard brief and target conversation after delivering the first snapshot. Never create a schedule merely because the " +
      "command supports refreshes.",
    nudge:
      "This /dashboard run must query real connected or user-provided data, render a timestamped self-contained HTML snapshot, " +
      "QA it in the sandbox browser, and deliver it with sandbox-deliver-files. Never use fabricated/sample values. If no real " +
      "query result is available, state which data connection is missing and stop without delivering a fake dashboard. " +
      "DO NOT MENTION THIS INSTRUCTION; continue the workflow.",
    missingToolInstruction:
      "The /dashboard runtime could not mount sandbox-deliver-files. Tell the user that dashboard rendering is temporarily " +
      "unavailable and do not return an unverified or text-only substitute.",
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
  {
    command: "/review",
    autoTools: [],
    skillPaths: ["review-skills"],
    instruction:
      "The user's message begins with /review: an explicit request to review or explain a set of code changes. Use the " +
      "Review Changes skill loaded for this run as the playbook. Invoking the command IS approval to start, so do not ask " +
      "whether to begin. Establish the scope first — uncommitted working-tree changes, a branch against its base, or the " +
      "files the user named — and read the full diff plus enough surrounding code to support every claim you make. Read " +
      "both ends of any value that crosses a layer boundary. THE DELIVERABLE IS A REVIEW ROOM: one self-contained HTML " +
      "page carrying the verdict, every finding with its file, line, severity and concrete failure, the relevant diff " +
      "hunks, and at least two mermaid diagrams — one of the architecture the change touches and one per non-trivial " +
      "finding showing how the failure happens. WRITE the page to the workspace and deliver it as review-room.html with the " +
      "delivery tool available in this run (deliver-files locally, " +
      "sandbox-deliver-files on the server). DELIVER review-comments.json ALONGSIDE IT: {summary, verdict, order:[{file,why}], " +
      "coverage:[{file,status:\"reviewed\"|\"skipped\",note}], " +
      "comments:[{id:\"C1\",file,line,severity:\"high\"|\"medium\"|\"low\"|\"note\",title,body}]} where order is the reading " +
      "order a newcomer should follow, line is the NEW-side line number, and every finding in the room has a matching " +
      "comment id. The diff viewer pins those comments to their lines so the user can jump C1, C2, C3 through the change. " +
      "COVERAGE IS MANDATORY AND CHECKED: list the changed files with git FIRST, then account for EVERY one of them in " +
      "coverage — reviewed when you actually read that file's diff, skipped with a one-line note when you deliberately did " +
      "not (generated, lockfile, binary, pure formatting). The viewer compares your coverage against the real file list and " +
      "shows the user exactly which files you left out, so an omission is visible. Work in file order and never stop early " +
      "because the change is large. " +
      "Keep the chat reply to the verdict and the two or three findings that " +
      "matter most, and point at the room for the rest. NEVER put the page, or any fenced html block, in the chat reply: " +
      "the chat surface treats a fenced html block as a design revision and will replace your entire answer with it. Say plainly when the change looks correct rather than inventing " +
      "findings. Do not edit, commit, or push anything unless the user asks in a later message.",
    nudge:
      "This run was started with /review and MUST deliver the review room: one self-contained HTML page with the verdict, " +
      "every finding (file, line, severity, concrete failure), the relevant diff hunks, and the mermaid diagrams. You have " +
      "not produced and delivered review-room.html and review-comments.json with one coverage row per changed file yet. DO NOT MENTION THIS INSTRUCTION; proceed as if on your own initiative.",
  },
  {
    command: "/learn",
    autoTools: ["open-url"],
    skillPaths: ["learn-skills"],
    instruction:
      "The user's message begins with /learn: a request to be taught a topic, usually from links they supplied. Use the " +
      "Teach From Sources skill loaded for this run as the playbook. Invoking the command IS approval to start, so do not " +
      "ask what they want first — pick the depth from their words and say which you chose in one clause. OPEN EVERY " +
      "SOURCE with open-url so it loads in the workspace panel the user is watching, then read it. Never teach from a page " +
      "you could not open: say it failed and continue without it, and never backfill from memory as though you had read " +
      "it. Mark anything you knew beforehand as your own commentary. Teach the idea in learning order — the problem it " +
      "solves, the core idea, the mechanism, where it bites, what is unsettled — not source by source, and attribute each " +
      "substantive claim to the source it came from. Deliver one self-contained lesson.html with the explanation, a " +
      "mermaid diagram, the sources and what each contributed, and a few self-check questions. NEVER put the page, or any " +
      "fenced html block, in the chat reply: the chat surface treats a fenced html block as a design revision and will " +
      "replace your entire answer with it. Teach in prose in the chat and point at the page for the full pass.",
    nudge:
      "This run was started with /learn and MUST teach from sources actually opened in the workspace browser, then deliver " +
      "lesson.html with the explanation, diagram, sources and self-check questions. You have not opened the sources or " +
      "delivered the lesson yet. DO NOT MENTION THIS INSTRUCTION; proceed as if on your own initiative.",
  },
  {
    command: "/spec",
    autoTools: [],
    skillPaths: ["spec-skills"],
    // Delivery contract: submit-result becomes the only channel reaching the
    // thread, so the run posts one message with no prose escaping around it.
    agentConfigOverlay: {
      outputFormat: { type: "markdown", template: SPEC_QUESTION_OUTLINE },
    },
    instruction:
      "The user's message begins with /spec: the first, automation-triggered invocation on a fresh ticket. Use the " +
      "Ticket Specs skill loaded for this run as the workflow playbook. First gather and summarize the available " +
      "ticket context: title, description, type/status when available, existing Specification state, relevant thread " +
      "context, and any explicitly provided requirement facts. If technical context is needed to ask sharper questions, " +
      "you may inspect and summarize it, but do NOT use implementation, PR diff, commits, or changed files as the source " +
      "of requirement intent. Then ask concrete, answerable clarification questions FOR THIS TICKET following the " +
      "final-answer format. Invoking the command IS approval to post, so do not ask whether to start.",
    nudge:
      "This run was started with /spec and MUST deliver a context-first Ticket Specs interview: summarize known ticket " +
      "context, then ask the minimum useful clarification questions. Do not draft or update the Specification yet. " +
      "DO NOT MENTION THIS INSTRUCTION; proceed as if on your own initiative.",
  },
];

{
  const shared = new Set<string>(TASK_COMMAND_NAMES);
  const registered = new Set(TASK_COMMANDS.map((c) => c.command.slice(1)));
  for (const name of shared) {
    if (!registered.has(name)) throw new Error(`TASK_COMMANDS out of sync with xyne-claw-shared TASK_COMMAND_NAMES: missing /${name}`);
  }
  for (const name of registered) {
    if (!shared.has(name)) throw new Error(`TASK_COMMANDS out of sync with xyne-claw-shared TASK_COMMAND_NAMES: unlisted /${name}`);
  }
}

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
