import { Server as SocketIOServer, Socket } from 'socket.io';
import { NotificationDeliveryMethod, NotificationType, UserPresenceStatus } from '@xyne/shared';
import { Server as HttpServer } from 'http';

import { redisService, ChatMessage, PresenceEvent, OrgMemberEvent } from './redisService';
import { typingService, TypingUser } from './typingService';
import { userStatusService } from './userStatusService';
import { ChannelRepository } from '../database/repositories/channelRepository';
// import { ConversationRepository } from '../database/repositories/conversationRepository';
import { logger } from '@/utils/logger';
import { authMiddleware } from '../middleware/auth';
import { notificationService } from '@/notification-service';
import { type NotificationData } from './notificationService';
import { presenceCleanupQueue } from '@/queues/presenceCleanupQueue';
import { activityTrackingService, ActivityEventPayload } from './activityTrackingService';
import { repositories } from '@/database/repositories';


interface AuthenticatedSocket extends Socket {
  userId: string;
  userEmail: string;
  userName: string;
  orgMemberId?: string;
  workspaceId?: string;
  workspaceName?: string;
}

// interface JoinSessionData {
//   sessionId: string; // This will be channelId or conversationId
// }



interface SubscribeToChannelsData {
  channels: string[];
  conversations: string[];
}

// interface ChannelSubscriptionData {
//   sessionId: string;
// }

type TicketCountsRoomType = 'project' | 'board' | 'user' | 'group';

interface TicketCountsRoomSubscriptionData {
  room: string;
}

class WebSocketService {
  private io: SocketIOServer | null = null;
  private channelRepository: ChannelRepository;
  // private conversationRepository: ConversationRepository;

  // Track per-socket subscriptions for user-driven subscription model
  private socketSubscriptions = new Map<string, Set<string>>(); // socketId -> Set<sessionId>
  private sessionSubscribers = new Map<string, Set<string>>(); // sessionId -> Set<socketId>

  // Track user event subscriptions
  private userEventSubscriptions = new Map<string, boolean>(); // userId -> hasSubscription

  private orgMemberEventSubscriptions = new Map<string, boolean>(); // orgMemberId -> hasSubscription
  private orgMemberSocketIds = new Map<string, Set<string>>(); // orgMemberId -> Set<socketId>
  private notificationHealthIntervals = new Map<string, ReturnType<typeof setInterval>>(); // socketId -> healthcheck interval

