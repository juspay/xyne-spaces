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
 *
 * `subTicketAction` mirrors ReferenceTicketActivityValue's `action`, but cannot share
 * the name: the dashboard merges all activity value shapes into one intersection type,
 * so a second `action` would narrow both to their overlap. Absent means 'created'.
 */
export interface SubticketActivityValue {
  subTicketAction?: 'created' | 'linked' | 'unlinked';
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

