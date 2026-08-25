/**
 * Activity Tracking Types
 * Shared between frontend and backend for user activity and idle time tracking
 */

export type ActivityEvent = 'onIdle' | 'onActive' | 'onAction';
export type ActivityStatus = 'idle' | 'active';

/**
 * Activity log payload sent from frontend to backend
 */
export interface ActivityLogPayload {
  timestamp: string; // ISO 8601 format: "2025-01-14T09:00:00Z"
  userId: string; // Current user's ID
  userEmail?: string; // Current user's email (optional for privacy)
  sessionId?: string; // Added by backend from UserSession.id (cookie)
  event: ActivityEvent; // Which idle timer event fired
  status: ActivityStatus; // Current user state
  page: string; // Current URL path
  activeDurationSec?: number;
  pageDurationSec?: number; // Active seconds on current page (only in onIdle/onAction page_change)
  previousPage?: string; // Previous page path, first segment (only on page_change)
  previousPagePath?: string; // Full workspace-prefixed path of the page just left (only on page_change)
  idleTimeSec?: number; // Idle time in seconds
  platform?: string; // Platform info from UserSession.deviceInfo (set by backend)
  triggerEvent?: string; // DOM event that triggered the activity (e.g., 'mousemove', 'keydown', 'page_change')
}

/**
 * Extended activity log entry with server-side fields (backend only)
 */
export interface ActivityLogEntry extends ActivityLogPayload {
  serverTimestamp: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
}
