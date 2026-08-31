import { logger, Event as LogEvent } from '../../utils/logger';
import { Platform, TriggerType, ActivityEventPayload } from '@xyne/shared';
import { websocketService } from '../clients/socketClient';
import { authActor } from '../../machines/authMachine';
import { isElectronApp } from '../../utils/electronApp';
import { v4 as uuidv4 } from 'uuid';
import { reactNativeBridge } from '../../utils/reactNativeBridge';

export const WS_ACTIVITY_EVENT = 'user_activity_event';

interface ParsedTrackingData {
  eventCategory: string;
  eventName: string;
  eventLabel?: string;
  contextMetadata?: Record<string, unknown>;
}

class GlobalClickTracker {
  private isInitialized = false;
  private sessionId: string;
  private platform: Platform;
  private lastViewedUrl: string | null = null;
  private originalPushState: History['pushState'] | null = null;
  private originalReplaceState: History['replaceState'] | null = null;
  private authSubscription: { unsubscribe: () => void } | null = null;
  // Events captured before the websocket handshake completes (the landing
  // PAGE_VIEW always is — auth resolves before connect() finishes) are held
  // here and drained on connect instead of being dropped.
  private pendingEvents: ActivityEventPayload[] = [];
  private static readonly MAX_PENDING_EVENTS = 50;
  private unsubscribeConnect: (() => void) | null = null;

  constructor() {
    this.sessionId = uuidv4();
    this.platform = this.detectPlatform();
  }

  private detectPlatform(): Platform {
    if (isElectronApp()) {
      return Platform.ELECTRON;
    } else if (reactNativeBridge.isAvailable()) {
      return Platform.MOBILE;
    }
    return Platform.WEB;
  }

