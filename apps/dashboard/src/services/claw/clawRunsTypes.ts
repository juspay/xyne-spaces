export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentRunTriggerSource = 'spaces' | 'scheduled' | 'chat' | 'api';

export interface ToolInvocation {
  readonly toolName: string;
  readonly args: unknown;
  readonly result: string;
  readonly isError: boolean;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly status?: 'running' | 'completed';
  readonly parentToolCallId?: string;
  readonly subagentName?: string;
  readonly toolCallId?: string;
}

export interface AgentRun {
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly agentSlug: string;
  readonly triggerSource: AgentRunTriggerSource;
  readonly status: AgentRunStatus;
  readonly currentToolLabel: string | null;
  readonly task: string;
  readonly conversationId: string | null;
  readonly scheduledJobId: string | null;
  readonly channelId: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly toolsUsed: string[];
  readonly toolInvocations: ToolInvocation[] | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly tokensCacheRead: number | null;
  readonly tokensCacheWrite: number | null;
  readonly totalMs: number | null;
  readonly llmTotalMs: number | null;
  readonly llmDecodeMs: number | null;
  readonly llmWaitMs: number | null;
  readonly llmTurns: number | null;
  readonly llmRetries: number | null;
  readonly ttftMs: number | null;
  readonly tokensPerSec: number | null;
  readonly toolMs: number | null;
  readonly lastRetryReason: string | null;
  readonly rating: 'up' | 'down' | null;
  readonly ratingComment: string | null;
  readonly ratedAt: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly chatMessageId?: string | null;
  readonly userName?: string | null;
  readonly userEmail?: string | null;
}
