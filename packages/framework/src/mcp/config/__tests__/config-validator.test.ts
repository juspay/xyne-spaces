import {
  validateMCPConfig,
  validateServerConfig,
  isValidServerConfig,
  getDefaultMCPConfig,
  MCPConfigSchema,
  MCPLocalServerConfigSchema,
  MCPRemoteServerConfigSchema
} from '../config-validator.js';
import type {
  MCPConfig,
  MCPLocalServerConfig,
  MCPRemoteServerConfig
} from '../../core/types/config.js';

describe('MCP Config Validator', (): void => {
  describe('MCPLocalServerConfigSchema', (): void => {
    it('should validate valid local server config', (): void => {
      const validConfig: MCPLocalServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'production' },
        timeout: 5000
      };

      const result = MCPLocalServerConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should require command field', (): void => {
      const invalidConfig = {
        args: ['server.js']
      };

      const result = MCPLocalServerConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.error?.errors[0]?.message).toContain('Required');
    });

    it('should reject empty command', (): void => {
      const invalidConfig = {
        command: ''
      };

      const result = MCPLocalServerConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.error?.errors[0]?.message).toBe('Command cannot be empty');
    });

    it('should validate optional fields', (): void => {
      const configWithOptionals: MCPLocalServerConfig = {
        command: 'python',
        args: ['-m', 'server'],
        env: { PYTHONPATH: '/app' },
        cwd: '/app',
        timeout: 10000,
        retryCount: 3,
        retryDelay: 1000
      };

      const result = MCPLocalServerConfigSchema.safeParse(configWithOptionals);
      expect(result.success).toBe(true);
    });

    it('should reject invalid retry count', (): void => {
      const invalidConfig = {
        command: 'node',
        retryCount: 15 // Too high
      };

      const result = MCPLocalServerConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('MCPRemoteServerConfigSchema', (): void => {
    it('should validate valid remote server config', (): void => {
      const validConfig: MCPRemoteServerConfig = {
        transport: {
          type: 'http',
          url: 'https://api.example.com/mcp'
        }
      };

      const result = MCPRemoteServerConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should validate config with authentication', (): void => {
      const configWithAuth: MCPRemoteServerConfig = {
        transport: {
          type: 'websocket',
          url: 'wss://api.example.com/mcp',
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'User-Agent': 'mcp-client'
          }
        },
        auth: {
          type: 'bearer',
          token: 'secret-token'
        }
      };

      const result = MCPRemoteServerConfigSchema.safeParse(configWithAuth);
      expect(result.success).toBe(true);
    });

    it('should reject invalid URL', (): void => {
      const invalidConfig = {
        transport: {
          type: 'http',
          url: 'not-a-url'
        }
      };

      const result = MCPRemoteServerConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.error?.errors[0]?.message).toBe('Invalid URL format');
    });

    it('should validate bearer auth requirements', (): void => {
      const invalidAuth = {
        transport: {
          type: 'http',
          url: 'https://api.example.com'
        },
        auth: {
          type: 'bearer'
          // Missing token
        }
      };

      const result = MCPRemoteServerConfigSchema.safeParse(invalidAuth);
      expect(result.success).toBe(false);
    });

    it('should validate basic auth requirements', (): void => {
      const validBasicAuth: MCPRemoteServerConfig = {
        transport: {
          type: 'http',
          url: 'https://api.example.com'
        },
        auth: {
          type: 'basic',
          username: 'user',
          password: 'pass'
        }
      };

      const result = MCPRemoteServerConfigSchema.safeParse(validBasicAuth);
      expect(result.success).toBe(true);
    });

    it('should validate api-key auth requirements', (): void => {
      const validApiKeyAuth: MCPRemoteServerConfig = {
        transport: {
          type: 'http',
          url: 'https://api.example.com'
        },
        auth: {
          type: 'api-key',
          apiKey: 'secret-key',
          header: 'X-API-Key'
        }
      };

      const result = MCPRemoteServerConfigSchema.safeParse(validApiKeyAuth);
      expect(result.success).toBe(true);
    });
  });

  describe('MCPConfigSchema', (): void => {
    it('should validate complete valid config', (): void => {
      const validConfig: MCPConfig = {
        mcpServers: {
          localFs: {
            command: 'node',
            args: ['fs-server.js']
          },
          remoteApi: {
            transport: {
              type: 'http',
              url: 'https://api.example.com/mcp'
            }
          }
        },
        security: {
          allowedHosts: ['localhost', 'example.com'],
          maxResourceSize: '10MB',
          enableSandbox: true
        },
        performance: {
          maxConcurrentConnections: 5,
          requestTimeout: 30000
        },
        features: {
          enableResourceCaching: true,
          enableToolIntegration: true
        }
      };

      const result = MCPConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should allow empty server configuration', (): void => {
      const configWithEmptyServers = {
        mcpServers: {}
      };

      const result = MCPConfigSchema.safeParse(configWithEmptyServers);
      expect(result.success).toBe(true);
      expect(result.data?.mcpServers).toEqual({});
    });

    it('should provide default empty servers when mcpServers is not specified', (): void => {
      const configWithoutServers = {};

      const result = MCPConfigSchema.safeParse(configWithoutServers);
      expect(result.success).toBe(true);
      expect(result.data?.mcpServers).toEqual({});
    });

    it('should validate with minimal config', (): void => {
      const minimalConfig: MCPConfig = {
        mcpServers: {
          testServer: {
            command: 'test'
          }
        }
      };

      const result = MCPConfigSchema.safeParse(minimalConfig);
      expect(result.success).toBe(true);
    });
  });

  describe('validateMCPConfig', (): void => {
    it('should return success for valid config', (): void => {
      const validConfig: MCPConfig = {
        mcpServers: {
          testServer: {
            command: 'node',
            args: ['server.js']
          }
        }
      };

      const result = validateMCPConfig(validConfig);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validConfig);
      expect(result.errors).toBeUndefined();
    });

    it('should return errors for invalid config', (): void => {
      const invalidConfig = {
        mcpServers: {
          testServer: {
            // Missing command
            args: ['server.js']
          }
        }
      };

      const result = validateMCPConfig(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('testServer');
    });

    it('should handle non-object input', (): void => {
      const result = validateMCPConfig('not an object');
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('validateServerConfig', (): void => {
    it('should validate individual server config', (): void => {
      const serverConfig: MCPLocalServerConfig = {
        command: 'node',
        args: ['server.js']
      };

      const result = validateServerConfig('testServer', serverConfig);
      expect(result.success).toBe(true);
      expect(result.data?.mcpServers['testServer']).toEqual(serverConfig);
    });

    it('should include server name in error messages', (): void => {
      const invalidConfig = {
        command: '' // Invalid empty command
      };

      const result = validateServerConfig('my-server', invalidConfig);
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('my-server');
    });
  });

  describe('isValidServerConfig', (): void => {
    it('should identify valid local server config', (): void => {
      const localConfig: MCPLocalServerConfig = {
        command: 'node'
      };

      expect(isValidServerConfig(localConfig)).toBe(true);
    });

    it('should identify valid remote server config', (): void => {
      const remoteConfig: MCPRemoteServerConfig = {
        transport: {
          type: 'http',
          url: 'https://example.com'
        }
      };

      expect(isValidServerConfig(remoteConfig)).toBe(true);
    });

    it('should reject invalid config', (): void => {
      const invalidConfig = {
        invalidField: 'value'
      };

      expect(isValidServerConfig(invalidConfig)).toBe(false);
    });
  });

  describe('getDefaultMCPConfig', (): void => {
    it('should return sensible defaults', (): void => {
      const defaults = getDefaultMCPConfig();
      
      expect(defaults.security).toBeDefined();
      expect(defaults.performance).toBeDefined();
      expect(defaults.features).toBeDefined();
      
      // Check specific defaults
      expect(defaults.security?.enableSandbox).toBe(true);
      expect(defaults.performance?.maxConcurrentConnections).toBe(10);
      expect(defaults.features?.enableResourceCaching).toBe(true);
    });

    it('should have all optional properties', (): void => {
      const defaults = getDefaultMCPConfig();
      
      // Security defaults
      expect(defaults.security?.maxResourceSize).toBe('10MB');
      expect(defaults.security?.timeout).toBe(30000);
      expect(defaults.security?.allowedHosts).toContain('localhost');
      
      // Performance defaults
      expect(defaults.performance?.retryAttempts).toBe(3);
      expect(defaults.performance?.connectionPoolSize).toBe(5);
      
      // Feature defaults
      expect(defaults.features?.enableHealthMonitoring).toBe(true);
      expect(defaults.features?.enableToolIntegration).toBe(true);
    });
  });
});