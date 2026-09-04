import type { Logger } from "../../logger.js";
import type { ResolvedAgent } from "../digital-twin-agent.js";
import type { ProviderOverride } from "../parseSlashCommand.js";

export interface StopReconcileResult {
  stopped: number;
  cleaned: number;
  queued: number;
  hadRunningRows: boolean;
}

export interface WebhookCommandPayload {
  conversationId: string;
  channelId: string;
  userId: string;
}

export interface WebhookCommandCtx {
  agent: ResolvedAgent;
  payload: WebhookCommandPayload;
  log: Logger;
  userText: string;
  taskCommandText: string;
  immediateTaskCommand: boolean;
  autoGoalEnabled: boolean;
  reply: (markdownText: string, failureLabel: string) => Promise<void>;
  reconcileStoppedRuns: (
    conversationId: string,
    fallbackAgentSlug: string,
  ) => Promise<StopReconcileResult>;
}

export interface PendingGoalStart {
  condition: string;
  providerOverride?: ProviderOverride;
}

export type CommandOutcome =
  | { kind: "handled" }
  | {
      kind: "dispatch";
      task: string;
      compactBeforeRun: boolean;
      explicitQueueOnly: boolean;
      pendingGoalStart: PendingGoalStart | null;
    };
