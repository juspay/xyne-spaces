import Redis from 'ioredis';
import { logger } from '@/utils/logger';
import { createRedisClient, getBaseRedisOptions, connectWithRetryForever } from './redisFactory';

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  msgType: string;
  createdAt: Date;
}

export interface SessionEvent {
  type: 'user_joined' | 'user_left' | 'session_created' | 'session_updated';
  sessionId: string;
  userId?: string;
  data?: any;
}

export interface UserEvent {
  type: 'channel_added' | 'channel_removed' | 'participant_added' | 'participant_removed' | 'user_mentioned' | 'incoming_call' | 'call_ended' | 'call_cancelled' | 'recap_unread_count_updated' | 'recap_generated' | 'recap_cleanup_completed' | 'data_source_ingestion_updated' | 'data_source_ingestion_progress' | 'client_command';
  userId: string;
  data: any;
  timestamp: Date;
}

export interface OrgMemberEvent {
  type: 'notification_received';
  orgMemberId: string;
  data: any;
  timestamp: Date;
}

export interface WorkflowEvent {
  type: 'step_added' | 'step_updated' | 'execution_completed';
  executionId: string;
  data: {
    stepId?: string;
    stepName?: string | null;
    type?: string | null;  // 'input' | 'output' for step_added events
    stepExecutorType?: string;
    [key: string]: unknown;
  };
  timestamp: Date;
}

export interface PresenceEvent {
  userId: string;
  status: 'ONLINE' | 'AWAY' | 'OFFLINE';
}

class RedisService {
  private redis: Redis | null = null;
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  // Track active subscriptions to prevent duplicate handlers
  private activeSubscriptions = new Set<string>();
  // Track callbacks for each channel (multiple listeners per channel)
  private subscriptionCallbacks = new Map<string, Function[]>();

  constructor() {
    this.initializeRedis();
  }

  public getRedisConfig() {
    return getBaseRedisOptions('default');
  }

  private initializeRedis(): void {
    try {
      this.redis = createRedisClient('main');
      this.publisher = createRedisClient('publisher');
      this.subscriber = createRedisClient('subscriber');
    } catch (error) {
      logger.error('Failed to initialize Redis:', error);
    }
  }

  async connect(): Promise<void> {
    await Promise.all([
      this.redis ? connectWithRetryForever(this.redis, 'main') : Promise.resolve(),
      this.publisher ? connectWithRetryForever(this.publisher, 'publisher') : Promise.resolve(),
      this.subscriber ? connectWithRetryForever(this.subscriber, 'subscriber') : Promise.resolve(),
    ]);
    logger.info('All Redis connections established');
  }

  async disconnect(): Promise<void> {
    try {
      if (this.redis) await this.redis.disconnect();
      if (this.publisher) await this.publisher.disconnect();
      if (this.subscriber) await this.subscriber.disconnect();
      logger.info('All Redis connections closed');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
    }
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (!this.redis) {
      logger.warn('[REDIS] Cannot srem - Redis not initialized');
      return 0;
    }
    return await this.redis.srem(key, ...members);
  }

  async scard(key: string): Promise<number> {
    if (!this.redis) {
      logger.warn('[REDIS] Cannot scard - Redis not initialized');
      return 0;
    }
    return await this.redis.scard(key);
  }

  // Session participant management
  async addParticipantToSession(sessionId: string, userId: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:participants`;
    await this.redis.sadd(key, userId);
    await this.redis.expire(key, 86400); // Expire in 24 hours
  }

  async removeParticipantFromSession(sessionId: string, userId: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:participants`;
    await this.redis.srem(key, userId);
  }

