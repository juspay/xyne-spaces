export type MetricAttributeValue = string | number | boolean;

export type MetricAttributePolicyValue = readonly MetricAttributeValue[] | 'dynamic-string';

export type MetricAttributePolicy = Readonly<Record<string, MetricAttributePolicyValue>>;

export type MetricUnit = '1' | 'ms' | 's' | 'By';

type BaseMetricDefinition = Readonly<{
  name: string;
  description: string;
  unit: MetricUnit;
  attributes: MetricAttributePolicy;
}>;

export type MetricDefinition =
  | (BaseMetricDefinition & Readonly<{ kind: 'counter' }>)
  | (BaseMetricDefinition & Readonly<{ kind: 'upDownCounter' }>)
  | (BaseMetricDefinition & Readonly<{ kind: 'histogram'; boundaries: readonly number[] }>);

/** Same bucket set as web dashboard `zero_query_latency` / mutation / run histograms. */
export const ZERO_LATENCY_BOUNDARIES_MS = [
  10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600,
] as const;

export type ZeroOperationStage = 'start' | 'success' | 'error';

export const APP_METRICS = {
  appSessionHeartbeat: {
    kind: 'counter',
    name: 'app_session_heartbeat',
    description: 'Periodic pulse emitted while an app session is in the foreground',
    unit: '1',
    attributes: {
      session_id: 'dynamic-string',
    },
  },
  appStartupDuration: {
    kind: 'histogram',
    name: 'app_startup_duration',
    description: 'Time from native application launch until the destination is ready',
    unit: 'ms',
    boundaries: [100, 250, 500, 1000, 2000, 3000, 5000, 7500, 10000, 20000, 30000, 60000],
    attributes: {
      launch_cause: ['direct', 'notification', 'call', 'deeplink', 'share'],
      destination: ['dms', 'login', 'enrollment'],
      native_anchor: ['app', 'activity'],
    },
  },

  notificationMessageHighlightDuration: {
    kind: 'histogram',
    name: 'notification_message_highlight_duration',
    description: 'Time from notification open until the target message is highlighted',
    unit: 'ms',
    boundaries: [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000],
    attributes: {
      app_state: ['cold', 'warm'],
      surface: ['channel', 'thread'],
      native_anchor: ['app', 'activity'],
    },
  },

  notificationHeaderResolveDuration: {
    kind: 'histogram',
    name: 'notification_header_resolve_duration',
    description: 'Time from notification open until the chat header title is resolved',
    unit: 'ms',
    boundaries: [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000],
    attributes: {
      surface: ['channel', 'thread'],
      native_anchor: ['app', 'activity'],
    },
  },

  chatOpenSkeletonDuration: {
    kind: 'histogram',
    name: 'chat_open_skeleton_duration',
    description: 'Time the chat or thread open skeleton stays visible until the list is revealed',
    unit: 'ms',
    boundaries: [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000, 10000, 20000],
    attributes: {
      surface: ['channel', 'thread'],
      entry: ['direct', 'notification'],
    },
  },

  activityMessageHighlightDuration: {
    kind: 'histogram',
    name: 'activity_message_highlight_duration',
    description: 'Time from an Activity row tap until the target message is highlighted',
    unit: 'ms',
    boundaries: [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000],
    attributes: {
      surface: ['channel', 'thread'],
    },
  },

  notificationPayloadReceived: {
    kind: 'counter',
    name: 'notification_payload_received',
    description: 'Payloads that reached the notification pipeline',
    unit: '1',
    attributes: {
      delivery_context: ['foreground', 'background'],
      category: ['chat', 'sos', 'reminder', 'control', 'call', 'prefetch', 'ticket', 'unknown'],
    },
  },

  notificationDisplayed: {
    kind: 'counter',
    name: 'notification_displayed',
    description: 'Payloads that resulted in a visible banner (app-drawn or OS-owned)',
    unit: '1',
    attributes: {
      delivery_context: ['foreground', 'background'],
      category: ['chat', 'sos', 'reminder', 'ticket'],
      presentation_owner: ['app', 'operating_system'],
    },
  },

  notificationDisplaySkipped: {
    kind: 'counter',
    name: 'notification_display_skipped',
    description: 'Payloads received and intentionally not presented as a banner',
    unit: '1',
    attributes: {
      delivery_context: ['foreground', 'background'],
      category: ['chat', 'sos', 'reminder', 'control', 'call', 'prefetch', 'ticket', 'unknown'],
      reason: [
        'silent_control_signal',
        'prefetch_only',
        'conversation_already_visible',
        'native_call_pipeline',
        'os_presented_ticket',
        'notifications_paused',
        'unsupported_or_invalid_payload',
      ],
    },
  },

  notificationDisplayFailed: {
    kind: 'counter',
    name: 'notification_display_failed',
    description: 'Payloads we intended to present but failed to display',
    unit: '1',
    attributes: {
      delivery_context: ['foreground', 'background'],
      category: ['chat', 'sos', 'reminder', 'ticket'],
    },
  },

  notificationHandlerFailed: {
    kind: 'counter',
    name: 'notification_handler_failed',
    description: 'Background/foreground handler threw before the delivery funnel closed',
    unit: '1',
    attributes: {
      delivery_context: ['foreground', 'background'],
      category: ['chat', 'sos', 'reminder', 'control', 'call', 'prefetch', 'ticket', 'unknown'],
    },
  },

  zeroQueryLatency: {
    kind: 'histogram',
    name: 'zero_query_latency',
    description: 'Latency of Zero query subscriptions until first complete, in milliseconds',
    unit: 'ms',
    boundaries: ZERO_LATENCY_BOUNDARIES_MS,
    attributes: {
      query: 'dynamic-string',
    },
  },
  zeroQueryOperations: {
    kind: 'counter',
    name: 'zero_query_operations',
    description: 'Zero query operations by stage (start, success, error)',
    unit: '1',
    attributes: {
      query: 'dynamic-string',
      stage: ['start', 'success', 'error'],
    },
  },
  zeroMutationLatency: {
    kind: 'histogram',
    name: 'zero_mutation_latency',
    description: 'Latency of Zero mutations until client and server settle, in milliseconds',
    unit: 'ms',
    boundaries: ZERO_LATENCY_BOUNDARIES_MS,
    attributes: {
      mutation: 'dynamic-string',
    },
  },
  zeroMutationOperations: {
    kind: 'counter',
    name: 'zero_mutation_operations',
    description: 'Zero mutation operations by stage (start, success, error)',
    unit: '1',
    attributes: {
      mutation: 'dynamic-string',
      stage: ['start', 'success', 'error'],
    },
  },
  zeroRunLatency: {
    kind: 'histogram',
    name: 'zero_run_latency',
    description: 'Latency of one-shot Zero run() fetches in milliseconds',
    unit: 'ms',
    boundaries: ZERO_LATENCY_BOUNDARIES_MS,
    attributes: {
      query: 'dynamic-string',
    },
  },
  zeroRunOperations: {
    kind: 'counter',
    name: 'zero_run_operations',
    description: 'Zero run operations by stage (start, success, error)',
    unit: '1',
    attributes: {
      query: 'dynamic-string',
      stage: ['start', 'success', 'error'],
    },
  },
} as const satisfies Readonly<Record<string, MetricDefinition>>;

export type AppMetricKey = keyof typeof APP_METRICS;
