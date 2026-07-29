/**
 * Shared AI constants for data channel communication
 */

// ============================================================================
// Message Types (from Python Agent)
// ============================================================================

/**
 * Message type constants for AI data channel messages
 */
export const AI_MESSAGE_TYPES = {
  /** AI action message (contains action and data) */
  AI_ACTION: 'AI_ACTION',
  /** AI controller changed broadcast */
  CONTROLLER_CHANGED: 'ai_controller_changed',
  /** Request to take control from current controller */
  CONTROL_REQUEST: 'ai_control_request',
  /** Transfer control to another participant */
  CONTROL_TRANSFER: 'ai_control_transfer',
  /** Toggle AI voice on/off */
  VOICE_TOGGLE: 'ai_voice_toggle',
} as const;

// ============================================================================
// Action Types
// ============================================================================

/**
 * AI action constants (used in AI_ACTION messages)
 */
export const AI_ACTIONS = {
  /** Invite users to the call */
  INVITE_USER: 'INVITE_USER',
  /** Create a ticket */
  CREATE_TICKET: 'CREATE_TICKET',
} as const;

// ============================================================================
// Data Channel Topics
// ============================================================================

/**
 * LiveKit data channel topic for AI actions
 */
export const AI_DATA_TOPIC = 'ai-actions';

// ============================================================================
// Event Type Constants (for parsed events)
// ============================================================================

/**
 * Parsed event type constants
 */
export const AI_EVENT_TYPES = {
  /** AI invite event */
  AI_INVITE: 'AI_INVITE',
  /** AI create ticket event */
  AI_CREATE_TICKET: 'AI_CREATE_TICKET',
  /** AI controller changed event */
  AI_CONTROLLER_CHANGED: 'AI_CONTROLLER_CHANGED',
  /** AI control request event */
  AI_CONTROL_REQUEST: 'AI_CONTROL_REQUEST',
} as const;
