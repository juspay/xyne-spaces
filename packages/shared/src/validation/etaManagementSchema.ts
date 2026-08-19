import { z } from 'zod';

// ============================================================================
// BOARD ETA MANAGEMENT (stored in Board.metadata.etaManagement)
//
// Configuration + versioning for the "Ticket ETA Risk Detection and
// Automatic Recalculation" feature. Stored as a JSON subtree so it requires
// no schema migration; every reader/writer must go through the parse/merge
// helpers below rather than casting the raw column.
// ============================================================================

export const boardEtaManagementSchema = z.object({
  schemaVersion: z.literal(1),
  autoRecomputeEnabled: z.boolean(),
  standardPathStageIds: z.array(z.string()),
  configVersion: z.number().int().nonnegative(),
  updatedAt: z.number(),
  updatedBy: z.string(),
});

export type BoardEtaManagement = z.infer<typeof boardEtaManagementSchema>;

/**
 * A board with no `etaManagement` key (or an unparseable one) is treated as
 * configVersion 0, no Standard Path, automation disabled. This lets existing
 * boards keep their current behavior with zero metadata backfill - only
 * boards that explicitly opt in via the board-settings mutator get a real
 * `etaManagement` object.
 */
export const DEFAULT_BOARD_ETA_MANAGEMENT: BoardEtaManagement = {
  schemaVersion: 1,
  autoRecomputeEnabled: false,
  standardPathStageIds: [],
  configVersion: 0,
  updatedAt: 0,
  updatedBy: 'system',
};

export function validateBoardEtaManagement(data: unknown) {
  return boardEtaManagementSchema.safeParse(data);
}

/** Tolerant parse: absent or invalid `etaManagement` falls back to the documented defaults. */
export function parseBoardEtaManagement(metadata: unknown): BoardEtaManagement {
  if (metadata === null || typeof metadata !== 'object') {
    return DEFAULT_BOARD_ETA_MANAGEMENT;
  }
  const candidate = (metadata as Record<string, unknown>).etaManagement;
  if (candidate === undefined) {
    return DEFAULT_BOARD_ETA_MANAGEMENT;
  }
  const result = validateBoardEtaManagement(candidate);
  return result.success ? result.data : DEFAULT_BOARD_ETA_MANAGEMENT;
}

/**
 * Merge a patch into `Board.metadata.etaManagement` while preserving every
 * unrelated key already on `Board.metadata` (ticketFormConfig,
 * ticketControlRoleIds, slaPolicyType, ...). Callers write the returned
 * object back as the full `metadata` column value.
 */
export function mergeBoardEtaManagement(
  existingMetadata: unknown,
  patch: Partial<BoardEtaManagement>,
): Record<string, unknown> {
  const base =
    existingMetadata !== null && typeof existingMetadata === 'object'
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  const current = parseBoardEtaManagement(existingMetadata);
  base.etaManagement = { ...current, ...patch } satisfies BoardEtaManagement;
  return base;
}

// ============================================================================
// TICKET ETA MANAGEMENT (stored in Ticket.metadata.etaManagement)
//
// Only the CURRENT forecast/risk state lives here. Full history stays in
// TicketActivity rows (see packages/shared/src/tickets/etaActivityValues.ts)
// so this JSON subtree stays small and bounded.
// ============================================================================

