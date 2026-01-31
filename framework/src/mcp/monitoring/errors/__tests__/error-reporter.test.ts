/**
 * Tests for ErrorReporter - structured error categorization, reporting, and alerting
 */

import { ErrorReporter } from '../error-reporter.js';
import { MCPError } from '../../../core/errors/index.js';
import type { ErrorReportConfig } from '../../types/index.js';

// Mock the logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock call helper utilities are available in dashboard and health monitor test files

describe('ErrorReporter', () => {
  let reporter: ErrorReporter;

  beforeEach(() => {
    reporter = new ErrorReporter();
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (reporter.isReportingActive()) {
      reporter.stop();
    }
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should create reporter with default configuration', () => {
      const config = reporter.getConfig();
      
      expect(config.categorization.enabled).toBe(true);
      expect(config.reporting.batchSize).toBe(50);
      expect(config.reporting.reportingInterval).toBe(60000);
      expect(config.reporting.includeStackTrace).toBe(true);
    });

    it('should create reporter with custom configuration', () => {
      const customConfig: Partial<ErrorReportConfig> = {
        categorization: {
          enabled: false,
          customCategories: {
            'custom': ['test', 'example']
          }
        },
        reporting: {
          batchSize: 10,
          reportingInterval: 30000,
          includeStackTrace: false
        }
      };

      const customReporter = new ErrorReporter(customConfig);
      const config = customReporter.getConfig();

      expect(config.categorization.enabled).toBe(false);
      expect(config.reporting.batchSize).toBe(10);
      expect(config.reporting.reportingInterval).toBe(30000);
      expect(config.reporting.includeStackTrace).toBe(false);
    });

    it('should not be active initially', () => {
      expect(reporter.isReportingActive()).toBe(false);
    });
  });

  describe('lifecycle management', () => {
    it('should start reporting successfully', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      reporter.start();

      expect(reporter.isReportingActive()).toBe(true);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);

      setIntervalSpy.mockRestore();
    });

    it('should not start twice', () => {
      reporter.start();
      
      // Second start should be ignored
      reporter.start();
      
      expect(reporter.isReportingActive()).toBe(true);
    });

    it('should stop reporting successfully', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      reporter.start();
      reporter.stop();

      expect(reporter.isReportingActive()).toBe(false);
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });

    it('should flush errors on stop', () => {
      const flushSpy = jest.spyOn(reporter, 'flushErrors');
      
      reporter.start();
      reporter.reportError(new Error('Test error'));
      reporter.stop();

      expect(flushSpy).toHaveBeenCalled();
      flushSpy.mockRestore();
    });
  });

  describe('error categorization', () => {
    beforeEach(() => {
      reporter.start();
    });

    it('should categorize connection errors', () => {
      const error = new Error('Connection timeout occurred');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsByCategory['Connection']).toBe(1);
    });

    it('should categorize authentication errors', () => {
      const error = new Error('Authentication failed');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsByCategory['Authentication']).toBe(1);
    });

    it('should categorize protocol errors', () => {
      const error = new Error('Invalid MCP message format');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsByCategory['Protocol']).toBe(1);
    });

    it('should categorize validation errors', () => {
      const error = new Error('Parameter validation failed');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsByCategory['Validation']).toBe(1);
    });

    it('should categorize MCP errors as protocol errors', () => {
      const error = new MCPError({
        type: 'PROTOCOL_ERROR',
        message: 'Invalid request',
        severity: 'medium',
        timestamp: new Date(),
        retryable: false
      });
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsByCategory['Protocol']).toBe(1);
    });

    it('should handle uncategorized errors', () => {
      const error = new Error('Some random error');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsByCategory['Uncategorized']).toBe(1);
    });

    it('should use custom categories when configured', () => {
      const customReporter = new ErrorReporter({
        categorization: {
          enabled: true,
          customCategories: {
            'CustomCategory': ['custom', 'special']
          }
        }
      } as Partial<ErrorReportConfig>);
      customReporter.start();

      const error = new Error('This is a custom error');
      customReporter.reportError(error);

      const stats = customReporter.getErrorStatistics();
      expect(stats.errorsByCategory['CustomCategory']).toBe(1);

      customReporter.stop();
    });

    it('should disable categorization when configured', () => {
      const noCatReporter = new ErrorReporter({
        categorization: { enabled: false }
      } as Partial<ErrorReportConfig>);
      noCatReporter.start();

      const error = new Error('Connection failed');
      noCatReporter.reportError(error);

      const stats = noCatReporter.getErrorStatistics();
      expect(stats.errorsByCategory['Uncategorized']).toBe(1);

      noCatReporter.stop();
    });
  });

  describe('severity determination', () => {
    beforeEach(() => {
      reporter.start();
    });

    it('should classify critical errors', () => {
      const error = new Error('Fatal system crash');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsBySeverity.critical).toBe(1);
    });

    it('should classify high severity errors', () => {
      const error = new Error('Connection lost to server');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsBySeverity.high).toBe(1);
    });

    it('should classify medium severity errors', () => {
      const error = new Error('Validation failed for parameter');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsBySeverity.medium).toBe(1);
    });

    it('should classify low severity errors by default', () => {
      const error = new Error('Some minor issue');
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsBySeverity.low).toBe(1);
    });

    it('should classify MCP errors as high severity', () => {
      const error = new MCPError({
        type: 'CONNECTION_ERROR',
        message: 'Failed to connect',
        severity: 'high',
        timestamp: new Date(),
        retryable: true
      });
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsBySeverity.high).toBe(1);
    });
  });

  describe('error filtering', () => {
    it('should exclude errors based on patterns', () => {
      const filterReporter = new ErrorReporter({
        filtering: {
          excludePatterns: ['test', 'debug']
        }
      } as Partial<ErrorReportConfig>);
      filterReporter.start();

      filterReporter.reportError(new Error('This is a test error'));
      filterReporter.reportError(new Error('Debug information'));
      filterReporter.reportError(new Error('Real error occurred'));

      const stats = filterReporter.getErrorStatistics();
      expect(stats.totalErrors).toBe(1); // Only 'Real error' should be reported

      filterReporter.stop();
    });

    it('should filter errors by severity', () => {
      const filterReporter = new ErrorReporter({
        filtering: {
          severityFilter: ['high', 'critical']
        }
      });
      filterReporter.start();

      filterReporter.reportError(new Error('Minor issue')); // low severity
      filterReporter.reportError(new Error('Connection failed')); // high severity
      filterReporter.reportError(new Error('Critical system failure')); // critical severity

      const stats = filterReporter.getErrorStatistics();
      expect(stats.totalErrors).toBe(2); // Only high and critical errors

      filterReporter.stop();
    });
  });

  describe('error handlers', () => {
    beforeEach(() => {
      reporter.start();
    });

    it('should add and remove error handlers', () => {
      const handler = jest.fn();

      reporter.addErrorHandler(handler);
      expect(() => reporter.removeErrorHandler(handler)).not.toThrow();
    });

    it('should notify handlers immediately for critical errors', () => {
      const handler = jest.fn();
      reporter.addErrorHandler(handler);

      const criticalError = new Error('Critical system failure');
      reporter.reportError(criticalError);

      expect(handler).toHaveBeenCalledWith(
        criticalError,
        expect.objectContaining({
          category: expect.any(String) as string,
          severity: 'critical'
        })
      );
    });

    it('should not notify handlers immediately for non-critical errors', () => {
      const handler = jest.fn();
      reporter.addErrorHandler(handler);

      const normalError = new Error('Normal error');
      reporter.reportError(normalError);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle errors in handlers gracefully', () => {
      const faultyHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      
      reporter.addErrorHandler(faultyHandler);

      const criticalError = new Error('Critical system failure');
      
      // Should not throw despite handler error
      expect(() => reporter.reportError(criticalError)).not.toThrow();
    });

    it('should include context in handler calls', () => {
      const handler = jest.fn();
      reporter.addErrorHandler(handler);

      const error = new Error('Critical failure');
      const context = { userId: '123', operation: 'connect' };
      
      reporter.reportError(error, context, 'server1', 'tool_call');

      expect(handler).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          ...context,
          errorId: expect.any(String) as string,
          category: expect.any(String) as string,
          severity: 'critical',
          serverId: 'server1',
          operationType: 'tool_call'
        })
      );
    });
  });

  describe('batch processing', () => {
    beforeEach(() => {
      reporter.start();
    });

    it('should flush errors when batch size is reached', () => {
      const batchReporter = new ErrorReporter({
        reporting: { batchSize: 3, reportingInterval: 60000, includeStackTrace: true }
      });
      batchReporter.start();

      const handler = jest.fn();
      batchReporter.addErrorHandler(handler);

      // Report errors up to batch size
      for (let i = 0; i < 3; i++) {
        batchReporter.reportError(new Error(`Error ${i}`));
      }

      // All errors should have been flushed
      expect(handler).toHaveBeenCalledTimes(3);

      batchReporter.stop();
    });

    it('should flush errors on interval', () => {
      const handler = jest.fn();
      reporter.addErrorHandler(handler);

      // Report some errors
      reporter.reportError(new Error('Error 1'));
      reporter.reportError(new Error('Error 2'));

      // Advance time to trigger interval flush
      jest.advanceTimersByTime(60000);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should handle empty buffer gracefully', () => {
      expect(() => reporter.flushErrors()).not.toThrow();
    });

    it('should process error batches correctly', () => {
      const handler = jest.fn();
      reporter.addErrorHandler(handler);

      // Create errors with different severities
      reporter.reportError(new Error('Minor issue')); // low
      reporter.reportError(new Error('Connection failed')); // high
      reporter.reportError(new Error('Critical failure')); // critical - called immediately + batch

      reporter.flushErrors();

      // Critical error is called immediately (1) + all 3 errors in batch (3) = 4 total calls
      expect(handler).toHaveBeenCalledTimes(4);
    });
  });

  describe('statistics and reporting', () => {
    beforeEach(() => {
      reporter.start();
    });

    it('should provide accurate error statistics', () => {
      reporter.reportError(new Error('Connection failed')); // high, Connection
      reporter.reportError(new Error('Validation error')); // medium, Validation
      reporter.reportError(new Error('Critical system failure')); // critical, System

      const stats = reporter.getErrorStatistics();

      expect(stats.totalErrors).toBe(3);
      expect(stats.errorsByCategory['Connection']).toBe(1);
      expect(stats.errorsByCategory['Validation']).toBe(1);
      expect(stats.errorsByCategory['System']).toBe(1);
      expect(stats.errorsBySeverity.high).toBe(1);
      expect(stats.errorsBySeverity.medium).toBe(1);
      expect(stats.errorsBySeverity.critical).toBe(1);
    });

    it('should limit recent errors in statistics', () => {
      // Report more than 10 errors
      for (let i = 0; i < 15; i++) {
        reporter.reportError(new Error(`Error ${i}`));
      }

      const stats = reporter.getErrorStatistics();
      expect(stats.recentErrors.length).toBeLessThanOrEqual(10);
    });

    it('should return most recent errors', () => {
      reporter.reportError(new Error('First error'));
      reporter.reportError(new Error('Second error'));
      reporter.reportError(new Error('Third error'));

      const stats = reporter.getErrorStatistics();
      const lastError = stats.recentErrors[stats.recentErrors.length - 1];
      
      expect(lastError?.error.message).toBe('Third error');
    });
  });

  describe('configuration updates', () => {
    it('should update configuration', () => {
      const newConfig: Partial<ErrorReportConfig> = {
        reporting: {
          batchSize: 25,
          reportingInterval: 30000,
          includeStackTrace: false
        }
      };

      reporter.updateConfig(newConfig);
      const config = reporter.getConfig();

      expect(config.reporting.batchSize).toBe(25);
      expect(config.reporting.reportingInterval).toBe(30000);
      expect(config.reporting.includeStackTrace).toBe(false);
    });

    it('should restart reporting when interval changes', () => {
      reporter.start();
      expect(reporter.isReportingActive()).toBe(true);

      reporter.updateConfig({
        reporting: { batchSize: 50, reportingInterval: 45000, includeStackTrace: true }
      });

      expect(reporter.isReportingActive()).toBe(true);
    });

    it('should update custom categories', () => {
      reporter.updateConfig({
        categorization: {
          enabled: true,
          customCategories: {
            'NewCategory': ['new', 'fresh']
          }
        }
      });

      reporter.start();
      reporter.reportError(new Error('This is new'));

      const stats = reporter.getErrorStatistics();
      expect(stats.errorsByCategory['NewCategory']).toBe(1);
    });
  });

  describe('stack trace handling', () => {
    beforeEach(() => {
      reporter.start();
    });

    it('should include stack trace when enabled', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      
      reporter.reportError(error);

      const stats = reporter.getErrorStatistics();
      const recentError = stats.recentErrors[0];
      
      expect(recentError?.stackTrace).toBeDefined();
      expect(recentError?.stackTrace).toContain('test.js:1:1');
    });

    it('should exclude stack trace when disabled', () => {
      const noStackReporter = new ErrorReporter({
        reporting: { batchSize: 50, reportingInterval: 60000, includeStackTrace: false }
      });
      noStackReporter.start();

      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      
      noStackReporter.reportError(error);

      const stats = noStackReporter.getErrorStatistics();
      const recentError = stats.recentErrors[0];
      
      expect(recentError?.stackTrace).toBeUndefined();

      noStackReporter.stop();
    });

    it('should handle errors without stack trace', () => {
      const error = new Error('Test error');
      delete error.stack;
      
      expect(() => reporter.reportError(error)).not.toThrow();

      const stats = reporter.getErrorStatistics();
      expect(stats.recentErrors).toHaveLength(1);
    });
  });

  describe('error context and metadata', () => {
    beforeEach(() => {
      reporter.start();
    });

    it('should include server and operation context', () => {
      const error = new Error('Operation failed');
      const context = { requestId: 'req-123' };
      
      reporter.reportError(error, context, 'server1', 'tool_execution');

      const stats = reporter.getErrorStatistics();
      const recentError = stats.recentErrors[0];
      
      expect(recentError?.serverId).toBe('server1');
      expect(recentError?.operationType).toBe('tool_execution');
      expect(recentError?.context['requestId']).toBe('req-123');
    });

    it('should generate unique error IDs', () => {
      reporter.reportError(new Error('Error 1'));
      reporter.reportError(new Error('Error 2'));

      const stats = reporter.getErrorStatistics();
      const ids = stats.recentErrors.map(e => e.id);
      
      expect(ids[0]).not.toBe(ids[1]);
      expect(ids[0]).toMatch(/^err_/);
      expect(ids[1]).toMatch(/^err_/);
    });

    it('should timestamp errors correctly', () => {
      const beforeTime = new Date();
      reporter.reportError(new Error('Timed error'));
      const afterTime = new Date();

      const stats = reporter.getErrorStatistics();
      const errorTime = stats.recentErrors[0]?.timestamp;
      
      expect(errorTime).toBeDefined();
      expect(errorTime!.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(errorTime!.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle null/undefined error gracefully', () => {
      reporter.start();

      // These should not throw
      expect(() => reporter.reportError(null as unknown as Error)).not.toThrow();
      expect(() => reporter.reportError(undefined as unknown as Error)).not.toThrow();
    });

    it('should handle circular references in context', () => {
      reporter.start();

      const circularContext: Record<string, unknown> = { test: 'value' };
      circularContext['self'] = circularContext;

      expect(() => reporter.reportError(new Error('Test'), circularContext)).not.toThrow();
    });

    it('should handle very large context objects', () => {
      reporter.start();

      const largeContext = {
        data: 'x'.repeat(10000), // Large string
        array: Array.from({ length: 1000 }, (_, i) => i)
      };

      expect(() => reporter.reportError(new Error('Test'), largeContext)).not.toThrow();
    });
  });
});