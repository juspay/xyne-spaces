import { websocketService } from './clients/socketClient';
import { stateMachineActor } from '../machines/stateMachine';
import type { CountData, DurationData } from './metricsService';

// Track WebSocket subscription state
let isSubscribed = false;

// WebSocket handler references for cleanup
const handlers = {
  todayMessage: (data: CountData): void => {
    stateMachineActor.send({
      type: 'UPDATE_METRIC',
      period: 'today',
      metric: 'messages',
      value: data.count,
    });
  },
  allTimeMessage: (data: CountData): void => {
    stateMachineActor.send({
      type: 'UPDATE_METRIC',
      period: 'allTime',
      metric: 'messages',
      value: data.count,
    });
  },
  todayUser: (data: CountData): void => {
    stateMachineActor.send({
      type: 'UPDATE_METRIC',
      period: 'today',
      metric: 'users',
      value: data.count,
    });
  },
  allTimeUser: (data: CountData): void => {
    stateMachineActor.send({
      type: 'UPDATE_METRIC',
      period: 'allTime',
      metric: 'users',
      value: data.count,
    });
  },
  todayCall: (data: CountData): void => {
    stateMachineActor.send({
      type: 'UPDATE_METRIC',
      period: 'today',
      metric: 'calls',
      value: data.count,
    });
  },
  allTimeCall: (data: CountData): void => {
    stateMachineActor.send({
      type: 'UPDATE_METRIC',
      period: 'allTime',
      metric: 'calls',
      value: data.count,
    });
  },
  todayDuration: (data: DurationData): void => {
    stateMachineActor.send({
      type: 'UPDATE_METRIC',
      period: 'today',
      metric: 'callsDuration',
      value: data.duration,
    });
  },
  allTimeDuration: (data: DurationData): void => {
    stateMachineActor.send({
      type: 'UPDATE_METRIC',
      period: 'allTime',
      metric: 'callsDuration',
      value: data.duration,
    });
  },
};

/**
 * Subscribe to metrics WebSocket events for real-time updates.
 * This should be called after the initial API fetch.
 */
export const subscribeToMetricsUpdates = async (): Promise<void> => {
  if (isSubscribed) {
    return;
  }

  try {
    if (!websocketService.isConnectedToServer()) {
      await websocketService.connect();
    }

    websocketService.on('today_message_count_updated', handlers.todayMessage);
    websocketService.on('all_time_message_count_updated', handlers.allTimeMessage);
    websocketService.on('today_user_count_updated', handlers.todayUser);
    websocketService.on('all_time_user_count_updated', handlers.allTimeUser);
    websocketService.on('today_call_count_updated', handlers.todayCall);
    websocketService.on('all_time_call_count_updated', handlers.allTimeCall);
    websocketService.on('today_call_duration_updated', handlers.todayDuration);
    websocketService.on('all_time_call_duration_updated', handlers.allTimeDuration);

    isSubscribed = true;
  } catch {
    // WebSocket connection failed, metrics will use API values only
  }
};

/**
 * Unsubscribe from metrics WebSocket events.
 * Call this when the user logs out.
 */
export const unsubscribeFromMetricsUpdates = (): void => {
  websocketService.removeListener('today_message_count_updated', handlers.todayMessage);
  websocketService.removeListener('all_time_message_count_updated', handlers.allTimeMessage);
  websocketService.removeListener('today_user_count_updated', handlers.todayUser);
  websocketService.removeListener('all_time_user_count_updated', handlers.allTimeUser);
  websocketService.removeListener('today_call_count_updated', handlers.todayCall);
  websocketService.removeListener('all_time_call_count_updated', handlers.allTimeCall);
  websocketService.removeListener('today_call_duration_updated', handlers.todayDuration);
  websocketService.removeListener('all_time_call_duration_updated', handlers.allTimeDuration);

  isSubscribed = false;
};

/**
 * Check if currently subscribed to metrics WebSocket events
 */
export const isMetricsSubscribed = (): boolean => isSubscribed;
