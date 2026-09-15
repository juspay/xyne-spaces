const USER_VISIBLE_TRANSIENT_RESULT =
  "⚠️ The model provider was temporarily unavailable and your request couldn't be completed. Please try again in a moment.";

export interface TransientRunProgress {
  idleMs: number;
  completedToolCount: number;
  lastTool?: {
    name: string;
    failed: boolean;
    error?: string;
  };
}

function describeStalledRun(
  progress: TransientRunProgress,
  structured: boolean,
): string {
  const seconds = Math.round(progress.idleMs / 1000);
  const first = `${structured ? "Work" : "⚠️ Work"} stopped before completion because the model stopped responding for ${seconds} seconds.`;
  const last = progress.lastTool;
  const issue = last?.failed && last.error
    ? last.error.split(/\r?\n/, 1)[0]!.trim().slice(0, 300)
    : "";
  const toolSummary = last
    ? `${progress.completedToolCount} tool calls completed; the last was \`${last.name}\` (${last.failed ? `failed${issue ? `: ${issue}` : ""}` : "succeeded"}).`
    : `${progress.completedToolCount} tool calls completed before the interruption.`;
  const next = structured
    ? "No final verification or artifact delivery was recorded. Retry the run to continue from the saved conversation."
    : "Work may remain in the sandbox, but no final verification, commit, push, or PR should be assumed. Retry to continue from the saved conversation.";
  return structured
    ? [first, toolSummary, next].join(" ")
    : [first, toolSummary, next].join("\n\n");
}

export function transientProviderCallback(
  requiresStructuredDelivery: boolean,
  progress?: TransientRunProgress,
):
  | { status: 'failed'; error: string }
  | { status: 'completed'; result: string } {
  if (progress) {
    const detail = describeStalledRun(progress, requiresStructuredDelivery);
    return requiresStructuredDelivery
      ? { status: 'failed', error: detail }
      : { status: 'completed', result: detail };
  }
  if (requiresStructuredDelivery) {
    return {
      status: 'failed',
      error: 'Model provider stalled or was temporarily unavailable. Retry the run.',
    };
  }
  return { status: 'completed', result: USER_VISIBLE_TRANSIENT_RESULT };
}
