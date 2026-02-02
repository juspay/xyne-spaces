import client from 'prom-client';
import { Request, Response } from 'express';
import { logger } from '@/utils/logger';


// Registry
class MetricsRegistry {
  private static instance: client.Registry;

  static getInstance(): client.Registry {
    if (!MetricsRegistry.instance) {
      MetricsRegistry.instance = new client.Registry();
    }
    return MetricsRegistry.instance;
  }
}

const register = MetricsRegistry.getInstance();

// Helpers
function getOrCreateMetric<T>(name: string, createFn: () => T): T {
  const existing = register.getSingleMetric(name);
  if (existing) return existing as T;
  return createFn();
}

// Define Metrics
client.collectDefaultMetrics({
  register,
  prefix: 'xyne_spaces_backend_'
});

const httpRequestDuration = getOrCreateMetric("http_request_duration_ms", () => new client.Histogram({
  name: "http_request_duration_ms",
  help: 'Duration of HTTP requests in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register],
}));

const httpRequestTotal = getOrCreateMetric("http_requests_total", () => new client.Counter({
  name: "http_requests_total",
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
}));


const httpRequestErrors = getOrCreateMetric("http_request_errors_total", () => new client.Counter({
  name: "http_request_errors_total",
  help: 'Total number of HTTP request errors',
  labelNames: ['method', 'route', 'status_code', 'error_type'],
  registers: [register],
}));


const activeConnections = getOrCreateMetric("http_active_connections", () => new client.Gauge({
  name: "http_active_connections",
  help: 'Number of active HTTP connections',
  registers: [register],
}));


const dbQueryDuration = getOrCreateMetric("db_query_duration_ms", () => new client.Histogram({
  name: "db_query_duration_ms",
  help: 'Duration of database queries in milliseconds',
  labelNames: ['query_type', 'table'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
}));

// Counter: Total jobs created
const notificationJobCreated = getOrCreateMetric("notification_job_created_total", () => new client.Counter({
  name: "notification_job_created_total",
  help: 'Total number of notification jobs created',
  labelNames: ['platform', 'message_type'],
  registers: [register],
}));

// Gauge: Jobs waiting in queue
const notificationJobsWaiting = getOrCreateMetric("notification_jobs_waiting", () => new client.Gauge({
  name: "notification_jobs_waiting",
  help: 'Number of notification jobs currently waiting in the queue',
  labelNames: ['platform', 'message_type'],
  registers: [register],
}));

// Counter: Job completion status
const notificationJobStatus = getOrCreateMetric("notification_job_status_total", () => new client.Counter({
  name: "notification_job_status_total",
  help: 'Total number of notification jobs by status',
  labelNames: ['status', 'platform', 'message_type', 'error_type'],
  registers: [register],
}));

// Histogram: Duration of notification processing
const notificationJobDuration = getOrCreateMetric("notification_job_duration_ms", () => new client.Histogram({
  name: "notification_job_duration_ms",
  help: 'Duration of notification processing in milliseconds',
  labelNames: ['platform', 'message_type', 'status'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
}));

// Histogram: Time spent in queue before processing
const notificationJobQueueTime = getOrCreateMetric("notification_job_queue_time_ms", () => new client.Histogram({
  name: "notification_job_queue_time_ms",
  help: 'Time spent in queue before processing in milliseconds',
  labelNames: ['platform', 'message_type'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
}));

// Counter: Expected notification jobs to be created
const notificationJobsExpected = getOrCreateMetric("notification_jobs_expected_total", () => new client.Counter({
  name: "notification_jobs_expected_total",
  help: 'Total number of notification jobs expected to be created',
  labelNames: ['platform', 'message_type'],
  registers: [register],
}));

// ============================================
// Ask AI Metrics
// ============================================

// Counter: Total Ask AI queries
const askAIQueriesTotal = getOrCreateMetric("ask_ai_queries_total", () => new client.Counter({
  name: "ask_ai_queries_total",
  help: 'Total number of Ask AI queries',
  labelNames: ['status'], // success, error
  registers: [register],
}));

// Histogram: Ask AI query duration
const askAIQueryDuration = getOrCreateMetric("ask_ai_query_duration", () => new client.Histogram({
  name: "ask_ai_query_duration",
  help: 'Duration of Ask AI queries in milliseconds',
  labelNames: ['status'],
  buckets: [100, 500, 1000, 2500, 5000, 10000, 25000, 60000],
  registers: [register],
}));

// Histogram: Number of context channels used per query
const askAIContextChannels = getOrCreateMetric("ask_ai_context_channels_count", () => new client.Histogram({
  name: "ask_ai_context_channels_count",
  help: 'Number of channels used as context in Ask AI queries',
  buckets: [0, 1, 2, 3, 4, 5], // Max 5 channels allowed
  registers: [register],
}));

// Counter: Ask AI feedback received
const askAIFeedbackTotal = getOrCreateMetric("ask_ai_feedback_total", () => new client.Counter({
  name: "ask_ai_feedback_total",
  help: 'Total number of Ask AI feedback submissions',
  labelNames: ['value'], // LIKE, DISLIKE
  registers: [register],
}));


// Metrics endpoint
export const metricsEndpoint = async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    logger.error('Error generating metrics:', error);
    res.status(500).end('Error generating metrics');
  }
};

// Counter: Call jobs with status
const callJobs = getOrCreateMetric("call_jobs_total", () => new client.Counter({
  name: "call_jobs_total",
  help: 'Total number of call jobs with status',
  labelNames: ['platform', 'status'],
  registers: [register],
}));

// Export
export { register };

export const metrics = {
  httpRequestDuration,
  httpRequestTotal,
  httpRequestErrors,
  activeConnections,
  dbQueryDuration,
  notificationJobCreated,
  notificationJobsWaiting,
  notificationJobStatus,
  notificationJobDuration,
  notificationJobQueueTime,
  notificationJobsExpected,
  callJobs,
  // Ask AI metrics
  askAIQueriesTotal,
  askAIQueryDuration,
  askAIContextChannels,
  askAIFeedbackTotal,
};
