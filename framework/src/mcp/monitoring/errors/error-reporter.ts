/**
 * Error reporting system - structured error categorization, reporting, and alerting
 */

import { MCPError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';
import type {
  ErrorReportConfig,
  MonitoringEvent,
  ErrorSummary,
  ErrorReportHandler
} from '../types/index.js';

export interface ErrorReport {
  id: string;
  timestamp: Date;
  error: Error;
  category: string;
  severity: ErrorSummary['severity'];
  context: Record<string, unknown>;
  stackTrace?: string;
  serverId?: string;
  operationType?: string;
}

export interface ErrorBatch {
  id: string;
  timestamp: Date;
  reports: ErrorReport[];
  summary: {
    totalErrors: number;
    severityCounts: Record<ErrorSummary['severity'], number>;
    categoryCounts: Record<string, number>;
  };
}

export class ErrorReporter {
  private config: ErrorReportConfig;
  private errorBuffer: ErrorReport[] = [];
  private reportingInterval: NodeJS.Timeout | null = null;
  private errorHandlers: Set<ErrorReportHandler> = new Set();
  private errorCategories: Map<string, string> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private isActive = false;

  constructor(config: Partial<ErrorReportConfig> = {}) {
    this.config = {
      categorization: {
        enabled: true,
        customCategories: {}
      },
      reporting: {
        batchSize: 50,
        reportingInterval: 60000, // 1 minute
        includeStackTrace: true
      },
      filtering: {
        excludePatterns: [],
        severityFilter: []
      },
      ...config
    };

    this.initializeDefaultCategories();
  }

  /**
   * Start error reporting
   */
  public start(): void {
    if (this.isActive) {
      logger.warn('Error reporting is already active');
      return;
    }

    logger.info('Starting error reporting system', {
      batchSize: this.config.reporting.batchSize,
      reportingInterval: this.config.reporting.reportingInterval
    });

    this.isActive = true;
    this.scheduleReporting();
  }

  /**
   * Stop error reporting
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }

    logger.info('Stopping error reporting system');

    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
    }

    // Flush any remaining errors
    if (this.errorBuffer.length > 0) {
      void this.flushErrors();
    }

    this.isActive = false;
  }

  /**
   * Report an error
   */
  public reportError(
    error: Error,
    context: Record<string, unknown> = {},
    serverId?: string,
    operationType?: string
  ): void {
    if (!error || !this.shouldReportError(error)) {
      return;
    }

    const report: ErrorReport = {
      id: this.generateErrorId(),
      timestamp: new Date(),
      error,
      category: this.categorizeError(error),
      severity: this.determineSeverity(error),
      context,
      ...(this.config.reporting.includeStackTrace && error.stack && { stackTrace: error.stack }),
      ...(serverId && { serverId }),
      ...(operationType && { operationType })
    };

    this.errorBuffer.push(report);
    this.updateErrorCounts(report);

    // Notify handlers immediately for critical errors
    if (report.severity === 'critical') {
      this.notifyHandlers(report);
    }

    // Flush buffer if it's full
    if (this.errorBuffer.length >= this.config.reporting.batchSize) {
      void this.flushErrors();
    }

    logger.debug('Error reported', {
      errorId: report.id,
      category: report.category,
      severity: report.severity,
      serverId
    });
  }

  /**
   * Add error handler
   */
  public addErrorHandler(handler: ErrorReportHandler): void {
    this.errorHandlers.add(handler);
  }

  /**
   * Remove error handler
   */
  public removeErrorHandler(handler: ErrorReportHandler): void {
    this.errorHandlers.delete(handler);
  }

  /**
   * Get error statistics
   */
  public getErrorStatistics(): {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    errorsBySeverity: Record<ErrorSummary['severity'], number>;
    recentErrors: ErrorReport[];
  } {
    const errorsByCategory: Record<string, number> = {};
    const errorsBySeverity: Record<ErrorSummary['severity'], number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    for (const [key, count] of this.errorCounts) {
      const [category] = key.split('_');
      if (category) {
        errorsByCategory[category] = (errorsByCategory[category] || 0) + count;
      }
    }

    // Count errors by severity from recent buffer
    for (const report of this.errorBuffer) {
      errorsBySeverity[report.severity]++;
    }

    return {
      totalErrors: Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0),
      errorsByCategory,
      errorsBySeverity,
      recentErrors: [...this.errorBuffer].slice(-10) // Last 10 errors
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ErrorReportConfig>): void {
    this.config = { ...this.config, ...config };

    // Update custom categories if provided
    if (config.categorization?.customCategories) {
      this.updateCustomCategories(config.categorization.customCategories);
    }

    // Restart reporting if interval changed
    if (this.isActive && config.reporting?.reportingInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): ErrorReportConfig {
    return { ...this.config };
  }

  /**
   * Manually flush all buffered errors
   */
  public flushErrors(): void {
    if (this.errorBuffer.length === 0) {
      return;
    }

    const batch = this.createErrorBatch();
    this.errorBuffer = [];

    this.processBatch(batch);
  }

  /**
   * Check if error reporting is active
   */
  public isReportingActive(): boolean {
    return this.isActive;
  }

  /**
   * Initialize default error categories
   */
  private initializeDefaultCategories(): void {
    const defaultCategories = {
      'Connection': ['connection', 'transport', 'network', 'timeout'],
      'Authentication': ['auth', 'authentication', 'permission', 'unauthorized'],
      'Protocol': ['protocol', 'mcp', 'message', 'format'],
      'Validation': ['validation', 'schema', 'parameter', 'input'],
      'Server': ['server', 'process', 'spawn', 'child'],
      'Resource': ['resource', 'file', 'not found', 'access'],
      'Tool': ['tool', 'execution', 'adapter', 'mapping'],
      'System': ['system', 'memory', 'cpu', 'disk', 'internal']
    };

    for (const [category, keywords] of Object.entries(defaultCategories)) {
      for (const keyword of keywords) {
        this.errorCategories.set(keyword.toLowerCase(), category);
      }
    }

    // Add custom categories if configured
    if (this.config.categorization.customCategories) {
      this.updateCustomCategories(this.config.categorization.customCategories);
    }
  }

  /**
   * Update custom error categories
   */
  private updateCustomCategories(customCategories: Record<string, string[]>): void {
    for (const [category, keywords] of Object.entries(customCategories)) {
      for (const keyword of keywords) {
        this.errorCategories.set(keyword.toLowerCase(), category);
      }
    }
  }

  /**
   * Categorize an error based on its message and type
   */
  private categorizeError(error: Error): string {
    if (!this.config.categorization.enabled) {
      return 'Uncategorized';
    }

    if (!error || !error.message) {
      return 'Uncategorized';
    }

    const errorMessage = error.message.toLowerCase();
    const errorType = error.constructor.name.toLowerCase();

    // Check error type first
    for (const [keyword, category] of this.errorCategories) {
      if (errorType.includes(keyword)) {
        return category;
      }
    }

    // Check error message
    for (const [keyword, category] of this.errorCategories) {
      if (errorMessage.includes(keyword)) {
        return category;
      }
    }

    // Special handling for MCP errors
    if (error instanceof MCPError) {
      return 'Protocol';
    }

    return 'Uncategorized';
  }

  /**
   * Determine error severity
   */
  private determineSeverity(error: Error): ErrorSummary['severity'] {
    if (!error || !error.message) {
      return 'low';
    }

    const errorMessage = error.message.toLowerCase();
    const errorType = error.constructor.name.toLowerCase();

    // Critical errors
    if (
      errorMessage.includes('fatal') ||
      errorMessage.includes('critical') ||
      errorMessage.includes('crash') ||
      errorType.includes('critical')
    ) {
      return 'critical';
    }

    // High severity errors
    if (
      error instanceof MCPError ||
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('unauthorized') ||
      errorType.includes('connection')
    ) {
      return 'high';
    }

    // Medium severity errors
    if (
      errorMessage.includes('validation') ||
      errorMessage.includes('parameter') ||
      errorMessage.includes('not found') ||
      errorType.includes('validation')
    ) {
      return 'medium';
    }

    // Default to low severity
    return 'low';
  }

  /**
   * Check if error should be reported based on filters
   */
  private shouldReportError(error: Error): boolean {
    if (!error) {
      return false;
    }

    const { filtering } = this.config;

    // Check exclude patterns
    if (filtering.excludePatterns && filtering.excludePatterns.length > 0) {
      const errorMessage = error.message?.toLowerCase() || '';
      for (const pattern of filtering.excludePatterns) {
        if (errorMessage.includes(pattern.toLowerCase())) {
          return false;
        }
      }
    }

    // Check severity filter
    if (filtering.severityFilter && filtering.severityFilter.length > 0) {
      const severity = this.determineSeverity(error);
      if (!filtering.severityFilter.includes(severity)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `err_${timestamp}_${random}`;
  }

  /**
   * Update error counts for statistics
   */
  private updateErrorCounts(report: ErrorReport): void {
    const key = `${report.category}_${report.severity}`;
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
  }

  /**
   * Create error batch from current buffer
   */
  private createErrorBatch(): ErrorBatch {
    const reports = [...this.errorBuffer];
    const severityCounts: Record<ErrorSummary['severity'], number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };
    const categoryCounts: Record<string, number> = {};

    for (const report of reports) {
      severityCounts[report.severity]++;
      categoryCounts[report.category] = (categoryCounts[report.category] || 0) + 1;
    }

    return {
      id: this.generateErrorId(),
      timestamp: new Date(),
      reports,
      summary: {
        totalErrors: reports.length,
        severityCounts,
        categoryCounts
      }
    };
  }

  /**
   * Process error batch
   */
  private processBatch(batch: ErrorBatch): void {
    try {
      // Log batch summary
      logger.info('Processing error batch', {
        batchId: batch.id,
        errorCount: batch.summary.totalErrors,
        severityCounts: batch.summary.severityCounts,
        categoryCounts: batch.summary.categoryCounts
      });

      // Notify all handlers
      for (const report of batch.reports) {
        this.notifyHandlers(report);
      }

      // Emit monitoring event
      this.emitMonitoringEvent({
        type: 'error_report',
        serverId: 'system',
        timestamp: batch.timestamp,
        data: batch,
        severity: this.getBatchSeverity(batch)
      });

    } catch (error) {
      logger.error('Failed to process error batch', error as Error, {
        batchId: batch.id
      });
    }
  }

  /**
   * Notify error handlers
   */
  private notifyHandlers(report: ErrorReport): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(report.error, {
          ...report.context,
          errorId: report.id,
          category: report.category,
          severity: report.severity,
          serverId: report.serverId,
          operationType: report.operationType
        });
      } catch (error) {
        logger.error('Error in error report handler', error as Error);
      }
    }
  }

  /**
   * Determine batch severity based on highest severity error
   */
  private getBatchSeverity(batch: ErrorBatch): MonitoringEvent['severity'] {
    if (batch.summary.severityCounts.critical > 0) return 'critical';
    if (batch.summary.severityCounts.high > 0) return 'error';
    if (batch.summary.severityCounts.medium > 0) return 'warning';
    return 'info';
  }

  /**
   * Schedule periodic error reporting
   */
  private scheduleReporting(): void {
    this.reportingInterval = setInterval(() => {
      if (this.isActive && this.errorBuffer.length > 0) {
        void this.flushErrors();
      }
    }, this.config.reporting.reportingInterval);
  }

  /**
   * Emit monitoring event (placeholder for event system integration)
   */
  private emitMonitoringEvent(event: MonitoringEvent): void {
    logger.debug('Monitoring event emitted', { event });
    // This would integrate with the broader monitoring event system
  }
}