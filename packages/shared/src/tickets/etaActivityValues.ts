/**
 * Stored-`value` JSON contracts for the `ActivityType.ETA_*` TicketActivity
 * rows (packages/shared/src/zero/types.ts `ActivityType`). One interface per
 * type, matching the PRD's audit-trail field list. Timestamps are epoch ms
 * (consistent with `TicketEtaManagement`/`BoardEtaManagement`), not ISO
 * strings, so these values round-trip through `Json` columns without a
 * serialization layer.
 *
 * Every write of one of these activity types must use the matching
 * interface below rather than an ad hoc object literal, so the Prisma
 * (`recordTicketTimelineEvent`) and Zero (`tx.mutate.ticket_activities`)
 * write paths stay byte-for-byte consistent with each other.
 */

export type EtaChangeTrigger =
  | 'CREATE'
  | 'STAGE_TRANSITION'
  | 'MANUAL_STAGE_DEADLINE'
  | 'MANUAL_DUE_DATE'
  | 'RESUME'
  | 'TERMINAL_ENTRY'
  | 'TERMINAL_EXIT'
  | 'RECONCILIATION';

/** ActivityType.ETA_AUTO_RECOMPUTED */
export interface EtaAutoRecomputedActivityValue {
  trigger: EtaChangeTrigger;
  oldEta: number | null;
  forecastEta: number;
  finalEta: number;
  stageVisitId: string | null;
  /** Set when a Standard Path was used to build the forecast route. */
  standardPathUsed: boolean;
  systemReason: string;
}

/** ActivityType.ETA_MANUALLY_UPDATED */
export interface EtaManuallyUpdatedActivityValue {
  oldEta: number | null;
  newEta: number;
  reason: string;
  actingUserId: string;
}

/** ActivityType.ETA_RISK_DETECTED */
export interface EtaRiskDetectedActivityValue {
  fingerprint: string;
  stageEta: number;
  ticketEta: number;
  stageId: string;
  stageVisitId: string;
}

/** ActivityType.ETA_RISK_ACKNOWLEDGED */
export interface EtaRiskAcknowledgedActivityValue {
  fingerprint: string;
  reason: string;
  acknowledgedBy: string;
  acknowledgedAt: number;
}

/** ActivityType.ETA_RISK_REOPENED */
export interface EtaRiskReopenedActivityValue {
  previousFingerprint: string | null;
  newFingerprint: string;
  /** Which fingerprint inputs changed, e.g. ["stageEta", "ticketStatus"]. */
  changedInputs: string[];
}

export type EtaRiskResolutionCause =
  | 'CONDITION_NO_LONGER_TRUE'
  | 'TERMINAL_STATUS'
  | 'MANUAL_DATE_CHANGE';

/** ActivityType.ETA_RISK_RESOLVED */
export interface EtaRiskResolvedActivityValue {
  fingerprint: string;
  cause: EtaRiskResolutionCause;
}