  private getCurrentUserId(): string | null {
    const snapshot = authActor.getSnapshot();
    return snapshot.context.user?.id ?? null;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('GlobalClickTracker is already initialized'),
      });
      return;
    }

    this.setupClickListener();
    this.setupChangeListener();
    this.setupBlurListener();
    this.setupPageViewListener();
    this.unsubscribeConnect = websocketService.onConnect(this.flushPendingEvents);
    this.isInitialized = true;
  }

  destroy(): void {
    if (!this.isInitialized) {
      return;
    }

    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('blur', this.handleBlur, true);
    window.removeEventListener('popstate', this.handlePageView);
    window.removeEventListener('hashchange', this.handlePageView);
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
    this.unsubscribeConnect?.();
    this.unsubscribeConnect = null;
    this.pendingEvents = [];
    this.isInitialized = false;
  }

  private setupClickListener(): void {
    document.addEventListener('click', this.handleClick, true);
  }

  private setupChangeListener(): void {
    document.addEventListener('change', this.handleChange, true);
  }

  private setupBlurListener(): void {
    document.addEventListener('blur', this.handleBlur, true);
  }

  // Route changes in the SPA never reload the document, so page views are
  // captured by intercepting the history API rather than any router hook.
  private setupPageViewListener(): void {
    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args: Parameters<History['pushState']>) => {
      this.originalPushState?.(...args);
      this.handlePageView();
    };
    history.replaceState = (...args: Parameters<History['replaceState']>) => {
      this.originalReplaceState?.(...args);
      this.handlePageView();
    };
    window.addEventListener('popstate', this.handlePageView);
    window.addEventListener('hashchange', this.handlePageView);

    // The landing view: trackEvent drops events with no user id, so if auth
    // has not resolved yet, hold the first emission until it does.
    if (this.getCurrentUserId()) {
      this.handlePageView();
    } else {
      this.authSubscription = authActor.subscribe(snapshot => {
        if (snapshot.context.user?.id) {
          this.authSubscription?.unsubscribe();
          this.authSubscription = null;
          this.handlePageView();
        }
      });
    }
  }

  private handlePageView = (): void => {
    const url = window.location.pathname + window.location.hash;
    if (url === this.lastViewedUrl) {
      return;
    }
    const previousUrl = this.lastViewedUrl;
    this.lastViewedUrl = url;

    const data: ParsedTrackingData = {
      eventCategory: 'NAVIGATION',
      eventName: 'PAGE_VIEW',
    };
    if (previousUrl !== null) {
      data.contextMetadata = { from: previousUrl };
    }
    this.trackEvent(data, TriggerType.PAGE_VIEW);
  };

  private handleClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (!target) return;

    const tag = target.tagName?.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;

    const trackedElement = this.findTrackedElement(target);
    if (!trackedElement) return;

    const trackingData = this.parseTrackingData(trackedElement);
    if (!trackingData) return;

    this.trackEvent(trackingData, TriggerType.CLICK);
  };

  private handleChange = (event: Event): void => {
    const target = event.target as HTMLElement;
    if (!target) return;

    if (target instanceof HTMLInputElement) {
      const inputType = target.type;
      if (!['checkbox', 'radio'].includes(inputType)) {
        return;
      }
    } else if (target instanceof HTMLTextAreaElement) {
      return;
    } else if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const trackedElement = this.findTrackedElement(target);
    if (!trackedElement) return;

    const trackingData = this.parseTrackingData(trackedElement);
    if (!trackingData) return;

    const valueMetadata = this.extractChangeValue(target);
    this.trackEvent(trackingData, TriggerType.CHANGE, valueMetadata);
  };

  private handleBlur = (event: FocusEvent): void => {
    const target = event.target as HTMLElement;
    if (!target) return;

    // Passwords are excluded entirely — not even their length is recorded.
    const isTextInput =
      (target instanceof HTMLInputElement &&
        ['text', 'search', 'url', 'number', 'email', 'tel'].includes(target.type)) ||
      target instanceof HTMLTextAreaElement;

    if (!isTextInput) return;

    const trackedElement = this.findTrackedElement(target);
    if (!trackedElement) return;

    const trackingData = this.parseTrackingData(trackedElement);
    if (!trackingData) return;

    // Never record the typed content — only that the field was filled.
    const el = target;
    this.trackEvent(trackingData, TriggerType.BLUR, {
      input_length: el.value.length,
      filled: el.value.length > 0,
    });
  };

  private findTrackedElement(element: HTMLElement): HTMLElement | null {
    if (element.hasAttribute('data-track-category')) {
      return element;
    }

    let current: HTMLElement | null = element;
    for (let i = 0; i < 6 && current; i++) {
      if (current.hasAttribute('data-track-category')) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  private getElementText(element: HTMLElement): string {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const innerText = element.innerText?.trim();
    if (innerText && innerText.length < 100) return innerText;

    const textContent = element.textContent?.trim();
    if (textContent && textContent.length < 100) return textContent;

    const title = element.getAttribute('title');
    if (title) return title;

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const placeholder = element.placeholder;
      if (placeholder) return placeholder;
    }

    return 'NO_LABEL_FOUND';
  }

  private extractChangeValue(element: HTMLElement): Record<string, unknown> {
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox') {
        return { checked: element.checked };
      }
      if (element.type === 'radio') {
        return { value: element.value };
      }
    }

    if (element instanceof HTMLSelectElement) {
      return {
        value: element.value,
        selectedLabel: element.options[element.selectedIndex]?.text ?? null,
      };
    }

    return {};
  }

  private parseTrackingData(element: HTMLElement): ParsedTrackingData | null {
    const eventCategory = element.getAttribute('data-track-category');
    const eventName = element.getAttribute('data-track-name');

    if (!eventCategory || !eventName) {
      return null;
    }

    const explicitLabel = element.getAttribute('data-track-label');
    const autoLabel = this.getElementText(element);
    const eventLabel = explicitLabel || (autoLabel ? autoLabel : undefined);

    let contextMetadata: Record<string, unknown> | undefined;
    const metadataAttr = element.getAttribute('data-track-metadata');
    if (metadataAttr) {
      try {
        contextMetadata = JSON.parse(metadataAttr) as Record<string, unknown>;
      } catch (error) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[ActivityTracking] Invalid metadata JSON:'),
          context: [error],
        });
      }
    }

    const result: ParsedTrackingData = {
      eventCategory,
      eventName,
    };

    if (eventLabel !== undefined) {
      result.eventLabel = eventLabel;
    }
    if (contextMetadata !== undefined) {
      result.contextMetadata = contextMetadata;
    }

    return result;
  }

  private flushPendingEvents = (): void => {
    if (this.pendingEvents.length === 0) return;
    // Original capture timestamps are preserved on the queued payloads.
    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    for (const event of events) {
      if (websocketService.isConnectedToServer()) {
        websocketService.emit(WS_ACTIVITY_EVENT, event);
      } else {
        this.pendingEvents.push(event);
      }
    }
  };

  // For surfaces the DOM listener cannot reach (portalled toasts, native
  // notification actions, third-party modals that drop data-* attributes).
  trackManualEvent(
    eventCategory: string,
    eventName: string,
    eventLabel?: string,
    contextMetadata?: Record<string, unknown>,
  ): void {
    const data: ParsedTrackingData = { eventCategory, eventName };
    if (eventLabel !== undefined) {
      data.eventLabel = eventLabel;
    }
    if (contextMetadata !== undefined) {
      data.contextMetadata = contextMetadata;
    }
    this.trackEvent(data, TriggerType.CLICK);
  }

  private trackEvent(
    data: ParsedTrackingData,
    triggerType: TriggerType = TriggerType.CLICK,
    extraMetadata?: Record<string, unknown>,
  ): void {
    const userId = this.getCurrentUserId();

    if (!userId) {
      return;
    }

    try {
      const event: ActivityEventPayload = {
        user_id: userId,
        session_id: this.sessionId,
        event_category: data.eventCategory,
        event_name: data.eventName,
        url: window.location.pathname + window.location.hash,
        trigger_type: triggerType,
        platform: this.platform,
        timestamp: Date.now(),
      };

      if (data.eventLabel !== undefined) {
        event.event_label = data.eventLabel;
      }

      if (data.contextMetadata || extraMetadata) {
        event.context_metadata = {
          ...data.contextMetadata,
          ...extraMetadata,
        };
      }

      if (websocketService.isConnectedToServer()) {
        websocketService.emit(WS_ACTIVITY_EVENT, event);
      } else {
        // Queue instead of dropping; drained by flushPendingEvents on connect.
        if (this.pendingEvents.length >= GlobalClickTracker.MAX_PENDING_EVENTS) {
          this.pendingEvents.shift();
        }
        this.pendingEvents.push(event);
      }
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[ActivityTracking] Failed to track event:'),
        error: error,
      });
    }
  }
}

export const globalClickTracker = new GlobalClickTracker();
