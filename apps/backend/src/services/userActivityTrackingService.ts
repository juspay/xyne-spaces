import { v4 as uuidv4 } from 'uuid';
import { activityTrackingService } from './activityTrackingService';
import { ChannelScopeType, Platform, TriggerType } from '@xyne/shared';
import { logger } from '@/utils/logger';

const NON_DISPLAY_NAME_SCOPES = new Set<string>([ChannelScopeType.DM, ChannelScopeType.GROUP_DM]);

/**
 * `Channel.name` is a human name only for non-DM scopes; DMs store a sorted
 * user-id pair (channelRepository.getDMChannel) and self-DMs the user id.
 * Those are neither readable in reports nor something to persist into the
 * event store, so they are dropped here and `channelId` + `scopeType` carry
 * the dimension.
 */
export function reportableChannelName(
  name: string | null | undefined,
  scopeType: string | null | undefined,
): string | undefined {
  if (!name) return undefined;
  return NON_DISPLAY_NAME_SCOPES.has(scopeType ?? '') ? undefined : name;
}

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
        // No interaction_kind: a server-side emitter sees a row change, not a
        // gesture, and the client click that caused it is tracked separately.
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

  async trackMessageSent(
    userId: string,
    metadata?: {
      messageId?: string;
      conversationId?: string;
      channelId?: string;
      channelName?: string;
      scopeType?: string;
      isThreadReply?: boolean;
      hasAttachment?: boolean;
    },
  ): Promise<void> {
    await this.track({
      userId,
      eventName: 'MESSAGE_SENT',
      eventCategory: 'CHAT',
      metadata,
    });
  }

  async trackReactionAdded(
    userId: string,
    metadata?: {
      messageId?: string;
      channelId?: string;
      channelName?: string;
      scopeType?: string;
      emojiName?: string;
      isThreadReply?: boolean;
      isSelf?: boolean;
    },
  ): Promise<void> {
    await this.track({
      userId,
      eventName: 'REACTION_ADDED',
      eventCategory: 'CHAT',
      metadata,
    });
  }

  async trackReactionRemoved(
    userId: string,
    metadata?: {
      messageId?: string;
      channelId?: string;
      channelName?: string;
      scopeType?: string;
      emojiName?: string;
      isThreadReply?: boolean;
      isSelf?: boolean;
    },
  ): Promise<void> {
    await this.track({
      userId,
      eventName: 'REACTION_REMOVED',
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

  async trackReleaseReportPublished(
    userId: string,
    metadata: {
      ticketId: string;
      canvasId: string;
      action: 'created' | 'updated';
      version: number;
      devTicketCount: number;
      environmentVariableCount: number;
      migrationFileCount: number;
      partialFailure: boolean;
    },
  ): Promise<void> {
    await this.track({
      userId,
      eventName: 'RELEASE_REPORT_PUBLISHED',
      eventCategory: 'RELEASE',
      metadata,
    });
  }

  // ==================== Specific Channel Operations ====================

  async trackChannelCreated(
    userId: string,
    metadata?: { channelId?: string; name?: string; channelName?: string; scopeType?: string; projectId?: string },
  ): Promise<void> {
    await this.track({
      userId,
      eventName: 'CHANNEL_CREATED',
      eventCategory: 'CHANNEL',
      metadata,
    });
  }

  /**
   * `memberId` became a member of a channel. Keyed on the member (the subject,
   * like every other event on this table); `addedBy` is the actor when someone
   * else added them, and `isSelf` is true when they joined on their own.
   */
  async trackChannelJoined(
    memberId: string,
    metadata?: { channelId?: string; channelName?: string; scopeType?: string; addedBy?: string; isSelf?: boolean },
  ): Promise<void> {
    await this.track({
      userId: memberId,
      eventName: 'CHANNEL_JOINED',
      eventCategory: 'CHANNEL',
      metadata,
    });
  }

  /**
   * `memberId` stopped being a member. `removedBy` is the actor when someone
   * else removed them; `isSelf` is true when they left on their own.
   */
  async trackChannelLeft(
    memberId: string,
    metadata?: { channelId?: string; channelName?: string; scopeType?: string; removedBy?: string; isSelf?: boolean },
  ): Promise<void> {
    await this.track({
      userId: memberId,
      eventName: 'CHANNEL_LEFT',
      eventCategory: 'CHANNEL',
      metadata,
    });
  }
}

export const userActivityTrackingService = new UserActivityTrackingService();
