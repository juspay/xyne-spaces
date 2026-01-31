import { 
  isLocalServerConfig, 
  isRemoteServerConfig,
  type MCPLocalServerConfig,
  type MCPRemoteServerConfig,
  type MCPServerConfig
} from '../../../core/types/config.js';

describe('MCP Config Type Guards', (): void => {
  describe('isLocalServerConfig', (): void => {
    it('should identify local server config correctly', (): void => {
      const localConfig: MCPLocalServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'production' },
        timeout: 5000
      };

      expect(isLocalServerConfig(localConfig)).toBe(true);
    });

    it('should reject remote server config', (): void => {
      const remoteConfig: MCPRemoteServerConfig = {
        transport: {
          type: 'http',
          url: 'http://localhost:8080'
        }
      };

      expect(isLocalServerConfig(remoteConfig)).toBe(false);
    });

    it('should handle minimal local config', (): void => {
      const minimalConfig: MCPLocalServerConfig = {
        command: 'python'
      };

      expect(isLocalServerConfig(minimalConfig)).toBe(true);
    });
  });

  describe('isRemoteServerConfig', (): void => {
    it('should identify remote server config correctly', (): void => {
      const remoteConfig: MCPRemoteServerConfig = {
        transport: {
          type: 'websocket',
          url: 'ws://localhost:8080',
          headers: {
            authorization: 'Bearer token'
          }
        },
        auth: {
          type: 'bearer',
          token: 'secret-token'
        }
      };

      expect(isRemoteServerConfig(remoteConfig)).toBe(true);
    });

    it('should reject local server config', (): void => {
      const localConfig: MCPLocalServerConfig = {
        command: 'node',
        args: ['server.js']
      };

      expect(isRemoteServerConfig(localConfig)).toBe(false);
    });

    it('should handle minimal remote config', (): void => {
      const minimalConfig: MCPRemoteServerConfig = {
        transport: {
          type: 'http',
          url: 'http://example.com'
        }
      };

      expect(isRemoteServerConfig(minimalConfig)).toBe(true);
    });
  });

  describe('Mixed Config Arrays', (): void => {
    it('should correctly identify mixed server configs', (): void => {
      const configs: MCPServerConfig[] = [
        {
          command: 'node',
          args: ['local-server.js']
        },
        {
          transport: {
            type: 'http',
            url: 'http://remote-server.com'
          }
        },
        {
          command: 'python',
          args: ['-m', 'server']
        }
      ];

      const localConfigs = configs.filter(isLocalServerConfig);
      const remoteConfigs = configs.filter(isRemoteServerConfig);

      expect(localConfigs).toHaveLength(2);
      expect(remoteConfigs).toHaveLength(1);
      
      expect(localConfigs[0]).toHaveProperty('command', 'node');
      expect(localConfigs[1]).toHaveProperty('command', 'python');
      expect(remoteConfigs[0]).toHaveProperty('transport');
    });
  });

  describe('Type Safety', (): void => {
    it('should provide proper type narrowing for local configs', (): void => {
      const config: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'test' }
      };

      if (isLocalServerConfig(config)) {
        // TypeScript should know this is MCPLocalServerConfig
        expect(config.command).toBe('node');
        expect(config.args).toEqual(['server.js']);
        expect(config.env).toEqual({ NODE_ENV: 'test' });
        
        // This should not cause TypeScript errors
        const command: string = config.command;
        const args: readonly string[] | undefined = config.args;
        
        expect(command).toBeDefined();
        expect(args).toBeDefined();
      } else {
        fail('Should have identified as local config');
      }
    });

    it('should provide proper type narrowing for remote configs', (): void => {
      const config: MCPServerConfig = {
        transport: {
          type: 'websocket',
          url: 'ws://test.com',
          timeout: 10000
        },
        auth: {
          type: 'api-key',
          apiKey: 'secret',
          header: 'X-API-Key'
        }
      };

      if (isRemoteServerConfig(config)) {
        // TypeScript should know this is MCPRemoteServerConfig
        expect(config.transport.type).toBe('websocket');
        expect(config.transport.url).toBe('ws://test.com');
        expect(config.auth?.type).toBe('api-key');
        
        // This should not cause TypeScript errors
        const transportType: 'http' | 'websocket' = config.transport.type;
        const authType: string | undefined = config.auth?.type;
        
        expect(transportType).toBeDefined();
        expect(authType).toBeDefined();
      } else {
        fail('Should have identified as remote config');
      }
    });
  });
});