/**
 * Health monitoring types and interfaces for MCP framework
 */

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded' | 'unknown';
  timestamp: Date;
  details?: string;
  metadata?: Record<string, unknown>;
}

export interface ServerHealthMetrics {
  serverId: string;
  connectionStatus: HealthStatus;
  responseTime: {
    current: number;
    average: number;
    percentile95: number;
  };
  operationCounts: {
    successful: number;
    failed: number;
    total: number;
  };
  lastActivity: Date;
  uptime: number; // in milliseconds
  errors: ErrorSummary[];
}

export interface ErrorSummary {
  type: string;
  count: number;
  lastOccurrence: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SystemHealthReport {
  overall: HealthStatus;
  servers: Record<string, ServerHealthMetrics>;
  summary: {
    totalServers: number;
    healthyServers: number;
    unhealthyServers: number;
    degradedServers: number;
  };
  generatedAt: Date;
}

export interface HealthMonitorConfig {
  healthCheckInterval: number; // in milliseconds
  responseTimeThreshold: number; // in milliseconds
  errorRateThreshold: number; // percentage
  enableDetailedMetrics: boolean;
  alerting: {
    enabled: boolean;
    webhookUrl?: string;
    emailRecipients?: string[];
    slackChannel?: string;
  };
  retention: {
    metricsRetentionDays: number;
    detailedLogsRetentionDays: number;
  };
}

export interface ErrorReportConfig {
  categorization: {
    enabled: boolean;
    customCategories?: Record<string, string[]>;
  };
  reporting: {
    batchSize: number;
    reportingInterval: number; // in milliseconds
    includeStackTrace: boolean;
  };
  filtering: {
    excludePatterns?: string[];
    severityFilter?: ErrorSummary['severity'][];
  };
}

export interface ReconnectionConfig {
  enabled: boolean;
  maxRetryAttempts: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  baseDelay: number; // in milliseconds
  maxDelay: number; // in milliseconds
  jitter: boolean;
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeout: number; // in milliseconds
    halfOpenMaxCalls: number;
  };
}

export interface HealthCheckResult {
  serverId: string;
  status: HealthStatus;
  metrics: {
    responseTime: number;
    memoryUsage?: number;
    cpuUsage?: number;
    connectionCount?: number;
  };
  errors?: Error[];
}

export interface MonitoringEvent {
  type: 'health_check' | 'error_report' | 'reconnection_attempt' | 'status_change';
  serverId: string;
  timestamp: Date;
  data: unknown;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface CircuitBreakerState {
  serverId: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime: Date | null;
  nextRetryTime: Date | null;
}

export interface DashboardConfig {
  refreshInterval: number; // in milliseconds
  theme: 'light' | 'dark' | 'auto';
  layout: {
    showMetrics: boolean;
    showErrors: boolean;
    showReconnections: boolean;
    compactMode: boolean;
  };
  alerts: {
    showNotifications: boolean;
    soundEnabled: boolean;
    autoHide: boolean;
    autoHideDelay: number; // in milliseconds
  };
}

export type HealthEventHandler = (event: MonitoringEvent) => void;
export type ErrorReportHandler = (error: Error, context: Record<string, unknown>) => void;
export type ReconnectionHandler = (serverId: string, attempt: number, success: boolean) => void;

export interface HealthMonitorOptions {
  healthConfig?: Partial<HealthMonitorConfig>;
  errorConfig?: Partial<ErrorReportConfig>;
  reconnectionConfig?: Partial<ReconnectionConfig>;
  dashboardConfig?: Partial<DashboardConfig>;
  eventHandlers?: {
    onHealthChange?: HealthEventHandler;
    onError?: ErrorReportHandler;
    onReconnection?: ReconnectionHandler;
  };
}