/**
 * Xyne Automatic's control state, as shown by its tile in `CallMoreSheet`. Pure so it can be
 * tested without rendering the bottom sheet.
 */

export interface AiControlToneInput {
  /** Whether the assistant is currently switched on in the call. */
  isAIAssistantEnabled: boolean;
  localParticipantId: string | null | undefined;
  aiController: { id: string; name: string } | null | undefined;
  pendingControlRequest: { requesterId: string; requesterName: string } | null | undefined;
}

type AiControlTone = 'ai' | 'aiControlled' | null;

interface AiControlToneResult {
  /** `ai` = you're using it (purple), `aiControlled` = someone else is (amber), `null` = neutral. */
  tone: AiControlTone;
  hint: string | undefined;
  /** Someone other than you currently holds control. */
  isControlledByOther: boolean;
  /** Notification dot: someone else has it and no one has asked to take it back yet. */
  showBadge: boolean;
}

/**
 * A pending request from someone else means `AiControlRequestSheet` is already up asking you to
 * approve or deny — the tile stays neutral underneath rather than also signalling a state change.
 */
export function resolveAiControlTone(input: AiControlToneInput): AiControlToneResult {
  const isController = input.localParticipantId === input.aiController?.id;
  const isControlledByOther = !!input.aiController && !isController;
  const hasPendingRequestFromOther =
    !!input.pendingControlRequest &&
    input.pendingControlRequest.requesterId !== input.localParticipantId;

  let tone: AiControlTone = null;
  let hint: string | undefined;
  if (!hasPendingRequestFromOther) {
    if (isController || (input.isAIAssistantEnabled && !isControlledByOther)) {
      tone = 'ai';
      hint = 'Active';
    } else if (isControlledByOther) {
      tone = 'aiControlled';
      hint = `${input.aiController?.name || 'Someone'} is using it`;
    }
  }

  return {
    tone,
    hint,
    isControlledByOther,
    showBadge: isControlledByOther && !hasPendingRequestFromOther,
  };
}
