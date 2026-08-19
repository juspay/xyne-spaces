import type { TicketEtaManagement } from '../validation/etaManagementSchema';

/**
 * Shared shape for `Ticket.metadata`. This is the first typed contract for
 * that column - existing callers across the backend read it via ad hoc
 * `as Record<string, unknown>` casts for keys like `flow` (see
 * `FlowTicketMetadata` in apps/backend/src/services/flowCascadeService.ts),
 * `reporterEmail`, `workflowType`, and an external `ticketId`. Those keys are
 * intentionally NOT modeled here (no shared owner today) - the index
 * signature keeps this interface additive rather than forcing a retrofit of
 * every existing consumer.
 *
 * Only `etaManagement` is well-typed here. Every reader/writer of it must go
 * through `parseTicketEtaManagement`/`mergeTicketEtaManagement`
 * (`validation/etaManagementSchema.ts`) rather than touching this field
 * directly, so unrelated sibling keys are never clobbered.
 */
export interface TicketMetadata {
  etaManagement?: TicketEtaManagement;
  [key: string]: unknown;
}
