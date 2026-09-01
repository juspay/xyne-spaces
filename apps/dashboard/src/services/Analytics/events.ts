/**
 * PostHog Event Constants
 *
 * Optional constants for common event names and property values.
 *
 * USAGE GUIDE:
 *
 * 1. For constant/predefined values - use EVENT_PROPERTIES:
 *    posthogService.capture(EVENTS.NAVIGATION, {
 *      item: EVENT_PROPERTIES.NAVIGATION_ITEMS.CHAT,
 *    });
 *
 * 2. For dynamic/runtime values - send plain objects:
 *    posthogService.capture('button_click', {
 *      buttonId: 'submit',
 *      userId: user.id,
 *    });
 *
 * TIP: Add constants to EVENT_PROPERTIES only for values that repeat across the
 *      app. For one-off values, use plain strings/numbers directly.
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
  MESSAGE_SEND: 'message_send',
  MESSAGE_SEND_FAILED: 'message_send_failed',

  // Conversation events
  CONVERSATION_OPENED: 'conversation_opened',

  // Search events
  SEARCH_PERFORMED: 'search_performed',

  // WebSocket events
  WS_CONNECTION_CLOSED: 'ws_connection_closed',

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
    SCHEDULE_MESSAGE: 'scheduleMessage',
    COPY_MESSAGE: 'copyMessage',
    ATTACH_FILES: 'attachFiles',
    AI_QUERY_SUBMITTED: 'aiQuerySubmitted',
    AI_GENERATION_STOPPED: 'aiGenerationStopped',
    AGENT_SWITCHED: 'agentSwitched',
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
