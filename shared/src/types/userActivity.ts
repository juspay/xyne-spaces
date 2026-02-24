export enum Platform {
  WEB = 'WEB',
  ELECTRON = 'ELECTRON',
  MOBILE = 'MOBILE',
}

export enum TriggerType {
  CLICK = 'CLICK',
  CHANGE = 'SELECTION_CHANGE',
  BLUR = 'INPUT_CHANGE',
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