  constructor() {
    this.channelRepository = new ChannelRepository();
    // this.conversationRepository = new ConversationRepository();
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
            (socket as any).userName = req.user.displayName || req.user.name;
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

    this.setupZeroFallbackConfigSubscription();

    // Setup global presence subscription (for multi-server support)
    this.setupPresenceSubscription();

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

    // Cancel any pending offline job (user reconnected within grace period)
    const wasPendingOffline = await presenceCleanupQueue.cancelOfflineJob(userId);
    if (wasPendingOffline) {
      logger.info(`🔌 [CONNECT] User ${userEmail} reconnected within grace period`);
    }

    // Detect platform
    const platform = this.getPlatformFromSocket(socket);

    // Add user connection to Redis with platform info
    await redisService.addUserConnection(userId, socket.id, platform);

    socket.join(`user:${userId}`);

    // Observe-only: log (once per window) when a socket exceeds the candidate
    // inbound-event budget, but never drop events. Enforcement is deferred.
    let evtCount = 0;
    let evtWindowStart = Date.now();
    let evtWindowLogged = false;
    const SOCKET_EVT_OBSERVE_THRESHOLD = 300;
    const SOCKET_EVT_WINDOW_MS = 10_000;
    socket.use((_packet, next) => {
      const now = Date.now();
      if (now - evtWindowStart > SOCKET_EVT_WINDOW_MS) {
        evtWindowStart = now;
        evtCount = 0;
        evtWindowLogged = false;
      }
      if (++evtCount > SOCKET_EVT_OBSERVE_THRESHOLD && !evtWindowLogged) {
        evtWindowLogged = true;
        logger.warn(`[WS-EVT-OBSERVE] Socket ${socket.id} (user ${userId}) exceeded ${SOCKET_EVT_OBSERVE_THRESHOLD} events in ${SOCKET_EVT_WINDOW_MS}ms (not enforced)`);
      }
      next();
    });

    // Debug: Check connections after adding
    const userConnections = await redisService.getUserConnections(userId);
    logger.info(`🔌 [CONNECT] User ${userId} now has ${userConnections.length} connections: [${userConnections.join(', ')}]`);

    // Subscribe to user-specific events (only once per user across all their connections)
    await this.setupUserEventSubscription(userId);

    // Register for cross-workspace broadcast
    try {
      const userWithWorkspace = await repositories.users.findByIdWithWorkspace(userId);

      // Resolve the socket's workspace independently of org-membership. WS channel/
      // conversation access is keyed on socket.workspaceId, so a user with a home
      // workspace but no orgMemberId (pre-onboarding / guest / service user) must
      // still get workspaceId set. Only the cross-workspace broadcast registration
      // below is org-member-scoped.
      if (userWithWorkspace?.workspaceId) {
        socket.workspaceId = userWithWorkspace.workspaceId;
        socket.workspaceName = userWithWorkspace.workspace?.name;
      }

      if (userWithWorkspace?.orgMemberId) {
        socket.orgMemberId = userWithWorkspace.orgMemberId;

        await redisService.addOrgMemberConnection(userWithWorkspace.orgMemberId, socket.id, platform);
        await this.setupOrgMemberEventSubscription(userWithWorkspace.orgMemberId);

        if (!this.orgMemberSocketIds.has(userWithWorkspace.orgMemberId)) {
          this.orgMemberSocketIds.set(userWithWorkspace.orgMemberId, new Set());
        }
        this.orgMemberSocketIds.get(userWithWorkspace.orgMemberId)!.add(socket.id);
        this.startOrgMemberConnectionHealthcheck(socket);
      } else {
        logger.warn(`🔌 [CONNECT] User ${userId} has no orgMemberId; skipping cross-workspace broadcast registration`);
      }
    } catch (error) {
      logger.error(`🔌 [CONNECT] Failed to register orgMember mapping for user ${userId}:`, error);
    }

      // Set user status to ONLINE automatically on connect (unless status is AWAY)
      try {
        // Check current status in Redis (source of truth for online/away/offline)
        const currentStatus = await userStatusService.getUserStatus(userId);
        
        // Only auto-set ONLINE if user is not AWAY
        if (!currentStatus || currentStatus.status !== 'AWAY') {
          const onlineUsers = await userStatusService.setUserStatus(
            userId,
            UserPresenceStatus.ONLINE
          );
          // Send initial state directly to connecting socket (broadcast may race with socket setup)
          socket.emit('user_status_sync', {
            onlineUsers,
          });

          logger.info(`👤 [USER-STATUS] User ${userName || userEmail} is now ONLINE`);
        } else {
          // User is AWAY - don't change status, but still send them the current state
          const onlineUsers = await userStatusService.getOnlineUsers();
          socket.emit('user_status_sync', {
            onlineUsers,
          });
          logger.info(`👤 [USER-STATUS] User ${userName || userEmail} remains AWAY on connect, sent current state`);
        }
      } catch (error) {
        logger.error('❌ [USER-STATUS] Error setting user online status:', error);
      }

    // SECURITY (secops): 'join_session'/'leave_session' handlers are disabled.
    // handleJoinSession joined `session:<id>` rooms with entity-existence as the ONLY gate
    // (no participant-membership or workspaceId check), so any authenticated socket could
    // join the room of a private channel/DM/conversation in any workspace and receive
    // broadcastToSession() message content in real time (cross-workspace broken access control).
    // No client emits these events (chat delivery is handled by Zero), so disabling the entry
    // point closes the hole without breaking any feature. The handler methods are kept below,
    // unreachable — re-enabling MUST first add a membership + workspaceId authorization check.
    // // Handle joining sessions
    // socket.on('join_session', async (data: JoinSessionData) => {
    //   await this.handleJoinSession(socket, data);
    // });

    // // Handle leaving sessions
    // socket.on('leave_session', async (data: JoinSessionData) => {
    //   await this.handleLeaveSession(socket, data);
    // });



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

    // Channel subscriptions (XYNE-17679): re-enabled WITH authorization.
    // handleBulkSubscription verifies channel-participant + workspace access for every
    // requested channel/conversation before subscribing, and caps sessions per request.
    // This powers real-time typing indicators and agent-progress (via session_activity).
    socket.on('subscribe_to_channels', async (data: SubscribeToChannelsData) => {
      await this.handleBulkSubscription(socket, data);
    });

    // Single-channel add/remove subscription events remain disabled — no client emits
    // them; re-enabling would require the same authorization as handleBulkSubscription.
    // socket.on('add_channel_subscription', async (data: ChannelSubscriptionData) => {
    //   await this.handleAddSubscription(socket, data);
    // });
    // socket.on('remove_channel_subscription', async (data: ChannelSubscriptionData) => {
    //   await this.handleRemoveSubscription(socket, data);
    // });

    // Handle notification acknowledgments
    socket.on('notification_acknowledged', async (data: { notificationId: string }) => {
      await this.handleNotificationAcknowledgment(socket, data);
    });

    socket.on('sos_alert_acknowledged', async (data: { alertId: string }) => {
      await this.handleSosAlertAcknowledgment(socket, data);
    });

    socket.on('sos_alerts_sync', async (data: { alertIds: string[] }) => {
      await this.handleSosAlertsSync(socket, data);
    });

    // Handle ticket count room subscription
    socket.on('subscribe_to_ticket_counts', (data: TicketCountsRoomSubscriptionData) => {
      this.handleTicketCountsSubscription(socket, data.room);
    });

    // Handle ticket count room unsubscription
    socket.on('unsubscribe_from_ticket_counts', (data: TicketCountsRoomSubscriptionData) => {
      this.handleTicketCountsUnsubscription(socket, data.room);
    });

    // Handle user status update (ONLINE/AWAY/OFFLINE)
    socket.on('update_status', async (data: { status: 'ONLINE' | 'AWAY' | 'OFFLINE' }) => {
      await this.handleUpdateStatus(socket, data.status);
    });

    // Handle request for current presence state (client may have missed initial broadcast)
    socket.on('request_presence_state', async () => {
      try {
        const onlineUsers = await userStatusService.getOnlineUsers();
        socket.emit('user_status_sync', {
          onlineUsers,
        });
      } catch (error) {
        logger.error('❌ [PRESENCE] Error handling request_presence_state:', error);
      }
    });

    // Handle user activity events (for analytics tracking)
    socket.on('user_activity_event', (event: ActivityEventPayload) => {
      // Attribute the event to the authenticated socket user, never the
      // client-supplied user_id.
      if (!socket.userId) return;
      const authoredEvent: ActivityEventPayload = { ...event, user_id: socket.userId };
      // Fire and forget - non-blocking
      activityTrackingService.saveActivityEvent(authoredEvent).catch(error => {
        logger.error('Error saving activity event from WebSocket:', authoredEvent, error);
      });
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
  private startOrgMemberConnectionHealthcheck(socket: AuthenticatedSocket): void {
    const orgMemberId = socket.orgMemberId;
    if (!orgMemberId) return;

    this.stopOrgMemberConnectionHealthcheck(socket.id);

    const interval = setInterval(async () => {
      const currentOrgMemberId = socket.orgMemberId;
      if (!currentOrgMemberId) {
        this.stopOrgMemberConnectionHealthcheck(socket.id);
        return;
      }

      const healthy = socket.connected === true && this.io?.sockets.sockets.has(socket.id) === true;
      if (healthy) {
        try {
          await redisService.addOrgMemberConnection(currentOrgMemberId, socket.id, this.getPlatformFromSocket(socket));
        } catch (error) {
          logger.error(`🔌 [ORGMEMBER-HEALTH] Failed to refresh notification socket TTL for ${socket.id}:`, error);
        }
        return;
      }

      this.stopOrgMemberConnectionHealthcheck(socket.id);

      try {
        await this.handleDisconnection(socket);
      } catch (error) {
        logger.error(`🔌 [ORGMEMBER-HEALTH] Failed unhealthy socket cleanup for ${socket.id}:`, error);
      }
    }, 15 * 60 * 1000);

    interval.unref?.();
    this.notificationHealthIntervals.set(socket.id, interval);
  }

  private stopOrgMemberConnectionHealthcheck(socketId: string): void {
    const interval = this.notificationHealthIntervals.get(socketId);
    if (!interval) return;

    clearInterval(interval);
    this.notificationHealthIntervals.delete(socketId);
  }

  // private async handleJoinSession(socket: AuthenticatedSocket, data: JoinSessionData): Promise<void> {
  //   try {
  //     const { sessionId } = data; // This is either channelId or conversationId
  //     const { userId } = socket;

  //     logger.info(`🎯 [JOIN-SESSION] handleJoinSession called:`, {
  //       socketId: socket.id,
  //       userId,
  //       sessionId,
  //       userEmail: socket.userEmail
  //     });

  //     logger.info(`Attempting to join session: ${sessionId} for user: ${userId}`);

  //     // Try to find as channel first, then as conversation
  //     let isChannel = false;

  //     let entity = null;

  //     // First, try to find as a channel
  //     logger.info(`Searching for channel with ID: ${sessionId}`);
  //     entity = await this.channelRepository.findById(sessionId);

  //     if (entity) {
  //       isChannel = true;
  //       logger.info(`Found channel: ${entity.name}`);
  //     } else {
  //       // Not a channel, try as a conversation
  //       logger.info(`Searching for conversation with ID: ${sessionId}`);
  //       entity = await this.conversationRepository.findById(sessionId);

  //       if (entity) {

  //         logger.info(`Found conversation: ${entity.conversationId}`);
  //       }
  //     }

  //     if (!entity) {
  //       logger.warn(`No channel or conversation found for sessionId: ${sessionId}`);
  //       socket.emit('error', { message: 'Channel or conversation not found' });
  //       return;
  //     }

  //     // Join socket room (using same format for compatibility)
  //     logger.info(`🎯 [JOIN-SESSION] Joining socket to room: session:${sessionId}`);
  //     await socket.join(`session:${sessionId}`);
  //     logger.info(`🎯 [JOIN-SESSION] Socket successfully joined room: session:${sessionId}`);

  //     // Add to Redis tracking
  //     logger.info(`🎯 [JOIN-SESSION] Adding to Redis tracking...`);
  //     try {
  //       await redisService.subscribeToSession(sessionId, socket.id);
  //       await redisService.addParticipantToSession(sessionId, userId);
  //       logger.info(`🎯 [JOIN-SESSION] Successfully added to Redis tracking`);
  //     } catch (redisError) {
  //       logger.error(`🎯 [JOIN-SESSION] ❌ Redis tracking failed:`, redisError);
  //       // Continue even if Redis fails - socket.io room should still work
  //     }

  //     // Notify other participants
  //     socket.to(`session:${sessionId}`).emit('user_joined', {
  //       sessionId,
  //       userId,
  //       timestamp: new Date()
  //     });

  //     // Confirm join to user
  //     logger.info(`🎯 [JOIN-SESSION] Sending session_joined confirmation to user`);
  //     socket.emit('session_joined', {
  //       sessionId,
  //       participants: isChannel ? [] : [], // TODO: Get actual participants from channel/conversation
  //       timestamp: new Date()
  //     });

  //     const entityType = isChannel ? 'channel' : 'conversation';
  //     logger.info(`🎯 [JOIN-SESSION] ✅ User ${userId} successfully joined ${entityType} ${sessionId}`);
  //     logger.info(`User ${userId} joined ${entityType} ${sessionId}`);
  //   } catch (error) {
  //     logger.error(`🎯 [JOIN-SESSION] ❌ Error in handleJoinSession:`, {
  //       sessionId: data.sessionId,
  //       userId: socket.userId,
  //       error: error instanceof Error ? error.message : error
  //     });
  //     logger.error('Error handling join session:', error);
  //     socket.emit('error', { message: 'Failed to join session' });
  //   }
  // }

  // private async handleLeaveSession(socket: AuthenticatedSocket, data: JoinSessionData): Promise<void> {
  //   try {
  //     const { sessionId } = data;
  //     const { userId } = socket;

  //     // Leave socket room
  //     await socket.leave(`session:${sessionId}`);

  //     // Remove from Redis tracking
  //     await redisService.unsubscribeFromSession(sessionId, socket.id);
  //     await redisService.removeParticipantFromSession(sessionId, userId);

  //     // Notify other participants
  //     socket.to(`session:${sessionId}`).emit('user_left', {
  //       sessionId,
  //       userId,
  //       timestamp: new Date()
  //     });

  //     // Confirm leave to user
  //     socket.emit('session_left', {
  //       sessionId,
  //       timestamp: new Date()
  //     });

  //     logger.info(`User ${userId} left session ${sessionId}`);
  //   } catch (error) {
  //     logger.error('Error handling leave session:', error);
  //     socket.emit('error', { message: 'Failed to leave session' });
  //   }
  // }


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

      // Only broadcast typing if the socket user can access the target
      // channel/conversation (same check as subscribe_to_channels).
      const canAccess = isChannel
        ? await this.canAccessChannel(socket, sessionId)
        : await this.canAccessConversation(socket, sessionId);
      if (!canAccess) {
        logger.warn(`[TYPING] Unauthorized typing event by user ${socket.userId} in session ${sessionId}`);
        return;
      }

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

      // Only broadcast typing if the socket user can access the target
      // channel/conversation (same check as subscribe_to_channels).
      const canAccess = isChannel
        ? await this.canAccessChannel(socket, sessionId)
        : await this.canAccessConversation(socket, sessionId);
      if (!canAccess) {
        logger.warn(`[TYPING] Unauthorized typing event by user ${socket.userId} in session ${sessionId}`);
        return;
      }

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
   * Handle user status update (ONLINE/AWAY/OFFLINE)
   * Called when user manually changes their status via the UI
   */
  private async handleUpdateStatus(socket: AuthenticatedSocket, status: 'ONLINE' | 'AWAY' | 'OFFLINE'): Promise<void> {
    try {
      const { userId, userName, userEmail } = socket;
      
      logger.info(`[UPDATE-STATUS] User ${userName || userEmail} requested status change to ${status}`);
      
      // Update status in Redis and broadcast to all clients
      await userStatusService.setUserStatus(userId, status as UserPresenceStatus);
      
      // Send confirmation directly to the user who changed their status
      socket.emit('user_status_updated', {
        userId,
        status,
        onlineUsers: [], // Fallback for backwards compatibility with old frontend clients
      });
      
      logger.info(`[UPDATE-STATUS] User ${userName || userEmail} status updated to ${status}`);
    } catch (error) {
      logger.error('[UPDATE-STATUS] Error updating user status:', error);
      socket.emit('error', { message: 'Failed to update status' });
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

      this.stopOrgMemberConnectionHealthcheck(socket.id);

      // Clean up channel subscriptions for this socket
      await this.clearSocketSubscriptions(socket.id);
      logger.info(`🧹 [DISCONNECT] Cleaned up subscriptions for socket ${socket.id}`);

      // Remove user connection from Redis
      await redisService.removeUserConnection(userId, socket.id);


      // Unsubscribe from the org-member Redis channel when this pod has no
      // remaining sockets for the org member.
      if (socket.orgMemberId) {
        await redisService.removeOrgMemberConnection(socket.orgMemberId, socket.id);

        const socketIds = this.orgMemberSocketIds.get(socket.orgMemberId);
        if (socketIds) {
          socketIds.delete(socket.id);
          if (socketIds.size === 0) {
            this.orgMemberSocketIds.delete(socket.orgMemberId);
            await redisService.unsubscribeFromOrgMemberEvents(socket.orgMemberId);
            this.orgMemberEventSubscriptions.delete(socket.orgMemberId);
            logger.info(`🔌 [DISCONNECT] Unsubscribed org-member ${socket.orgMemberId} — no local sockets remain on this pod`);
          }
        }
      }

      // Check if user has other active connections
      const remainingConnections = await redisService.getUserConnections(userId);
      
      let activeConnections = 0;
      
      if (this.io && remainingConnections.length > 0) {
        // Verify each remaining connection is actually active across the cluster
        for (const sockId of remainingConnections) {
          try {
            const sockets = await this.io.in(sockId).fetchSockets();
            if (sockets && sockets.length > 0) {
              activeConnections++;
            } else {
              // It's a ghost connection, clean it up!
              logger.info(`🧹 [DISCONNECT-DEBUG] Removing ghost connection ${sockId} for user ${userId}`);
              await redisService.removeUserConnection(userId, sockId);
            }
          } catch (error) {
            logger.error(`Error verifying connection ${sockId} for user ${userId}:`, error);
          }
        }
      }
      
      if (activeConnections > 0) {
        // User has other tabs/devices open - do nothing, they're still connected
        logger.info(`👤 [USER-STATUS] User ${userName || userEmail} still has ${activeConnections} active connection(s), staying ONLINE`);
      } else {
        // No remaining active connections - schedule offline with grace period
        // This allows the user to reconnect (e.g., page refresh) without flickering offline
        logger.info(`👤 [DISCONNECT-DEBUG] Scheduling offline job for user ${userName || userEmail} (${userId}) with grace period`);
        await presenceCleanupQueue.scheduleOfflineJob(userId);
      }

      // Clean up typing indicators for this user
      await typingService.cleanupUserTyping(userId);

      // Get all sessions this socket was subscribed to and clean up
      const rooms = Array.from(socket.rooms);
      for (const room of rooms) {
        if (room.startsWith('session:')) {
          const sessionId = room.replace('session:', '');
          await redisService.unsubscribeFromSession(sessionId, socket.id);

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

  private async handleSosAlertAcknowledgment(socket: AuthenticatedSocket, data: { alertId: string }): Promise<void> {
    try {
      const { userId } = socket;
      if (!userId) return;
      const alertId = data?.alertId;
      if (!alertId || typeof alertId !== 'string') {
        logger.warn(`[SOS-ACK] Invalid alertId received from user ${userId}`);
        return;
      }
      // Verify the acking user owns this alert (by userId or same orgMember)
      const notification = await repositories.notifications.findById(alertId);
      if (!notification) {
        logger.warn(`[SOS-ACK] Alert ${alertId} not found, ignoring ack from user ${userId}`);
        return;
      }
      let isOwner = notification.userId === userId;
      if (!isOwner && socket.orgMemberId) {
        const owner = await repositories.users.findById(notification.userId);
        isOwner = !!owner?.orgMemberId && owner.orgMemberId === socket.orgMemberId;
      }
      if (!isOwner) {
        logger.warn(`[SOS-ACK] User ${userId} does not own alert ${alertId}, ignoring ack`);
        return;
      }

      await repositories.notifications.dismiss(alertId, notification.userId);

      // Forward ack to the user's other sessions across all workspaces
      const connections = socket.orgMemberId
        ? await redisService.getOrgMemberConnections(socket.orgMemberId)
        : await redisService.getUserConnections(userId);
      const others = connections.filter(id => id !== socket.id);
      logger.info(`[SOS-ACK] User ${userId} acknowledged alert ${alertId}, forwarding to ${others.length} other connection(s)`);
      for (const socketId of others) {
        this.io?.to(socketId).emit('sos_alert_acknowledged', { alertId });
      }
    } catch (error) {
      logger.error(`[SOS-ACK] Error handling SOS acknowledgment for alert ${data?.alertId}`, error);
    }
  }

  /** Tells the client which of its stored SOS alerts were already dismissed elsewhere. */
  private async handleSosAlertsSync(socket: AuthenticatedSocket, data: { alertIds: string[] }): Promise<void> {
    try {
      const { userId } = socket;
      if (!userId) return;
      const alertIds = Array.isArray(data?.alertIds)
        ? data.alertIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 50)
        : [];
      if (alertIds.length === 0) return;

      // Match against all of the user's workspace identities
      let userIds: string[] = [userId];
      if (socket.orgMemberId) {
        const siblings = await repositories.users.findMany({
          where: { orgMemberId: socket.orgMemberId },
        });
        if (siblings.length > 0) userIds = siblings.map(u => u.id);
      }

      const dismissed = await repositories.notifications.findMany({
        where: { id: { in: alertIds }, userId: { in: userIds }, status: 'DISMISSED' },
        select: { id: true },
      });
      if (dismissed.length === 0) return;

      logger.info(`[SOS-SYNC] User ${userId}: ${dismissed.length}/${alertIds.length} stored alert(s) already dismissed elsewhere`);
      for (const { id } of dismissed) {
        socket.emit('sos_alert_acknowledged', { alertId: id });
      }
    } catch (error) {
      logger.error('[SOS-SYNC] Error reconciling SOS alerts:', error);
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
      const { userId } = socket;
      const channels = Array.isArray(data?.channels) ? data.channels : [];
      const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
      // Observe-only: no cap enforced (see needs-design). Log large requests so
      // real subscription counts inform the eventual bound.
      const BULK_SUB_OBSERVE_THRESHOLD = 500;
      const requestedCount = channels.length + conversations.length;
      if (requestedCount > BULK_SUB_OBSERVE_THRESHOLD) {
        logger.warn(`[BULK-SUB-OBSERVE] Socket ${socket.id} (user ${userId}) requested ${requestedCount} subscriptions (no cap enforced)`);
      }

      // 🔒 Authorize every requested session against the user's channel membership /
      // workspace BEFORE subscribing. Mirrors the HTTP ACL in conversationController.
      const authorizedSessions: string[] = [];

      for (const channelId of channels) {
        if (await this.canAccessChannel(socket, channelId)) {
          authorizedSessions.push(channelId);
        } else {
          logger.warn(`🚫 [BULK-SUB] User ${userId} not authorized for channel ${channelId}; skipping`);
        }
      }

      for (const conversationId of conversations) {
        if (await this.canAccessConversation(socket, conversationId)) {
          authorizedSessions.push(conversationId);
        } else {
          logger.warn(`🚫 [BULK-SUB] User ${userId} not authorized for conversation ${conversationId}; skipping`);
        }
      }

      // Reset this socket's subscriptions, then subscribe only to authorized sessions.
      await this.clearSocketSubscriptions(socket.id);
      for (const sessionId of authorizedSessions) {
        await this.addSocketSubscription(socket.id, sessionId);
      }

      // Confirm subscription (only the sessions the user is actually allowed on).
      socket.emit('subscriptions_updated', {
        subscribed: authorizedSessions,
        total: authorizedSessions.length,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error(`❌ [BULK-SUB] Error in bulk subscription for socket ${socket.id}:`, error);
      socket.emit('subscription_error', { message: 'Failed to subscribe to channels' });
    }
  }

  /**
   * Authorization for subscribing to a channel's real-time stream.
   * Mirrors the HTTP ACL (conversationController): allow if the user is a channel
   * participant, or the channel is not PRIVATE — always scoped to the user's workspace.
   * DMs and group DMs are created PRIVATE, so they require participation.
   */
  private async canAccessChannel(socket: AuthenticatedSocket, channelId: string): Promise<boolean> {
    if (!channelId || typeof channelId !== 'string') return false;
    try {
      const channel = await repositories.channels.findById(channelId);
      if (!channel) return false;

      // Tenant boundary (fail-closed): a socket with no resolved workspace is denied,
      // and a channel whose workspaceId is set must match it.
      if (!socket.workspaceId) return false;
      if (channel.workspaceId && channel.workspaceId !== socket.workspaceId) {
        return false;
      }

      if (channel.visibility === 'PRIVATE') {
        return await repositories.channelParticipants.isParticipant(channelId, socket.userId);
      }
      return true;
    } catch (error) {
      logger.error(`❌ [BULK-SUB] canAccessChannel failed for ${channelId}:`, error);
      return false;
    }
  }

  /**
   * Authorization for subscribing to a conversation (thread). Access derives from
   * the parent channel's ACL, scoped to the user's workspace.
   */
  private async canAccessConversation(socket: AuthenticatedSocket, conversationId: string): Promise<boolean> {
    if (!conversationId || typeof conversationId !== 'string') return false;
    try {
      const conversation = await repositories.conversations.findById(conversationId);
      if (!conversation) return false;

      // Tenant boundary (fail-closed) — see canAccessChannel.
      if (!socket.workspaceId) return false;
      if (conversation.workspaceId && conversation.workspaceId !== socket.workspaceId) {
        return false;
      }

      return await this.canAccessChannel(socket, conversation.channelId);
    } catch (error) {
      logger.error(`❌ [BULK-SUB] canAccessConversation failed for ${conversationId}:`, error);
      return false;
    }
  }

  // private async handleAddSubscription(socket: AuthenticatedSocket, data: ChannelSubscriptionData): Promise<void> {
  //   try {
  //     const { sessionId } = data;

  //     logger.info(`➕ [ADD-SUB] Socket ${socket.id} adding subscription to session: ${sessionId}`);

  //     await this.addSocketSubscription(socket.id, sessionId);

  //     socket.emit('subscription_added', {
  //       sessionId,
  //       timestamp: new Date()
  //     });

  //     logger.info(`✅ [ADD-SUB] Socket ${socket.id} subscribed to session: ${sessionId}`);
  //   } catch (error) {
  //     logger.error(`❌ [ADD-SUB] Error adding subscription for socket ${socket.id}:`, error);
  //     socket.emit('subscription_error', { message: 'Failed to add channel subscription' });
  //   }
  // }

  // private async handleRemoveSubscription(socket: AuthenticatedSocket, data: ChannelSubscriptionData): Promise<void> {
  //   try {
  //     const { sessionId } = data;

  //     logger.info(`➖ [REMOVE-SUB] Socket ${socket.id} removing subscription from session: ${sessionId}`);

  //     await this.removeSocketSubscription(socket.id, sessionId);

  //     socket.emit('subscription_removed', {
  //       sessionId,
  //       timestamp: new Date()
  //     });

  //     logger.info(`✅ [REMOVE-SUB] Socket ${socket.id} unsubscribed from session: ${sessionId}`);
  //   } catch (error) {
  //     logger.error(`❌ [REMOVE-SUB] Error removing subscription for socket ${socket.id}:`, error);
  //     socket.emit('subscription_error', { message: 'Failed to remove channel subscription' });
  //   }
  // }

  /**
   * Setup global presence subscription
   * Subscribes to Redis Pub/Sub for presence events and broadcasts to all connected clients
   * This enables multi-server support - status changes on one server are broadcast to all servers
   */
  private async setupPresenceSubscription(): Promise<void> {
    try {
      logger.info('👤 [PRESENCE] Setting up global presence subscription...');
      
      await redisService.subscribeToPresenceEvents(async (event: PresenceEvent) => {
        await this.handlePresenceEvent(event);
      });
      
      logger.info('[PRESENCE] Global presence subscription active');
    } catch (error) {
      logger.error('[PRESENCE] Error setting up presence subscription:', error);
    }
  }

  /**
   * Handle presence events from Redis Pub/Sub
   * Broadcasts status updates to all connected clients on this server
   */
  private async handlePresenceEvent(event: PresenceEvent): Promise<void> {
    try {
      if (!this.io) {
        logger.info(`[PRESENCE-DEBUG] No io instance, skipping presence event`);
        return;
      }

      const { userId, status } = event;

      logger.info(`[PRESENCE] Received presence event: user=${userId}, status=${status}`);
      logger.info(`[PRESENCE-DEBUG] Full event: ${JSON.stringify(event)}`);

      // Broadcast to all connected clients on this server
      const connectedSocketsCount = this.io.sockets.sockets.size;
      logger.debug(`[PRESENCE] Broadcasting user_status_updated to ${connectedSocketsCount} connected sockets`);

      const broadcastPayload = {
        userId,
        status,
        onlineUsers: [], // Fallback for backwards compatibility with old frontend clients
      };

      this.io.emit('user_status_updated', broadcastPayload);

      logger.debug(`[PRESENCE] Broadcast complete for user_status_updated`);
    } catch (error) {
      logger.error('[PRESENCE] Error handling presence event:', error);
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

  private async setupOrgMemberEventSubscription(orgMemberId: string): Promise<void> {
    if (this.orgMemberEventSubscriptions.has(orgMemberId)) return;

    try {
      await redisService.subscribeToOrgMemberEvents(orgMemberId, (event: OrgMemberEvent) => {
        this.handleOrgMemberEvent(orgMemberId, event);
      });
      this.orgMemberEventSubscriptions.set(orgMemberId, true);
      logger.info(`✅ [ORGMEMBER-EVENTS] Subscribed to events for orgMember: ${orgMemberId}`);
    } catch (error) {
      logger.error(`❌ [ORGMEMBER-EVENTS] Failed subscribing orgMember ${orgMemberId}:`, error);
    }
  }

  private async handleOrgMemberEvent(orgMemberId: string, event: OrgMemberEvent): Promise<void> {
    try {
      if (event.type !== 'notification_received') return;

      const sourceUserId: string | undefined = event.data?.sourceUserId ?? event.data?.userId;
      if (!sourceUserId) {
        logger.warn(`[ORGMEMBER-EVENT] Missing sourceUserId on event for orgMember ${orgMemberId}; dropping`);
        return;
      }

      const socketIds = await redisService.getOrgMemberConnections(orgMemberId);
      if (socketIds.length === 0) return;

      for (const socketId of socketIds) {
        const socket = this.io?.sockets.sockets.get(socketId) as AuthenticatedSocket | undefined;
        if (!socket) continue;

        // Enforce strict orgMemberId match — guards against cross-tenant leakage.
        if (socket.orgMemberId !== orgMemberId) continue;

        await this.handleNotificationEvent(sourceUserId, orgMemberId, socketId, event);
      }
    } catch (error) {
      logger.error(`[ORGMEMBER-EVENT] Error handling event for orgMember ${orgMemberId}:`, error);
    }
  }

  // Handle user events from Redis and broadcast to user's connections
  private async handleUserEvent(userId: string, event: any): Promise<void> {
    try {
      logger.info(`👤 [USER-EVENT] Received event for user ${userId}:`, {
        type: event.type,
        timestamp: event.timestamp
      });

      if (event.type === 'notification_received') {
        logger.info(`👤 [USER-EVENT] Ignoring legacy user-channel notification for user ${userId}; notifications route by orgMemberId`);
        return;
      }

      this.io?.to(`user:${userId}`).emit(event.type, {
        ...event.data,
        timestamp: event.timestamp,
      });

      logger.info(`✅ [USER-EVENT] Broadcasted ${event.type} to room user:${userId}`);
    } catch (error) {
      logger.error(`❌ [USER-EVENT] Error handling user event for ${userId}:`, error, event);
    }
  }

  /**
   * Helper to handle notification events with edge creation and platform filtering
   * Returns true if the event was fully handled (emitted or skipped), false if it should fall back to standard emission
   */
  private async handleNotificationEvent(userId: string, orgMemberId: string, socketId: string, event: any): Promise<boolean> {
    try {
      const platform = await redisService.getOrgMemberSocketPlatform(orgMemberId, socketId);
      
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
          if (message.visibleTo) {
            const socket = this.io?.sockets.sockets.get(socketId) as AuthenticatedSocket | undefined;
            if (socket?.userId !== message.visibleTo) continue;
          }
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

  broadcastTicketCountsUpdate(payload: {
    operation: 'insert' | 'update' ;
    ticket: {
      id: string;
      workspaceId: string;
      boardId: string | null;
      projectId: string | null;
      stageName: string | null;
      statusV2: string | null;
      priority: string | null;
      assignedTo: string | null;
      createdBy: string | null;
      userGroupId: string | null;
      ticketType: string | null;
      eta: number | null;
      createdAt: number;
      tags?: string[];
      prReviewers?: string[];
      qaAssigned?: string[];
      roleAssignments?: Array<{ roleId: string; userIds: string[] }>;
      formFieldValues?: Record<string, unknown>;
    };
    previousTicket?: {
      id: string;
      workspaceId: string;
      boardId: string | null;
      projectId: string | null;
      stageName: string | null;
      statusV2: string | null;
      priority: string | null;
      assignedTo: string | null;
      createdBy: string | null;
      userGroupId: string | null;
      ticketType: string | null;
      eta: number | null;
      createdAt: number;
      tags?: string[];
      prReviewers?: string[];
      qaAssigned?: string[];
      roleAssignments?: Array<{ roleId: string; userIds: string[] }>;
      formFieldValues?: Record<string, unknown>;
    } | null;
  }): void {
    if (!this.io) {
      logger.warn('WebSocket server not initialized');
      return;
    }

    const rooms = new Set<string>();
    for (const room of this.getTicketCountsRooms(payload.ticket)) {
      rooms.add(room);
    }
    if (payload.previousTicket) {
      for (const room of this.getTicketCountsRooms(payload.previousTicket)) {
        rooms.add(room);
      }
    }

    const eventPayload = {
      ...payload,
      timestamp: new Date().toISOString(),
    };

    for (const room of rooms) {
      this.io.to(room).emit('ticket_counts_room_updated', eventPayload);
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
    try {
      const connections = await redisService.getUserConnections(userId);
      return connections.length > 0;
    } catch (error) {
      logger.warn(`[WebSocketService] Failed to check online status for user ${userId}`, { error });
      return false;
    }
  }

  // Workflow subscription handlers (room-based with Redis pub/sub bridge)
  private getTicketCountsRoomName(type: TicketCountsRoomType, id: string): string {
    return `ticket-counts:${type}:${id}`;
  }

  private getTicketCountsRooms(ticket: {
    boardId: string | null;
    projectId: string | null;
    assignedTo: string | null;
    createdBy: string | null;
    userGroupId: string | null;
  }): string[] {
    const rooms = new Set<string>();

    if (ticket.projectId) {
      rooms.add(this.getTicketCountsRoomName('project', ticket.projectId));
    }

    if (ticket.boardId) {
      rooms.add(this.getTicketCountsRoomName('board', ticket.boardId));
    }

    const userIds = [ticket.assignedTo, ticket.createdBy].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    for (const userId of userIds) {
      rooms.add(this.getTicketCountsRoomName('user', userId));
    }

    if (ticket.userGroupId) {
      rooms.add(this.getTicketCountsRoomName('group', ticket.userGroupId));
    }

    return [...rooms];
  }

  private handleTicketCountsSubscription(socket: AuthenticatedSocket, room: string): void {
    if (!room || typeof room !== 'string') return;

    // Only allow well-formed ticket-counts rooms — never an arbitrary room string.
    if (!/^ticket-counts:(project|board|user|group):[^:]+$/.test(room)) {
      logger.warn(`[TICKET-COUNTS] Rejected malformed room "${room}" from user ${socket.userId}`);
      return;
    }
    // A user may only subscribe to their OWN per-user ticket-counts room. The
    // project/board/group rooms remain open (workspace-scoped ids). Consequently the
    // "view a teammate's tickets" board (?assignee=<other>) gets no live count pushes;
    // it still renders from the REST snapshot. Re-opening it needs a same-workspace
    // membership check.
    if (room.startsWith('ticket-counts:user:') && room !== `ticket-counts:user:${socket.userId}`) {
      logger.warn(`[TICKET-COUNTS] Rejected cross-user room "${room}" from user ${socket.userId}`);
      return;
    }

    socket.join(room);
  }

  private handleTicketCountsUnsubscription(socket: AuthenticatedSocket, room: string): void {
    if (!room) return;

    socket.leave(room);
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


  broadcastZeroFallbackConfig(config: { fallbackEnabled: boolean; allowMutations: boolean; pollIntervalMs: number }): void {
    if (!this.io) {
      logger.warn('⚠️ [ZERO-FALLBACK] WebSocket server not initialized, cannot broadcast');
      return;
    }
    redisService.broadcastZeroFallbackConfigUpdate(config).catch(error => {
      logger.error('❌ [ZERO-FALLBACK] Failed to broadcast via Redis:', error);
    });
    
    logger.info(`📢 [ZERO-FALLBACK] Broadcasted config via Redis: fallbackEnabled=${config.fallbackEnabled}, allowMutations=${config.allowMutations}, pollIntervalMs=${config.pollIntervalMs}`);
  }

  private async setupZeroFallbackConfigSubscription(): Promise<void> {
    try {
      await redisService.subscribeToZeroFallbackConfigUpdates((config) => {
        this.handleZeroFallbackConfigUpdate(config);
      });

      logger.info('✅ [ZERO-FALLBACK] Fallback config subscription established successfully');
    } catch (error) {
      logger.error('❌ [ZERO-FALLBACK] Error setting up fallback config subscription:', error);
    }
  }

  private handleZeroFallbackConfigUpdate(config: { fallbackEnabled: boolean; allowMutations: boolean; pollIntervalMs: number; timestamp: Date }): void {
    try {
      if (!this.io) {
        logger.warn('⚠️ [ZERO-FALLBACK] WebSocket server not initialized, cannot broadcast to local clients');
        return;
      }
      this.io.emit('zero_fallback_config_updated', {
        fallbackEnabled: config.fallbackEnabled,
        allowMutations: config.allowMutations,
        pollIntervalMs: config.pollIntervalMs
      });
      
      logger.info(`✅ [ZERO-FALLBACK] Broadcasted config update to all local clients: fallbackEnabled=${config.fallbackEnabled}, allowMutations=${config.allowMutations}, pollIntervalMs=${config.pollIntervalMs}`);
    } catch (error) {
      logger.error('❌ [ZERO-FALLBACK] Error broadcasting config update to local clients:', error);
    }
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
