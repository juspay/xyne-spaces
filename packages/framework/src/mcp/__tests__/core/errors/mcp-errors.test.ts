import {
  MCPError,
  MCPConfigError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPValidationError,
  isMCPError,
  isMCPErrorType,
  createMCPConfigError,
  createMCPConnectionError,
  createMCPTimeoutError,
  createMCPValidationError
} from '../../../core/errors/index.js';

describe('MCP Error Classes', (): void => {
  describe('MCPError', (): void => {
    it('should create base MCP error with required properties', (): void => {
      const error = new MCPError({
        type: 'UNKNOWN_ERROR',
        severity: 'medium',
        message: 'Test error',
        timestamp: new Date(),
        retryable: true
      });

      expect(error.name).toBe('MCPError');
      expect(error.message).toBe('Test error');
      expect(error.getType()).toBe('UNKNOWN_ERROR');
      expect(error.getSeverity()).toBe('medium');
      expect(error.isRetryable()).toBe(true);
    });

    it('should serialize error to JSON correctly', (): void => {
      const timestamp = new Date();
      const error = new MCPError({
        type: 'CONFIG_ERROR',
        severity: 'high',
        message: 'Config validation failed',
        timestamp,
        retryable: false
      });

      const json = error.toJSON();
      
      expect(json['name']).toBe('MCPError');
      expect(json['message']).toBe('Config validation failed');
      expect(json['mcpError']).toBeDefined();
      expect(json['mcpError']).toEqual({
        type: 'CONFIG_ERROR',
        severity: 'high',
        message: 'Config validation failed',
        timestamp,
        retryable: false
      });
    });
  });

  describe('MCPConfigError', (): void => {
    it('should create config error with proper type', (): void => {
      const error = new MCPConfigError({
        severity: 'high',
        message: 'Configuration file not found',
        configPath: '/path/to/config',
        retryable: false
      });

      expect(error.name).toBe('MCPConfigError');
      expect(error.getType()).toBe('CONFIG_ERROR');
      expect(error.getConfigPath()).toBe('/path/to/config');
    });

    it('should handle validation errors', (): void => {
      const validationErrors = ['Missing required field', 'Invalid format'];
      const error = new MCPConfigError({
        severity: 'high',
        message: 'Validation failed',
        validationErrors,
        retryable: false
      });

      expect(error.getValidationErrors()).toEqual(validationErrors);
    });
  });

  describe('MCPConnectionError', (): void => {
    it('should create connection error with server info', (): void => {
      const error = new MCPConnectionError({
        serverName: 'test-server',
        severity: 'high',
        message: 'Connection failed',
        connectionAttempts: 3,
        endpoint: 'http://localhost:8080',
        retryable: true
      });

      expect(error.name).toBe('MCPConnectionError');
      expect(error.getType()).toBe('CONNECTION_ERROR');
      expect(error.getServerName()).toBe('test-server');
      expect(error.getConnectionAttempts()).toBe(3);
      expect(error.getEndpoint()).toBe('http://localhost:8080');
    });
  });

  describe('MCPTimeoutError', (): void => {
    it('should create timeout error with operation details', (): void => {
      const error = new MCPTimeoutError({
        severity: 'medium',
        message: 'Operation timed out',
        timeoutMs: 5000,
        operation: 'listResources',
        serverName: 'test-server',
        retryable: true
      });

      expect(error.name).toBe('MCPTimeoutError');
      expect(error.getType()).toBe('TIMEOUT_ERROR');
      expect(error.getTimeoutMs()).toBe(5000);
      expect(error.getOperation()).toBe('listResources');
    });
  });

  describe('MCPValidationError', (): void => {
    it('should create validation error with error details', (): void => {
      const validationErrors = ['Field is required', 'Invalid type'];
      const error = new MCPValidationError({
        severity: 'medium',
        message: 'Validation failed',
        validationErrors,
        schema: 'MCPToolSchema',
        retryable: false
      });

      expect(error.name).toBe('MCPValidationError');
      expect(error.getType()).toBe('VALIDATION_ERROR');
      expect(error.getValidationErrors()).toEqual(validationErrors);
      expect(error.getSchema()).toBe('MCPToolSchema');
    });
  });

  describe('Type Guards', (): void => {
    it('should correctly identify MCP errors', (): void => {
      const mcpError = new MCPError({
        type: 'UNKNOWN_ERROR',
        severity: 'medium',
        message: 'Test error',
        timestamp: new Date()
      });
      const regularError = new Error('Regular error');

      expect(isMCPError(mcpError)).toBe(true);
      expect(isMCPError(regularError)).toBe(false);
      expect(isMCPError(null)).toBe(false);
      expect(isMCPError(undefined)).toBe(false);
    });

    it('should correctly identify specific MCP error types', (): void => {
      const configError = new MCPConfigError({
        severity: 'high',
        message: 'Config error',
        retryable: false
      });
      const connectionError = new MCPConnectionError({
        serverName: 'test',
        severity: 'high',
        message: 'Connection error',
        retryable: true
      });

      expect(isMCPErrorType(configError, 'CONFIG_ERROR')).toBe(true);
      expect(isMCPErrorType(configError, 'CONNECTION_ERROR')).toBe(false);
      expect(isMCPErrorType(connectionError, 'CONNECTION_ERROR')).toBe(true);
      expect(isMCPErrorType(connectionError, 'CONFIG_ERROR')).toBe(false);
    });
  });

  describe('Helper Functions', (): void => {
    it('should create config error with helper function', (): void => {
      const error = createMCPConfigError('Config not found', {
        configPath: '/test/path',
        severity: 'critical',
        validationErrors: ['Missing field']
      });

      expect(error).toBeInstanceOf(MCPConfigError);
      expect(error.message).toBe('Config not found');
      expect(error.getConfigPath()).toBe('/test/path');
      expect(error.getSeverity()).toBe('critical');
      expect(error.isRetryable()).toBe(false);
    });

    it('should create connection error with helper function', (): void => {
      const error = createMCPConnectionError('test-server', 'Failed to connect', {
        connectionAttempts: 2,
        endpoint: 'http://test.com',
        retryable: true
      });

      expect(error).toBeInstanceOf(MCPConnectionError);
      expect(error.getServerName()).toBe('test-server');
      expect(error.isRetryable()).toBe(true);
    });

    it('should create timeout error with helper function', (): void => {
      const error = createMCPTimeoutError('ping', 3000, {
        serverName: 'test-server',
        severity: 'low'
      });

      expect(error).toBeInstanceOf(MCPTimeoutError);
      expect(error.message).toBe("Operation 'ping' timed out after 3000ms");
      expect(error.getTimeoutMs()).toBe(3000);
      expect(error.getSeverity()).toBe('low');
    });

    it('should create validation error with helper function', (): void => {
      const validationErrors = ['Required field missing'];
      const error = createMCPValidationError(validationErrors, {
        schema: 'TestSchema',
        serverName: 'test-server'
      });

      expect(error).toBeInstanceOf(MCPValidationError);
      expect(error.message).toBe('Validation failed: Required field missing');
      expect(error.getValidationErrors()).toEqual(validationErrors);
    });
  });
});