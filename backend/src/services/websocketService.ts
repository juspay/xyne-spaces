import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';

import { redisService, ChatMessage, WorkflowEvent } from './redisService';
import { typingService, TypingUser } from './typingService';
import { userStatusService, OnlineUser } from './userStatusService';
import { workspaceEventService, WorkspaceEvent } from './workspaceEventService';
import { ChannelRepository } from '../database/repositories/channelRepository';
import { ConversationRepository } from '../database/repositories/conversationRepository';
import { DatabaseClient } from '../database/client';
import { logger } from '@/utils/logger';
import { authMiddleware } from '../middleware/auth';
import { notificationService } from '@/notification-service';
import { messageCountService, MessageCountData, AllTimeMessageCountData } from './messageCountService';
import { userCountService, UserCountData, AllTimeUserCountData } from './userCountService';
import { callCountService, CallCountData, AllTimeCallCountData, CallDurationData, AllTimeCallDurationData } from './callCountService';
import { type NotificationData } from './notificationService';
import { NotificationDeliveryMethod, NotificationType } from '@prisma/client';


interface AuthenticatedSocket extends Socket {
  userId: string;
  userEmail: string;
  userName: string;
}

interface JoinSessionData {
  sessionId: string; // This will be channelId or conversationId
}



interface SubscribeToChannelsData {
  channels: string[];
  conversations: string[];
}

interface ChannelSubscriptionData {
  sessionId: string;
}

class WebSocketService {
  private io: SocketIOServer | null = null;
  private channelRepository: ChannelRepository;
  private conversationRepository: ConversationRepository;

  // Track per-socket subscriptions for user-driven subscription model
  private socketSubscriptions = new Map<string, Set<string>>(); // socketId -> Set<sessionId>
  private sessionSubscribers = new Map<string, Set<string>>(); // sessionId -> Set<socketId>

  // Track user event subscriptions
  private userEventSubscriptions = new Map<string, boolean>(); // userId -> hasSubscription

  // Track workflow room membership for Redis subscription cleanup
  private workflowRoomSubscribers = new Map<string, Set<string>>(); // executionId -> Set<socketId>

  constructor() {
    this.channelRepository = new ChannelRepository();
    this.conversationRepository = new ConversationRepository();
  }

