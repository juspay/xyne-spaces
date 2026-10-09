import type { Logger } from "../../logger.js";
import type { ChannelDeliveryTarget } from "../../surfaces/messaging/plugin.js";
import type { ResolvedAgent } from "../resolved-agent.js";
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
  isTwin: boolean;
  reply: (markdownText: string, failureLabel: string) => Promise<void>;
  /** Post a generated file (an HTML trace, a findings bundle) where the
   *  command was typed: a Spaces file message, or a chat document or link. */
  attach: (file: { fileName: string; mimeType: string; content: string | Buffer; summary: string }) => Promise<void>;
  /** Set when the command came from a messaging chat (WhatsApp …) rather than
   *  a Spaces thread. There is no Spaces app identity then — `agent.appToken`
   *  is empty — so anything that would post through Spaces goes here instead. */
  channelDelivery?: ChannelDeliveryTarget;
  reconcileStoppedRuns: (
    conversationId: string,
    targetAgentSlug: string,
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
