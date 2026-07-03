export interface NotificationEvent {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string;
  data?: Record<string, any>;
  createdAt: Date;
  workspaceId?: string;
  workspaceName?: string;
}

export enum NotificationStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  ACKNOWLEDGED = 'acknowledged',
}

export enum DeliveryChannel {
  WEBSOCKET = 'websocket',
  MOBILE_PUSH = 'mobile_push',
}

// WebSocket notification job data (existing)
export interface WebSocketJobData {
  channel: DeliveryChannel.WEBSOCKET;
  event: NotificationEvent;
  attempt: number;
  maxAttempts: number;
  acknowledgedAt?: string;
  status?: 'pending' | 'processing' | 'delivered' | 'acknowledged' | 'failed';
}

// Mobile push notification job data
export interface MobilePushPayload {
  type: string;
  title: string;
  message: string;
  notificationId?: string;
  actionUrl?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: Record<string, any>;
}

export interface MobilePushJobData {
  channel: DeliveryChannel.MOBILE_PUSH;
  userId: string;
  sessionId: string;
  token: string;
  voipToken?: string;
  platform: string;
  appVersion?: string;
  payload: MobilePushPayload;
}

// Union type for all job data
export type NotificationJobData = WebSocketJobData | MobilePushJobData;

// Legacy type alias for backward compatibility
export type LegacyNotificationJobData = WebSocketJobData;

export interface NotificationDeliveryResult {
  success: boolean;
  deliveredAt?: Date;
  error?: string;
  errorCode?: string;
  isRetryable?: boolean;
}

export interface NotificationChannelHandler {
  deliver(event: NotificationEvent): Promise<NotificationDeliveryResult>;
  acknowledge(eventId: string, userId: string): Promise<boolean>;
}

export interface UserBucketEntry {
  userId: string;
  events: NotificationEvent[];
  lastUpdated: Date;
}
