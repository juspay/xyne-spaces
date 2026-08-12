// Types for the per-user Digital Twin feature. Ported verbatim from the
// reference app (xyne-claw-auth/frontend/src/lib/api.ts) so the shapes match the
// claw-auth backend exactly. Two endpoint families:
//   - control  (`/api/v1/digital-twin/...`, x-user-id header, {success,data})
//   - memory-bank / Hindsight (`/api/v1/memory/banks/digital-twin/...`, cookie
//     auth + `?userTag=user:<id>` query)

// ── Control family ────────────────────────────────────────────────────────────

export interface DigitalTwinBackfillEntry {
  from: string;
  to: string;
  cursor: string;
  complete: boolean;
  progress?: {
    windowsTotal: number;
    windowsDone: number;
    recordsSeen: number;
    candidatesMade: number;
    currentWindow: { from: string; to: string } | null;
    lastError: { message: string; windowUpper: string; at: string } | null;
    startedAt: string;
    updatedAt: string;
  };
}

export interface DigitalTwinBackfillSourceProgress {
  complete: boolean;
  paused?: boolean;
  pausedAt?: string | null;
  windowsDone: number | null;
  windowsTotal: number | null;
  recordsSeen: number | null;
  candidatesMade: number | null;
  currentWindow: { from: string; to: string } | null;
  pctByWindows: number | null;
  pctByTime: number | null;
  lastError: { message: string; windowUpper: string; at: string } | null;
  job: {
    state: string;
    attemptsMade: number;
    maxAttempts: number;
    failedReason: string | null;
  } | null;
}

export interface DigitalTwinBackfillBlock {
  overall: {
    running: boolean;
    paused: boolean;
    stalled: boolean;
    windowsDone: number;
    windowsTotal: number;
    recordsSeen: number;
    candidatesMade: number;
    pctByWindows: number | null;
    updatedAt: string | null;
  };
  sources: Record<string, DigitalTwinBackfillSourceProgress>;
}

export interface DigitalTwinStatus {
  enabled: boolean;
  enabledAt: string | null;
  backfillState: Record<string, DigitalTwinBackfillEntry> | null;
  /** Server-normalized progress and stall state. Prefer this over cursor math. */
  backfill?: DigitalTwinBackfillBlock | null;
  pendingCandidates: number;
  totalCandidates: number;
  approvedCandidates: number;
  memoryCount?: number;
  memoryDeleteInProgress?: boolean;
  mdFileCount: number;
  /** Optional suffix the user has configured. Empty string when unset. */
  responseSuffix: string;
  /** "manual" (review queue) or "auto" (retain high-confidence candidates). */
  memoryApprovalMode: string;
  /** Min curator confidence (0–1) required to auto-approve a candidate. */
  memoryAutoApproveMinScore: number;
  /** Whether every mention receives a reply or learned behavior decides. */
  respondPolicy?: 'always' | 'learned';
}

export interface DigitalTwinEstimate {
  messages: number;
  calls: number;
  canvases: number;
  totalRecords: number;
  estCandidates: number;
  estCostUSD: number;
}

export interface DigitalTwinClusterPreview {
  subsystem: string;
  pending: number;
  top3: Array<{ id: string; text: string; signalScore: number }>;
}

export interface DigitalTwinCandidate {
  id: string;
  subsystem: string;
  /** Human-readable proposal title. Older API responses may omit it. */
  title?: string;
  text: string;
  editedText: string | null;
  sourceRefs: Array<{
    type: 'message' | 'call' | 'canvas';
    id: string;
    channelId?: string;
    ts: string;
  }>;
  signalScore: number;
  status: 'pending' | 'approved' | 'rejected';
  source: string;
  createdAt: string;
}

export interface DigitalTwinSubsystemMetric {
  subsystem: string;
  approved: number;
  rejected: number;
  pending: number;
}

export interface DigitalTwinSourceMetric {
  source: string;
  approved: number;
  rejected: number;
}

export interface DigitalTwinMetrics {
  total: number;
  approvedClean: number;
  approvedEdited: number;
  totalApproved: number;
  rejected: number;
  pending: number;
  approvalRate: number | null;
  editRate: number | null;
  previousApprovalRate: number | null;
  previousEditRate: number | null;
  bySubsystem: DigitalTwinSubsystemMetric[];
  bySource: DigitalTwinSourceMetric[];
  oldestPendingDays: number | null;
  addedSinceYesterday: number;
  recallPrecision: number | null;
  recallRatedCount: number;
}

// ── Persona files ─────────────────────────────────────────────────────────────

export interface DigitalTwinMemoryFile {
  id: string;
  name: string;
  content: string;
  loadInPrompt: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface DigitalTwinMemoryFilesResponse {
  files: DigitalTwinMemoryFile[];
  maxLoaded: number;
  maxChars: number;
}

// ── Pipeline activity ─────────────────────────────────────────────────────────

export interface PipelineRecordPreview {
  id: string;
  type: string;
  ts: string;
  channelId?: string;
  channelName?: string;
  title?: string;
  textPreview: string;
}

export interface PipelineEventSummary {
  id: string;
  createdAt: string;
  runType: string;
  source: string;
  sourceKind: string | null;
  windowFrom: string;
  windowTo: string;
  status: string;
  recordCount: number;
  existingMemoryCount: number;
  emittedCount: number;
  keptCount: number;
  candidatesCreated: number;
  autoApproved: number;
  durationMs: number;
  error: string | null;
  hasTrace: boolean;
  approvedCount?: number;
  pendingCount?: number;
  rejectedCount?: number;
}

export interface PipelineEventDetail extends PipelineEventSummary {
  records: PipelineRecordPreview[] | null;
  /** Trace shapes vary by curator, persona synthesis, and response-gate runs. */
  trace: Record<string, unknown> | null;
}

export interface PipelineEventsPage {
  events: PipelineEventSummary[];
  nextBefore: string | null;
}

export interface PipelineEventFilters {
  limit?: number;
  before?: string;
  runType?: string;
  status?: string;
  sourceKind?: string;
}

// ── Memory Bank (Hindsight) family ────────────────────────────────────────────

export interface MemoryBankMemory {
  id: string;
  hindsightMemoryId: string;
  /** Human-readable label. Older memory-bank records may not provide one. */
  title?: string;
  category: string | null;
  content: string;
  curatorReasoning: string | null;
  curatorConfidence: number | null;
  createdAt: string;
  recallHits7d: number;
  lastRecalledAt: string | null;
  pipelineEventId?: string | null;
  tags?: string[];
}

export interface MemoryBankStats {
  range: string;
  totals: {
    approved: number;
    pending: number;
    recallsInRange: number;
  };
  hot: Array<{
    hindsightMemoryId: string;
    title?: string;
    hits: number;
    lastRecalledAt: string | null;
    content: string;
    category: string | null;
    status: string | null;
    createdAt: string | null;
  }>;
}

export interface RecallResult {
  id?: string;
  text?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- backend response key
  fact_type?: string;
  score?: number;
  tags?: string[];
}

export interface DigitalTwinSubsystemNode {
  name: string;
  memoryCount: number;
  sessionCount: number;
  sampleContent: string;
  lastUpdated: string | null;
}

export interface DigitalTwinSubsystemEdge {
  source: string;
  target: string;
  sharedSessions: number;
}

export type MemoryRange = '7d' | '30d' | '90d';
