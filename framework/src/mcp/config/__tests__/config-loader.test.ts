import { promises as fs } from 'fs';
import path from 'path';
import { MCPConfigLoader } from '../config-loader.js';
import { isLocalServerConfig } from '../config-validator.js';
import type { MCPConfig } from '../../core/types/config.js';

// Mock the logger to avoid console output during tests
jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
  }
}));

describe('MCPConfigLoader', (): void => {
  const testConfigDir = path.join(process.cwd(), 'test-temp', 'mcp-config-test');
  const localConfigPath = path.join(testConfigDir, 'local-mcp.config.json');
  const globalConfigPath = path.join(testConfigDir, 'global-mcp.config.json');

  beforeAll(async (): Promise<void> => {
    // Create test directory
    await fs.mkdir(testConfigDir, { recursive: true });
  });

  afterAll(async (): Promise<void> => {
    // Clean up test directory
    try {
      await fs.rm(testConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  afterEach(async (): Promise<void> => {
    // Clean up test config files
    try {
      await fs.unlink(localConfigPath);
    } catch {
      // Ignore if file doesn't exist
    }
    try {
      await fs.unlink(globalConfigPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('Constructor Validation', (): void => {
    it('should throw error when no paths are provided', (): void => {
      expect(() => {
        new MCPConfigLoader({});
      }).toThrow('At least one configuration path must be provided');
    });

    it('should accept local path only', (): void => {
      expect(() => {
        new MCPConfigLoader({ localPath: 'local.json' });
      }).not.toThrow();
    });

    it('should accept global path only', (): void => {
      expect(() => {
        new MCPConfigLoader({ globalPath: 'global.json' });
      }).not.toThrow();
    });

    it('should accept both paths', (): void => {
      expect(() => {
        new MCPConfigLoader({ localPath: 'local.json', globalPath: 'global.json' });
      }).not.toThrow();
    });
  });

  describe('Local-Only Configuration Loading', (): void => {
    it('should load valid local configuration', async (): Promise<void> => {
      const validConfig: MCPConfig = {
        mcpServers: {
          localServer: {
            command: 'node',
            args: ['server.js']
          }
        }
      };

      await fs.writeFile(localConfigPath, JSON.stringify(validConfig, null, 2));

      const loader = MCPConfigLoader.createForTesting({ localPath: localConfigPath });
      const result = await loader.loadConfig();

      expect(result.success).toBe(true);
      expect(result.config?.mcpServers['localServer']).toBeDefined();
      
      const serverConfig = result.config?.mcpServers['localServer'];
      if (serverConfig && isLocalServerConfig(serverConfig)) {
        expect(serverConfig.command).toBe('node');
      } else {
        fail('Expected local server config');
      }
    });

    it('should return error for non-existent local file', async (): Promise<void> => {
      const nonExistentPath = path.join(testConfigDir, 'nonexistent.json');
      const loader = MCPConfigLoader.createForTesting({ localPath: nonExistentPath });
      
      const result = await loader.loadConfig();

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Failed to load local configuration');
    });

    it('should return error for invalid JSON in local file', async (): Promise<void> => {
      await fs.writeFile(localConfigPath, 'invalid json {');

      const loader = MCPConfigLoader.createForTesting({ localPath: localConfigPath });
      const result = await loader.loadConfig();

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Invalid JSON');
    });
  });

  describe('Global-Only Configuration Loading', (): void => {
    it('should load valid global configuration', async (): Promise<void> => {
      const validConfig: MCPConfig = {
        mcpServers: {
          globalServer: {
            command: 'npx',
            args: ['global-server.js']
          }
        }
      };

      await fs.writeFile(globalConfigPath, JSON.stringify(validConfig, null, 2));

      const loader = MCPConfigLoader.createForTesting({ globalPath: globalConfigPath });
      const result = await loader.loadConfig();

      expect(result.success).toBe(true);
      expect(result.config?.mcpServers['globalServer']).toBeDefined();
    });
  });

  describe('Configuration Merging', (): void => {
    it('should merge global and local configs with local precedence', async (): Promise<void> => {
      const globalConfig = {
        mcpServers: {
          globalServer: {
            command: 'npx',
            args: ['global-server.js']
          },
          sharedServer: {
            command: 'global-shared',
            timeout: 30000
          }
        },
        security: {
          enableSandbox: false,
          allowedHosts: ['global.com']
        },
        performance: {
          maxConcurrentConnections: 5
        }
      };

      const localConfig = {
        mcpServers: {
          localServer: {
            command: 'node',
            args: ['local-server.js']
          },
          sharedServer: {
            command: 'local-shared',
            args: ['local-args']
          }
        },
        security: {
          enableSandbox: true,
          trustedServers: ['local.com']
        },
        features: {
          enableLogging: true
        }
      };

      await fs.writeFile(globalConfigPath, JSON.stringify(globalConfig, null, 2));
      await fs.writeFile(localConfigPath, JSON.stringify(localConfig, null, 2));

      const loader = MCPConfigLoader.createForTesting({ 
        globalPath: globalConfigPath, 
        localPath: localConfigPath 
      });
      const result = await loader.loadConfig();

      expect(result.success).toBe(true);
      
      const config = result.config!;
      
      // Should have all servers
      expect(config.mcpServers['globalServer']).toBeDefined();
      expect(config.mcpServers['localServer']).toBeDefined();
      expect(config.mcpServers['sharedServer']).toBeDefined();
      
      // Local server should completely override global server
      const sharedServer = config.mcpServers['sharedServer'];
      if (sharedServer && isLocalServerConfig(sharedServer)) {
        expect(sharedServer.command).toBe('local-shared');
        expect(sharedServer.args).toEqual(['local-args']);
        expect(sharedServer.timeout).toBeUndefined(); // Global timeout should not be present
      } else {
        fail('Expected local server config');
      }
      
      // Security should be deep merged with local precedence
      expect(config.security?.enableSandbox).toBe(true); // Local override
      expect(config.security?.allowedHosts).toEqual(['global.com']); // From global
      expect(config.security?.trustedServers).toEqual(['local.com']); // From local
      
      // Performance should have global values
      expect(config.performance?.maxConcurrentConnections).toBe(5);
      
      // Features should have local values
      expect(config.features?.enableLogging).toBe(true);
    });

    it('should merge with defaults', async (): Promise<void> => {
      const minimalConfig = {
        mcpServers: {
          testServer: {
            command: 'node'
          }
        }
      };

      await fs.writeFile(localConfigPath, JSON.stringify(minimalConfig));

      const loader = MCPConfigLoader.createForTesting({ localPath: localConfigPath });
      const result = await loader.loadConfig();

      expect(result.success).toBe(true);
      expect(result.config?.security).toBeDefined();
      expect(result.config?.performance).toBeDefined();
      expect(result.config?.features).toBeDefined();
    });
  });

  describe('Environment Variable Resolution', (): void => {
    beforeEach((): void => {
      process.env['TEST_VAR'] = 'test-value';
      process.env['SERVER_PORT'] = '8080';
    });

    afterEach((): void => {
      delete process.env['TEST_VAR'];
      delete process.env['SERVER_PORT'];
    });

    it('should resolve environment variables', async (): Promise<void> => {
      const configWithEnvVars = {
        mcpServers: {
          testServer: {
            command: 'node',
            args: ['server.js', '--port', '${SERVER_PORT}'],
            env: {
              NODE_ENV: '${TEST_VAR}'
            },
            timeout: 30000
          }
        }
      };

      await fs.writeFile(localConfigPath, JSON.stringify(configWithEnvVars));

      const loader = new MCPConfigLoader({
        localPath: localConfigPath
      });

      const result = await loader.loadConfig();

      expect(result.success).toBe(true);
      
      const serverConfig = result.config?.mcpServers['testServer'];
      if (serverConfig && isLocalServerConfig(serverConfig)) {
        expect(serverConfig.args).toContain('8080');
        expect(serverConfig.env?.['NODE_ENV']).toBe('test-value');
      } else {
        fail('Expected local server config');
      }
    });

    it('should handle missing environment variables', async (): Promise<void> => {
      const configWithMissingVars = {
        mcpServers: {
          testServer: {
            command: 'node',
            env: {
              MISSING_VAR: '${MISSING_VAR}'
            }
          }
        }
      };

      await fs.writeFile(localConfigPath, JSON.stringify(configWithMissingVars));

      const loader = new MCPConfigLoader({
        localPath: localConfigPath
      });

      const result = await loader.loadConfig();

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Environment variable resolution failed');
    });
  });

  describe('Static Methods', (): void => {
    it('should provide quick load method', async (): Promise<void> => {
      const validConfig: MCPConfig = {
        mcpServers: {
          testServer: {
            command: 'node'
          }
        }
      };

      await fs.writeFile(localConfigPath, JSON.stringify(validConfig));

      const config = await MCPConfigLoader.load({ localPath: localConfigPath });

      expect(config.mcpServers['testServer']).toBeDefined();
      
      const serverConfig = config.mcpServers['testServer'];
      if (serverConfig && isLocalServerConfig(serverConfig)) {
        expect(serverConfig.command).toBe('node');
      } else {
        fail('Expected local server config');
      }
    });

    it('should throw on load failure', async (): Promise<void> => {
      const nonExistentPath = path.join(testConfigDir, 'nonexistent.json');

      await expect(MCPConfigLoader.load({ localPath: nonExistentPath })).rejects.toThrow();
    });
  });

  describe('Configuration Path Resolution', (): void => {
    it('should resolve custom config paths', (): void => {
      const localPath = '/custom/path/local.json';
      const globalPath = '/custom/path/global.json';
      const loader = new MCPConfigLoader({ localPath, globalPath });

      const paths = loader.getConfigPaths();
      expect(paths).toContain(globalPath);
      expect(paths).toContain(localPath);
    });

    it('should check config existence', async (): Promise<void> => {
      await fs.writeFile(localConfigPath, '{}');

      const loader = MCPConfigLoader.createForTesting({ localPath: localConfigPath });
      expect(await loader.configExists()).toBe(true);

      await fs.unlink(localConfigPath);
      expect(await loader.configExists()).toBe(false);
    });
  });
});