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
}

export interface DigitalTwinStatus {
  enabled: boolean;
  enabledAt: string | null;
  backfillState: Record<string, DigitalTwinBackfillEntry> | null;
  pendingCandidates: number;
  totalCandidates: number;
  approvedCandidates: number;
  mdFileCount: number;
  /** Optional suffix the user has configured. Empty string when unset. */
  responseSuffix: string;
  /** "manual" (review queue) or "auto" (retain high-confidence candidates). */
  memoryApprovalMode: string;
  /** Min curator confidence (0–1) required to auto-approve a candidate. */
  memoryAutoApproveMinScore: number;
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

// ── Memory Bank (Hindsight) family ────────────────────────────────────────────

export interface MemoryBankMemory {
  id: string;
  hindsightMemoryId: string;
  category: string | null;
  content: string;
  curatorReasoning: string | null;
  curatorConfidence: number | null;
  createdAt: string;
  recallHits7d: number;
  lastRecalledAt: string | null;
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
