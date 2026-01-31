import { EnvironmentResolver } from '../environment-resolver.js';

describe('EnvironmentResolver', (): void => {
  const originalEnv = process.env;

  beforeEach((): void => {
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach((): void => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Basic Environment Resolution', (): void => {
    it('should resolve simple environment variables', (): void => {
      process.env['TEST_VAR'] = 'test-value';
      process.env['API_KEY'] = 'secret-key';

      const config = {
        database: {
          url: '${TEST_VAR}',
          key: '${API_KEY}'
        }
      };

      const resolver = new EnvironmentResolver();
      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(true);
      expect(result.resolvedConfig).toEqual({
        database: {
          url: 'test-value',
          key: 'secret-key'
        }
      });
    });

    it('should handle nested environment variables', (): void => {
      process.env['HOST'] = 'localhost';
      process.env['PORT'] = '8080';
      process.env['PROTOCOL'] = 'https';
      delete process.env['DEBUG']; // Ensure DEBUG is not set

      const config = {
        server: {
          url: '${PROTOCOL}://${HOST}:${PORT}',
          settings: {
            debug: '${DEBUG:-false}'
          }
        }
      };

      const resolver = new EnvironmentResolver();
      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(true);
      const resolved = result.resolvedConfig as Record<string, Record<string, unknown>>;
      const server = resolved['server'] as Record<string, unknown>;
      const settings = server['settings'] as Record<string, unknown>;
      expect(server['url']).toBe('https://localhost:8080');
      expect(settings['debug']).toBe(false); // Default value converted to boolean
    });

    it('should handle default values', (): void => {
      // Don't set OPTIONAL_VAR
      process.env['REQUIRED_VAR'] = 'required-value';

      const config = {
        required: '${REQUIRED_VAR}',
        optional: '${OPTIONAL_VAR:-default-value}',
        withSpaces: '${SPACED_VAR:- default with spaces }'
      };

      const resolver = new EnvironmentResolver();
      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(true);
      expect(result.resolvedConfig).toEqual({
        required: 'required-value',
        optional: 'default-value',
        withSpaces: ' default with spaces '
      });
    });
  });

  describe('Error Handling', (): void => {
    it('should fail for missing required variables', (): void => {
      const config = {
        requiredValue: '${MISSING_VAR}'
      };

      const resolver = new EnvironmentResolver({ throwOnMissing: true });
      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(false);
      expect(result.missingVariables).toContain('MISSING_VAR');
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('MISSING_VAR');
    });

    it('should handle lenient mode', (): void => {
      const config = {
        value: '${MISSING_VAR}',
        withDefault: '${ANOTHER_MISSING:-default}'
      };

      const resolver = new EnvironmentResolver({ throwOnMissing: false });
      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(true);
      expect(result.missingVariables).toContain('MISSING_VAR');
      expect(result.resolvedConfig).toEqual({
        value: '${MISSING_VAR}', // Unchanged
        withDefault: 'default'
      });
    });

    it('should handle empty values based on allowEmpty option', (): void => {
      process.env['EMPTY_VAR'] = '';

      const config = {
        value: '${EMPTY_VAR}'
      };

      // With allowEmpty: false (default)
      const strictResolver = new EnvironmentResolver({ allowEmpty: false });
      const strictResult = strictResolver.resolveEnvironmentVariables(config);

      expect(strictResult.success).toBe(false);
      expect(strictResult.missingVariables).toContain('EMPTY_VAR');

      // With allowEmpty: true
      const lenientResolver = new EnvironmentResolver({ allowEmpty: true });
      const lenientResult = lenientResolver.resolveEnvironmentVariables(config);

      expect(lenientResult.success).toBe(true);
      expect(lenientResult.resolvedConfig).toEqual({ value: '' });
    });
  });

  describe('Default Values', (): void => {
    it('should use default values from options', (): void => {
      const config = {
        value: '${MISSING_VAR}'
      };

      const resolver = new EnvironmentResolver({
        defaultValues: {
          'MISSING_VAR': 'from-defaults'
        }
      });

      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(true);
      expect(result.resolvedConfig).toEqual({
        value: 'from-defaults'
      });
    });

    it('should prioritize environment over defaults', (): void => {
      process.env['TEST_VAR'] = 'from-env';

      const config = {
        value: '${TEST_VAR}'
      };

      const resolver = new EnvironmentResolver({
        defaultValues: {
          'TEST_VAR': 'from-defaults'
        }
      });

      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(true);
      expect(result.resolvedConfig).toEqual({
        value: 'from-env'
      });
    });

    it('should prioritize inline defaults over option defaults', (): void => {
      const config = {
        value: '${MISSING_VAR:-inline-default}'
      };

      const resolver = new EnvironmentResolver({
        defaultValues: {
          'MISSING_VAR': 'option-default'
        }
      });

      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(true);
      expect(result.resolvedConfig).toEqual({
        value: 'inline-default'
      });
    });
  });

  describe('Static Methods', (): void => {
    it('should extract environment variables from config', (): void => {
      const config = {
        server: {
          url: '${HOST}:${PORT}',
          key: '${API_KEY}',
          debug: '${DEBUG:-false}'
        },
        database: {
          url: '${DB_URL}'
        }
      };

      const variables = EnvironmentResolver.extractEnvironmentVariables(config);

      expect(variables).toContain('HOST');
      expect(variables).toContain('PORT');
      expect(variables).toContain('API_KEY');
      expect(variables).toContain('DEBUG');
      expect(variables).toContain('DB_URL');
      expect(variables).toHaveLength(5);
    });

    it('should validate environment variables', (): void => {
      process.env['EXISTING_VAR'] = 'value';
      // Don't set MISSING_VAR

      const config = {
        existing: '${EXISTING_VAR}',
        missing: '${MISSING_VAR}'
      };

      const result = EnvironmentResolver.validateEnvironmentVariables(config);

      expect(result.isValid).toBe(false);
      expect(result.missingVars).toContain('MISSING_VAR');
      expect(result.missingVars).not.toContain('EXISTING_VAR');
    });

    it('should validate specific variables', (): void => {
      process.env['VAR1'] = 'value1';
      // Don't set VAR2

      const result = EnvironmentResolver.validateEnvironmentVariables(
        {},
        ['VAR1', 'VAR2', 'VAR3']
      );

      expect(result.isValid).toBe(false);
      expect(result.missingVars).toEqual(['VAR2', 'VAR3']);
    });
  });

  describe('Factory Methods', (): void => {
    it('should create lenient resolver', (): void => {
      const resolver = EnvironmentResolver.createLenient({
        'DEFAULT_VAR': 'default-value'
      });

      const config = { value: '${MISSING_VAR}' };
      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(true);
      expect(result.missingVariables).toContain('MISSING_VAR');
    });

    it('should create strict resolver', (): void => {
      const resolver = EnvironmentResolver.createStrict({
        'DEFAULT_VAR': 'default-value'
      });

      const config = { value: '${MISSING_VAR}' };
      const result = resolver.resolveEnvironmentVariables(config);

      expect(result.success).toBe(false);
      expect(result.missingVariables).toContain('MISSING_VAR');
    });
  });

  describe('resolveOrThrow', (): void => {
    it('should return resolved config on success', (): void => {
      process.env['TEST_VAR'] = 'test-value';

      const config = { value: '${TEST_VAR}' };
      const resolver = new EnvironmentResolver();

      const result = resolver.resolveOrThrow(config);

      expect(result).toEqual({ value: 'test-value' });
    });

    it('should throw MCPConfigError on failure', (): void => {
      const config = { value: '${MISSING_VAR}' };
      const resolver = new EnvironmentResolver();

      expect((): unknown => resolver.resolveOrThrow(config)).toThrow();
    });
  });

  describe('Complex Scenarios', (): void => {
    it('should handle MCP configuration example', (): void => {
      process.env['DB_HOST'] = 'localhost';
      process.env['DB_PORT'] = '5432';
      process.env['API_TOKEN'] = 'secret-token';
      delete process.env['LOG_LEVEL']; // Ensure LOG_LEVEL is not set so default is used

      const mcpConfig = {
        mcpServers: {
          databaseServer: {
            command: 'node',
            args: ['db-server.js'],
            env: {
              'DATABASE_URL': 'postgresql://user:pass@${DB_HOST}:${DB_PORT}/db',
              'LOG_LEVEL': '${LOG_LEVEL:-info}'
            }
          },
          apiServer: {
            transport: {
              type: 'http',
              url: 'https://api.example.com/mcp',
              headers: {
                'authorization': 'Bearer ${API_TOKEN}'
              }
            }
          }
        }
      };

      const resolver = new EnvironmentResolver();
      const result = resolver.resolveEnvironmentVariables(mcpConfig);

      expect(result.success).toBe(true);
      const resolved = result.resolvedConfig as Record<string, Record<string, unknown>>;
      const mcpServers = resolved['mcpServers'] as Record<string, Record<string, unknown>>;
      const dbServer = mcpServers['databaseServer'] as Record<string, unknown>;
      const dbEnv = dbServer['env'] as Record<string, unknown>;
      const apiServer = mcpServers['apiServer'] as Record<string, unknown>;
      const transport = apiServer['transport'] as Record<string, unknown>;
      const headers = transport['headers'] as Record<string, unknown>;
      
      expect(dbEnv['DATABASE_URL']).toBe('postgresql://user:pass@localhost:5432/db');
      expect(dbEnv['LOG_LEVEL']).toBe('info');
      expect(headers['authorization']).toBe('Bearer secret-token');
    });

    it('should handle malformed JSON gracefully', (): void => {
      // Create a circular reference that would break JSON.stringify
      const circularConfig: Record<string, unknown> = { prop: 'value' };
      circularConfig['circular'] = circularConfig;

      const resolver = new EnvironmentResolver();
      const result = resolver.resolveEnvironmentVariables(circularConfig);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Environment resolution failed');
    });
  });
});