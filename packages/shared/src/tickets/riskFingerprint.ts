/**
 * Deterministic identity of a planning-risk condition's inputs. Used both by
 * the immediate evaluation path (domain service, on every mutation) and the
 * hourly reconciliation worker so risk-state transitions never drift between
 * the two - both must always compute the exact same fingerprint for the
 * same inputs.
 *
 * Deliberately a plain, synchronous, non-cryptographic hash (FNV-1a): this
 * is an equality/dedup key, not a security boundary, and staying
 * synchronous keeps the risk-evaluation pure functions synchronous too.
 * Inputs are IDs, timestamps, a status string, and a version number only -
 * no personal data, per the PRD's fingerprint requirement.
 */

export interface RiskFingerprintInput {
  ticketId: string;
  /** Active TicketStageEta.id at evaluation time. */
  activeStageVisitId: string;
  /** Stage deadline, epoch ms. */
  stageEta: number;
  /** Ticket due date, epoch ms. */
  ticketEta: number;
  ticketStatus: string;
  boardConfigVersion: number;
}

const MAX_HASH_INPUT_LENGTH = 1024;

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  const length = Math.min(input.length, MAX_HASH_INPUT_LENGTH);
  for (let i = 0; i < length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const FINGERPRINT_VERSION = 'v1';

export function computeRiskFingerprint(input: RiskFingerprintInput): string {
  const canonical = [
    input.ticketId,
    input.activeStageVisitId,
    String(input.stageEta),
    String(input.ticketEta),
    input.ticketStatus,
    String(input.boardConfigVersion),
  ].join('|');
  return `${FINGERPRINT_VERSION}:${fnv1a(canonical)}`;
}
