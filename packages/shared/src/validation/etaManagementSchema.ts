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
  autoRecomputeEnabled: z.boolean(),
  standardPathStageIds: z.array(z.string()),
});

export type BoardEtaManagement = z.infer<typeof boardEtaManagementSchema>;

/**
 * The single source of truth for what an unconfigured board should default
 * to - used both when a board is first created (`boardRepository.createBoard`)
 * and when an existing board with no saved `etaManagement` is read
 * (`parseBoardEtaManagement`'s fallback below). One function shared by both
 * moments in a board's life is what makes it impossible for "a new board of
 * type X" and "a pre-existing board of type X" to silently end up with
 * different automation defaults - every board type defaults to on, for both.
 *
 * `createTicket` and every stage-transition path only ever write `eta` when
 * `autoRecomputeEnabled` is true, so this is what restores every
 * pre-existing board's pre-feature guarantee that a ticket always gets a
 * computed due date, and what keeps a stage-deadline edit or board transfer
 * recalculating it the way it always used to (PRD H1/H2).
 *
 * The tradeoff, accepted deliberately: existing tickets - on every board
 * type, not only linear ones - will have their due date auto-extended
 * (never shortened - see `extendOnly.ts`) the next time a covered mutation
 * touches them, not only new ones. In practice this only has a live effect
 * on DEFAULT and RELEASE boards, which `routeResolution.ts` forecasts
 * identically; NON_LINEAR stays inert until a Standard Path is configured
 * (`standardPathStageIds: []` makes the route NOT_APPLICABLE regardless of
 * this flag), and FLOW stays inert unconditionally (same file).
 *
 * `boardType` stays a parameter - not dropped now that every type resolves
 * the same way - so this remains the one place a future per-type split would
 * be made, rather than reappearing as two independently-maintained checks.
 */
export function defaultAutoRecomputeEnabled(_boardType: string): boolean {
  return true;
}

export function validateBoardEtaManagement(data: unknown) {
  return boardEtaManagementSchema.safeParse(data);
}

/**
 * Tolerant parse: absent or invalid `etaManagement` falls back to no Standard
 * Path and `defaultAutoRecomputeEnabled(boardType)`. `boardType` is required
 * (not optional/defaulted) so a call site can't silently fall back to the
 * wrong automation default for its board by omitting it.
 */
export function parseBoardEtaManagement(metadata: unknown, boardType: string): BoardEtaManagement {
  const fallback: BoardEtaManagement = {
    autoRecomputeEnabled: defaultAutoRecomputeEnabled(boardType),
    standardPathStageIds: [],
  };
  if (metadata === null || typeof metadata !== 'object') {
    return fallback;
  }
  const candidate = (metadata as Record<string, unknown>).etaManagement;
  if (candidate === undefined) {
    return fallback;
  }
  const result = validateBoardEtaManagement(candidate);
  return result.success ? result.data : fallback;
}

/**
 * Merge a patch into `Board.metadata.etaManagement` while preserving every
 * unrelated key already on `Board.metadata` (ticketFormConfig,
 * ticketControlRoleIds, slaPolicyType, ...). Callers write the returned
 * object back as the full `metadata` column value.
 */
export function mergeBoardEtaManagement(
  existingMetadata: unknown,
  boardType: string,
  patch: Partial<BoardEtaManagement>,
): Record<string, unknown> {
  const base =
    existingMetadata !== null && typeof existingMetadata === 'object'
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  const current = parseBoardEtaManagement(existingMetadata, boardType);
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
  acknowledgedAt: z.number().nullable(),
  acknowledgedBy: z.string().nullable(),
  acknowledgmentReason: z.string().nullable(),
});

const etaActivityOutboxEntrySchema = z.object({
  activityType: z.string(),
  /** One of the typed Eta*ActivityValue shapes; see tickets/etaActivityValues.ts. */
  value: z.unknown(),
  /** Attributing user, or null for the workspace ticket bot (automatic rows). */
  actorId: z.string().nullable(),
});

const etaActivityOutboxSchema = z.object({
  at: z.number(),
  entries: z.array(etaActivityOutboxEntrySchema),
});

export type EtaActivityOutboxEntry = z.infer<typeof etaActivityOutboxEntrySchema>;
export type EtaActivityOutbox = z.infer<typeof etaActivityOutboxSchema>;

export const ticketEtaManagementSchema = z.object({
  lastEvaluatedAt: z.number().nullable(),
  pendingActivities: etaActivityOutboxSchema.nullable().default(null),
  forecastStatus: z.enum(forecastStatusValues),
  forecastIncompleteReason: z.string().nullable(),
  forecastIncompleteStageIds: z.array(z.string()),
  activeVisit: activeVisitSchema,
  planningRisk: planningRiskSchema,
});

export type TicketEtaManagementActiveVisit = z.infer<typeof activeVisitSchema>;
export type TicketEtaManagementPlanningRisk = z.infer<typeof planningRiskSchema>;
export type TicketEtaManagement = z.infer<typeof ticketEtaManagementSchema>;

/** Default state for a ticket that has never been evaluated by this feature. */
export const DEFAULT_TICKET_ETA_MANAGEMENT: TicketEtaManagement = {
  lastEvaluatedAt: null,
  pendingActivities: null,
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
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgmentReason: null,
  },
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
