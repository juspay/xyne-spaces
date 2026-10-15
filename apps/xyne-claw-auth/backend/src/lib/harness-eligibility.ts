/**
 * Whether a Xyne AI chat turn may run on the user's own machine (local harness).
 *
 * run-stream.ts and agent-chat.ts used to decide this separately and differently:
 * agent-chat only checked task commands, so a turn whose attached context resolved
 * to files was sent to the device without those files. Both routes now ask here.
 */
export type HarnessIneligibleReason = "task_command" | "unresolved_context" | "context_files" | "attachments";

export interface HarnessEligibilityInput {
  /** The turn is a task command (`/design`, `/explainer`, …). */
  isTaskCommandRun: boolean;
  /** A task command the device can run itself (one of LOCAL_SANDBOX_COMMANDS, sandboxMode local/container). */
  localSandboxRequested: boolean;
  /** A conversation attached to a local folder: it can only run on the device. */
  workspaceRun: boolean;
  /** Attached context was given but could not be resolved into a prompt block or files. */
  unresolvedContext: boolean;
  /** Context files that claw would write into the run's workspace; the device has no copy. */
  hasContextFiles: boolean;
  /** Attachments that cannot travel with the run envelope. */
  attachmentsBlocked: boolean;
}

export type HarnessEligibility = { eligible: true } | { eligible: false; reason: HarnessIneligibleReason };

export function harnessEligibility(input: HarnessEligibilityInput): HarnessEligibility {
  if (input.workspaceRun) return { eligible: true };
  if (input.isTaskCommandRun && !input.localSandboxRequested) return { eligible: false, reason: "task_command" };
  if (input.unresolvedContext) return { eligible: false, reason: "unresolved_context" };
  if (input.hasContextFiles) return { eligible: false, reason: "context_files" };
  if (input.attachmentsBlocked) return { eligible: false, reason: "attachments" };
  return { eligible: true };
}

/** One line for the user when their choice of "run on my machine" could not be honoured. */
export function harnessIneligibleMessage(reason: HarnessIneligibleReason): string {
  switch (reason) {
    case "task_command":
      return "This command runs on Xyne servers, not on your machine.";
    case "unresolved_context":
      return "Ran on Xyne servers because the attached context could not be prepared for your machine.";
    case "context_files":
      return "Ran on Xyne servers because the attached context includes files your machine doesn't have.";
    case "attachments":
      return "Ran on Xyne servers because these attachments can't be sent to your machine.";
  }
}
