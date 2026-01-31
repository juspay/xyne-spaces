import { apiInstance } from './clients/apiClient';
import { stateMachineActor, initialMetricsState } from '../machines/stateMachine';
import {
  subscribeToMetricsUpdates,
  unsubscribeFromMetricsUpdates,
} from './metricsWebSocketService';

// Shared types for metrics
export interface CountData {
  count: number;
  date?: string;
  timestamp?: string;
}

export interface DurationData {
  duration: number;
  date?: string;
  timestamp?: string;
}

interface MetricsBarApiResponse {
  success: boolean;
  data: {
    messages: { today: CountData; allTime: CountData };
    users: { today: CountData; allTime: CountData };
    calls: { today: CountData; allTime: CountData };
    callsDuration: { today: DurationData; allTime: DurationData };
  };
  error?: string;
  timestamp: string;
}

// Track initialization state
let isInitialized = false;
let isInitializing = false;

/**
 * Initialize metrics by fetching from API and setting up WebSocket listeners.
 * This should be called once at app startup (e.g., in AppRoot).
 * Subsequent calls will be no-ops if already initialized.
 */
export const initializeMetrics = async (): Promise<void> => {
  // Prevent duplicate initialization
  if (isInitialized || isInitializing) {
    return;
  }

  isInitializing = true;
  stateMachineActor.send({ type: 'SET_METRICS_LOADING', loading: true });

  try {
    // Fetch initial metrics data
    const response = await apiInstance.get<MetricsBarApiResponse>('/analytics/metrics-bar');

    if (response.data.success) {
      const { messages, users, calls, callsDuration } = response.data.data;
      stateMachineActor.send({
        type: 'SET_METRICS',
        metrics: {
          today: {
            messages: messages.today.count,
            users: users.today.count,
            calls: calls.today.count,
            callsDuration: callsDuration.today.duration,
          },
          allTime: {
            messages: messages.allTime.count,
            users: users.allTime.count,
            calls: calls.allTime.count,
            callsDuration: callsDuration.allTime.duration,
          },
        },
      });
    }

    // Set up WebSocket listeners for real-time updates
    await subscribeToMetricsUpdates();

    isInitialized = true;
  } catch (err) {
    stateMachineActor.send({
      type: 'SET_METRICS_ERROR',
      error: err instanceof Error ? err.message : 'Failed to fetch metrics',
    });
  } finally {
    isInitializing = false;
  }
};

/**
 * Cleanup metrics state and WebSocket listeners.
 * Call this when the app unmounts or user logs out.
 */
export const cleanupMetrics = (): void => {
  // Unsubscribe from WebSocket events
  unsubscribeFromMetricsUpdates();

  // Reset XState metrics to initial state
  stateMachineActor.send({
    type: 'SET_METRICS',
    metrics: {
      today: initialMetricsState.today,
      allTime: initialMetricsState.allTime,
    },
  });

  isInitialized = false;
  isInitializing = false;
};

/**
 * Check if metrics have been initialized
 */
export const isMetricsInitialized = (): boolean => isInitialized;