export const forecastStatusValues = ['COMPLETE', 'INCOMPLETE', 'NOT_APPLICABLE'] as const;
export const estimateSourceValues = [
  'STAGE_DEFAULT',
  'TRANSITION_FIXED',
  'MANUAL',
  'LEGACY_INFERRED',
] as const;
export const planningRiskStateValues = ['NONE', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'] as const;

export type ForecastStatus = (typeof forecastStatusValues)[number];
export type EstimateSource = (typeof estimateSourceValues)[number];
export type PlanningRiskState = (typeof planningRiskStateValues)[number];

const activeVisitSchema = z.object({
  stageVisitId: z.string().nullable(),
  transitionId: z.string().nullable(),
  /**
   * Distinguishes a genuine tracked deadline from the existing no-SLA
   * placeholder, where `TicketStageEta.stageEta` is stored equal to
   * `stageEnteredAt` because the column is non-nullable. Must never be
   * inferred purely from "is stageEta in the future" - the evaluator that
   * builds this value owns that decision.
   */
  deadlineTracked: z.boolean(),
  estimateSource: z.enum(estimateSourceValues),
  estimateHours: z.number().nullable(),
});

const planningRiskSchema = z.object({
  state: z.enum(planningRiskStateValues),
  fingerprint: z.string().nullable(),
  detectedAt: z.number().nullable(),
  stageVisitId: z.string().nullable(),
  stageEta: z.number().nullable(),
  ticketEta: z.number().nullable(),
  boardConfigVersion: z.number().int().nullable(),
  acknowledgedAt: z.number().nullable(),
  acknowledgedBy: z.string().nullable(),
  acknowledgmentReason: z.string().nullable(),
});

/**
 * Tracks an in-progress deviation from the board's Standard Path (NON_LINEAR only).
 * Populated when the ticket's current stage isn't on the configured path; cleared when it
 * returns. Kept as cheap ticket-level state rather than reconstructed from TicketActivity
 * history on every evaluation, since return-handling needs "off-path since" on every stage
 * move while deviated, not just once at return time.
 */
const deviationSchema = z.object({
  /** Epoch ms - when the ticket first moved off the Standard Path this deviation. */
  startedAt: z.number(),
  /** Every off-path stage id visited during this deviation, in visit order (may repeat). */
  offPathStageIds: z.array(z.string()),
});

export type TicketEtaManagementDeviation = z.infer<typeof deviationSchema>;

export const ticketEtaManagementSchema = z.object({
  schemaVersion: z.literal(1),
  lastEvaluatedAt: z.number().nullable(),
  lastBoardConfigVersion: z.number().int().nullable(),
  forecastStatus: z.enum(forecastStatusValues),
  forecastIncompleteReason: z.string().nullable(),
  forecastIncompleteStageIds: z.array(z.string()),
  activeVisit: activeVisitSchema,
  planningRisk: planningRiskSchema,
  /** Null when not currently deviated from the Standard Path. */
  deviation: deviationSchema.nullable(),
});

export type TicketEtaManagementActiveVisit = z.infer<typeof activeVisitSchema>;
export type TicketEtaManagementPlanningRisk = z.infer<typeof planningRiskSchema>;
export type TicketEtaManagement = z.infer<typeof ticketEtaManagementSchema>;

/** Default state for a ticket that has never been evaluated by this feature. */
export const DEFAULT_TICKET_ETA_MANAGEMENT: TicketEtaManagement = {
  schemaVersion: 1,
  lastEvaluatedAt: null,
  lastBoardConfigVersion: null,
  forecastStatus: 'NOT_APPLICABLE',
  forecastIncompleteReason: null,
  forecastIncompleteStageIds: [],
  activeVisit: {
    stageVisitId: null,
    transitionId: null,
    deadlineTracked: false,
    estimateSource: 'LEGACY_INFERRED',
    estimateHours: null,
  },
  planningRisk: {
    state: 'NONE',
    fingerprint: null,
    detectedAt: null,
    stageVisitId: null,
    stageEta: null,
    ticketEta: null,
    boardConfigVersion: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgmentReason: null,
  },
  deviation: null,
};

export function validateTicketEtaManagement(data: unknown) {
  return ticketEtaManagementSchema.safeParse(data);
}

/** Tolerant parse: absent or invalid `etaManagement` falls back to the documented defaults. */
export function parseTicketEtaManagement(metadata: unknown): TicketEtaManagement {
  if (metadata === null || typeof metadata !== 'object') {
    return DEFAULT_TICKET_ETA_MANAGEMENT;
  }
  const candidate = (metadata as Record<string, unknown>).etaManagement;
  if (candidate === undefined) {
    return DEFAULT_TICKET_ETA_MANAGEMENT;
  }
  const result = validateTicketEtaManagement(candidate);
  return result.success ? result.data : DEFAULT_TICKET_ETA_MANAGEMENT;
}

/**
 * Merge a patch into `Ticket.metadata.etaManagement` while preserving every
 * unrelated key already on `Ticket.metadata` (flow, reporterEmail,
 * workflowType, ...). `activeVisit`/`planningRisk` are merged one level deep
 * so a single-field patch (e.g. just `planningRisk.state`) doesn't clobber
 * untouched sibling fields on the same nested object.
 */
export function mergeTicketEtaManagement(
  existingMetadata: unknown,
  patch: Partial<Omit<TicketEtaManagement, 'activeVisit' | 'planningRisk'>> & {
    activeVisit?: Partial<TicketEtaManagementActiveVisit>;
    planningRisk?: Partial<TicketEtaManagementPlanningRisk>;
  },
): Record<string, unknown> {
  const base =
    existingMetadata !== null && typeof existingMetadata === 'object'
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  const current = parseTicketEtaManagement(existingMetadata);
  const merged: TicketEtaManagement = {
    ...current,
    ...patch,
    activeVisit: { ...current.activeVisit, ...(patch.activeVisit ?? {}) },
    planningRisk: { ...current.planningRisk, ...(patch.planningRisk ?? {}) },
  };
  base.etaManagement = merged;
  return base;
}

export function formatEtaManagementValidationErrors(result: {
  success: false;
  error: z.ZodError;
}): string[] {
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}
