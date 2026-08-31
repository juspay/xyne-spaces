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
    this.isInitialized = true;
  }

  destroy(): void {
    if (!this.isInitialized) {
      return;
    }

    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('blur', this.handleBlur, true);
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
