import { logger, Event as LogEvent } from '../../utils/logger';
import axios from 'axios';
import { API_BASE_URL } from '../../config';

type JSONSerializable =
  | string
  | number
  | boolean
  | null
  | JSONSerializable[]
  | { [key: string]: JSONSerializable };
type EventProperties = Record<string, JSONSerializable>;

interface QueuedEvent {
  eventName: string;
  properties?: EventProperties;
  timestamp: number;
}

interface FlushResponse {
  success: boolean;
  data: {
    processed: number;
    failed: number;
    total: number;
  };
}

class SudoQueryService {
  private eventQueue: QueuedEvent[] = [];
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly FLUSH_INTERVAL = 10000; // 10 seconds
  private readonly API_ENDPOINT = `${API_BASE_URL}/search-metrics/metrics`;

  constructor() {
    // Start the flush interval
    this.startFlushInterval();

    // Handle page unload to flush remaining events
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    }
  }

  private startFlushInterval(): void {
    if (this.flushIntervalId) {
      return;
    }

    this.flushIntervalId = setInterval(() => {
      void this.flushEvents();
    }, this.FLUSH_INTERVAL);

    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('[SudoQuery] Flush interval started (10s)'),
    });
  }

  private stopFlushInterval(): void {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }
  }

  private async flushEvents(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    // Take a snapshot of current events and clear queue
    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('[SudoQuery] Flushing'),
      context: [eventsToSend.length, 'events to backend'],
    });

    try {
      const response = await axios.post<FlushResponse>(
        this.API_ENDPOINT,
        { events: eventsToSend },
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (response.data.success) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[SudoQuery] Events flushed successfully:'),
          context: [response.data.data],
        });
      } else {
        // If request fails, put events back in queue (but limit size to prevent memory leak)
        this.eventQueue = [...eventsToSend, ...this.eventQueue].slice(0, 1000);
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[SudoQuery] Failed to flush events'),
        });
      }
    } catch (error) {
      // If request fails, put events back in queue (but limit size to prevent memory leak)
      this.eventQueue = [...eventsToSend, ...this.eventQueue].slice(0, 1000);
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[SudoQuery] Network error flushing events:'),
        error: error,
      });
    }
  }

  private handleBeforeUnload(): void {
    // Attempt to send remaining events synchronously using sendBeacon
    if (this.eventQueue.length > 0 && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const eventsToSend = [...this.eventQueue];
      const blob = new Blob([JSON.stringify({ events: eventsToSend })], {
        type: 'application/json',
      });

      const success = navigator.sendBeacon(this.API_ENDPOINT, blob);
      if (success) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[SudoQuery] Sent'),
          context: [eventsToSend.length, 'events via beacon'],
        });
        this.eventQueue = [];
      }
    }
  }

  /**
   * Queue an event to be sent to the backend (batched every 10 seconds)
   */
  track(eventName: string, properties?: EventProperties): void {
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('[SudoQuery] Track called:'),
      context: [eventName],
    });

    const event: QueuedEvent = {
      eventName,
      properties: properties || {},
      timestamp: Date.now(),
    };

    this.eventQueue.push(event);
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('[SudoQuery] Event queued:'),
      context: [eventName, '(queue size:', this.eventQueue.length, ')'],
    });
  }

  /**
   * Manually flush queued events immediately
   */
  async flush(): Promise<void> {
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('[SudoQuery] Manual flush called'),
    });
    await this.flushEvents();
  }

  /**
   * Clean up on app shutdown
   */
  destroy(): void {
    this.stopFlushInterval();
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    }
  }
}

export const sudoQueryService = new SudoQueryService();

export type { EventProperties };
