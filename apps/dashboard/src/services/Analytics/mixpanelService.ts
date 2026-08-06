import mixpanel from 'mixpanel-browser';
import posthog from 'posthog-js';

interface MixpanelUser {
  id: string;
  name?: string;
  email?: string;
  googleId?: string;
  [key: string]: string | undefined; // Allow any additional properties
}

interface EventProperties {
  [key: string]:
    | string
    | number
    | boolean
    | undefined
    | null
    | Record<string, unknown>
    | string[]
    | number[];
}

class MixpanelService {
  private isInitialized = false;
  private isPosthogInitialized = false;
  private currentUserId: string | null = null;
  private currentPlatform: string | null = null;
  private registeredProperties: string[] = [];
  private isRecording = false;

  // Session Replay Configuration - Toggle this to enable/disable session replay
  private readonly ENABLE_SESSION_REPLAY = false; // Set to true to enable session replay

  // Idle detection state
  private idleTimer: number | null = null;
  private isIdle = false;
  private wasIdleBeforeHidden = false;
  private lastActivityTime = Date.now();
  private readonly IDLE_TIMEOUT = 3 * 60 * 1000; // 3 minutes
  private readonly THROTTLE_DELAY = 1000; // 1 second
  private readonly ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart'] as const;

  // Production URL configuration
  private readonly PRODUCTION_URLS = [
    'https://spaces.xyne.juspay.net',
    'https://app.spaces.xyne.juspay.net',
  ];

  /**
   * Check if the current URL is a production URL
   * Only send events to Mixpanel on production URLs
   */
  private isProductionUrl(): boolean {
    const currentUrl = window.location.origin;
    return this.PRODUCTION_URLS.some(prodUrl => currentUrl.startsWith(prodUrl));
  }

  initialize(): void {
    this.initializePosthog();

    if (this.isInitialized) {
      return;
    }

    const token = import.meta.env['VITE_MIXPANEL_TOKEN'] as string | undefined;

    if (!token || token.trim() === '') {
      return;
    }

    try {
      /* eslint-disable @typescript-eslint/naming-convention */
      mixpanel.init(token, {
        debug: false,
        track_pageview: false,
        persistence: 'localStorage',
        ignore_dnt: false,
        secure_cookie: window.location.protocol === 'https:',
        // Session Replay Configuration - Controlled by ENABLE_SESSION_REPLAY constant
        record_sessions_percent: this.ENABLE_SESSION_REPLAY ? 100 : 0,
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      // Set initialized immediately (don't wait for loaded callback)
      this.isInitialized = true;

      // Recording starts automatically due to record_sessions_percent: 100
      this.isRecording = false; // need to set to true if session recording needed

      // Start idle detection if session replay is enabled
      if (this.ENABLE_SESSION_REPLAY) {
        this.startIdleDetection();
      }
    } catch {
      this.isInitialized = false;
    }
  }

  private initializePosthog(): void {
    if (this.isPosthogInitialized) {
      return;
    }

    const key = import.meta.env['VITE_POSTHOG_KEY'] as string | undefined;
    const host = import.meta.env['VITE_POSTHOG_HOST'] as string | undefined;

    if (!key || key.trim() === '' || !host || host.trim() === '') {
      return;
    }

    try {
      /* eslint-disable @typescript-eslint/naming-convention */
      posthog.init(key, {
        api_host: host,
        defaults: '2025-05-24',
      });
      /* eslint-enable @typescript-eslint/naming-convention */
      this.isPosthogInitialized = true;
    } catch {
      this.isPosthogInitialized = false;
    }
  }

  /**
   * Start idle detection to pause/resume recording on inactivity
   */
  private startIdleDetection(): void {
    if (!this.ENABLE_SESSION_REPLAY) return;

    // Setup activity listeners (events that bubble)
    this.ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, this.handleActivity, { passive: true });
    });

    // Setup scroll listener with capture phase (scroll doesn't bubble)
    window.addEventListener('scroll', this.handleActivity, { capture: true, passive: true });

