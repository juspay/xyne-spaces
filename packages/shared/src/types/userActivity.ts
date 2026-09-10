import type { Platform } from '../zero/types.js';

/**
 * Whether a tracked interaction persisted a write (`active`: send, create,
 * edit, delete, join, star, change a setting, ...) or only read / navigated
 * (`passive`: open, view, search, filter, switch tab, expand, cancel, ...).
 * Declared where the event is emitted: `data-track-kind` on the tracked
 * element, or explicitly by backend emitters. `null` means the emitter did
 * not declare one.
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
