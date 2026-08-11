/**
 * Shared AI types for communication between native and web clients
 * These types define the data channel message formats used for AI assistant features
 */

// ============================================================================
// AI Action Types (from Python Agent)
// ============================================================================

/**
 * Supported AI action types that the Python agent can send
 */
export type AIActionType = 'INVITE_USER' | 'CREATE_TICKET';

/**
 * User info for invite actions
 */
export interface AIInviteUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Data payload for INVITE_USER action
 */
export interface AIInviteUserData {
  users: AIInviteUser[];
  suggestedMessage?: string;
}

/**
 * Data payload for CREATE_TICKET action
 */
export interface AICreateTicketData {
  title: string;
  description: string;
  assignedToName?: string;
  boardId?: string;
}

/**
 * AI Action message from Python agent
 */
export interface AIActionMessage {
  type: 'AI_ACTION';
  action: AIActionType;
  data?: AIInviteUserData | AICreateTicketData;
}

// ============================================================================
// AI Control Types (controller management)
// ============================================================================

/**
 * AI controller changed event
 */
export interface AIControllerChangedMessage {
  type: 'ai_controller_changed';
  controller: string | null;
  controllerName: string | null;
}

/**
 * AI control request event (from participant wanting control)
 */
export interface AIControlRequestMessage {
  type: 'ai_control_request';
  requester_id: string;
  requester_name: string;
}

/**
 * AI control transfer event (from current controller)
 */
export interface AIControlTransferMessage {
  type: 'ai_control_transfer';
  new_controller_id: string;
  new_controller_name: string;
}

/**
 * AI control request denied event (from current controller)
 */
export interface AIControlRequestDeniedMessage {
  type: 'ai_control_request_denied';
  requester_id: string;
}

/**
 * AI voice toggle event (enable/disable AI)
 */
export interface AIVoiceToggleMessage {
  type: 'ai_voice_toggle';
  enabled: boolean;
  participantId: string;
  participantName: string;
}

/**
 * Transcription toggle event (host enables/disables the transcription agent mid-call).
 * When `enabled` is false the still-in-room agent unsubscribes from audio and stops
 * writing any transcript sinks; `at` is the epoch-ms cutoff for the pause.
 */
export interface TranscriptionToggleMessage {
  type: 'transcription_toggle';
  enabled: boolean;
  at: number;
  participantId: string;
  participantName: string;
}

/**
 * Authoritative transcription state, broadcast by the AGENT after it actually applies
 * (or rejects) a `transcription_toggle` command. Clients reflect their privacy state
 * from THIS message — never from the optimistic command — so the UI can never show
 * "off" while the agent is still capturing audio.
 */
export interface TranscriptionStateMessage {
  type: 'transcription_state';
  enabled: boolean;
  at: number;
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * All possible AI-related data channel messages
 */
export type AIDataMessage =
  | AIActionMessage
  | AIControllerChangedMessage
  | AIControlRequestMessage
  | AIControlTransferMessage
  | AIControlRequestDeniedMessage
  | AIVoiceToggleMessage
  | TranscriptionToggleMessage
  | TranscriptionStateMessage;

/**
 * Generic data message from data channel (before parsing)
 */
export interface RawDataMessage {
  type?: string;
  action?: string;
  controller?: string | null;
  controllerName?: string | null;
  requester_id?: string;
  requester_name?: string;
  new_controller_id?: string;
  new_controller_name?: string;
  enabled?: boolean;
  at?: number;
  participantId?: string;
  participantName?: string;
  data?: {
    users?: AIInviteUser[];
    suggestedMessage?: string;
    message?: string;
    title?: string;
    description?: string;
    assignedToName?: string;
    boardId?: string;
  };
}

// ============================================================================
// Parsed Event Types (for UI consumption)
// ============================================================================

/**
 * Parsed AI invite event ready for UI
 */
export interface AIInviteEvent {
  type: 'AI_INVITE';
  users: AIInviteUser[];
  suggestedMessage: string;
}

/**
 * Parsed AI create ticket event ready for UI
 */
export interface AICreateTicketEvent {
  type: 'AI_CREATE_TICKET';
  title: string;
  description: string;
  assignedToName?: string;
  boardId?: string;
}

/**
 * Parsed AI controller changed event
 */
export interface AIControllerEvent {
  type: 'AI_CONTROLLER_CHANGED';
  controller: string | null;
  controllerName: string | null;
}

/**
 * Parsed AI control request event
 */
export interface AIControlRequestEvent {
  type: 'AI_CONTROL_REQUEST';
  requesterId: string;
  requesterName: string;
}

/**
 * Parsed AI control request denied event
 */
export interface AIControlRequestDeniedEvent {
  type: 'AI_CONTROL_REQUEST_DENIED';
  requesterId: string;
}

/**
 * Parsed authoritative transcription-state event (from the agent). Clients reflect
 * their privacy state from this, not from the optimistic toggle command.
 */
export interface AITranscriptionStateEvent {
  type: 'AI_TRANSCRIPTION_STATE';
  enabled: boolean;
  at: number;
}

/**
 * All possible parsed AI events
 */
export type AIEvent =
  | AIInviteEvent
  | AICreateTicketEvent
  | AIControllerEvent
  | AIControlRequestEvent
  | AIControlRequestDeniedEvent
  | AITranscriptionStateEvent;
