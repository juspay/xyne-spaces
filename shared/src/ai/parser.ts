/**
 * Shared AI message parser for data channel messages
 * Used by both native and web clients to parse AI-related data channel messages
 */

import {
  RawDataMessage,
  AIEvent,
  AIInviteEvent,
  AICreateTicketEvent,
  AIControllerEvent,
  AIControlRequestEvent,
  AIInviteUser,
} from './types';

/**
 * Parse a raw data channel message into typed AI events
 * Returns an array because one message might trigger multiple events
 */
export function parseAIDataMessage(data: RawDataMessage): AIEvent | null {
  // Handle AI Action messages (from Python agent)
  if (data.type === 'AI_ACTION' && data.action === 'INVITE_USER') {
    const users = data.data?.users || [];
    const suggestedMessage = data.data?.suggestedMessage || data.data?.message || '';
    
    const event: AIInviteEvent = {
      type: 'AI_INVITE',
      users,
      suggestedMessage,
    };
    return event;
  }

  // Handle CREATE_TICKET action
  if (data.type === 'AI_ACTION' && data.action === 'CREATE_TICKET') {
    const title = data.data?.title || '';
    const description = data.data?.description || '';
    const assignedToName = data.data?.assignedToName;
    const boardId = data.data?.boardId;
    
    const event: AICreateTicketEvent = {
      type: 'AI_CREATE_TICKET',
      title,
      description,
      ...(assignedToName && { assignedToName }),
      ...(boardId && { boardId }),
    };
    return event;
  }

  // Handle controller changed messages
  if (data.type === 'ai_controller_changed') {
    const event: AIControllerEvent = {
      type: 'AI_CONTROLLER_CHANGED',
      controller: data.controller ?? null,
      controllerName: data.controllerName ?? null,
    };
    return event;
  }

  // Handle control request messages
  if (data.type === 'ai_control_request' && data.requester_id && data.requester_name) {
    const event: AIControlRequestEvent = {
      type: 'AI_CONTROL_REQUEST',
      requesterId: data.requester_id,
      requesterName: data.requester_name,
    };
    return event;
  }

  return null;
}

/**
 * Decode a Uint8Array payload into a parsed data message
 * Returns null if the payload is not valid JSON
 */
export function decodeDataPayload(payload: Uint8Array): RawDataMessage | null {
  try {
    const text = new TextDecoder().decode(payload);
    return JSON.parse(text) as RawDataMessage;
  } catch {
    return null;
  }
}

/**
 * Parse a Uint8Array payload directly into an AI event
 * Combines decoding and parsing in one step
 */
export function parseDataPayload(payload: Uint8Array): AIEvent | null {
  const data = decodeDataPayload(payload);
  if (!data) return null;
  return parseAIDataMessage(data);
}

/**
 * Format user names for display
 */
export function formatUserNames(users: AIInviteUser[]): string {
  if (users.length === 0) return 'users';
  if (users.length === 1) return users[0].name;
  if (users.length === 2) return `${users[0].name} and ${users[1].name}`;
  return `${users[0].name}, ${users[1].name}, and ${users.length - 2} others`;
}

/**
 * Type guard to check if an event is an AI Invite event
 */
export function isAIInviteEvent(event: AIEvent): event is AIInviteEvent {
  return event.type === 'AI_INVITE';
}

/**
 * Type guard to check if an event is an AI Controller Changed event
 */
export function isAIControllerEvent(event: AIEvent): event is AIControllerEvent {
  return event.type === 'AI_CONTROLLER_CHANGED';
}

/**
 * Type guard to check if an event is an AI Control Request event
 */
export function isAIControlRequestEvent(event: AIEvent): event is AIControlRequestEvent {
  return event.type === 'AI_CONTROL_REQUEST';
}
