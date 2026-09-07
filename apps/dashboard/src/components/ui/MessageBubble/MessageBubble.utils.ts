/**
 * Utility functions for MessageBubble component
 */

interface MentionedUser {
  userId: string;
}

export interface MessageMetadata {
  ticketId?: string;
  xyneId?: string;
  workflowId?: string;
  workflowName?: string;
  workflowType?: string;
  executionTime?: string;
  workflowStatus?: 'NEW' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PENDING';
  isCallMessage?: boolean;
  operation?: string;
  callId?: string;
  recordingId?: string;
  recordingType?: string;
  prdCanvasUrl?: string;
  detailedSummaryCanvasUrl?: string;
  completedSteps?: Array<{
    stepName: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  }>;
  pendingSteps?: Array<{
    stepName: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  }>;
  rerunStartTime?: string;
  executorType?: string;
  useQuestioningMode?: boolean;
  description?: string;
  createdBy?: string;
  gitInfo?: {
    branch?: string;
    repoUrl?: string;
    preview?: {
      url?: string;
    };
  };
  // NonParticipantActions fields
  messageSubtype?: string;
  mentionedUsers?: MentionedUser[];
  channelId?: string;
  mentionedUserId?: string;
  mentionedUserName?: string;
  status?: string;
  // Claw agent citations baked in at reply-time so a re-opened thread can render
  // clickable citation chips without re-calling claw. `clawCitations` is a
  // slimmed toolInvocations list (toolCallId + Citation[]); `clawCitationIcons`
  // is the de-duplicated iconKey→data:URI map (registered via registerClawIcons).
  clawCitations?: Array<{ toolCallId: string; citations: unknown[] }>;
  clawCitationIcons?: Record<string, string>;
  clawRunOrigin?: {
    kind?: string;
    provider?: string;
    harnessName?: string;
    label?: string;
    ownerName?: string;
  };
  // Forwarded message fields
  originalMessageId?: string;
  optionalText?: string;
  originalSenderId?: string;
  originalSenderName?: string;
  originalCreatedAt?: number;
  originalChannelId?: string;
  originalConversationId?: string;
  // Index signature to make it compatible with Record<string, unknown>
  [key: string]: unknown;
}

/**
 * Formats duration in seconds to human-readable format
 * @param durationInSeconds - Duration in seconds
 * @returns Formatted duration string (e.g., "2m 15s", "1h 30m", "45s")
 */
export const formatDuration = (durationInSeconds: number): string => {
  if (durationInSeconds < 60) {
    return `${durationInSeconds}s`;
  } else if (durationInSeconds < 3600) {
    const minutes = Math.floor(durationInSeconds / 60);
    const seconds = durationInSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};

/**
 * Calculates and formats execution time for workflow messages
 * @param metadata - Message metadata containing workflow information
 * @param messageCreatedAt - Message creation timestamp
 * @returns Formatted execution time string
 */
export const getExecutionTimeDisplay = (
  metadata: MessageMetadata | null,
  messageCreatedAt: string | Date,
): string => {
  // For completed workflows with executionTime, use the stored execution time
  if (
    metadata?.workflowStatus &&
    ['SUCCESS', 'FAILED'].includes(metadata.workflowStatus) &&
    metadata?.executionTime
  ) {
    const durationInSeconds = parseInt(metadata.executionTime);
    return formatDuration(durationInSeconds);
  }

  // For all other statuses (including RUNNING), show real-time elapsed time
  const now = new Date().getTime();

  const startTime = metadata?.rerunStartTime
    ? new Date(metadata.rerunStartTime).getTime()
    : typeof messageCreatedAt === 'string'
      ? new Date(messageCreatedAt).getTime()
      : messageCreatedAt.getTime();
  const durationInSeconds = Math.floor((now - startTime) / 1000);

  return formatDuration(durationInSeconds);
};

export const formatStepName = (name: string): string =>
  name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
