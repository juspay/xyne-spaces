export enum Platform {
  WEB = 'WEB',
  ELECTRON = 'ELECTRON',
  MOBILE = 'MOBILE',
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

export enum TriggerType {
  CLICK = 'CLICK',
  CHANGE = 'SELECTION_CHANGE',
  BLUR = 'INPUT_CHANGE',
  DB_MUTATION = 'DB_MUTATION',
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
  platform: Platform;
  timestamp: Date;
}

export interface TrackActivityOptions {
  eventCategory: string;
  eventName: string;
  url?: string;
  eventLabel?: string;
  contextMetadata?: Record<string, unknown>;
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
