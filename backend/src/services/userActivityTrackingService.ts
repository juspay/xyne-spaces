import { v4 as uuidv4 } from 'uuid';
import { activityTrackingService } from './activityTrackingService';
import { Platform, TriggerType } from '@xyne/shared';
import { logger } from '@/utils/logger';

class UserActivityTrackingService {

  async trackActivity(params: {
    userId: string;
    eventCategory: string;
    eventName: string;
    eventLabel?: string;
    url?: string;
    triggerType: TriggerType;
    platform?: Platform;
    contextMetadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const event = {
        user_id: params.userId,
        session_id: uuidv4(),
        event_category: params.eventCategory,
        event_name: params.eventName,
        event_label: params.eventLabel,
        url: params.url || 'backend',
        trigger_type: params.triggerType,
        context_metadata: params.contextMetadata,
        platform: params.platform || Platform.WEB,
        timestamp: Date.now(),
      };

      await activityTrackingService.saveActivityEvent(event);
    } catch (error) {
      logger.debug('[UserActivityTracking] Failed to track activity:', error);
    }
  }

  async track(params: {
    userId: string;
    eventName: string;
    eventCategory: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {

    const event = {
        user_id: params.userId,
        session_id: uuidv4(),
        event_category: params.eventCategory,
        event_name: params.eventName,
        event_label: "NO_LABEL_FOUND",
        url: 'backend',
        trigger_type: TriggerType.DB_MUTATION,
        context_metadata: params.metadata,
        platform: Platform.WEB,
        timestamp: Date.now(),
      };

      await activityTrackingService.saveActivityEvent(event);
  }

  // ==================== Specific Call Operations ====================

  async trackCallInitiated(userId: string, metadata?: { callId?: string; channelId?: string; callType?: string }): Promise<void> {
    await this.track({
      userId,
      eventName: 'CALL_INITIATE',
      eventCategory: 'CALLS',
      metadata,
    });
  }

  async trackCallJoined(userId: string, metadata?: { callId?: string; channelId?: string }): Promise<void> {
    await this.track({
      userId,
      eventName: 'CALL_JOIN',
      eventCategory: 'CALLS',
      metadata,
    });
  }

  async trackCallLeft(userId: string, metadata?: { callId?: string; duration?: number }): Promise<void> {
    await this.track({
      userId,
      eventName: 'CALL_LEFT',
      eventCategory: 'CALLS',
      metadata,
    });
  }

  // ==================== Specific Message Operations ====================

  async trackMessageSent(userId: string, metadata?: { messageId?: string; conversationId?: string; channelId?: string; hasAttachment?: boolean }): Promise<void> {
    await this.track({
      userId,
      eventName: 'MESSAGE_SENT',
      eventCategory: 'CHAT',
      metadata,
    });
  }

  // ==================== Specific Ticket Operations ====================

  async trackTicketCreated(userId: string, metadata?: { ticketId?: string; title?: string; boardId?: string; channelId?: string }): Promise<void> {
    await this.track({
      userId,
      eventName: 'TICKET_CREATED',
      eventCategory: 'TICKETS',
      metadata,
    });
  }

  async trackTicketUpdated(userId: string, metadata?: { ticketId?: string; fields?: string[]; boardId?: string }): Promise<void> {
    await this.track({
      userId,
      eventName: 'TICKET_UPDATED',
      eventCategory: 'TICKETS',
      metadata,
    });
  }

  // ==================== Specific Canvas Operations ====================

  async trackCanvasCreated(userId: string, metadata?: { canvasId?: string; title?: string; channelId?: string | null }): Promise<void> {
    await this.track({
      userId,
      eventName: 'CANVAS_CREATED',
      eventCategory: 'CANVAS',
      metadata,
    });
  }

  // ==================== Specific Channel Operations ====================

  async trackChannelCreated(userId: string, metadata?: { channelId?: string; name?: string; scopeType?: string; projectId?: string }): Promise<void> {
    await this.track({
      userId,
      eventName: 'CHANNEL_CREATED',
      eventCategory: 'CHANNEL',
      metadata,
    });
  }
}

export const userActivityTrackingService = new UserActivityTrackingService();
