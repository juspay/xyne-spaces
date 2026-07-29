/**
 * Mixpanel Event Constants
 *
 * This file provides optional constants for common event names and properties
 *
 * USAGE GUIDE:
 *
 * 1. For constant/predefined values - Define them in EVENT_PROPERTIES:
 *    mixpanelService.track(EVENTS.NAVIGATION, {
 *      item: EVENT_PROPERTIES.NAVIGATION_ITEMS.CHAT  // ← Constant value
 *    });
 *
 * 2. For dynamic/runtime values - Send them as plain objects:
 *    mixpanelService.track('ButtonClicked', {
 *      buttonId: 'submit',           // ← Dynamic value
 *      timestamp: Date.now(),        // ← Dynamic value
 *      userId: user.id               // ← Dynamic value (auto-added)
 *    });
 *
 * 3. Mix both approaches:
 *    mixpanelService.track(EVENTS.INITIATE_ACTION, {
 *      type: EVENT_PROPERTIES.ACTION_TYPES.DELETE_MESSAGE,  // ← Constant
 *      messageId: message.id,                               // ← Dynamic
 *      channelName: channel.name                            // ← Dynamic
 *    });
 *
 * TIP: Add constants to EVENT_PROPERTIES only for values that repeat across the app.
 *      For one-time or unique values, use plain strings/numbers directly.
 */

// Common event names (optional - you can use plain strings)
export const EVENTS = {
  NAVIGATION: 'Navigation',
  INITIATE_ACTION: 'InitiateAction',
  AUTHENTICATION: 'Authentication',
  APP_REFRESH: 'AppRefresh',
  SEARCH_EXECUTED: 'SearchExecuted',

  // App lifecycle events (for DAU/WAU/MAU tracking)
  APP_OPEN: 'app_open',

  // Messaging events
  MESSAGE_SEND_FAILED: 'message_send_failed',

  // Conversation events
  CONVERSATION_OPENED: 'conversation_opened',

  // Search events
  SEARCH_PERFORMED: 'search_performed',

  // WebSocket events
  WS_CONNECTION_CLOSED: 'ws_connection_closed',

  // Unified Performance Event
  PERFORMANCE_METRIC: 'performance_metric',

  // Settings/Preferences events
  PREFERENCE_CHANGED: 'preference_changed',
} as const;

// Common property values (optional - you can use plain strings)
export const EVENT_PROPERTIES = {
  // Action types
  ACTION_TYPES: {
    JOIN_CHANNEL: 'joinChannel',
    REACTION_ADDED: 'ReactionAdded',
    REACTION_REMOVED: 'ReactionRemoved',
    DELETE_MESSAGE: 'deleteMessage',
    NEW_CHANNEL: 'newChannel',
    NEW_DM: 'newDm',
    NEW_GROUP_DM: 'newGroupDm',
    START_CALL: 'startCall',
    END_CALL: 'endCall',
    EDIT: 'edit',
    THREAD_REPLY: 'ThreadReply',
    DIRECT_MESSAGE: 'DirectMessage',
    ACTIVITY_VIEWED: 'ActivityViewed',
    THREAD_VIEWED: 'ThreadViewed',
    ACTIVITY_TAB_CHANGED: 'ActivityTabChanged',
    ACTIVITY_UNREAD_TOGGLED: 'ActivityUnreadToggled',
    FILE_UPLOADED: 'FileUploaded',
    PROJECT_CREATED: 'ProjectCreated',
  },

  PERFORMANCE_METRIC_TYPES: {
    // Message Performance
    MESSAGES_LOADED: 'messages_loaded',
    MESSAGES_LOAD_FAILED: 'message_load_failed',

    // Call Performance
    CALL_JOIN: 'call_join',
    CALL_CONNECTION_FAILED: 'call_connection_failed',

    // WebSocket connection event
    WS_CONNECTION_RECONNECT_ATTEMPT: 'ws_connection_reconnect_attempt',

    // Zero Connection Performance
    ZERO_CONNECTION_ERROR: 'zero_connection_error',
    ZERO_CONNECTION_MAX_RETRIES_REACHED: 'zero_connection_max_retries_reached',
    ZERO_CONNECTION_STABLE: 'zero_connection_stable',

    // API Performance
    API_LATENCY: 'api_latency',
  },

  // Authentication types
  AUTH_TYPES: {
    LOGIN: 'Login',
    LOGOUT: 'Logout',
  },

  // Conversation types
  CONVERSATION_TYPES: {
    CHANNEL: 'channel',
    DM: 'dm',
    GROUP_DM: 'group_dm',
  },

  // Search types
  SEARCH_TYPES: {
    MESSAGES: 'messages',
    CHANNELS: 'channels',
    USERS: 'users',
    FILES: 'files',
    COMMAND_MENU: 'command_menu',
  },

  // Message failure reasons
  MESSAGE_FAILURE_REASONS: {
    NETWORK_ERROR: 'network_error',
    TIMEOUT: 'timeout',
    VALIDATION_ERROR: 'validation_error',
    PERMISSION_DENIED: 'permission_denied',
    UNKNOWN: 'unknown',
  },

  // WebSocket disconnect reasons
  WS_DISCONNECT_REASONS: {
    CLIENT_INITIATED: 'client_initiated',
    SERVER_INITIATED: 'server_initiated',
    NETWORK_ERROR: 'network_error',
    TIMEOUT: 'timeout',
    AUTHENTICATION_FAILED: 'authentication_failed',
    UNKNOWN: 'unknown',
  },

  // App refresh triggers
  REFRESH_TRIGGERS: {
    ZERO_SYNC_AUTH_ERROR: 'ZeroSyncAuthError',
    ZERO_SYNC_AUTH_INVALIDATED: 'ZeroSyncAuthInvalidated',
    API_SESSION_EXPIRED: 'ApiSessionExpired',
    AUTH_SUCCESS_REDIRECT: 'AuthSuccessRedirect',
  },
} as const;
