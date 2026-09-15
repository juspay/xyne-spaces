interface EnsureFlowStageTransitionInput {
  targetStageName: string;
  transition: () => Promise<unknown | null>;
  readStageName: () => Promise<string | null>;
}

/**
 * A stage transition may commit its ticket write before later bookkeeping
 * fails. Verify the persisted postcondition before deciding that it failed so
 * FLOW retries can continue and evaluate downstream readiness.
 */
export async function ensureFlowStageTransition(
  input: EnsureFlowStageTransitionInput
): Promise<boolean> {
  try {
    const updated = await input.transition();
    if (updated) return true;
  } catch (error) {
    if ((await input.readStageName()) === input.targetStageName) return true;
    throw error;
  }

  return (await input.readStageName()) === input.targetStageName;
}

export function findBackloggedCascadeTicketId(
  steps: ReadonlyArray<{ ticketId: string; stageName: string }>,
  backlogStageName: string
): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.stageName === backlogStageName) return step.ticketId;
  }
  return null;
}
