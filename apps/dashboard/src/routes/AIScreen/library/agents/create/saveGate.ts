import { validateSystemPromptContract } from '@/components/flowUI/nodes/agent/create/agentPromptContract';

export interface SaveGateInput {
  created: boolean;
  creating: boolean;
  /** A build-chat turn is still writing the canvas. */
  drafting: boolean;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  conflictCount: number;
  /** Why the Schedule property can't be armed (a past time, a bad cron), if it can't. */
  scheduleProblem?: string | null;
  nameCheck: { checking: boolean; nameError: string | null; slugError: string | null };
  /**
   * Changing a saved agent: Save needs a change, and the instructions only
   * have to meet the contract once they've been changed (older agents predate it).
   */
  editing?: { dirty: boolean; instructionsChanged: boolean };
}

export interface SaveGate {
  canSave: boolean;
  /** First thing blocking Save, phrased for the Save tooltip. Null when Save is allowed. */
  reason: string | null;
}

const blocked = (reason: string): SaveGate => ({ canSave: false, reason });

/** Everything that must hold before the create canvas may POST the agent, in the order a user fixes it. */
export function computeSaveGate(input: SaveGateInput): SaveGate {
  if (input.created) return blocked('This agent is already saved.');
  if (input.creating) return blocked('Saving…');
  if (input.drafting) return blocked('Wait for the draft to finish.');
  if (input.editing && !input.editing.dirty) return blocked('Nothing has changed yet.');
  if (!input.name.trim()) return blocked('Add a name.');
  if (!input.slug.trim()) return blocked('Add a handle.');
  if (!input.editing && !input.description.trim()) return blocked('Add a description.');
  if (!input.instructions.trim()) return blocked('Add instructions.');
  if (input.conflictCount > 0) {
    return blocked('Choose "Keep mine" or "Use chat" on the highlighted fields.');
  }
  if (input.nameCheck.checking) return blocked('Checking the name and handle…');
  if (input.nameCheck.slugError) return blocked(`@${input.slug} is taken. Change the handle.`);
  if (input.nameCheck.nameError) return blocked(input.nameCheck.nameError);
  const contract =
    input.editing && !input.editing.instructionsChanged
      ? { ok: true, error: null }
      : validateSystemPromptContract(input.instructions);
  if (!contract.ok) return blocked(contract.error ?? 'Instructions are incomplete.');
  if (input.scheduleProblem) return blocked(input.scheduleProblem);
  return { canSave: true, reason: null };
}
