export enum MigrationType {
  DM = 'DM',            // DMs + group DMs — token-based, per person, one-time
  CHANNEL = 'CHANNEL',  // channels — form-based, central token, re-migratable
}

export enum MigrationStatus {
  SUBMITTED = 'SUBMITTED',
  QUEUED = 'QUEUED',
  COLLECTING = 'COLLECTING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  INGESTING = 'INGESTING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
}

export enum QueueName {
  COLLECTION = 'slack-migration-collection',
  INGESTION = 'slack-migration-ingestion',
  CONV_INGEST = 'slack-migration-conv-ingest', // fan-out: one job per conversation, drained by all worker processes in parallel
}

export interface Checkpoint {
  totalConversations: number;
  collectedConversationIds: string[];
  ingestedConversationIds: string[];
}

export interface ChannelInput {
  slackChannelId: string;
  xyneChannelId: string;
  startDate?: string;
  announceInSlack?: boolean;
}

/** A conversation that couldn't be fully collected — surfaced so a partial migration isn't shown as complete. */
export interface MigrationIssue {
  conversationId: string;
  kind: 'skipped' | 'truncated' | 'ingest-error';
  reason: string;
  label?: string; // human-readable conversation identifier captured at issue time (e.g. "DM with Jane Doe" / "#general")
}

export interface MigrationJob {
  id: string;
  type: MigrationType;
  status: MigrationStatus;
  currentQueue: QueueName;
  workspaceId: string;
  submittedByUserId: string;
  submittedByName?: string;
  teamId: string;
  ownerSlackId?: string;
  gcsPrefix: string;
  encryptedToken?: string;       // DM: cleared once collection completes; never logged/exported
  channelInput?: ChannelInput;
  slackChannelName?: string;
  xyneChannelName?: string;
  slackChannelCreator?: string; // Slack channel creator's user id → Xyne channel ADMIN
  slackChannelCreated?: number; // creation unix ts (secs) — lower bound for collection progress
  channelProgress?: { start: number; end: number; through: number }; // epoch secs: window [start,end] + oldest collected
  checkpoint: Checkpoint;
  ingestedCount?: number;       // parallel ingest: count of conversations done, tracked atomically (Redis SET) instead of the checkpoint array
  ingestStartedAt?: number;     // when ingestion first began (planner set INGESTING) — with completedAt gives the ingest duration
  stats: { conversations: number; messages: number };
  stopRequested: boolean;
  stopReason?: 'admin' | 'system';
  heartbeatAt: number;          // liveness: bumped by the heartbeat ticker AND every write
  progressAt?: number;          // forward progress: bumped only when a page/conversation actually advances — drives the stall watchdog
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  issues?: MigrationIssue[]; // conversations that couldn't be fully collected (Slack-side)
}

/** Public projection — never carries the token. */
export interface MigrationJobView {
  id: string;
  type: MigrationType;
  status: MigrationStatus;
  phase: 'collect' | 'ingest';
  stopRequested: boolean;
  stopReason?: 'admin' | 'system';
  submittedByUserId: string;
  submittedByName?: string;
  stats: { conversations: number; messages: number };
  progress: { total: number; collected: number; ingested: number };
  channel?: { slackId: string; xyneId: string; slackName?: string; xyneName?: string; startDate?: string; announceInSlack?: boolean; windowStart?: number; windowEnd?: number; collectedThrough?: number };
  issues?: MigrationIssue[];
  heartbeatAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  ingestStartedAt?: number;
  ingestDurationMs?: number; // completedAt − ingestStartedAt when both present — "how long ingestion took"
  error?: string;
}

export const toView = (j: MigrationJob): MigrationJobView => ({
  id: j.id,
  type: j.type,
  status: j.status,
  phase: j.currentQueue === QueueName.INGESTION ? 'ingest' : 'collect',
  stopRequested: j.stopRequested,
  stopReason: j.stopReason,
  submittedByUserId: j.submittedByUserId,
  submittedByName: j.submittedByName,
  stats: j.stats,
  progress: {
    total: j.checkpoint.totalConversations,
    collected: j.checkpoint.collectedConversationIds.length,
    ingested: j.ingestedCount ?? j.checkpoint.ingestedConversationIds.length,
  },
  channel: j.type === MigrationType.CHANNEL && j.channelInput ? {
    slackId: j.channelInput.slackChannelId,
    xyneId: j.channelInput.xyneChannelId,
    slackName: j.slackChannelName,
    xyneName: j.xyneChannelName,
    startDate: j.channelInput.startDate,
    announceInSlack: j.channelInput.announceInSlack,
    windowStart: j.channelProgress?.start,
    windowEnd: j.channelProgress?.end,
    collectedThrough: j.channelProgress?.through,
  } : undefined,
  heartbeatAt: j.heartbeatAt,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
  completedAt: j.completedAt,
  ingestStartedAt: j.ingestStartedAt,
  ingestDurationMs: j.ingestStartedAt && j.completedAt ? j.completedAt - j.ingestStartedAt : undefined,
  error: j.error,
  issues: j.issues,
});
