import type {
  AppLifecycle,
  AppLifecycleState,
  AppLifecycleSubscription,
} from '../logging/lifecycle/AppLifecycle';
import type { MetricsRecorder } from './MetricsRecorder';

export const APP_HEARTBEAT_INTERVAL_MS = 30_000;

export interface ScheduledHeartbeat {
  cancel(): void;
}

export interface HeartbeatScheduler {
  scheduleRepeating(callback: () => void, intervalMs: number): ScheduledHeartbeat;
}

class SystemHeartbeatScheduler implements HeartbeatScheduler {
  scheduleRepeating(callback: () => void, intervalMs: number): ScheduledHeartbeat {
    const handle = setInterval(callback, intervalMs);

    return {
      cancel: (): void => {
        clearInterval(handle);
      },
    };
  }
}

type HeartbeatRecorder = Pick<MetricsRecorder, 'incrementCounter'>;

export type AppHeartbeatControllerOptions = Readonly<{
  recorder: HeartbeatRecorder;
  appLifecycle: AppLifecycle;
  sessionId: string;
  intervalMs?: number;
  scheduler?: HeartbeatScheduler;
  onError?: (error: unknown) => void;
}>;

export class AppHeartbeatController {
  private readonly recorder: HeartbeatRecorder;
  private readonly appLifecycle: AppLifecycle;
  private readonly sessionId: string;
  private readonly intervalMs: number;
  private readonly scheduler: HeartbeatScheduler;
  private readonly onError: (error: unknown) => void;

  private subscription: AppLifecycleSubscription | null = null;
  private scheduledHeartbeat: ScheduledHeartbeat | null = null;
  private currentState: AppLifecycleState | null = null;

  constructor(options: AppHeartbeatControllerOptions) {
    this.recorder = options.recorder;
    this.appLifecycle = options.appLifecycle;
    this.sessionId = options.sessionId;
    this.intervalMs = Math.max(1, Math.floor(options.intervalMs ?? APP_HEARTBEAT_INTERVAL_MS));
    this.scheduler = options.scheduler ?? new SystemHeartbeatScheduler();
    this.onError = options.onError ?? ((): void => undefined);
  }

  start(): void {
    if (this.subscription !== null) {
      return;
    }

    this.currentState = this.appLifecycle.currentState;
    this.subscription = this.appLifecycle.subscribe(nextState => {
      this.handleStateChange(nextState);
    });

    if (this.currentState === 'foreground') {
      this.startHeartbeat();
    }
  }

  stop(): void {
    const subscription = this.subscription;

    if (subscription === null) {
      return;
    }

    subscription.remove();
    this.subscription = null;
    this.currentState = null;
    this.stopHeartbeat();
  }

  private handleStateChange(nextState: AppLifecycleState): void {
    if (nextState === this.currentState) {
      return;
    }

    this.currentState = nextState;

    if (nextState === 'foreground') {
      this.startHeartbeat();
      return;
    }

    this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.scheduledHeartbeat !== null) {
      return;
    }

    this.recordHeartbeat();
    this.scheduledHeartbeat = this.scheduler.scheduleRepeating(() => {
      this.recordHeartbeat();
    }, this.intervalMs);
  }

  private stopHeartbeat(): void {
    this.scheduledHeartbeat?.cancel();
    this.scheduledHeartbeat = null;
  }

  private recordHeartbeat(): void {
    try {
      this.recorder.incrementCounter('appSessionHeartbeat', {
        session_id: this.sessionId,
      });
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Heartbeat diagnostics must never crash product code.
    }
  }
}