  async getSessionParticipants(sessionId: string): Promise<string[]> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:participants`;
    return await this.redis.smembers(key);
  }

  // WebSocket connection management
  async addUserConnection(userId: string, socketId: string, platform: string = 'web'): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `user:${userId}:connections`;
    await this.redis.sadd(key, socketId);
    await this.redis.expire(key, 3600); // Expire in 1 hour

    // Store platform metadata
    const platformKey = `user:${userId}:socket:${socketId}:platform`;
    await this.redis.set(platformKey, platform, 'EX', 3600);
  }

  async removeUserConnection(userId: string, socketId: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `user:${userId}:connections`;
    await this.redis.srem(key, socketId);
    
    // Clean up platform metadata
    const platformKey = `user:${userId}:socket:${socketId}:platform`;
    await this.redis.del(platformKey);
  }

  async getUserConnections(userId: string): Promise<string[]> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `user:${userId}:connections`;
    return await this.redis.smembers(key);
  }

  // Cross-workspace broadcast registry. Keyed on orgMemberId — the person-level
  // identity that stays constant across per-workspace User rows.
  async addOrgMemberConnection(orgMemberId: string, socketId: string, platform: string = 'web'): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `orgmember:${orgMemberId}:connections`;
    await this.redis.sadd(key, socketId);
    await this.redis.expire(key, 3600);

    const platformKey = `orgmember:${orgMemberId}:socket:${socketId}:platform`;
    await this.redis.set(platformKey, platform, 'EX', 3600);
  }

  async removeOrgMemberConnection(orgMemberId: string, socketId: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `orgmember:${orgMemberId}:connections`;
    await this.redis.srem(key, socketId);

    const platformKey = `orgmember:${orgMemberId}:socket:${socketId}:platform`;
    await this.redis.del(platformKey);
  }

  async getOrgMemberConnections(orgMemberId: string): Promise<string[]> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `orgmember:${orgMemberId}:connections`;
    return await this.redis.smembers(key);
  }

  async getOrgMemberSocketPlatform(orgMemberId: string, socketId: string): Promise<string | null> {
    if (!this.redis) throw new Error('Redis not initialized');

    const platformKey = `orgmember:${orgMemberId}:socket:${socketId}:platform`;
    return await this.redis.get(platformKey);
  }

  // Workspace context cache for notification producer (user:wsctx:{userId}).
  // workspaceId and orgMemberId are immutable per User row; workspaceName is
  async getWorkspaceContext(userId: string): Promise<{
    workspaceId: string;
    workspaceName: string;
    orgMemberId: string;
  } | null> {
    if (!this.redis) throw new Error('Redis not initialized');
    const raw = await this.redis.get(`user:wsctx:${userId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async setWorkspaceContext(
    userId: string,
    ctx: { workspaceId: string; workspaceName: string; orgMemberId: string }
  ): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    await this.redis.set(`user:wsctx:${userId}`, JSON.stringify(ctx), 'EX', 3600);
  }

  // Session subscription management
  async subscribeToSession(sessionId: string, socketId: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:sockets`;
    await this.redis.sadd(key, socketId);
    await this.redis.expire(key, 3600); // Expire in 1 hour
  }

  async unsubscribeFromSession(sessionId: string, socketId: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:sockets`;
    await this.redis.srem(key, socketId);
  }

