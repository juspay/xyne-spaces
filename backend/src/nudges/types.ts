import type { NudgeKind, SurfaceAreaType } from '@prisma/client';
import type { ActivityWithRelatedData } from '@/services/userActivityService';

export type NudgeMode = 'explicit' | 'implicit';

// --- Generic activity event payload (the universal nudge trigger) ---

export interface ActivityEventNudgePayload {
  userId: string;
  sessionId: string;
  eventCategory: string;
  eventName: string;
  eventLabel?: string;
  url: string;
  triggerType: string;
  contextMetadata?: Record<string, unknown>;
  platform: string;
  timestamp: Date;
}

// --- Domain-specific payloads (resolved from activity events) ---

export interface MessageNudgePayload {
  messageId: string;
  conversationId: string;
  channelId: string;
  projectId: string;
  senderId: string;
  messageText: string;
  messageCreatedAt: string;
}

// --- Activity history (passed to trigger lookback handlers) ---

export interface ActivityHistoryEvent {
  eventCategory: string;
  eventName: string;
  eventLabel?: string;
  url: string;
  triggerType: string;
  contextMetadata?: Record<string, unknown>;
  platform: string;
  timestamp: Date;
}

export interface ActivityHistoryWindow {
  events: ActivityHistoryEvent[];
  windowMinutes: number;
  userId: string;
}

// --- Nudge definition contract ---

export interface NudgeTrigger {
  /**
   * Events this definition subscribes to (used by registry for pre-filtering).
   * Format: 'EVENT_CATEGORY.EVENT_NAME', e.g. 'MESSAGE.SENT', 'TICKET.CREATED'
   * The final event in a sequence should be listed here.
   */
  subscribesTo: string[];

  /**
   * Optional handler that receives the triggering event and recent activity history.
   * Use this for:
   * - Event sequence matching (e.g., TICKET.CREATED followed by MESSAGE.SENT)
   * - Domain-specific eligibility checks (e.g., is this a parent message?)
   * - Any custom gating logic
   *
   * If omitted, the definition triggers on any subscribesTo match.
   */
  lookbackHandler?(
    event: ActivityEventNudgePayload,
    history: ActivityHistoryWindow,
  ): Promise<boolean> | boolean;
}

export interface NudgeCandidate {
  title: string;
  description: string;
  priority?: string;
  actions?: Record<string, unknown>;
  visibleTo?: string;
}

// --- Build context runtime (injected by engine into definitions) ---

export interface NudgeBuildContextRuntime {
  event: ActivityEventNudgePayload;
  enrichedActivity: ActivityWithRelatedData;
  messagePayload?: MessageNudgePayload;
}

export interface NudgeEvaluationContext {
  triggerEvent: ActivityEventNudgePayload;
  enrichedActivity: ActivityWithRelatedData;
  source: {
    sourceId: string | null;
    projectId: string | null;
    sourceType?: SurfaceAreaType;
  };
  activityContext: ActivityContextOutput;
  data?: Record<string, unknown>;
}

export interface MessageNudgeEvaluationContext extends NudgeEvaluationContext {
  message: MessageNudgePayload;
  threadMessages: Array<{
    messageId: string;
    content: string;
    senderId: string;
    createdAt: Date;
  }>;
  projectTags: string[];
}

export interface NudgeDefinition<
  TPayload = MessageNudgePayload,
  TContext extends NudgeEvaluationContext = NudgeEvaluationContext,
> {
  kind: NudgeKind;
  mode: NudgeMode;
  trigger: NudgeTrigger;
  direction: { from: SurfaceAreaType; to: SurfaceAreaType };
  priority?: string;

  buildContext(
    payload: TPayload,
    activityContext: ActivityContextOutput,
    runtime: NudgeBuildContextRuntime,
  ): Promise<TContext>;
  evaluate(context: TContext, payload: TPayload): Promise<NudgeCandidate[]>;
  postProcess?(candidates: NudgeCandidate[], payload: TPayload): Promise<NudgeCandidate[]>;
}

// --- Activity Context Resolver types ---

export interface ActivityContextResolverInput {
  actor: {
    userId: string;
    projectId: string | null;
  };
  trigger: {
    eventCategory: string;
    eventName: string;
    timestamp: string;
    messageId?: string;
    conversationId?: string;
    channelId?: string;
    messageText?: string;
  };
  options: {
    lookbackMinutes: number;
    maxEvents: number;
    allowedCategories?: string[];
    allowedPlatforms?: Array<'WEB' | 'ELECTRON' | 'MOBILE'>;
    includeRawEvents?: boolean;
  };
}

export interface ActivityContextOutput {
  version: 'v1';
  generatedAt: string;
  source: {
    userId: string;
    projectId: string | null;
    triggerEntityId: string;
  };
  window: {
    from: string;
    to: string;
    lookbackMinutes: number;
  };
  stats: {
    fetchedEvents: number;
    keptEvents: number;
    droppedEvents: number;
    droppedReasonCounts: Record<string, number>;
  };
  recentActions: Array<{
    ts: string;
    category: string;
    name: string;
    label?: string;
    url?: string;
    platform: 'WEB' | 'ELECTRON' | 'MOBILE';
    triggerType: string;
    confidence: number;
  }>;
  topEntities: Array<{
    surfaceType: 'MESSAGE' | 'TICKET' | 'CANVAS' | 'CALL' | 'CONVERSATION' | 'CHANNEL';
    id: string;
    confidence: number;
    evidence: Array<{ ts: string; reason: string }>;
    lastSeenAt: string;
    hitCount: number;
  }>;
  signals: {
    activeChannelIds: string[];
    activeConversationIds: string[];
    probableIntentTags: string[];
    hasStrongEntityContext: boolean;
  };
  promptHints: string[];
}

export const EMPTY_ACTIVITY_CONTEXT: ActivityContextOutput = {
  version: 'v1',
  generatedAt: new Date().toISOString(),
  source: { userId: '', projectId: null, triggerEntityId: '' },
  window: { from: '', to: '', lookbackMinutes: 0 },
  stats: { fetchedEvents: 0, keptEvents: 0, droppedEvents: 0, droppedReasonCounts: {} },
  recentActions: [],
  topEntities: [],
  signals: {
    activeChannelIds: [],
    activeConversationIds: [],
    probableIntentTags: [],
    hasStrongEntityContext: false,
  },
  promptHints: [],
};
