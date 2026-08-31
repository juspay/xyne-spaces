/**
 * Shared shapes for the awakening pipeline.
 *
 * A WindowEvent is the pipeline's unit of currency: one thing that happened in
 * a watched channel during a window. Collectors produce them, signals score
 * them, the gate counts them, and the renderer writes them to disk as the
 * events.jsonl the agent greps. Adding a new event source means adding a
 * collector that returns these — nothing downstream changes.
 */

import type { AwakeningConfig } from "./config.js";
import type { PriorRun } from "./prior-runs.js";

export interface ResolvedChannel {
  id: string;
  name: string;
  lastActivityAt: number;
}

export interface WindowEvent {
  /** 1-based line number in events.jsonl; assigned by the renderer, not the collector. */
  L: number;
  kind: "message";
  /** ISO timestamp. */
  at: string;
  atMs: number;
  id: string;
  ch: string;
  chName: string;
  cv: string;
  cvTitle: string;
  sender: string;
  senderId: string;
  isHuman: boolean;
  /** True when this event was produced by the awakened agent itself. */
  isMe: boolean;
  root: boolean;
  mentionsMe: boolean;
  /** Last message in its thread within this window AND authored by a human. */
  unanswered: boolean;
  /** True when a prior awakened run in this window already acted on this event. */
  covered: boolean;
  /** Which prior run covered it, for the agent to reference. */
  coveredBy: string | null;
  question: boolean;
  actionSignals: string[];
  edited: boolean;
  chars: number;
  text: string;
}

/** Counts the gate decides on, and the metrics table the agent reads. */
export interface WindowSignals {
  eventCount: number;
  humanEventCount: number;
  botEventCount: number;
  selfEventCount: number;
  distinctSenders: number;
  distinctThreads: number;
  newThreads: number;
  unansweredThreads: number;
  mentionsOfMe: number;
  questions: number;
  actionSignals: number;
  channelsWithActivity: number;
}

export interface AwakeningWindow {
  agentId: string;
  agentSlug: string;
  orgId: string;
  kind: "heartbeat" | "reflex";
  startMs: number;
  endMs: number;
  channels: ResolvedChannel[];
  /** Channels resolved but silent this window — useful negative space for the agent. */
  silentChannels: ResolvedChannel[];
  events: WindowEvent[];
  signals: WindowSignals;
  /** True when the event cap cut the window short. */
  truncated: boolean;
  /** Set when the watermark had to jump forward after an outage. */
  gap: { skippedMs: number } | null;
  /** Awakened runs whose window overlaps this one (requirement 7). */
  priorRuns: PriorRun[];
  config: AwakeningConfig;
}

export type GateOutcome =
  | { decision: "run"; rule: string }
  | { decision: "skip"; rule: string };

/** Auth for reads/writes performed as the agent's Spaces app identity. */
export interface AgentSpacesIdentity {
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  workspaceId: string;
}
