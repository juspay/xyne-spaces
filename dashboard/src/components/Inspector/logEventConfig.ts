/**
 * Inspector Log Event Configuration
 *
 * Controls which log events are shown in "Important Only" mode
 * and which fields to display in compact view per container.
 *
 * To include a new event: add it to IMPORTANT_LOG_EVENTS
 * To exclude an event: remove it from IMPORTANT_LOG_EVENTS
 * To customize compact fields for a container: add/edit entry in IMPORTANT_FIELDS
 */

// Events to INCLUDE in Inspector's "Important Only" view
export const IMPORTANT_LOG_EVENTS = new Set([
  // Loader / latency events
  'app_loader_hidden',
  'splash_screen_hidden',
  'loading_animation_hidden',
  'initial_state_hydration_complete',
  'initial_state_hydration_failed',
  'thread_messages_loaded',
  'activities_loaded',
  'call_history_loaded',
  'kanban_entity_loaded',

  // API call errors
  'api_call_failed',

  // Auth events
  'auth_error_occurred',
  'auth_refresh_success',
  'auth_refresh_failed',
  'auth_session_expired',
  'clear_auth_token_called',

  // Connection state changes
  'zero_socket_connected',
  'zero_socket_connecting',
  'zero_socket_disconnected',
  'zero_socket_connection_error',
  'zero_socket_auth_required',
  'zero_socket_connection_closed',
  'zero_error_reload_initiated',
  'zero_error_reconnect_initiated',
  'zero_error_reload_limit_reached',
  'websocket_connection_successful',
  'websocket_connection_closed',
  'websocket_connection_failed',

  // Canvas errors
  'canvas_connection_error',
  'canvas_prefetch_failed',
  'canvas_create_failed',

  // Recording errors
  'recording_error',

  // Chat prefetch errors
  'conversation_prefetch_error',

  // LiveKit connection issues
  'livekit_socket_disconnected',
  'livekit_socket_reconnecting',
  'livekit_track_subscription_failed',

  // Zero query latency (only complete/error events carry latency data)
  // 'zero_query_called',
  'zero_query_complete',
  'zero_query_failed',
  // 'zero_cached_query_called',
  'zero_cached_query_complete',
  'zero_cached_query_error',
  // 'zero_mutation_called',
  'zero_mutation_complete',
  'zero_mutation_error',
  // 'zero_run_called',
  'zero_run_complete',
  'zero_run_error',

  // App lifecycle
  'app_refresh',
]);

// Which fields to show in compact view per container
// Only these fields are displayed in the one-liner; chevron expands to full JSON
export const IMPORTANT_FIELDS: Record<string, string[]> = {
  'xyne-logging-bridge': [
    'platformName',
    'version',
    'zeroClientId',
    'zeroSocketState',
    'event',
    'mutation',
    'query',
    'url',
    'api_url',
    'duration',
    'durationMs',
    'latency',
    'statusCode',
    'status_code',
    'error',
    'reason',
  ],
  'xyne-backend': ['message', 'module', 'requestId', 'latency', 'durationMs', 'error'],
  'xyne-worker': ['message', 'module', 'error'],
  _default: ['message', 'event', 'error', 'latency', 'durationMs'],
};

/**
 * Get the important fields for a given container name
 */
export function getImportantFields(container: string): string[] {
  return IMPORTANT_FIELDS[container] || IMPORTANT_FIELDS['_default']!;
}

/**
 * Check if a log event is considered important
 */
export function isImportantEvent(event: string): boolean {
  return IMPORTANT_LOG_EVENTS.has(event);
}

/**
 * Build a LogsQL filter string for important events
 * e.g. event:in("app_loader_hidden","splash_screen_hidden",...)
 */
export function buildImportantEventsFilter(): string {
  const events = [...IMPORTANT_LOG_EVENTS].map(e => `"${e}"`).join(',');
  return `event:in(${events})`;
}

/**
 * Get color class for a field value in compact log view
 */
export function getFieldColor(field: string, value: string): string {
  switch (field) {
    case 'event':
      return 'text-cyan-700 dark:text-cyan-400';
    case 'duration':
    case 'durationMs':
    case 'latency': {
      const num = Number(value);
      if (num > 3000) return 'text-red-700 dark:text-red-300';
      if (num > 1000) return 'text-yellow-700 dark:text-yellow-400';
      return 'text-emerald-600 dark:text-green-400';
    }
    case 'url':
    case 'api_url':
      return 'text-blue-700 dark:text-blue-400';
    case 'statusCode':
    case 'status_code': {
      const code = Number(value);
      if (code >= 400) return 'text-red-700 dark:text-red-300';
      if (code >= 300) return 'text-yellow-700 dark:text-yellow-400';
      return 'text-emerald-600 dark:text-green-400';
    }
    case 'error':
    case 'reason':
      return 'text-red-700 dark:text-red-300';
    case 'platformName':
      return 'text-muted-foreground';
    case 'notificationSocketState':
    case 'zeroSocketState':
      return value === 'connected'
        ? 'text-emerald-600 dark:text-green-400'
        : value === 'disconnected'
          ? 'text-red-700 dark:text-red-300'
          : 'text-yellow-700 dark:text-yellow-400';
    default:
      return 'text-foreground/80';
  }
}