    // Setup visibility listener
    document.addEventListener('visibilitychange', this.handleVisibility);

    // Start timer
    this.resetIdleTimer();

    // Pause if tab is already hidden
    if (document.hidden) {
      this.stopSessionRecording();
    }
  }

  /**
   * Stop idle detection and cleanup
   */
  private stopIdleDetection(): void {
    if (!this.ENABLE_SESSION_REPLAY) return;

    // Remove activity listeners (events that bubble)
    this.ACTIVITY_EVENTS.forEach(event => {
      window.removeEventListener(event, this.handleActivity);
    });

    // Remove scroll listener with same options used in addEventListener (critical for proper cleanup)
    window.removeEventListener('scroll', this.handleActivity, { capture: true });

    // Remove visibility listener
    document.removeEventListener('visibilitychange', this.handleVisibility);

    // Clear timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Handle user activity (throttled)
   */
  private handleActivity = (): void => {
    if (!this.ENABLE_SESSION_REPLAY) return;

    const now = Date.now();
    if (now - this.lastActivityTime < this.THROTTLE_DELAY) return;

    this.lastActivityTime = now;

    // Resume recording if was idle
    if (this.isIdle && !document.hidden) {
      this.isIdle = false;
      this.wasIdleBeforeHidden = false;
      this.startSessionRecording();
    }

    this.resetIdleTimer();
  };

  /**
   * Handle tab visibility changes
   */
  private handleVisibility = (): void => {
    if (!this.ENABLE_SESSION_REPLAY) return;

    if (document.hidden) {
      // Save idle state before hiding tab
      this.wasIdleBeforeHidden = this.isIdle;
      this.stopSessionRecording();
    } else {
      // Tab became visible - only resume if user wasn't idle before tab was hidden
      if (!this.isRecording && !this.wasIdleBeforeHidden) {
        this.startSessionRecording();
      }
      // If user was idle, wait for activity to resume (handleActivity will do it)
      this.resetIdleTimer();
    }
  };

  /**
   * Reset idle timer
   */
  private resetIdleTimer(): void {
    if (!this.ENABLE_SESSION_REPLAY) return;

    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (document.hidden) return;

    this.idleTimer = window.setTimeout(() => {
      this.isIdle = true;
      this.stopSessionRecording();
    }, this.IDLE_TIMEOUT);
  }

  /**
   * Set platform for tracking
   * Should be called once when the app initializes
   */
  setPlatform(platform: string): void {
    this.currentPlatform = platform;
  }

  /**
   * Get enriched properties with user context
   */
  private getEnrichedProperties(properties?: EventProperties): EventProperties {
    const enrichedProps: EventProperties = {
      ...properties,
      timestamp: Date.now(),
    };

    // Always add userId if available (compulsory for all events)
    if (this.currentUserId) {
      enrichedProps['userId'] = this.currentUserId;
    }

    // Always add platform if available
    if (this.currentPlatform) {
      enrichedProps['platform'] = this.currentPlatform;
    }

    return enrichedProps;
  }

  /**
   * Validate event name
   */
  private isValidEventName(eventName: string): boolean {
    return typeof eventName === 'string' && eventName.trim().length > 0;
  }

  /**
   * Track any event with any properties
   * userId is automatically added from super properties and enriched properties
   * Events are only sent to Mixpanel on production URLs
   */
  track(eventName: string, properties?: EventProperties): void {
    if (!this.isValidEventName(eventName)) {
      return;
    }

    if (this.isPosthogInitialized) {
      try {
        posthog.capture(eventName, this.getEnrichedProperties(properties || {}));
      } catch {
        // Silently fail if posthog capture fails
      }
    }

    if (!this.isInitialized) {
      return;
    }

    // Only track events on production URLs
    if (!this.isProductionUrl()) {
      return;
    }

    try {
      // Enrich properties with userId if available
      const enrichedProperties = this.getEnrichedProperties(properties || {});
      mixpanel.track(eventName, enrichedProperties);
    } catch {
      return;
    }
  }

  /**
   * Identify a user with their ID and properties
   * Sets super properties and user profile for automatic enrichment of all events
   * All user properties (except picture) are registered as super properties
   */
  identify(user: MixpanelUser): void {
    // Auto-initialize if not already initialized
    if (!this.isInitialized) {
      this.initialize();
    }

    if (this.isPosthogInitialized && user?.id) {
      try {
        const posthogProperties: Record<string, string> = {};
        Object.keys(user).forEach(key => {
          const value = user[key];
          if (value !== undefined && key !== 'picture' && key !== 'id') {
            posthogProperties[key] = value;
          }
        });
        posthog.identify(user.id, posthogProperties);
      } catch {
        // Silently fail if posthog identify fails
      }
    }

    if (!this.isInitialized || !user?.id) {
      return;
    }

    try {
      this.currentUserId = user.id;

      mixpanel.identify(user.id);

      const userProperties: Record<string, string> = {};
      Object.keys(user).forEach(key => {
        const value = user[key];
        if (value !== undefined && key !== 'picture' && key !== 'id') {
          userProperties[key] = value;
        }
      });

      userProperties['userId'] = user.id;
      this.registeredProperties = Object.keys(userProperties);

      /* eslint-disable @typescript-eslint/naming-convention */
      mixpanel.register(userProperties);
      mixpanel.people.set({
        $distinct_id: user.id,
        ...userProperties,
      });
      /* eslint-enable @typescript-eslint/naming-convention */
    } catch {
      this.currentUserId = null;
    }
  }

  /**
   * Reset user identity (call on logout)
   * Clears user ID, super properties, and user profile
   */
  reset(): void {
    if (this.isPosthogInitialized) {
      try {
        posthog.reset();
      } catch {
        // Silently fail if posthog reset fails
      }
    }

    if (!this.isInitialized) {
      return;
    }

    this.currentUserId = null;
    this.isRecording = false;
    this.isIdle = false;
    this.wasIdleBeforeHidden = false;

    this.stopIdleDetection();

    try {
      this.registeredProperties.forEach(prop => {
        mixpanel.unregister(prop);
      });
      this.registeredProperties = [];

      mixpanel.reset();
    } catch {
      // Silently fail if mixpanel API calls fail
    }
  }

  /**
   * Start session replay recording for the current session
   * Note: Recording will only start if session replay is enabled in initialization
   */
  startSessionRecording(): void {
    if (!this.ENABLE_SESSION_REPLAY || !this.isInitialized || this.isRecording) {
      return;
    }

    try {
      mixpanel.start_session_recording();
      this.isRecording = true;
    } catch {
      // Silently fail if session replay is not available or configured
      return;
    }
  }

  /**
   * Stop session replay recording for the current session
   */
  stopSessionRecording(): void {
    if (!this.ENABLE_SESSION_REPLAY || !this.isInitialized || !this.isRecording) {
      return;
    }

    try {
      mixpanel.stop_session_recording();
      this.isRecording = false;
    } catch {
      // Silently fail if session replay is not available
      return;
    }
  }

  /**
   * Get the current session replay properties
   * Returns an object containing the replay ID if session recording is active
   */
  getSessionRecordingProperties():
    | {
        /* eslint-disable-next-line @typescript-eslint/naming-convention */
        $mp_replay_id?: string;
      }
    | Record<string, never> {
    if (!this.ENABLE_SESSION_REPLAY || !this.isInitialized) {
      return {};
    }

    try {
      return mixpanel.get_session_recording_properties();
    } catch {
      return {};
    }
  }

  /**
   * Get the current session replay ID
   * Returns the replay ID if session recording is active, or null if not available
   */
  getSessionReplayId(): string | null {
    if (!this.ENABLE_SESSION_REPLAY) {
      return null;
    }
    const properties = this.getSessionRecordingProperties();
    return properties.$mp_replay_id ?? null;
  }
}

// Export a singleton instance
export const mixpanelService = new MixpanelService();

// Export types
export type { MixpanelUser, EventProperties };

// Re-export constants (optional to use)
export { EVENTS, EVENT_PROPERTIES } from './mixpanel.types';
