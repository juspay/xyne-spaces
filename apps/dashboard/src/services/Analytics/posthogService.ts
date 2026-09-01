import posthog from 'posthog-js';

interface PosthogUser {
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

/**
 * PostHogService
 *
 * Single home for all PostHog logic. Captures the entire user journey:
 *  - autocapture: every click (incl. every button), input change and pageview is
 *    recorded automatically without instrumenting individual elements.
 *  - heatmaps: enabled so click/scroll heatmaps are available in the dashboard.
 *  - session replay: records the full session so the journey can be replayed.
 *  - rageclick + dead click detection for friction analysis.
 *
 * Custom events can still be sent explicitly via `capture()`.
 */
class PostHogService {
  private isInitialized = false;
  private currentUserId: string | null = null;
  private currentPlatform: string | null = null;

  /**
   * Initialize PostHog. No-op if env vars are missing or already initialized.
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    const key = import.meta.env['VITE_POSTHOG_KEY'] as string | undefined;
    const host =
      (import.meta.env['VITE_POSTHOG_HOST'] as string | undefined) || 'https://eu.i.posthog.com';

    if (!key || key.trim() === '' || !host || host.trim() === '') {
      return;
    }

    try {
      /* eslint-disable @typescript-eslint/naming-convention */
      posthog.init(key, {
        api_host: host,
        defaults: '2025-05-24',
        // --- Full user journey capture ---
        // Automatically capture every click (all buttons), change and submit event.
        autocapture: true,
        // Track navigation so the journey is stitched across pages/routes.
        capture_pageview: true,
        capture_pageleave: true,
        // Enable click + scroll heatmaps in the PostHog dashboard.
        enable_heatmaps: true,
        // Detect rage clicks / dead clicks for friction analysis.
        rageclick: true,
        // Persist identity across reloads.
        persistence: 'localStorage+cookie',
        // Record the full session so the journey can be replayed.
        disable_session_recording: false,
        session_recording: {
          // Chat/email/ticket bodies are sensitive — mask ALL text and inputs by
          // default. Opt specific safe elements back in with `.ph-no-mask`.
          maskAllInputs: true,
          maskTextSelector: '*',
        },
      });
      /* eslint-enable @typescript-eslint/naming-convention */
      this.isInitialized = true;
    } catch {
      this.isInitialized = false;
    }
  }

  /**
   * Set platform for tracking. Registered as a super property so it is attached
   * to every autocaptured and custom event.
   */
  setPlatform(platform: string): void {
    this.currentPlatform = platform;
    if (!this.isInitialized) {
      return;
    }
    try {
      posthog.register({ platform });
    } catch {
      // Silently fail
    }
  }

  /**
   * Enrich custom event properties with user context.
   */
  private getEnrichedProperties(properties?: EventProperties): EventProperties {
    const enrichedProps: EventProperties = {
      ...properties,
      timestamp: Date.now(),
    };
    if (this.currentUserId) {
      enrichedProps['userId'] = this.currentUserId;
    }
    if (this.currentPlatform) {
      enrichedProps['platform'] = this.currentPlatform;
    }
    return enrichedProps;
  }

  private isValidEventName(eventName: string): boolean {
    return typeof eventName === 'string' && eventName.trim().length > 0;
  }

  /**
   * Capture a custom event. Autocaptured clicks are handled automatically by
   * PostHog; use this for named domain events.
   */
  capture(eventName: string, properties?: EventProperties): void {
    if (!this.isInitialized || !this.isValidEventName(eventName)) {
      return;
    }
    try {
      posthog.capture(eventName, this.getEnrichedProperties(properties || {}));
    } catch {
      // Silently fail
    }
  }

  /**
   * Capture the outcome of an action. Emits `<trackId>_<status>` (e.g.
   * `save_call_summary_prompt_success` / `_failure`) so a mutation's pass/fail is
   * recorded — a signal autocapture cannot produce, since it only sees the click,
   * not the async result. Clicks themselves are covered by autocapture, so this
   * intentionally has no `click` status.
   */
  captureActionOutcome(
    trackId: string,
    status: 'success' | 'failure',
    properties?: EventProperties,
  ): void {
    if (!trackId || trackId.trim() === '') {
      return;
    }
    this.capture(`${trackId}_${status}`, { trackId, status, ...properties });
  }

  /**
   * Identify a user. All properties except id/picture become person properties.
   */
  identify(user: PosthogUser): void {
    if (!this.isInitialized || !user?.id) {
      return;
    }
    try {
      const personProperties: Record<string, string> = {};
      Object.keys(user).forEach(key => {
        const value = user[key];
        if (value !== undefined && key !== 'picture' && key !== 'id') {
          personProperties[key] = value;
        }
      });
      posthog.identify(user.id, personProperties);
      this.currentUserId = user.id;
    } catch {
      // Silently fail
    }
  }

  /**
   * Reset identity (call on logout).
   */
  reset(): void {
    this.currentUserId = null;
    if (!this.isInitialized) {
      return;
    }
    try {
      posthog.reset();
    } catch {
      // Silently fail
    }
  }

  /**
   * Check if a feature flag is enabled.
   */
  isFeatureEnabled(flag: string): boolean {
    if (!this.isInitialized) {
      return false;
    }
    try {
      return posthog.isFeatureEnabled(flag) ?? false;
    } catch {
      return false;
    }
  }
}

// Export a singleton instance
export const posthogService = new PostHogService();

// Export types
export type { PosthogUser, EventProperties };

// Re-export event constants (optional to use)
export { EVENTS, EVENT_PROPERTIES } from './events';
