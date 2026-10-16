import { CallStatus } from '@xyne/shared';
import { formatRelativeTime } from './dateUtils';

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

export interface AiControlState {
  /** The local user currently controls the agent. */
  isController: boolean;
  /** Someone else controls the agent. */
  isControlledByOther: boolean;
  /** Another participant is waiting for control. */
  hasPendingRequestFromOther: boolean;
  /** The local user is the one waiting for control. */
  isRequestingUser: boolean;
}

/** Who owns Xyne Automatic, from the local user's point of view. */
export function getAiControlState({
  localParticipantId,
  aiController,
  pendingControlRequest,
}: {
  localParticipantId: string | null;
  aiController: AiControllerLike | null;
  pendingControlRequest: PendingControlRequestLike | null;
}): AiControlState {
  const isController = !!localParticipantId && localParticipantId === aiController?.id;
  return {
    isController,
    isControlledByOther: !!aiController && !isController,
    hasPendingRequestFromOther:
      !!pendingControlRequest && pendingControlRequest.requesterId !== localParticipantId,
    isRequestingUser:
      !!pendingControlRequest && pendingControlRequest.requesterId === localParticipantId,
  };
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

interface CallInviteInfo {
  title?: string | null | undefined;
  hostName?: string | null | undefined;
  roomLink: string;
  status?: CallStatus | null | undefined;
  startsAt?: number | null | undefined;
  endsAt?: number | null | undefined;
  startedAt?: number | null | undefined;
  endedAt?: number | null | undefined;
  timezone?: string | null | undefined;
}

export function buildCallInviteText({
  title,
  hostName,
  roomLink,
  status,
  startsAt,
  endsAt,
  startedAt,
  endedAt,
  timezone,
}: CallInviteInfo): string {
  const rangeStart = status === CallStatus.SCHEDULED ? startsAt : startedAt;
  const rangeEnd = status === CallStatus.ENDED ? endedAt : endsAt;

  const scheduleLines: string[] = [];
  if (rangeStart) {
    // 'UTC' means no real timezone was captured for this call (e.g. an instant call), so
    // fall back to the viewer's own local zone instead of mislabeling times as UTC.
    const timeZone = timezone && timezone.toUpperCase() !== 'UTC' ? timezone : undefined;
    const dateLabel = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      timeZone,
    }).format(rangeStart);
    const timeFmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
    });
    scheduleLines.push(
      rangeEnd
        ? `${dateLabel} · ${timeFmt.format(rangeStart)} – ${timeFmt.format(rangeEnd)}`
        : `${dateLabel} · ${timeFmt.format(rangeStart)}`,
    );
    if (timeZone) scheduleLines.push(`Time zone: ${timeZone}`);
    if (status === CallStatus.ACTIVE || status === CallStatus.IN_PROGRESS) {
      scheduleLines.push(`This call started ${formatRelativeTime(rangeStart)}`);
    }
  }

  const heading = title || (hostName ? `${hostName} is inviting you to join the call` : null);
  const lines = [
    ...(heading ? [heading] : []),
    ...(title && hostName ? [`Hosted by ${hostName}`] : []),
    ...scheduleLines,
    '',
    'Xyne Call joining info',
    `Video call link: ${roomLink}`,
  ];
  return lines.join('\n');
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
