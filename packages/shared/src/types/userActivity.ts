import type { Platform } from '../zero/types.js';

/**
 * The intent behind a tracked client gesture, declared by the element that
 * emits it (`data-track-kind`), never inferred server-side.
 *
 *  - `active`: the gesture's purpose is to change persisted state — send,
 *    create, edit, delete, join, leave, react, star, mute, mark read, change
 *    a setting, approve, dismiss-and-forget is NOT included. Preference writes
 *    count. "Did the user contribute or decide something" is the test, not
 *    "did a row change".
 *  - `passive`: read, navigate, or UI-only — open, view, search, filter, sort,
 *    switch tab, expand/collapse, preview, cancel, dismiss.
 *  - `null`: the emitter declared nothing. Backend-originated rows
 *    (DB_MUTATION / SYSTEM) are always `null`: a server-side write cannot see
 *    the gesture, and the client click that caused it is tracked separately,
 *    so stamping them would double-count one action.
 */
export type InteractionKind = 'active' | 'passive';
export const INTERACTION_KINDS: readonly InteractionKind[] = ['active', 'passive'];

export function isInteractionKind(value: unknown): value is InteractionKind {
  return typeof value === 'string' && (INTERACTION_KINDS as readonly string[]).includes(value);
}

// UserActivity type for API responses
export interface UserActivity {
  id: string;
  userId: string;
  sessionId: string;
  eventCategory: string;
  eventName: string;
  originalEventCategory: string;
  originalEventName: string;
  eventLabel: string | null;
  url: string;
  triggerType: string;
  contextMetadata: Record<string, unknown> | null;
  interactionKind: InteractionKind | null;
  platform: Platform;
  timestamp: string; // ISO 8601
  hasAlias: boolean;
  relatedData: unknown;
  isBlacklisted: boolean;
}

export interface UserActivityResponse {
  data: UserActivity[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface ActivityEventPayload {
  user_id: string;
  session_id: string;
  event_category: string;
  event_name: string;
  event_label?: string;
  url: string;
  trigger_type: string;
  context_metadata?: Record<string, unknown>;
  interaction_kind?: InteractionKind | null;
  platform: Platform;
  timestamp: number;
}

export interface CreateActivityEventInput {
  userId: string;
  sessionId: string;
  eventCategory: string;
  eventName: string;
  eventLabel?: string;
  url: string;
  triggerType?: string;
  contextMetadata?: Record<string, unknown>;
  interactionKind?: InteractionKind | null;
  platform: Platform;
  timestamp: Date;
}

export interface TrackActivityOptions {
  eventCategory: string;
  eventName: string;
  url?: string;
  eventLabel?: string;
  contextMetadata?: Record<string, unknown>;
  interactionKind?: InteractionKind;
}

export interface ActivityAlias {
  id: string;
  eventName: string;
  eventCategory: string;
  aliasEventName: string;
  aliasEventCategory: string;
  isBlacklisted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityAliasesResponse {
  aliases: ActivityAlias[];
}

export interface CreateActivityAliasInput {
  eventName: string;
  eventCategory: string;
  aliasEventName: string;
  aliasEventCategory: string;
  isBlacklisted?: boolean;
}

export interface UpdateActivityAliasInput {
  aliasEventName: string;
  aliasEventCategory: string;
  isBlacklisted?: boolean;
}
