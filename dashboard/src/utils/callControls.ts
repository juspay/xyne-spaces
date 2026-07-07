interface AiControllerLike {
  id: string;
  name: string;
}

interface PendingControlRequestLike {
  requesterId: string;
  requesterName: string;
}

interface AiButtonStateParams {
  hasPendingRequestFromOther: boolean;
  isRequestingUser: boolean;
  requestedAiController: boolean;
  isControlledByOther: boolean;
  isController: boolean;
  isAIAssistantEnabled: boolean;
  pendingControlRequest: PendingControlRequestLike | null;
  aiController: AiControllerLike | null;
  defaultControlClass: string;
}

interface AiButtonActionParams {
  hasPendingRequestFromOther: boolean;
  isControlledByOther: boolean;
  onRequestControl?: (() => void) | undefined;
  onToggleAIAssistant: () => void;
}

export function getAiButtonDisabled({
  hasPendingRequestFromOther,
  isRequestingUser,
  requestedAiController,
}: Pick<
  AiButtonStateParams,
  'hasPendingRequestFromOther' | 'isRequestingUser' | 'requestedAiController'
>): boolean {
  return hasPendingRequestFromOther || isRequestingUser || requestedAiController;
}

export function getAiButtonTitle({
  hasPendingRequestFromOther,
  isRequestingUser,
  isControlledByOther,
  isAIAssistantEnabled,
  pendingControlRequest,
  aiController,
}: Omit<
  AiButtonStateParams,
  'requestedAiController' | 'isController' | 'defaultControlClass'
>): string {
  if (hasPendingRequestFromOther) {
    return `${pendingControlRequest?.requesterName || 'Unknown User'} is requesting control`;
  }
  if (isRequestingUser) return 'Your request is pending...';
  if (isControlledByOther) return `Request control from ${aiController?.name || 'Unknown User'}`;
  if (isAIAssistantEnabled) return 'Disable Xyne Automatic';
  return 'Enable Xyne Automatic';
}

export function getAiButtonColorClass({
  hasPendingRequestFromOther,
  isController,
  isAIAssistantEnabled,
  isControlledByOther,
  defaultControlClass,
}: Pick<
  AiButtonStateParams,
  | 'hasPendingRequestFromOther'
  | 'isController'
  | 'isAIAssistantEnabled'
  | 'isControlledByOther'
  | 'defaultControlClass'
>): string {
  if (hasPendingRequestFromOther) return `${defaultControlClass} cursor-not-allowed opacity-60`;
  if (isController || (isAIAssistantEnabled && !isControlledByOther)) {
    return 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-500/50';
  }
  if (isControlledByOther) {
    return 'bg-yellow-600 hover:bg-yellow-700 text-white shadow-yellow-500/50';
  }
  return defaultControlClass;
}

export function handleAiButtonClick({
  hasPendingRequestFromOther,
  isControlledByOther,
  onRequestControl,
  onToggleAIAssistant,
}: AiButtonActionParams): void {
  if (hasPendingRequestFromOther) return;
  if (isControlledByOther && onRequestControl) {
    onRequestControl();
    return;
  }
  onToggleAIAssistant();
}