  initialize(httpServer: HttpServer): void {
    this.io = new SocketIOServer(httpServer, {
      path: '/api/socket.io/',
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      // Ping/pong configuration to keep connection alive
      pingInterval: 5000, // Send ping every 5 seconds
      pingTimeout: 25000, // Wait 25 seconds for pong response before disconnecting
    });

    // Authentication middleware - reuse Express auth logic
    this.io.use(async (socket, next) => {
      try {
        // Extract token same way as Express routes expect it
        const authHeader = socket.handshake.auth.token ?
          `Bearer ${socket.handshake.auth.token}` :
          socket.handshake.headers.authorization;

        // Build headers object same as Express requests
        const headers: any = {
          authorization: authHeader,
          ...socket.handshake.headers
        };

        // Add auth data from socket.handshake.auth to headers (for dev mode)
        Object.keys(socket.handshake.auth).forEach(key => {
          if (key !== 'token') {
            headers[key.toLowerCase()] = socket.handshake.auth[key];
          }
        });

        // Parse cookies from socket handshake (cookie-parser not available for socket.io)
        const cookies: Record<string, string> = {};
        const cookieHeader = socket.handshake.headers.cookie;
        if (cookieHeader) {
          cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            if (name && value) {
              cookies[name] = decodeURIComponent(value);
            }
          });
        }

        // Create Express-compatible request object
        const req = {
          headers,
          cookies, // Add parsed cookies
          ip: socket.handshake.address,
          hostname: socket.handshake.headers.host?.split(':')[0] || 'unknown',
          get: (header: string) => headers[header.toLowerCase()],
          method: 'GET',
          path: '/api/socket.io/'
        } as any;

        // Create Express-compatible response object
        const res = {
          status: (code: number) => ({
            json: (data: any) => {
              logger.warn(`WebSocket auth failed with ${code}: ${data.message}`);
              next(new Error(data.message || 'Authentication failed'));
            }
          }),
          cookie: () => { },
          setHeader: () => { } // Ignore headers for WebSocket
        } as any;

        // Create Express-compatible next function
        const expressNext = (error?: any) => {
          if (error) {
            next(error);
            return;
          }

          if (req.user) {
            // Attach user info to socket same as Express attaches to req
            (socket as any).userId = req.user.id;
            (socket as any).userEmail = req.user.email;
            (socket as any).userName = req.user.name;
            (socket as any).user = req.user;

            logger.info(`WebSocket authenticated: ${req.user.email} (${req.user.id})`);
            logger.info(`Socket ${socket.id} assigned user: ${req.user.name} (${req.user.email})`);
            next();
          } else {
            next(new Error('Authentication failed: No user data'));
          }
        };

        // Use same auth middleware as Express routes
        await authMiddleware.authenticate(req, res, expressNext);

      } catch (error) {
        logger.error('WebSocket authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });

    // Handle connections
    this.io.on('connection', (socket) => {
      this.handleConnection(socket as AuthenticatedSocket);
    });

    // Setup message count subscription
    this.setupMessageCountSubscription();

    // Setup user count subscription
    this.setupUserCountSubscription();

    // Setup call count subscription
    this.setupCallCountSubscription();

    // Setup call duration subscription
    this.setupCallDurationSubscription();

    logger.info('WebSocket server initialized');
  }

  /**
   * Helper to detect platform from socket headers
   */
  private getPlatformFromSocket(socket: AuthenticatedSocket): string {
    const userAgent = socket.handshake.headers['user-agent']?.toLowerCase() || '';
    
    if (userAgent.includes('electron')) {
      return 'electron';
    }

    if (userAgent.includes('android')) {
      return 'android';
    }
    
    if (
      userAgent.includes('iphone') || 
      userAgent.includes('ipad') || 
      userAgent.includes('ios')
    ) {
      return 'ios';
    }

    // Default to web
    return 'web';
  }

  private async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const { userId, userEmail, userName } = socket;

    logger.info(`🔌 [CONNECT] User ${userEmail} connected via WebSocket (Socket ID: ${socket.id})`);

    // Detect platform
    const platform = this.getPlatformFromSocket(socket);

    // Add user connection to Redis with platform info
    await redisService.addUserConnection(userId, socket.id, platform);

    // Debug: Check connections after adding
    const userConnections = await redisService.getUserConnections(userId);
    logger.info(`🔌 [CONNECT] User ${userId} now has ${userConnections.length} connections: [${userConnections.join(', ')}]`);

    // Subscribe to user-specific events (only once per user across all their connections)
    await this.setupUserEventSubscription(userId);

    // Set user status to ONLINE automatically on connect (unless status is AWAY)
    try {
      // Check current status in database
      const prisma = DatabaseClient.getInstance();
      const currentPresence = await prisma.userPresence.findUnique({
        where: { userId }
      });
      
      // Only auto-set ONLINE if user is not AWAY
      if (!currentPresence || currentPresence.status !== 'AWAY') {
        const deviceInfo = `${socket.handshake.headers['user-agent']?.substring(0, 100) || 'Unknown'} - ${socket.handshake.address}`;
        const allOnlineUsers = await userStatusService.setUserStatus(
          userId,
          'ONLINE',
          {
            userName: userName || userEmail.split('@')[0],
            userEmail,
            deviceInfo
          }
        );

        // Broadcast user online status to all relevant sessions
        await this.broadcastUserStatusUpdate(userId, 'ONLINE', allOnlineUsers);

        logger.info(`👤 [USER-STATUS] User ${userName || userEmail} is now ONLINE (${allOnlineUsers.length} total online users)`);
      } else {
        logger.info(`👤 [USER-STATUS] User ${userName || userEmail} remains AWAY on connect`);
      }
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error setting user online status:', error);
    }

    // Handle joining sessions
    socket.on('join_session', async (data: JoinSessionData) => {
      await this.handleJoinSession(socket, data);
    });

    // Handle leaving sessions
    socket.on('leave_session', async (data: JoinSessionData) => {
      await this.handleLeaveSession(socket, data);
    });



    // Handle marking channel as viewed
    socket.on('mark_channel_viewed', async (data: { channelId: string; conversationId: string }) => {
      await this.handleMarkChannelViewed(socket, data);
    });

    // Handle typing indicators
    socket.on('typing_start', async (data: { sessionId: string }) => {
      logger.info("sessionId rrrr", data.sessionId);
      await this.handleTypingStart(socket, data.sessionId);
    });

    socket.on('typing_stop', async (data: { sessionId: string }) => {
      await this.handleTypingStop(socket, data.sessionId);
    });

    // Handle user status updates
    socket.on('update_status', async (data: { status: 'ONLINE' | 'AWAY' | 'OFFLINE' }) => {
      await this.handleStatusUpdate(socket, data.status);
    });

    // Handle user activity (extends online time)
    // Supports acknowledgment callback for reliable delivery detection
    socket.on('user_activity', async (_data: unknown, callback?: (ack: { success: boolean }) => void) => {
      await this.handleUserActivity(socket);
      
      // Send acknowledgment if callback provided (for heartbeat reliability)
      if (typeof callback === 'function') {
        callback({ success: true });
      }
    });

    // Handle bulk channel subscriptions (new user-driven model)
    socket.on('subscribe_to_channels', async (data: SubscribeToChannelsData) => {
      await this.handleBulkSubscription(socket, data);
    });

    // Handle adding single channel subscription
    socket.on('add_channel_subscription', async (data: ChannelSubscriptionData) => {
      await this.handleAddSubscription(socket, data);
    });

    // Handle removing single channel subscription
    socket.on('remove_channel_subscription', async (data: ChannelSubscriptionData) => {
      await this.handleRemoveSubscription(socket, data);
    });

    // Handle notification acknowledgments
    socket.on('notification_acknowledged', async (data: { notificationId: string }) => {
      await this.handleNotificationAcknowledgment(socket, data);
    });

    // Handle workflow subscription (room-based)
    socket.on('subscribe_to_workflow', (data: { executionId: string }) => {
      this.handleWorkflowSubscription(socket, data.executionId);
    });

    // Handle workflow unsubscription
    socket.on('unsubscribe_from_workflow', (data: { executionId: string }) => {
      this.handleWorkflowUnsubscription(socket, data.executionId);
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      logger.info(`🔌 [DISCONNECT] Socket ${socket.id} (user: ${socket.userId}) disconnecting...`);
      await this.handleDisconnection(socket);
    });

    // Add debugging for when socket leaves rooms
    socket.on('disconnecting', () => {
      logger.info(`🔌 [DISCONNECTING] Socket ${socket.id} (user: ${socket.userId}) is disconnecting...`);
      logger.info(`🔌 [DISCONNECTING] Socket was in rooms:`, Array.from(socket.rooms));
    });
  }

  private async handleJoinSession(socket: AuthenticatedSocket, data: JoinSessionData): Promise<void> {
    try {
      const { sessionId } = data; // This is either channelId or conversationId
      const { userId } = socket;

      logger.info(`🎯 [JOIN-SESSION] handleJoinSession called:`, {
        socketId: socket.id,
        userId,
        sessionId,
        userEmail: socket.userEmail
      });

      logger.info(`Attempting to join session: ${sessionId} for user: ${userId}`);

      // Try to find as channel first, then as conversation
      let isChannel = false;

      let entity = null;

      // First, try to find as a channel
      logger.info(`Searching for channel with ID: ${sessionId}`);
      entity = await this.channelRepository.findById(sessionId);

      if (entity) {
        isChannel = true;
        logger.info(`Found channel: ${entity.name}`);
      } else {
        // Not a channel, try as a conversation
        logger.info(`Searching for conversation with ID: ${sessionId}`);
        entity = await this.conversationRepository.findById(sessionId);

        if (entity) {

          logger.info(`Found conversation: ${entity.conversationId}`);
        }
      }

      if (!entity) {
        logger.warn(`No channel or conversation found for sessionId: ${sessionId}`);
        socket.emit('error', { message: 'Channel or conversation not found' });
        return;
      }

      // Join socket room (using same format for compatibility)
      logger.info(`🎯 [JOIN-SESSION] Joining socket to room: session:${sessionId}`);
      await socket.join(`session:${sessionId}`);
      logger.info(`🎯 [JOIN-SESSION] Socket successfully joined room: session:${sessionId}`);

      // Add to Redis tracking
      logger.info(`🎯 [JOIN-SESSION] Adding to Redis tracking...`);
      try {
        await redisService.subscribeToSession(sessionId, socket.id);
        await redisService.addParticipantToSession(sessionId, userId);
        logger.info(`🎯 [JOIN-SESSION] Successfully added to Redis tracking`);
      } catch (redisError) {
        logger.error(`🎯 [JOIN-SESSION] ❌ Redis tracking failed:`, redisError);
        // Continue even if Redis fails - socket.io room should still work
      }

      // Notify other participants
      socket.to(`session:${sessionId}`).emit('user_joined', {
        sessionId,
        userId,
        timestamp: new Date()
      });

      // Confirm join to user
      logger.info(`🎯 [JOIN-SESSION] Sending session_joined confirmation to user`);
      socket.emit('session_joined', {
        sessionId,
        participants: isChannel ? [] : [], // TODO: Get actual participants from channel/conversation
        timestamp: new Date()
      });

      const entityType = isChannel ? 'channel' : 'conversation';
      logger.info(`🎯 [JOIN-SESSION] ✅ User ${userId} successfully joined ${entityType} ${sessionId}`);
      logger.info(`User ${userId} joined ${entityType} ${sessionId}`);
    } catch (error) {
      logger.error(`🎯 [JOIN-SESSION] ❌ Error in handleJoinSession:`, {
        sessionId: data.sessionId,
        userId: socket.userId,
        error: error instanceof Error ? error.message : error
      });
      logger.error('Error handling join session:', error);
      socket.emit('error', { message: 'Failed to join session' });
    }
  }

  private async handleLeaveSession(socket: AuthenticatedSocket, data: JoinSessionData): Promise<void> {
    try {
      const { sessionId } = data;
      const { userId } = socket;

      // Leave socket room
      await socket.leave(`session:${sessionId}`);

      // Remove from Redis tracking
      await redisService.unsubscribeFromSession(sessionId, socket.id);
      await redisService.removeParticipantFromSession(sessionId, userId);

      // Notify other participants
      socket.to(`session:${sessionId}`).emit('user_left', {
        sessionId,
        userId,
        timestamp: new Date()
      });

      // Confirm leave to user
      socket.emit('session_left', {
        sessionId,
        timestamp: new Date()
      });

      logger.info(`User ${userId} left session ${sessionId}`);
    } catch (error) {
      logger.error('Error handling leave session:', error);
      socket.emit('error', { message: 'Failed to leave session' });
    }
  }


  private async handleMarkChannelViewed(socket: AuthenticatedSocket, data: { channelId: string; conversationId: string }): Promise<void> {
    try {
      const { channelId, conversationId } = data;
      const { userId } = socket;

      // Update database
      const { unreadService } = await import('./unreadService');
      await unreadService.markChannelAsViewed(channelId, userId, conversationId);

      // Broadcast to user's other connected clients
      await this.broadcastToUser(userId, 'channel_viewed', {
        channelId,
        conversationId,
        timestamp: new Date()
      });

      logger.info(`User ${userId} marked channel ${channelId} as viewed`);
    } catch (error) {
      logger.error('Error handling mark channel viewed:', error);
    }
  }

  private async handleTypingStart(socket: AuthenticatedSocket, sessionId: string): Promise<void> {
    try {
      const { userId, userName, userEmail } = socket;

      logger.info(`🔍 [TYPING-DEBUG] Socket ${socket.id} - User ${userName} (${userEmail}) [ID: ${userId}] started typing in session: ${sessionId}`);

      // Create typing user object
      const typingUser: TypingUser = {
        userId,
        userName: userName || 'Unknown User',
        userEmail
      };

      // Determine if this is a channel or conversation
      const isChannel = await this.isChannelSession(sessionId);

      let allTypingUsers: TypingUser[] = [];

      if (isChannel) {
        // Handle channel typing
        allTypingUsers = await typingService.startTypingInChannel(sessionId, typingUser);
      } else {
        // Handle conversation typing
        allTypingUsers = await typingService.startTypingInConversation(sessionId, typingUser);
      }

      // Use Redis-only for all typing events (both same-pod and cross-pod)
      await typingService.broadcastTypingUpdate(sessionId, allTypingUsers, isChannel, 'typing_start');

      logger.info(`Typing users in ${sessionId}: ${allTypingUsers.map(u => u.userName).join(', ')}`);
    } catch (error) {
      logger.error('Error handling typing start:', error);
    }
  }

  private async handleTypingStop(socket: AuthenticatedSocket, sessionId: string): Promise<void> {
    try {
      const { userId, userName } = socket;

      logger.info(`User ${userName} stopped typing in session: ${sessionId}`);

      // Determine if this is a channel or conversation
      const isChannel = await this.isChannelSession(sessionId);

      let allTypingUsers: TypingUser[] = [];

      if (isChannel) {
        // Handle channel typing
        allTypingUsers = await typingService.stopTypingInChannel(sessionId, userId);
      } else {
        // Handle conversation typing
        allTypingUsers = await typingService.stopTypingInConversation(sessionId, userId);
      }

      // Use Redis-only for all typing events (both same-pod and cross-pod)
      await typingService.broadcastTypingUpdate(sessionId, allTypingUsers, isChannel, 'typing_stop');

      logger.info(`Typing users in ${sessionId}: ${allTypingUsers.map(u => u.userName).join(', ')}`);
    } catch (error) {
      logger.error('Error handling typing stop:', error);
    }
  }

  /**
   * Helper method to determine if a session ID belongs to a channel or conversation
   */
  private async isChannelSession(sessionId: string): Promise<boolean> {
    try {
      const channel = await this.channelRepository.findById(sessionId);
      return !!channel;
    } catch (error) {
      logger.error(`Error checking if session ${sessionId} is a channel:`, error);
      return false;
    }
  }

  private async handleDisconnection(socket: AuthenticatedSocket): Promise<void> {
    try {
      const { userId, userEmail, userName } = socket;

      logger.info(`🔌 [DISCONNECT] Socket ${socket.id} disconnecting for user ${userName || userEmail} (${userId})`);

      // Clean up channel subscriptions for this socket
      await this.clearSocketSubscriptions(socket.id);
      logger.info(`🧹 [DISCONNECT] Cleaned up subscriptions for socket ${socket.id}`);

      // Clean up workflow room subscriptions for this socket
      await this.cleanupWorkflowSubscriptions(socket.id);

      // Remove user connection from Redis
      await redisService.removeUserConnection(userId, socket.id);

      // Check if user has other active connections
      const remainingConnections = await redisService.getUserConnections(userId);
      
      if (remainingConnections.length > 0) {
        // User has other tabs/devices open - do nothing, they're still connected
        logger.info(`👤 [USER-STATUS] User ${userName || userEmail} still has ${remainingConnections.length} other connection(s), staying ONLINE`);
      } else {
        // No remaining connections - but DON'T mark OFFLINE immediately!
        // Let the grace period handle it:
        // - Redis TTL (90s) will keep user in ONLINE state briefly
        // - If user reopens tab, heartbeat will refresh the TTL
        // - If no heartbeat for 5 min, cleanup job marks OFFLINE
        // This prevents flicker when user refreshes page or briefly closes tab
        logger.info(`👤 [USER-STATUS] User ${userName || userEmail} has no remaining connections, grace period started (cleanup job will mark OFFLINE if no heartbeat)`);
      }

      // Clean up typing indicators for this user
      await typingService.cleanupUserTyping(userId);

      // Get all sessions this socket was subscribed to and clean up
      const rooms = Array.from(socket.rooms);
      for (const room of rooms) {
        if (room.startsWith('session:')) {
          const sessionId = room.replace('session:', '');
          await redisService.unsubscribeFromSession(sessionId, socket.id);

          // Always notify offline when user disconnects (immediate offline)
          socket.to(room).emit('user_offline', {
            sessionId,
            userId,
            timestamp: new Date()
          });

          // Broadcast updated typing state (user is no longer typing)
          const isChannel = await this.isChannelSession(sessionId);
          const typingUsers = isChannel
            ? await typingService.getTypingUsersInChannel(sessionId)
            : await typingService.getTypingUsersInConversation(sessionId);

          socket.to(room).emit('typing_updated', {
            sessionId,
            typingUsers,
            isChannel,
            timestamp: new Date()
          });
        }
      }

      logger.info(`User ${userEmail} disconnected from WebSocket`);
    } catch (error) {
      logger.error('Error handling disconnection:', error);
    }
  }

  private async handleStatusUpdate(socket: AuthenticatedSocket, status: 'ONLINE' | 'AWAY' | 'OFFLINE'): Promise<void> {
    try {
      const { userId, userName, userEmail } = socket;

      logger.info(`👤 [USER-STATUS] User ${userName || userEmail} manually updating status to ${status}`);

      const deviceInfo = `${socket.handshake.headers['user-agent']?.substring(0, 100) || 'Unknown'} - ${socket.handshake.address}`;
      const allOnlineUsers = await userStatusService.setUserStatus(
        userId,
        status,
        {
          userName: userName || userEmail.split('@')[0],
          userEmail,
          deviceInfo
        }
      );

      // Broadcast user status update to all relevant sessions
      await this.broadcastUserStatusUpdate(userId, status, allOnlineUsers);

      // Confirm status update to user
      socket.emit('status_updated', {
        userId,
        status,
        timestamp: new Date()
      });

      logger.info(`👤 [USER-STATUS] User ${userName || userEmail} status manually updated to ${status}`);
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error handling status update:', error);
      socket.emit('status_update_error', { message: 'Failed to update status' });
    }
  }

  private async handleUserActivity(socket: AuthenticatedSocket): Promise<void> {
    try {
      const { userId, userName, userEmail } = socket;
      const deviceInfo = `${socket.handshake.headers['user-agent']?.substring(0, 100) || 'Unknown'} - ${socket.handshake.address}`;

      // Log at info level so we can see heartbeats in production logs
      logger.info(`💓 [HEARTBEAT] Received from ${userName || userEmail} (${userId}) via socket ${socket.id}`);

      // Update user activity (extends online time)
      await userStatusService.updateUserActivity(userId, deviceInfo);
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error handling user activity:', error);
    }
  }

  private async handleNotificationAcknowledgment(socket: AuthenticatedSocket, data: { notificationId: string }): Promise<void> {
    try {
      const { userId } = socket;
      const { notificationId } = data;

      logger.info(`🔔 [NOTIFICATION-ACK] User ${userId} acknowledged notification ${notificationId}`);

      // Call notification service to mark as acknowledged
      const success = await notificationService.acknowledgeNotification(notificationId, userId);

      if (success) {
        logger.info(`✅ [NOTIFICATION-ACK] Successfully processed acknowledgment for notification ${notificationId} from user ${userId}`);
      } else {
        logger.warn(`⚠️ [NOTIFICATION-ACK] Failed to process acknowledgment for notification ${notificationId} from user ${userId}`);
      }
    } catch (error) {
      logger.error(`❌ [NOTIFICATION-ACK] Error processing notification acknowledgment:`, error);
    }
  }

  private async handleBulkSubscription(socket: AuthenticatedSocket, data: SubscribeToChannelsData): Promise<void> {
    try {
      const { channels, conversations } = data;
      const allSessions = [...channels, ...conversations];

      // logger.info(`📋 [BULK-SUB] Socket ${socket.id} (user: ${socket.userId}) subscribing to ${allSessions.length} sessions:`, allSessions);

      // Clear existing subscriptions for this socket
      await this.clearSocketSubscriptions(socket.id);

      // Subscribe to all requested sessions
      for (const sessionId of allSessions) {
        // logger.info(`📋 [BULK-SUB] Processing session ${sessionId} for socket ${socket.id}`);
        await this.addSocketSubscription(socket.id, sessionId);
      }

      // Confirm subscription
      socket.emit('subscriptions_updated', {
        subscribed: allSessions,
        total: allSessions.length,
        timestamp: new Date()
      });

      // logger.info(`✅ [BULK-SUB] Socket ${socket.id} subscribed to ${allSessions.length} sessions`);
    } catch (error) {
      // logger.error(`❌ [BULK-SUB] Error in bulk subscription for socket ${socket.id}:`, error);
      socket.emit('subscription_error', { message: 'Failed to subscribe to channels' });
    }
  }

  private async handleAddSubscription(socket: AuthenticatedSocket, data: ChannelSubscriptionData): Promise<void> {
    try {
      const { sessionId } = data;

      logger.info(`➕ [ADD-SUB] Socket ${socket.id} adding subscription to session: ${sessionId}`);

      await this.addSocketSubscription(socket.id, sessionId);

      socket.emit('subscription_added', {
        sessionId,
        timestamp: new Date()
      });

      logger.info(`✅ [ADD-SUB] Socket ${socket.id} subscribed to session: ${sessionId}`);
    } catch (error) {
      logger.error(`❌ [ADD-SUB] Error adding subscription for socket ${socket.id}:`, error);
      socket.emit('subscription_error', { message: 'Failed to add channel subscription' });
    }
  }

  private async handleRemoveSubscription(socket: AuthenticatedSocket, data: ChannelSubscriptionData): Promise<void> {
    try {
      const { sessionId } = data;

      logger.info(`➖ [REMOVE-SUB] Socket ${socket.id} removing subscription from session: ${sessionId}`);

      await this.removeSocketSubscription(socket.id, sessionId);

      socket.emit('subscription_removed', {
        sessionId,
        timestamp: new Date()
      });

      logger.info(`✅ [REMOVE-SUB] Socket ${socket.id} unsubscribed from session: ${sessionId}`);
    } catch (error) {
      logger.error(`❌ [REMOVE-SUB] Error removing subscription for socket ${socket.id}:`, error);
      socket.emit('subscription_error', { message: 'Failed to remove channel subscription' });
    }
  }

  private async broadcastUserStatusUpdate(userId: string, status: 'ONLINE' | 'AWAY' | 'OFFLINE', allOnlineUsers: OnlineUser[]): Promise<void> {
    try {
      if (!this.io) return;

      // Broadcast to all connected clients
      this.io.emit('user_status_updated', {
        userId,
        status,
        onlineUsers: allOnlineUsers,
        timestamp: new Date()
      });

      // Also broadcast to specific user's connections
      await this.broadcastToUser(userId, 'own_status_updated', {
        status,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error broadcasting user status update:', error);
    }
  }

  // Setup user event subscription (once per user)
  private async setupUserEventSubscription(userId: string): Promise<void> {
    // Check if we're already subscribed to this user's events
    if (this.userEventSubscriptions.has(userId)) {
      logger.info(`👤 [USER-EVENTS] Already subscribed to events for user: ${userId}`);
      return;
    }

    try {
      logger.info(`👤 [USER-EVENTS] Setting up event subscription for user: ${userId}`);

      await redisService.subscribeToUserEvents(userId, (event: any) => {
        this.handleUserEvent(userId, event);
      });

      this.userEventSubscriptions.set(userId, true);
      logger.info(`✅ [USER-EVENTS] Successfully subscribed to events for user: ${userId}`);
    } catch (error) {
      logger.error(`❌ [USER-EVENTS] Error setting up user event subscription for ${userId}:`, error);
    }
  }

  // Handle user events from Redis and broadcast to user's connections
  private async handleUserEvent(userId: string, event: any): Promise<void> {
    try {
      logger.info(`👤 [USER-EVENT] Received event for user ${userId}:`, {
        type: event.type,
        timestamp: event.timestamp
      });

      // Get all active connections for this user
      const userConnections = await redisService.getUserConnections(userId);

      if (userConnections.length === 0) {
        logger.info(`👤 [USER-EVENT] No active connections for user ${userId}, skipping broadcast`);
        return;
      }

      logger.info(`👤 [USER-EVENT] Broadcasting ${event.type} to ${userConnections.length} connections for user ${userId}`);

      // Broadcast to all user's active connections
      for (const socketId of userConnections) {
        // Special filtering and edge creation for notifications
        if (event.type === 'notification_received') {
          const handled = await this.handleNotificationEvent(userId, socketId, event);
          if (handled) {
            continue; 
          }
        }

        this.io?.to(socketId).emit(event.type, {
          ...event.data,
          timestamp: event.timestamp
        });
      }

      logger.info(`✅ [USER-EVENT] Successfully broadcasted ${event.type} to user ${userId}`);
    } catch (error) {
      logger.error(`❌ [USER-EVENT] Error handling user event for ${userId}:`, error, event);
    }
  }

  /**
   * Helper to handle notification events with edge creation and platform filtering
   * Returns true if the event was fully handled (emitted or skipped), false if it should fall back to standard emission
   */
  private async handleNotificationEvent(userId: string, socketId: string, event: any): Promise<boolean> {
    try {
      const platform = await redisService.getSocketPlatform(userId, socketId);
      
      // Skip if platform is mobile (iOS/Android) as they get Push Notifications
      if (platform === 'mobile' || platform === 'ios' || platform === 'android') {
          return true; // Handled by skipping
      }

      // For Web/Electron, create a specific notification entry at the edge
      
      const notificationData: NotificationData = {
        title: event.data?.title,
        message: event.data?.message,
        type: event.data?.type as NotificationType, // Cast to enum value
        actionUrl: event.data?.actionUrl,
        relatedEntityType: event.data?.data?.relatedEntityType,
        relatedEntityId: event.data?.data?.relatedEntityId,
        metadata: event.data?.metadata
      };

      const { notificationService: persistenceService } = await import('./notificationService');
      const notificationEntry = await persistenceService.createSessionNotification(
        userId,
        notificationData,
        NotificationDeliveryMethod.BROWSER
      );
      
      // Emit with the new specific ID
      this.io?.to(socketId).emit(event.type, {
        notification: {
          ...event.data,
          id: notificationEntry.id,
        },
        timestamp: event.timestamp
      });
      
      return true; // Successfully emitted
    } catch (err) {
      logger.error(`❌ [USER-EVENT] Failed to create edge notification for user ${userId} socket ${socketId}:`, err);
      return false; // Fallback to standard emission
    }
  }

  // Socket subscription management methods
  private async addSocketSubscription(socketId: string, sessionId: string): Promise<void> {
    // Check if this socket is already subscribed to this session (prevent duplicates)
    const existingSocketSessions = this.socketSubscriptions.get(socketId);
    if (existingSocketSessions && existingSocketSessions.has(sessionId)) {
      logger.info(`🔴 [SUB-DEDUPE] Socket ${socketId} already subscribed to session ${sessionId}, skipping`);
      return;
    }

    // Add to socket -> sessions mapping
    if (!this.socketSubscriptions.has(socketId)) {
      this.socketSubscriptions.set(socketId, new Set());
    }
    this.socketSubscriptions.get(socketId)!.add(sessionId);

    // Add to session -> sockets mapping
    if (!this.sessionSubscribers.has(sessionId)) {
      this.sessionSubscribers.set(sessionId, new Set());
    }
    const subscribersForSession = this.sessionSubscribers.get(sessionId)!;
    const wasEmpty = subscribersForSession.size === 0;
    subscribersForSession.add(socketId);

    // Subscribe to Redis for this session if this is the first socket for this session
    if (wasEmpty) {
      // logger.info(`🔴 [REDIS-SUB] First subscriber for session ${sessionId}, subscribing to Redis`);
      await redisService.subscribeToSessionMessages(sessionId, (message) => {
        this.handleRedisMessage(sessionId, message);
      });
    } else {
      // logger.info(`🔴 [REDIS-SUB] Session ${sessionId} already has ${subscribersForSession.size} subscribers`);
    }
  }

  private async removeSocketSubscription(socketId: string, sessionId: string): Promise<void> {
    // Remove from socket -> sessions mapping
    const socketSessions = this.socketSubscriptions.get(socketId);
    if (socketSessions) {
      socketSessions.delete(sessionId);
      if (socketSessions.size === 0) {
        this.socketSubscriptions.delete(socketId);
      }
    }

    // Remove from session -> sockets mapping
    const sessionSockets = this.sessionSubscribers.get(sessionId);
    if (sessionSockets) {
      sessionSockets.delete(socketId);

      // If no more sockets for this session, unsubscribe from Redis
      if (sessionSockets.size === 0) {
        // logger.info(`🔴 [REDIS-UNSUB] No more subscribers for session ${sessionId}, unsubscribing from Redis`);
        this.sessionSubscribers.delete(sessionId);
        await redisService.unsubscribeFromSessionMessages(sessionId);
      }
    }
  }

  private async clearSocketSubscriptions(socketId: string): Promise<void> {
    const socketSessions = this.socketSubscriptions.get(socketId);
    if (socketSessions) {
      // Remove this socket from all sessions it was subscribed to
      for (const sessionId of socketSessions) {
        await this.removeSocketSubscription(socketId, sessionId);
      }
    }
  }

  private handleRedisMessage = (sessionId: string, message: ChatMessage): void => {
    try {
      logger.info(`📨 [REDIS-MSG] Received message for session ${sessionId}:`, {
        messageId: message.messageId,
        senderId: message.senderId
      });

      // Find all sockets subscribed to this session
      const subscribedSockets = this.sessionSubscribers.get(sessionId);
      if (subscribedSockets && subscribedSockets.size > 0) {
        logger.info(`📤 [REDIS-RELAY] Relaying to ${subscribedSockets.size} sockets:`, Array.from(subscribedSockets));

        // Send to each subscribed socket
        for (const socketId of subscribedSockets) {
          this.io?.to(socketId).emit('session_activity', {
            sessionId,
            message,
            type: 'new_message',
            timestamp: new Date()
          });
        }
      } else {
        logger.info(`📭 [REDIS-RELAY] No subscribers for session ${sessionId}`);
      }
    } catch (error) {
      logger.error(`❌ [REDIS-MSG] Error handling Redis message for session ${sessionId}:`, error);
    }
  };

  // Utility methods for broadcasting from other parts of the application
  async broadcastToSession(sessionId: string, event: string, data: any): Promise<void> {

    if (!this.io) {
      logger.info('❌ [WEBSOCKET-SERVICE] WebSocket server not initialized');
      logger.warn('WebSocket server not initialized');
      return;
    }

    const roomName = `session:${sessionId}`;

    this.io.to(roomName).emit(event, data);
  }

  async broadcastNotificationToUser(userId: string, notification: any): Promise<void> {
    try {
      logger.info(`🔔 [NOTIFICATION] Broadcasting notification to user ${userId}:`, {
        id: notification.id,
        type: notification.type,
        title: notification.title
      });

      // Get all active connections for this user
      const userConnections = await redisService.getUserConnections(userId);

      if (userConnections.length === 0) {
        logger.info(`🔔 [NOTIFICATION] No active connections for user ${userId}, skipping broadcast`);
        return;
      }

      logger.info(`🔔 [NOTIFICATION] Broadcasting to ${userConnections.length} connections for user ${userId}`);

      // Broadcast to all user's active connections
      for (const socketId of userConnections) {
        this.io?.to(socketId).emit('notification_received', {
          notification,
          timestamp: new Date().toISOString()
        });
      }

      logger.info(`✅ [NOTIFICATION] Successfully broadcasted notification to user ${userId}`);
    } catch (error) {
      logger.error(`❌ [NOTIFICATION] Error broadcasting notification to user ${userId}:`, error);
    }
  }

  async broadcastNotificationUpdate(userId: string, notificationId: string, status: string): Promise<void> {
    try {
      logger.info(`🔔 [NOTIFICATION-UPDATE] Broadcasting notification update to user ${userId}:`, {
        notificationId,
        status
      });

      // Get all active connections for this user
      const userConnections = await redisService.getUserConnections(userId);

      if (userConnections.length === 0) {
        logger.info(`🔔 [NOTIFICATION-UPDATE] No active connections for user ${userId}, skipping broadcast`);
        return;
      }

      // Broadcast to all user's active connections
      for (const socketId of userConnections) {
        this.io?.to(socketId).emit('notification_updated', {
          notificationId,
          status,
          timestamp: new Date().toISOString()
        });
      }

      logger.info(`✅ [NOTIFICATION-UPDATE] Successfully broadcasted notification update to user ${userId}`);
    } catch (error) {
      logger.error(`❌ [NOTIFICATION-UPDATE] Error broadcasting notification update to user ${userId}:`, error);
    }
  }

  async broadcastToUser(userId: string, event: string, data: any): Promise<void> {
    if (!this.io) {
      logger.warn('WebSocket server not initialized');
      return;
    }

    // Get user's active connections
    const connections = await redisService.getUserConnections(userId);
    for (const socketId of connections) {
      this.io.to(socketId).emit(event, data);
    }
  }

  async getConnectedUsers(): Promise<number> {
    if (!this.io) return 0;

    const sockets = await this.io.fetchSockets();
    return sockets.length;
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const connections = await redisService.getUserConnections(userId);
    return connections.length > 0;
  }

  // Send call notification to user
  sendCallNotification(userId: string, notification: any): void {
    if (!this.io) {
      logger.warn('WebSocket server not initialized');
      return;
    }

    // Get user's socket connections and emit notification
    redisService.getUserConnections(userId).then((connections) => {
      for (const socketId of connections) {
        this.io?.to(socketId).emit('call_notification', notification);
      }
      logger.info(`Call notification sent to user ${userId} (${connections.length} connections)`);
    }).catch((error) => {
      logger.error('Failed to send call notification:', error);
    });
  }

  // Send call status update
  sendCallStatus(userId: string, status: any): void {
    if (!this.io) {
      logger.warn('WebSocket server not initialized');
      return;
    }

    redisService.getUserConnections(userId).then((connections) => {
      for (const socketId of connections) {
        this.io?.to(socketId).emit('call_status', status);
      }
    }).catch((error) => {
      logger.error('Failed to send call status:', error);
    });
  }

  // Workflow subscription handlers (room-based with Redis pub/sub bridge)
  private async handleWorkflowSubscription(socket: AuthenticatedSocket, executionId: string): Promise<void> {
    const roomName = `workflow:${executionId}`;

    // Join Socket.IO room
    socket.join(roomName);

    // Track socket in workflow room membership
    if (!this.workflowRoomSubscribers.has(executionId)) {
      this.workflowRoomSubscribers.set(executionId, new Set());
    }
    const subscribers = this.workflowRoomSubscribers.get(executionId)!;
    const wasEmpty = subscribers.size === 0;
    subscribers.add(socket.id);

    logger.info(`📊 [WORKFLOW-SUB] Socket ${socket.id} joined workflow room: ${roomName} (${subscribers.size} subscribers)`);

    // Subscribe to Redis only if this is the first socket for this execution
    if (wasEmpty) {
      logger.info(`📊 [WORKFLOW-SUB] First subscriber for ${executionId}, subscribing to Redis`);
      try {
        await redisService.subscribeToWorkflowEvents(executionId, (event: WorkflowEvent) => {
          this.handleWorkflowRedisEvent(executionId, event);
        });

        // Also subscribe to workspace events for live code viewing
        await workspaceEventService.subscribeToWorkspaceEvents(executionId, (event: WorkspaceEvent) => {
          this.handleWorkspaceRedisEvent(executionId, event);
        });
      } catch (error) {
        logger.error(`❌ [WORKFLOW-SUB] Failed to subscribe to Redis for ${executionId}:`, error);
      }
    }
  }

  private async handleWorkflowUnsubscription(socket: AuthenticatedSocket, executionId: string): Promise<void> {
    const roomName = `workflow:${executionId}`;

    // Leave Socket.IO room
    socket.leave(roomName);

    // Remove socket from workflow room membership
    const subscribers = this.workflowRoomSubscribers.get(executionId);
    if (subscribers) {
      subscribers.delete(socket.id);

      logger.info(`📊 [WORKFLOW-UNSUB] Socket ${socket.id} left workflow room: ${roomName} (${subscribers.size} subscribers remaining)`);

      // Unsubscribe from Redis if no more sockets for this execution
      if (subscribers.size === 0) {
        this.workflowRoomSubscribers.delete(executionId);
        logger.info(`📊 [WORKFLOW-UNSUB] No more subscribers for ${executionId}, unsubscribing from Redis`);
        try {
          await redisService.unsubscribeFromWorkflowEvents(executionId);
          // Also unsubscribe from workspace events
          await workspaceEventService.unsubscribeFromWorkspaceEvents(executionId);
        } catch (error) {
          logger.error(`❌ [WORKFLOW-UNSUB] Failed to unsubscribe from Redis for ${executionId}:`, error);
        }
      }
    } else {
      logger.info(`📊 [WORKFLOW-UNSUB] Socket ${socket.id} left workflow room: ${roomName} (no subscribers tracked)`);
    }
  }

  // Handle workflow events from Redis and broadcast to Socket.IO room
  private handleWorkflowRedisEvent(executionId: string, event: WorkflowEvent): void {
    if (!this.io) {
      logger.info('❌ [WORKFLOW-REDIS-EVENT] WebSocket server not initialized');
      return;
    }

    const roomName = `workflow:${executionId}`;

    // Emit to all sockets in the workflow room
    this.io.to(roomName).emit(event.type === 'step_added' ? 'workflow_step_added' : event.type, {
      executionId,
      ...event.data,
      timestamp: event.timestamp
    });

    logger.info(`📊 [WORKFLOW-REDIS-EVENT] Forwarded ${event.type} from Redis to room ${roomName}`);
  }

  // Handle workspace events from Redis and broadcast to Socket.IO room
  private handleWorkspaceRedisEvent(parentExecutionId: string, event: WorkspaceEvent): void {
    if (!this.io) {
      logger.info('❌ [WORKSPACE-REDIS-EVENT] WebSocket server not initialized');
      return;
    }

    const roomName = `workflow:${parentExecutionId}`;

    // Emit workspace event to all sockets in the workflow room
    this.io.to(roomName).emit('workspace_event', {
      executionId: parentExecutionId,
      ...event,
    });

    logger.info(`📁 [WORKSPACE-REDIS-EVENT] Forwarded ${event.type} from Redis to room ${roomName}`);
  }

  // Clean up workflow subscriptions for a disconnecting socket
  private async cleanupWorkflowSubscriptions(socketId: string): Promise<void> {
    // Find all workflow rooms this socket is in and clean up
    const executionIdsToCleanup: string[] = [];

    for (const [executionId, subscribers] of this.workflowRoomSubscribers.entries()) {
      if (subscribers.has(socketId)) {
        subscribers.delete(socketId);

        if (subscribers.size === 0) {
          executionIdsToCleanup.push(executionId);
        }
      }
    }

    // Unsubscribe from Redis for workflow rooms with no more subscribers
    for (const executionId of executionIdsToCleanup) {
      this.workflowRoomSubscribers.delete(executionId);
      logger.info(`📊 [WORKFLOW-CLEANUP] No more subscribers for ${executionId}, unsubscribing from Redis`);
      try {
        await redisService.unsubscribeFromWorkflowEvents(executionId);
        // Also unsubscribe from workspace events
        await workspaceEventService.unsubscribeFromWorkspaceEvents(executionId);
      } catch (error) {
        logger.error(`❌ [WORKFLOW-CLEANUP] Failed to unsubscribe from Redis for ${executionId}:`, error);
      }
    }

    if (executionIdsToCleanup.length > 0) {
      logger.info(`🧹 [WORKFLOW-CLEANUP] Cleaned up ${executionIdsToCleanup.length} workflow subscriptions for socket ${socketId}`);
    }
  }

  // Broadcast workflow step added event to all subscribers of a workflow execution
  broadcastWorkflowStepAdded(executionId: string, stepData: {
    stepId: string;
    stepName: string | null;
    type: string | null;
    stepExecutorType: string;
  }): void {
    if (!this.io) {
      logger.info('❌ [WORKFLOW-BROADCAST] WebSocket server not initialized');
      return;
    }

    const roomName = `workflow:${executionId}`;

    this.io.to(roomName).emit('workflow_step_added', {
      executionId,
      ...stepData,
      timestamp: new Date().toISOString()
    });

    logger.info(`📊 [WORKFLOW-BROADCAST] Emitted workflow_step_added to room ${roomName}:`, {
      executionId,
      stepId: stepData.stepId,
      stepName: stepData.stepName
    });
  }

  /**
   * Broadcast workspace_updated event when files change in the live workspace
   * This is emitted after tool executions that modify files (e.g., after commits)
   * Frontend listens to this to refresh the file tree in real-time
   */
  broadcastWorkspaceUpdated(parentExecutionId: string, childExecutionId: string, data?: {
    commitHash?: string;
    filesChanged?: number;
  }): void {
    if (!this.io) {
      logger.info('❌ [WORKSPACE-BROADCAST] WebSocket server not initialized');
      return;
    }

    const roomName = `workflow:${parentExecutionId}`;

    this.io.to(roomName).emit('workspace_updated', {
      executionId: parentExecutionId,
      childExecutionId,
      commitHash: data?.commitHash,
      filesChanged: data?.filesChanged,
      timestamp: new Date().toISOString()
    });

    logger.info(`📁 [WORKSPACE-BROADCAST] Emitted workspace_updated to room ${roomName}:`, {
      parentExecutionId,
      childExecutionId,
      commitHash: data?.commitHash
    });
  }

  // Debug method to get subscription stats
  getSubscriptionStats(): {
    socketSubscriptions: number;
    sessionSubscribers: number;
    redisStats: any;
  } {
    const redisStats = redisService.getSubscriptionStats();
    return {
      socketSubscriptions: this.socketSubscriptions.size,
      sessionSubscribers: this.sessionSubscribers.size,
      redisStats
    };
  }


  // Increment today's message count using Redis
  async incrementTodayMessageCount(): Promise<void> {
    try {
      const result = await messageCountService.incrementCount();
      logger.info(`✅ [WS-MESSAGE-COUNT] Message count incremented successfully: ${result.count}`);
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error incrementing today message count:', error);
    }
  }

  // Setup message count subscription (called once during initialization)
  private async setupMessageCountSubscription(): Promise<void> {
    try {
      logger.info('🔔 [WS-MESSAGE-COUNT] Setting up message count subscriptions...');

      await messageCountService.subscribeToUpdates((countData: MessageCountData) => {
        this.handleMessageCountUpdate(countData);
      });

      // Subscribe to all-time message count updates
      await messageCountService.subscribeToAllTimeUpdates((countData: AllTimeMessageCountData) => {
        this.handleAllTimeMessageCountUpdate(countData);
      });

      logger.info('✅ [WS-MESSAGE-COUNT] Message count subscriptions established successfully');
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error setting up message count subscriptions:', error);
    }
  }

  // Handle message count updates from Redis and broadcast to all connected clients
  private handleMessageCountUpdate(countData: MessageCountData): void {
    try {
      logger.debug('📡 [WS-MESSAGE-COUNT] Received message count update from Redis:', countData);

      if (!this.io) {
        logger.warn('⚠️ [WS-MESSAGE-COUNT] WebSocket server not initialized, cannot broadcast');
        return;
      }

      // Broadcast to all connected clients
      this.io.emit('today_message_count_updated', countData);
      logger.info(`📢 [WS-MESSAGE-COUNT] Broadcasted message count update to all clients: count=${countData.count}, date=${countData.date}`);
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error broadcasting message count update:', error);
    }
  }

  // Handle all-time message count updates from Redis and broadcast to all connected clients
  private handleAllTimeMessageCountUpdate(countData: AllTimeMessageCountData): void {
    try {
      logger.debug('📡 [WS-ALL-TIME-COUNT] Received all-time message count update from Redis:', countData);

      if (!this.io) {
        logger.warn('⚠️ [WS-ALL-TIME-COUNT] WebSocket server not initialized, cannot broadcast');
        return;
      }

      // Broadcast to all connected clients
      this.io.emit('all_time_message_count_updated', countData);
      logger.info(`📢 [WS-ALL-TIME-COUNT] Broadcasted all-time message count update to all clients: count=${countData.count}`);
    } catch (error) {
      logger.error('❌ [ALL-TIME-COUNT] Error broadcasting all-time message count update:', error);
    }
  }

  // Setup user count subscription (called once during initialization)
  private async setupUserCountSubscription(): Promise<void> {
    try {
      logger.info('🔔 [WS-USER-COUNT] Setting up user count subscriptions...');

      await userCountService.subscribeToUpdates((countData: UserCountData) => {
        this.handleUserCountUpdate(countData);
      });

      // Subscribe to all-time user count updates
      await userCountService.subscribeToAllTimeUpdates((countData: AllTimeUserCountData) => {
        this.handleAllTimeUserCountUpdate(countData);
      });

      logger.info('✅ [WS-USER-COUNT] User count subscriptions established successfully');
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error setting up user count subscriptions:', error);
    }
  }

  // Handle user count updates from Redis and broadcast to all connected clients
  private handleUserCountUpdate(countData: UserCountData): void {
    try {
      logger.debug('📡 [WS-USER-COUNT] Received user count update from Redis:', countData);

      if (!this.io) {
        logger.warn('⚠️ [WS-USER-COUNT] WebSocket server not initialized, cannot broadcast');
        return;
      }

      // Broadcast to all connected clients
      this.io.emit('today_user_count_updated', countData);
      logger.info(`📢 [WS-USER-COUNT] Broadcasted user count update to all clients: count=${countData.count}, date=${countData.date}`);
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error broadcasting user count update:', error);
    }
  }

  // Handle all-time user count updates from Redis and broadcast to all connected clients
  private handleAllTimeUserCountUpdate(countData: AllTimeUserCountData): void {
    try {
      logger.debug('📡 [WS-ALL-TIME-USER-COUNT] Received all-time user count update from Redis:', countData);

      if (!this.io) {
        logger.warn('⚠️ [WS-ALL-TIME-USER-COUNT] WebSocket server not initialized, cannot broadcast');
        return;
      }

      // Broadcast to all connected clients
      this.io.emit('all_time_user_count_updated', countData);
      logger.info(`📢 [WS-ALL-TIME-USER-COUNT] Broadcasted all-time user count update to all clients: count=${countData.count}`);
    } catch (error) {
      logger.error('❌ [ALL-TIME-USER-COUNT] Error broadcasting all-time user count update:', error);
    }
  }

  /**
   * Track a user's activity for active user counting
   * This is the optimized method that uses Redis Sets instead of DB queries
   * 
   * @param userId - The ID of the user who performed an activity
   */
  async trackUserActivity(userId: string): Promise<void> {
    try {
      await userCountService.trackUserActivity(userId);
    } catch (error) {
      logger.error('❌ [WS-USER-COUNT] Error tracking user activity:', error);
    }
  }

  // Increment today's call count using Redis
  async incrementTodayCallCount(): Promise<void> {
    try {
      const result = await callCountService.incrementCount();
      logger.info(`✅ [WS-CALL-COUNT] Call count incremented successfully: ${result.count}`);
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error incrementing today call count:', error);
    }
  }

  // Setup call count subscription (called once during initialization)
  private async setupCallCountSubscription(): Promise<void> {
    try {
      logger.info('🔔 [WS-CALL-COUNT] Setting up call count subscriptions...');
      
      await callCountService.subscribeToUpdates((countData: CallCountData) => {
        this.handleCallCountUpdate(countData);
      });
      
      // Subscribe to all-time call count updates
      await callCountService.subscribeToAllTimeUpdates((countData: AllTimeCallCountData) => {
        this.handleAllTimeCallCountUpdate(countData);
      });
      
      logger.info('✅ [WS-CALL-COUNT] Call count subscriptions established successfully');
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error setting up call count subscriptions:', error);
    }
  }

  // Handle call count updates from Redis and broadcast to all connected clients
  private handleCallCountUpdate(countData: CallCountData): void {
    try {
      logger.debug('📡 [WS-CALL-COUNT] Received call count update from Redis:', countData);
      
      if (!this.io) {
        logger.warn('⚠️ [WS-CALL-COUNT] WebSocket server not initialized, cannot broadcast');
        return;
      }

      // Broadcast to all connected clients
      this.io.emit('today_call_count_updated', countData);
      logger.info(`📢 [WS-CALL-COUNT] Broadcasted call count update to all clients: count=${countData.count}, date=${countData.date}`);
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error broadcasting call count update:', error);
    }
  }

  // Handle all-time call count updates from Redis and broadcast to all connected clients
  private handleAllTimeCallCountUpdate(countData: AllTimeCallCountData): void {
    try {
      logger.debug('📡 [WS-ALL-TIME-CALL-COUNT] Received all-time call count update from Redis:', countData);
      
      if (!this.io) {
        logger.warn('⚠️ [WS-ALL-TIME-CALL-COUNT] WebSocket server not initialized, cannot broadcast');
        return;
      }

      // Broadcast to all connected clients
      this.io.emit('all_time_call_count_updated', countData);
      logger.info(`📢 [WS-ALL-TIME-CALL-COUNT] Broadcasted all-time call count update to all clients: count=${countData.count}`);
    } catch (error) {
      logger.error('❌ [WS-ALL-TIME-CALL-COUNT] Error broadcasting all-time call count update:', error);
    }
  }

  // ==================== CALL DURATION WEBSOCKET METHODS ====================

  // Add call duration when a call ends using Redis
  async addCallDuration(durationMinutes: number): Promise<void> {
    try {
      const result = await callCountService.addCallDuration(durationMinutes);
      logger.info(`✅ [WS-CALL-DURATION] Call duration added successfully: ${result.duration} minutes`);
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error adding call duration:', error);
    }
  }

  // Setup call duration subscription (called once during initialization)
  private async setupCallDurationSubscription(): Promise<void> {
    try {
      logger.info('🔔 [WS-CALL-DURATION] Setting up call duration subscriptions...');
      
      await callCountService.subscribeToDurationUpdates((durationData: CallDurationData) => {
        this.handleCallDurationUpdate(durationData);
      });
      
      // Subscribe to all-time call duration updates
      await callCountService.subscribeToAllTimeDurationUpdates((durationData: AllTimeCallDurationData) => {
        this.handleAllTimeCallDurationUpdate(durationData);
      });
      
      logger.info('✅ [WS-CALL-DURATION] Call duration subscriptions established successfully');
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error setting up call duration subscriptions:', error);
    }
  }

  // Handle call duration updates from Redis and broadcast to all connected clients
  private handleCallDurationUpdate(durationData: CallDurationData): void {
    try {
      logger.debug('📡 [WS-CALL-DURATION] Received call duration update from Redis:', durationData);
      
      if (!this.io) {
        logger.warn('⚠️ [WS-CALL-DURATION] WebSocket server not initialized, cannot broadcast');
        return;
      }

      // Broadcast to all connected clients
      this.io.emit('today_call_duration_updated', durationData);
      logger.info(`📢 [WS-CALL-DURATION] Broadcasted call duration update to all clients: duration=${durationData.duration}, date=${durationData.date}`);
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error broadcasting call duration update:', error);
    }
  }

  // Handle all-time call duration updates from Redis and broadcast to all connected clients
  private handleAllTimeCallDurationUpdate(durationData: AllTimeCallDurationData): void {
    try {
      logger.debug('📡 [WS-ALL-TIME-CALL-DURATION] Received all-time call duration update from Redis:', durationData);
      
      if (!this.io) {
        logger.warn('⚠️ [WS-ALL-TIME-CALL-DURATION] WebSocket server not initialized, cannot broadcast');
        return;
      }

      // Broadcast to all connected clients
      this.io.emit('all_time_call_duration_updated', durationData);
      logger.info(`📢 [WS-ALL-TIME-CALL-DURATION] Broadcasted all-time call duration update to all clients: duration=${durationData.duration}`);
    } catch (error) {
      logger.error('❌ [WS-ALL-TIME-CALL-DURATION] Error broadcasting all-time call duration update:', error);
    }
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();