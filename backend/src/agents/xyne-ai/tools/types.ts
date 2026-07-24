/**
 * Types for the remaining Xyne AI integrations.
 *
 * The Ask AI V1 agent-context / streaming / research / citation-mapping types
 * (and their Redis citation constants) that lived here were removed with the
 * agent loop. What remains is consumed by the shared `tools/helpers.ts`
 * citation utilities (`EntityType`) and by `emailService` / `prompts/draft`
 * (`UserInfo`).
 */

// ============================================================================
// User Types
// ============================================================================

/**
 * User information for agent context
 */
export interface UserInfo {
  userId: string;
  userName: string;
  userEmail: string;
}

// ============================================================================
// Entity Types
// ============================================================================

/**
 * Entity type discriminator for different content types.
 * Used by `EnhancedEntityMetadata` (summariser citations) in tools/helpers.ts.
 */
export type EntityType = 'message' | 'attachment' | 'call' | 'recording' | 'canvas' | 'ticket' | 'web_search' | 'email' | 'knowledge_base';
