/**
 * Shared types for ticket activity
 */

import { PRStatusEvent } from '../zero/schema';

// Re-export for convenience
export { PRStatusEvent };

/**
 * PR Activity Value - used for ActivityType.PR
 * Aligns with BaseActivityValue for stage changes (field, oldValue, newValue)
 */
export interface PRActivityValue {
  action?: string;  // Human-readable action text: 'raised', 'updated', 'merged', 'declined'
  prId?: number;
  prUrl?: string;
  repoName?: string;
  sourceBranch?: string;
  destinationBranch?: string;
  authorName?: string;
  authorEmail?: string;
  // Stage change - aligned with BaseActivityValue
  field?: string;
  oldValue?: string;
  newValue?: string;
  oldTicketStatus?: string;
  newTicketStatus?: string;
  remainingOpenPRs?: number;
}

/**
 * Reference Ticket Activity Value - used for ActivityType.REFERENCE_TICKET
 */
export interface ReferenceTicketActivityValue {
  action?: 'created' | 'updated' | 'removed';
  relationType?: string; // TicketReferenceRelation from schema
  oldRelationType?: string;
  targetTicketId?: string;
  targetTicketTitle?: string | null;
  targetTicketXyneId?: string | null;
}

/**
 * Subticket Activity Value - used for ActivityType.SUBTICKET_CREATED
 */
export interface SubticketActivityValue {
  subTicketId?: string;
  subTicketTitle?: string;
  subTicketXyneId?: string;
}

/**
 * Base Activity Value - common fields for other activity types
 */
export interface BaseActivityValue {
  field?: string;
  oldValue?: string;
  newValue?: string;
  action?: string;
}