  async getSessionSockets(sessionId: string): Promise<string[]> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:sockets`;
    return await this.redis.smembers(key);
  }

  // Message broadcasting
  async broadcastMessageToSession(sessionId: string, message: ChatMessage): Promise<void> {
    logger.info(`📡 [REDIS-SERVICE] broadcastMessageToSession called:`, {
      sessionId,
      hasPublisher: !!this.publisher,
      messageId: message.messageId,
      conversationId: message.conversationId
    });

    if (!this.publisher) {
      logger.info('❌ [REDIS-SERVICE] Redis publisher not initialized');
      throw new Error('Redis publisher not initialized');
    }

    const channel = `session:${sessionId}:messages`;
    logger.info(`📡 [REDIS-SERVICE] Publishing to channel '${channel}'`);

    await this.publisher.publish(channel, JSON.stringify(message));
    logger.info(`✅ [REDIS-SERVICE] Successfully published message to channel '${channel}'`);
  }

  // User-specific event broadcasting
  async broadcastUserEvent(userId: string, event: UserEvent): Promise<void> {
    if ((event as { type?: string }).type === 'notification_received') {
      throw new Error('notification_received events must be published via orgMemberId');
    }

    logger.info(`👤 [REDIS-SERVICE] broadcastUserEvent called:`, {
      userId,
      eventType: event.type,
      hasPublisher: !!this.publisher
    });

    if (!this.publisher) {
      logger.info('❌ [REDIS-SERVICE] Redis publisher not initialized');
      throw new Error('Redis publisher not initialized');
    }

    const channel = `user:${userId}:events`;
    logger.info(`👤 [REDIS-SERVICE] Publishing user event to channel '${channel}'`);

    await this.publisher.publish(channel, JSON.stringify(event));
    logger.info(`✅ [REDIS-SERVICE] Successfully published user event to channel '${channel}'`);
  }

  async broadcastSessionEvent(sessionId: string, event: SessionEvent): Promise<void> {
    if (!this.publisher) throw new Error('Redis publisher not initialized');

    const channel = `session:${sessionId}:events`;
    await this.publisher.publish(channel, JSON.stringify(event));
  }

  async publishOrgMemberEvent(orgMemberId: string, event: OrgMemberEvent): Promise<void> {
    if (!this.publisher) throw new Error('Redis publisher not initialized');

    const channel = `orgmember:${orgMemberId}:events`;
    await this.publisher.publish(channel, JSON.stringify(event));
  }

  // Workflow event broadcasting (cross-process communication for worker -> API server)
  async broadcastWorkflowEvent(executionId: string, event: WorkflowEvent): Promise<void> {
    if (!this.publisher) {
      logger.info('❌ [REDIS-SERVICE] Redis publisher not initialized for workflow event');
      return; // Fail silently for workflow events - don't block workflow execution
    }

    const channel = `workflow:${executionId}:events`;
    
    try {
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.info(`📊 [REDIS-WORKFLOW] Published ${event.type} event to channel '${channel}'`);
    } catch (error) {
      // Log but don't throw - workflow execution should not be blocked by Redis issues
      logger.error(`❌ [REDIS-WORKFLOW] Failed to publish workflow event:`, error);
    }
  }

  async broadcastZeroFallbackConfigUpdate(config: { fallbackEnabled: boolean; allowMutations: boolean; pollIntervalMs: number }): Promise<void> {
    if (!this.publisher) {
      logger.info('❌ [REDIS-SERVICE] Redis publisher not initialized for Zero fallback config');
      return;
    }

    const channel = 'global:zero-fallback-config';
    const event = {
      fallbackEnabled: config.fallbackEnabled,
      allowMutations: config.allowMutations,
      pollIntervalMs: config.pollIntervalMs,
      timestamp: new Date()
    };

    try {
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.info('📢 [REDIS-ZERO-FALLBACK] Published config update to Redis:', config);
    } catch (error) {
      logger.error('❌ [REDIS-ZERO-FALLBACK] Failed to publish config update:', error);
    }
  }

  // Subscribe to session channels
  // Global message handler setup flag
  private messageHandlerSetup = false;

  // Set up a single global message handler that routes ALL messages
  private setupGlobalMessageHandler(): void {
    if (this.messageHandlerSetup || !this.subscriber) return;

    logger.info(`🔴 [REDIS-SETUP] Setting up global Redis message handler`);
    this.subscriber.on('message', (receivedChannel: string, data: string) => {
      // Route messages based on channel type
      const callbacks = this.subscriptionCallbacks.get(receivedChannel) || [];
      
      if (callbacks.length === 0) {
        // logger.info(`🔴 [REDIS-SKIP] No callbacks registered for channel: ${receivedChannel}`);
        return;
      }

      try {
        const parsed = JSON.parse(data);
        
        // Log based on channel type for debugging
        if (receivedChannel.includes('workflow:')) {
          logger.info(`📊 [REDIS-WORKFLOW] Received event on channel: ${receivedChannel}`, {
            type: parsed.type,
            executionId: parsed.executionId
          });
        } else if (receivedChannel.includes(':messages')) {
          logger.info(`🔴 [REDIS-MESSAGE] Received on channel: ${receivedChannel}`);
        }

        // Execute all callbacks for this channel
        callbacks.forEach((cb, index) => {
          try {
            cb(parsed);
          } catch (error) {
            logger.error(`Error in callback ${index} for channel ${receivedChannel}:`, error);
          }
        });
      } catch (error) {
        logger.error(`Error parsing message from Redis on channel ${receivedChannel}:`, error);
      }
    });

    this.messageHandlerSetup = true;
  }

  async subscribeToSessionMessages(
    sessionId: string,
    callback: (message: ChatMessage) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `session:${sessionId}:messages`;

    // Add callback to the list for this channel
    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);

    // Ensure global message handler is set up
    this.setupGlobalMessageHandler();

    // Only subscribe to Redis if we haven't already
    if (!this.activeSubscriptions.has(channel)) {
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  async subscribeToSessionEvents(
    sessionId: string,
    callback: (event: SessionEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `session:${sessionId}:events`;

    // Add callback to the list for this channel
    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);

    // Ensure global message handler is set up
    this.setupGlobalMessageHandler();

    // Only subscribe to Redis if we haven't already
    if (!this.activeSubscriptions.has(channel)) {
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  // Subscribe to user-specific events
  async subscribeToUserEvents(
    userId: string,
    callback: (event: UserEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `user:${userId}:events`;

    // Add callback to the list for this channel
    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);

    // Ensure global message handler is set up
    this.setupGlobalMessageHandler();

    // Only subscribe to Redis if we haven't already
    if (!this.activeSubscriptions.has(channel)) {
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  async subscribeToOrgMemberEvents(
    orgMemberId: string,
    callback: (event: OrgMemberEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `orgmember:${orgMemberId}:events`;

    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);

    this.setupGlobalMessageHandler();

    if (!this.activeSubscriptions.has(channel)) {
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  async unsubscribeFromOrgMemberEvents(orgMemberId: string): Promise<void> {
    const channel = `orgmember:${orgMemberId}:events`;
    const callbacks = this.subscriptionCallbacks.get(channel);
    if (!callbacks || callbacks.length === 0) {
      await this.unsubscribeFromChannel(channel);
      return;
    }
    // Remove all callbacks and unsubscribe
    await this.unsubscribeFromChannel(channel);
  }

  // Subscribe to workflow events (for real-time step updates)
  async subscribeToZeroFallbackConfigUpdates(
    callback: (config: { fallbackEnabled: boolean; allowMutations: boolean; pollIntervalMs: number; timestamp: Date }) => void
  ): Promise<void> {
    if (!this.subscriber) {
      logger.info('❌ [REDIS-SERVICE] Redis subscriber not initialized for Zero fallback config subscription');
      return;
    };

    const channel = 'global:zero-fallback-config';
    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);
    this.setupGlobalMessageHandler();

    if (!this.activeSubscriptions.has(channel)) {
      logger.info('📢 [REDIS-ZERO-FALLBACK] Subscribing to fallback config channel:', channel);
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
      logger.info('✅ [REDIS-ZERO-FALLBACK] Successfully subscribed to fallback config updates');
    }
  }

  // ============== PRESENCE PUB/SUB ==============
  
  // Global presence channel - all connected clients subscribe to this
  private readonly PRESENCE_CHANNEL = 'global:presence';

  /**
   * Broadcast a presence event to all subscribers
   * Used when a user's status changes (online/away/offline) or status text/emoji updates
   */
  async broadcastPresenceEvent(event: PresenceEvent): Promise<void> {
    if (!this.publisher) {
      logger.warn('[REDIS-PRESENCE] Redis publisher not initialized for presence event');
      return;
    }

    try {
      const subscriberCount = await this.publisher.publish(this.PRESENCE_CHANNEL, JSON.stringify(event));
      logger.debug(`[REDIS-PRESENCE] Published ${event.status} event for user ${event.userId} (received by ${subscriberCount} subscribers)`);
    } catch (error) {
      logger.error('[REDIS-PRESENCE] Failed to publish presence event:', error);
    }
  }

  /**
   * Subscribe to presence events
   * Each API server subscribes once and broadcasts to all its connected clients
   */
  async subscribeToPresenceEvents(
    callback: (event: PresenceEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = this.PRESENCE_CHANNEL;

    // Add callback to the list for this channel
    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);

    // Ensure global message handler is set up
    this.setupGlobalMessageHandler();

    // Only subscribe to Redis if we haven't already
    if (!this.activeSubscriptions.has(channel)) {
      logger.info(`[REDIS-PRESENCE] Subscribing to global presence events channel: ${channel}`);
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  /**
   * Unsubscribe from presence events
   */
  async unsubscribeFromPresenceEvents(
    callback?: (event: PresenceEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = this.PRESENCE_CHANNEL;

    if (callback) {
      // Remove specific callback
      const callbacks = this.subscriptionCallbacks.get(channel) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        logger.debug(`[REDIS-PRESENCE] Removed callback from presence events channel: ${channel}`);
      }

      // If no more callbacks, unsubscribe from Redis
      if (callbacks.length === 0) {
        await this.unsubscribeFromChannel(channel);
      }
    } else {
      // Remove all callbacks and unsubscribe
      await this.unsubscribeFromChannel(channel);
      logger.debug(`[REDIS-PRESENCE] Unsubscribed from presence events channel: ${channel}`);
    }
  }

  // Unsubscribe from session messages
  async unsubscribeFromSessionMessages(
    sessionId: string,
    callback?: (message: ChatMessage) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `session:${sessionId}:messages`;

    if (callback) {
      // Remove specific callback
      const callbacks = this.subscriptionCallbacks.get(channel) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        // logger.info(`🔴 [REDIS-UNSUB] Removed callback from channel: ${channel}`);
      }

      // If no more callbacks, unsubscribe from Redis
      if (callbacks.length === 0) {
        await this.unsubscribeFromChannel(channel);
      }
    } else {
      // Remove all callbacks and unsubscribe
      await this.unsubscribeFromChannel(channel);
    }
  }

  // Unsubscribe from session events
  async unsubscribeFromSessionEvents(
    sessionId: string,
    callback?: (event: SessionEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `session:${sessionId}:events`;

    if (callback) {
      // Remove specific callback
      const callbacks = this.subscriptionCallbacks.get(channel) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        // logger.info(`🔴 [REDIS-UNSUB] Removed callback from events channel: ${channel}`);
      }

      // If no more callbacks, unsubscribe from Redis
      if (callbacks.length === 0) {
        await this.unsubscribeFromChannel(channel);
      }
    } else {
      // Remove all callbacks and unsubscribe
      await this.unsubscribeFromChannel(channel);
    }
  }

  // Helper method to unsubscribe from a channel completely
  private async unsubscribeFromChannel(channel: string): Promise<void> {
    if (this.activeSubscriptions.has(channel)) {
      // logger.info(`🔴 [REDIS-UNSUB] Unsubscribing from channel: ${channel}`);
      await this.subscriber!.unsubscribe(channel);
      this.activeSubscriptions.delete(channel);
      this.subscriptionCallbacks.delete(channel);
    }
  }

  // Check if already subscribed to a channel
  isSubscribedTo(sessionId: string, type: 'messages' | 'events' = 'messages'): boolean {
    const channel = `session:${sessionId}:${type}`;
    return this.activeSubscriptions.has(channel);
  }

  // Get subscription stats for debugging
  getSubscriptionStats(): {
    activeChannels: string[];
    totalCallbacks: number;
  } {
    const totalCallbacks = Array.from(this.subscriptionCallbacks.values())
      .reduce((sum, callbacks) => sum + callbacks.length, 0);

    return {
      activeChannels: Array.from(this.activeSubscriptions),
      totalCallbacks
    };
  }

  // General pub/sub methods
  async subscribe(channel: string, callback: (data: any) => void): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    await this.subscriber.subscribe(channel);

    this.subscriber.on('message', (receivedChannel, data) => {
      if (receivedChannel === channel) {
        try {
          const parsedData = JSON.parse(data);
          callback(parsedData);
        } catch (error) {
          // If JSON parsing fails, pass raw data
          callback(data);
        }
      }
    });
  }

  async publish(channel: string, data: any): Promise<void> {
    if (!this.publisher) throw new Error('Redis publisher not initialized');

    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    await this.publisher.publish(channel, payload);
  }

  // Utility methods
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.redis) return false;
      await this.redis.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Cache methods for session data
  async cacheSessionData(sessionId: string, data: any, ttl?: number): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:cache`;
    if (ttl !== undefined) {
      // With TTL - key expires after ttl seconds
      await this.redis.setex(key, ttl, JSON.stringify(data));
    } else {
      // No TTL - key persists until explicitly deleted (used for AWAY status)
      await this.redis.set(key, JSON.stringify(data));
    }
  }

  async getCachedSessionData(sessionId: string): Promise<any | null> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:cache`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteCachedSessionData(sessionId: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `session:${sessionId}:cache`;
    await this.redis.del(key);
  }

  // Hash operations for user status management
  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    await this.redis.hset(key, field, value);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.redis) throw new Error('Redis not initialized');
    return await this.redis.hgetall(key);
  }

  async hdel(key: string, field: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    await this.redis.hdel(key, field);
  }

  async expire(key: string, ttl: number): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    await this.redis.expire(key, ttl);
  }

  async del(key: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    await this.redis.del(key);
  }

  /**
   * Deletes `key` only if its current value still equals `expectedValue`. Atomic
   * via Lua so a lock holder can never release a lock it no longer owns — e.g. its
   * own TTL expired, someone else acquired the key, and a bare DEL would otherwise
   * delete THEIR lock instead of a stale one, letting a third caller in.
   */
  async deleteIfMatch(key: string, expectedValue: string): Promise<boolean> {
    if (!this.redis) throw new Error('Redis not initialized');
    const luaScript = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;
    const result = await this.redis.eval(luaScript, 1, key, expectedValue) as number;
    return result === 1;
  }

  async exists(key: string): Promise<boolean> {
    if (!this.redis) throw new Error('Redis not initialized');
    const result = await this.redis.exists(key);
    return result === 1;
  }

  /**
   * Append a value to a Redis list using RPUSH.
   * Creates the list if it doesn't exist.
   */
  async rpush(key: string, value: string): Promise<void> {
    if (!this.redis) {
      logger.warn('[REDIS] Cannot rpush - Redis not initialized');
      return;
    }
    await this.redis.rpush(key, value);
  }

  /**
   * Prepend a value to a Redis list using LPUSH.
   * Creates the list if it doesn't exist.
   */
  async lpush(key: string, value: string): Promise<void> {
    if (!this.redis) {
      logger.warn('[REDIS] Cannot lpush - Redis not initialized');
      return;
    }
    await this.redis.lpush(key, value);
  }

  /**
   * Get all values from a Redis list.
   * Returns empty array if key doesn't exist.
   */
  async lrange(key: string, start: number = 0, end: number = -1): Promise<string[]> {
    if (!this.redis) {
      logger.warn('[REDIS] Cannot lrange - Redis not initialized');
      return [];
    }
    return await this.redis.lrange(key, start, end);
  }

  /**
   * Add member(s) to a Redis set using SADD.
   * Creates the set if it doesn't exist.
   * Returns number of elements added (0 if all already existed).
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.redis) {
      logger.warn('[REDIS] Cannot sadd - Redis not initialized');
      return 0;
    }
    return await this.redis.sadd(key, ...members);
  }

  /**
   * Get all members of a Redis set using SMEMBERS.
   * Returns empty array if key doesn't exist.
   */
  async smembers(key: string): Promise<string[]> {
    if (!this.redis) {
      logger.warn('[REDIS] Cannot smembers - Redis not initialized');
      return [];
    }
    return await this.redis.smembers(key);
  }

  /**
   * Set a value at a specific index in a Redis list.
   * Returns 'OK' on success.
   */
  async lset(key: string, index: number, value: string): Promise<'OK'> {
    if (!this.redis) throw new Error('Redis not initialized');
    return await this.redis.lset(key, index, value);
  }

  /**
   * Set a key with optional TTL - does NOT modify the key (unlike cacheSessionData)
   * Use this for user status keys where we need to check existence later
   * Returns true if key was set, false if it already existed (when nx is true)
   */
  async set(key: string, value: string, ttlSeconds?: number, nx?: boolean): Promise<boolean> {
    if (!this.redis) throw new Error('Redis not initialized');
    if (nx) {
      // NX: only set if key does not exist
      if (ttlSeconds !== undefined) {
        const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      }
      const result = await this.redis.set(key, value, 'NX');
      return result === 'OK';
    } else {
      if (ttlSeconds !== undefined) {
        await this.redis.setex(key, ttlSeconds, value);
      } else {
        await this.redis.set(key, value);
      }
      return true;
    }
  }

  /**
   * Get a key value - does NOT modify the key
   */
  async get(key: string): Promise<string | null> {
    if (!this.redis) throw new Error('Redis not initialized');
    return await this.redis.get(key);
  }

  async setHashField(key: string, field: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    await this.redis.hset(key, field, value);
    await this.redis.expire(key, ttlSeconds);
  }

  // Get a specific field from a Redis hash
  async getHashField(key: string, field: string): Promise<string | null> {
    if (!this.redis) throw new Error('Redis not initialized');
    return await this.redis.hget(key, field);
  }
  // Get all fields from a Redis hash
  async getAllHashFields(key: string): Promise<Record<string, string>> {
    if (!this.redis) throw new Error('Redis not initialized');
    return await this.redis.hgetall(key);
  }

  // Delete a specific field from a Redis hash
  async deleteHashField(key: string, field: string | string[]): Promise<number> {
    if (!this.redis) throw new Error('Redis not initialized');
    
    if (Array.isArray(field)) {
      if (field.length === 0) return 0;
      return await this.redis.hdel(key, ...field);
    }
    
    return await this.redis.hdel(key, field);
  }

  // ============== AGENT STEP CONTINUATION PUB/SUB ==============

  /**
   * Publish a continuation event for an agent step
   * Used to signal a running agent to abort and continue with a new message
   */
  async publishAgentContinuation(
    executionId: string,
    stepName: string,
    message: string
  ): Promise<void> {
    if (!this.publisher) {
      logger.warn('[REDIS-AGENT-CONTINUATION] Redis publisher not initialized');
      return;
    }

    const channel = `workflow:${executionId}:${stepName}:continue`;
    const event = {
      type: 'agent_continuation',
      executionId,
      stepName,
      message,
      timestamp: new Date().toISOString()
    };

    try {
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.info(`[REDIS-AGENT-CONTINUATION] Published continuation event to ${channel}`);
    } catch (error) {
      logger.error('[REDIS-AGENT-CONTINUATION] Failed to publish continuation event:', error);
      throw error;
    }
  }

  /**
   * Subscribe to agent continuation events
   * Called by the agent executor to listen for continuation signals
   */
  async subscribeToAgentContinuation(
    executionId: string,
    stepName: string,
    callback: (event: { message: string; type: string; executionId: string; stepName: string; timestamp: string }) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `workflow:${executionId}:${stepName}:continue`;

    // Add callback to the list for this channel
    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);

    // Ensure global message handler is set up
    this.setupGlobalMessageHandler();

    // Only subscribe to Redis if we haven't already
    if (!this.activeSubscriptions.has(channel)) {
      logger.info(`[REDIS-AGENT-CONTINUATION] Subscribing to channel: ${channel}`);
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  /**
   * Unsubscribe from agent continuation events
   */
  async unsubscribeFromAgentContinuation(
    executionId: string,
    stepName: string,
    callback?: (event: { message: string; type: string; executionId: string; stepName: string; timestamp: string }) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `workflow:${executionId}:${stepName}:continue`;

    if (callback) {
      // Remove specific callback
      const callbacks = this.subscriptionCallbacks.get(channel) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        logger.info(`[REDIS-AGENT-CONTINUATION] Removed callback from channel: ${channel}`);
      }

      // If no more callbacks, unsubscribe from Redis
      if (callbacks.length === 0) {
        await this.unsubscribeFromChannel(channel);
      }
    } else {
      // Remove all callbacks and unsubscribe
      await this.unsubscribeFromChannel(channel);
      logger.info(`[REDIS-AGENT-CONTINUATION] Unsubscribed from channel: ${channel}`);
    }
  }

  // Mode Change Pub/Sub for Agent Executor
  async subscribeToModeChange(
    executionId: string,
    callback: (event: { mode: string; executionId: string; timestamp: string }) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `workflow:${executionId}:mode`;

    const wrapperCallback = (message: string) => {
      try {
        const event = JSON.parse(message);
        callback(event);
      } catch (error) {
        logger.error('[REDIS-MODE] Failed to parse mode change message:', error);
      }
    };

    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(wrapperCallback);

    this.setupGlobalMessageHandler();

    if (!this.activeSubscriptions.has(channel)) {
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  async unsubscribeFromModeChange(
    executionId: string,
    callback?: (event: { mode: string; executionId: string; timestamp: string }) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `workflow:${executionId}:mode`;

    if (callback) {
      const callbacks = this.subscriptionCallbacks.get(channel) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
      if (callbacks.length === 0) {
        await this.subscriber.unsubscribe(channel);
        this.activeSubscriptions.delete(channel);
        this.subscriptionCallbacks.delete(channel);
      }
    } else {
      await this.subscriber.unsubscribe(channel);
      this.activeSubscriptions.delete(channel);
      this.subscriptionCallbacks.delete(channel);
    }
  }

  async publishModeChange(
    executionId: string,
    mode: string
  ): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');

    const channel = `workflow:${executionId}:mode`;
    const message = JSON.stringify({
      executionId,
      mode,
      timestamp: new Date().toISOString()
    });

    await this.redis.publish(channel, message);
    logger.info(`[REDIS-MODE] Published mode change for ${executionId}: ${mode}`);
  }

  // Zero Fallback Configuration
  async getZeroFallbackConfig(): Promise<{ fallbackEnabled: boolean; allowMutations: boolean; pollIntervalMs: number }> {
    if (!this.redis) throw new Error('Redis not initialized');
    const enabled = await this.redis.get('zero:fallback_enabled');
    const mutations = await this.redis.get('zero:allow_mutations');
    const pollInterval = await this.redis.get('zero:poll_interval_ms');
    return {
      fallbackEnabled: enabled === 'true',
      allowMutations: mutations === 'true',
      pollIntervalMs: pollInterval ? parseInt(pollInterval, 10) : 15000, // Default 15 seconds
    };
  }

  async setZeroFallbackConfig(config: { fallbackEnabled: boolean; allowMutations: boolean; pollIntervalMs: number }): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    await this.redis.set('zero:fallback_enabled', String(config.fallbackEnabled));
    await this.redis.set('zero:allow_mutations', String(config.allowMutations));
    await this.redis.set('zero:poll_interval_ms', String(config.pollIntervalMs));
  }

  private static readonly USER_HEADER_OVERRIDES_KEY = 'user-header-overrides';

  async getAllUserHeaderOverrides(): Promise<Record<string, Record<string, string>>> {
    if (!this.redis) throw new Error('Redis not initialized');
    const raw = await this.redis.hgetall(RedisService.USER_HEADER_OVERRIDES_KEY);
    const result: Record<string, Record<string, string>> = {};
    for (const [userId, json] of Object.entries(raw)) {
      try {
        result[userId] = JSON.parse(json);
      } catch {
        logger.warn(`[USER-HEADERS] Skipping corrupt override entry for user ${userId}`);
      }
    }
    return result;
  }

  async getUserHeaderOverrides(userId: string): Promise<Record<string, string>> {
    if (!this.redis) throw new Error('Redis not initialized');
    const json = await this.redis.hget(RedisService.USER_HEADER_OVERRIDES_KEY, userId);
    if (!json) return {};
    try {
      return JSON.parse(json);
    } catch {
      logger.warn(`[USER-HEADERS] Corrupt override entry for user ${userId}, treating as empty`);
      return {};
    }
  }

  async setUserHeaderOverrides(userId: string, headers: Record<string, string>): Promise<Record<string, string>> {
    if (!this.redis) throw new Error('Redis not initialized');
    const merged = { ...(await this.getUserHeaderOverrides(userId)), ...headers };
    await this.redis.hset(RedisService.USER_HEADER_OVERRIDES_KEY, userId, JSON.stringify(merged));
    return merged;
  }

  async removeUserHeaderOverrides(userId: string, headerNames?: string[]): Promise<Record<string, string>> {
    if (!this.redis) throw new Error('Redis not initialized');
    if (!headerNames || headerNames.length === 0) {
      await this.redis.hdel(RedisService.USER_HEADER_OVERRIDES_KEY, userId);
      return {};
    }
    const current = await this.getUserHeaderOverrides(userId);
    const toRemove = new Set(headerNames.map(name => name.toLowerCase()));
    const remaining: Record<string, string> = {};
    for (const [name, value] of Object.entries(current)) {
      if (!toRemove.has(name.toLowerCase())) remaining[name] = value;
    }
    if (Object.keys(remaining).length === 0) {
      await this.redis.hdel(RedisService.USER_HEADER_OVERRIDES_KEY, userId);
    } else {
      await this.redis.hset(RedisService.USER_HEADER_OVERRIDES_KEY, userId, JSON.stringify(remaining));
    }
    return remaining;
  }

  /**
   * Atomically get all items from a Redis list and delete the key if empty.
   * Uses Lua script to handle race conditions.
   * Returns null if key is empty or doesn't exist (and deletes it).
   */
 async fetchListAndCleanupIfEmpty(key: string, trackingSetKey?: string): Promise<string[] | null> {    if (!this.redis) {
      logger.warn('[REDIS] Cannot fetchListAndCleanupIfEmpty - Redis not initialized');
      return null;
    }

    const luaScript = `
      local data = redis.call('LRANGE', KEYS[1], 0, -1)
      if #data == 0 then
        redis.call('DEL', KEYS[1])
        if KEYS[2] then
          redis.call('SREM', KEYS[2], KEYS[1])
        end
        return nil
      end
      return data
    `;

    try {
      const keys = trackingSetKey ? [key, trackingSetKey] : [key];
      const result = await this.redis.eval(luaScript, keys.length, ...keys) as string[] | null;
      return result;
    } catch (error) {
      logger.error(`[REDIS] Lua script failed for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Atomically read all items from a Redis list, then always delete the key
   * and remove it from the tracking set
   * Use this when data should be consumed exactly once (e.g., syncing to GCS).
   * Returns null if the key is empty or doesn't exist.
   */
  async fetchListAndDelete(key: string, trackingSetKey?: string): Promise<string[] | null> {
    if (!this.redis) {
      logger.warn('[REDIS] Cannot fetchListAndDelete - Redis not initialized');
      return null;
    }

    const luaScript = `
      local data = redis.call('LRANGE', KEYS[1], 0, -1)
      redis.call('DEL', KEYS[1])
      if KEYS[2] then
        redis.call('SREM', KEYS[2], KEYS[1])
      end
      if #data == 0 then
        return nil
      end
      return data
    `;

    try {
      const keys = trackingSetKey ? [key, trackingSetKey] : [key];
      const result = await this.redis.eval(luaScript, keys.length, ...keys) as string[] | null;
      return result;
    } catch (error) {
      logger.error(`[REDIS] Lua script failed for key ${key}:`, error);
      throw error;
    }
  }

  // Getter for direct Redis access (use sparingly)
  getClient() {
    if (!this.redis) throw new Error('Redis not initialized');
    return this.redis;
  }

  // Assignment state backup management
  /**
   * Store user's assignment state backup in Redis
   * Stores state per group: { groupId: { onCall, isActiveForAssignment } }
   * Only stores groups where onCall === true OR isActiveForAssignment === true
   */
  async storeAssignmentStateBackup(
    userId: string,
    stateBackup: Record<string, { onCall: boolean; isActiveForAssignment: boolean }>
  ): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    const key = `assignment:state:backup:${userId}`;
    await this.redis.set(key, JSON.stringify(stateBackup));
    // No TTL - will be deleted manually when restored
  }

  /**
   * Get user's assignment state backup from Redis
   */
  async getAssignmentStateBackup(
    userId: string
  ): Promise<Record<string, { onCall: boolean; isActiveForAssignment: boolean }> | null> {
    if (!this.redis) throw new Error('Redis not initialized');
    const key = `assignment:state:backup:${userId}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    logger.info(`📦 [ASSIGNMENT-STATE] Retrieved assignment state backup for user ${userId}:`, data);
    // logging for each group
    const parsedData = JSON.parse(data) as Record<string, { onCall: boolean; isActiveForAssignment: boolean }>;
    return parsedData;
  }

  /**
   * Delete user's assignment state backup from Redis
   */
  async deleteAssignmentStateBackup(userId: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    const key = `assignment:state:backup:${userId}`;
    await this.redis.del(key);
  }
}

// Export singleton instance
export const redisService = new RedisService();
