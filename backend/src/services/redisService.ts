import Redis from 'ioredis';
import { logger } from '@/utils/logger';

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
  type: 'channel_added' | 'channel_removed' | 'participant_added' | 'participant_removed' | 'user_mentioned' | 'incoming_call' | 'call_ended' | 'call_cancelled';
  userId: string;
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

  private initializeRedis(): void {
    try {
      // Base configuration
      const baseConfig = {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      };

      const config = {
        ...baseConfig,
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
        ...(process.env.REDIS_TLS === 'true' && {
          tls: {
            rejectUnauthorized: false
          }
        })
      };

      // Main Redis instance for data operations
      this.redis = new Redis(config);

      // Publisher instance for broadcasting messages
      this.publisher = new Redis(config);

      // Subscriber instance for listening to messages
      this.subscriber = new Redis(config);

      this.redis.on('connect', () => {
        logger.info('🔴 [REDIS-CONNECTION] Redis connected successfully');
        logger.info('Redis connected successfully');
      });

      this.redis.on('error', (error) => {
        logger.info('❌ [REDIS-CONNECTION] Redis connection error:', error);
        logger.error('Redis connection error:', error);
      });

    } catch (error) {
      logger.error('Failed to initialize Redis:', error);
    }
  }

  async connect(): Promise<void> {
    try {
      if (this.redis) await this.redis.connect();
      if (this.publisher) await this.publisher.connect();
      if (this.subscriber) await this.subscriber.connect();
      logger.info('All Redis connections established');
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
    }
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

  async getSocketPlatform(userId: string, socketId: string): Promise<string | null> {
    if (!this.redis) throw new Error('Redis not initialized');
    const platformKey = `user:${userId}:socket:${socketId}:platform`;
    return await this.redis.get(platformKey);
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

  // Notification broadcasting (Worker -> API Server)
  async broadcastNotificationEvent(userId: string, notification: any): Promise<void> {
    // This reuses the user event channel which WebSocketService already subscribes to
    await this.broadcastUserEvent(userId, {
      type: 'notification_received', // This matches the socket event name we want to emit
      userId,
      data: notification,
      timestamp: new Date()
    } as any);
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

  // Subscribe to workflow events (for real-time step updates)
  async subscribeToWorkflowEvents(
    executionId: string,
    callback: (event: WorkflowEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `workflow:${executionId}:events`;

    // Add callback to the list for this channel
    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);

    // Ensure global message handler is set up
    this.setupGlobalMessageHandler();

    // Only subscribe to Redis if we haven't already
    if (!this.activeSubscriptions.has(channel)) {
      logger.info(`📊 [REDIS-SUB] Subscribing to workflow events channel: ${channel}`);
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  // Unsubscribe from workflow events
  async unsubscribeFromWorkflowEvents(
    executionId: string,
    callback?: (event: WorkflowEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    const channel = `workflow:${executionId}:events`;

    if (callback) {
      // Remove specific callback
      const callbacks = this.subscriptionCallbacks.get(channel) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        logger.info(`📊 [REDIS-UNSUB] Removed callback from workflow events channel: ${channel}`);
      }

      // If no more callbacks, unsubscribe from Redis
      if (callbacks.length === 0) {
        await this.unsubscribeFromChannel(channel);
      }
    } else {
      // Remove all callbacks and unsubscribe
      await this.unsubscribeFromChannel(channel);
      logger.info(`📊 [REDIS-UNSUB] Unsubscribed from workflow events channel: ${channel}`);
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

  async exists(key: string): Promise<boolean> {
    if (!this.redis) throw new Error('Redis not initialized');
    const result = await this.redis.exists(key);
    return result === 1;
  }

  /**
   * Set a key with optional TTL - does NOT modify the key (unlike cacheSessionData)
   * Use this for user status keys where we need to check existence later
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    if (ttlSeconds !== undefined) {
      await this.redis.setex(key, ttlSeconds, value);
    } else {
      await this.redis.set(key, value);
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
    // for (const [groupId, state] of Object.entries(parsedData)) {
    //   logger.info(`   - Group ${groupId}: onCall=${state.onCall}, isActiveForAssignment=${state.isActiveForAssignment}`);
    // }
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